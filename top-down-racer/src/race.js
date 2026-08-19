/* The race itself: the grid, the surface under each car, contact between
   cars, lap counting and the order. No canvas and no DOM, so a whole race
   can be run headless. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var clamp = util.clamp;
  var Car = Racer.physics.Car;

  var LIVERIES = [
    { name: 'Meridian', colour: '#f8fafc', accent: '#dc2626' },
    { name: 'Kestrel', colour: '#22d3ee', accent: '#0e7490' },
    { name: 'Calder', colour: '#fbbf24', accent: '#92400e' },
    { name: 'Vantor', colour: '#a78bfa', accent: '#4c1d95' },
    { name: 'Bellamy', colour: '#4ade80', accent: '#14532d' },
    { name: 'Orsini', colour: '#fb7185', accent: '#881337' },
    { name: 'Delcourt', colour: '#60a5fa', accent: '#1e3a8a' },
    { name: 'Rovane', colour: '#fdba74', accent: '#7c2d12' }
  ];

  var GRID_ROW = 96;        /* gap between rows, px along the track */
  var GRID_OFFSET = 44;     /* how far off the centreline each column sits */
  var GRID_LEAD = 64;       /* front row's gap back from the line */
  var WALL_GAP = 96;        /* grass beyond the kerb before the barrier */

  function Race(track, opts) {
    opts = opts || {};
    this.track = track;
    this.totalLaps = opts.laps || 3;
    this.difficulty = opts.difficulty || 'even';
    this.opponents = opts.opponents == null ? 4 : opts.opponents;
    this.seed = opts.seed || 20260819;

    this.cars = [];
    this.drivers = [];
    this.time = 0;              /* seconds since the lights went out */
    this.state = 'countdown';   /* countdown | racing | finished */
    this.countdown = 3.2;
    this.contacts = [];         /* contacts this step, for sound/sparks */

    this._build();
  }

  Race.prototype._build = function () {
    var track = this.track;
    var total = this.opponents + 1;

    /* The player starts at the back — there is nothing to do from pole. */
    for (var slot = 0; slot < total; slot++) {
      var isPlayer = slot === total - 1;
      var livery = LIVERIES[slot % LIVERIES.length];
      var place = this._gridSlot(slot);
      var car = new Car({
        x: place.x, y: place.y, heading: place.heading,
        name: isPlayer ? 'You' : livery.name,
        colour: isPlayer ? '#f8fafc' : livery.colour,
        accent: isPlayer ? '#0284c7' : livery.accent,
        isPlayer: isPlayer
      });
      car.gridSlot = slot;
      car.station = place.station;
      car.position = slot + 1;
      this.cars.push(car);
    }

    var rivals = this.cars.filter(function (c) { return !c.isPlayer; });
    this.drivers = Racer.ai.makeField(rivals, track, this.difficulty, this.seed);
    this.player = this.cars[this.cars.length - 1];
    this._rank();
  };

  Race.prototype._gridSlot = function (slot) {
    var track = this.track;
    var row = Math.floor(slot / 2), col = slot % 2;
    var back = GRID_LEAD + row * GRID_ROW;
    var station = track.station(track.count - Math.round(back / track.spacing));
    var frame = track.frames[station], centre = track.centre[station];
    var side = col === 0 ? 1 : -1;
    return {
      x: centre.x + frame.nx * side * GRID_OFFSET,
      y: centre.y + frame.ny * side * GRID_OFFSET,
      heading: frame.heading,
      station: station
    };
  };

  Race.prototype.surfaceFor = function (car) {
    var lat = Math.abs(this.track.lateral(car.x, car.y, car.station));
    var half = this.track.halfWidth;
    if (lat <= half - 6) return 'tarmac';
    if (lat <= half + 12) return 'kerb';
    return 'grass';
  };

  Race.prototype.step = function (dt, playerControls) {
    this.contacts.length = 0;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.state = 'racing'; this.countdown = 0; }
    } else if (this.state === 'racing') {
      this.time += dt;
    }

    var racing = this.state === 'racing';
    var idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    for (var d = 0; d < this.drivers.length; d++) {
      var driver = this.drivers[d];
      var car = driver.car;
      var controls = (racing && !car.finished) ? driver.update(dt, this.cars, this.time) : idle;
      car.update(dt, controls, this.surfaceFor(car));
    }

    var pc = (racing && !this.player.finished) ? (playerControls || idle) : idle;
    this.player.update(dt, pc, this.surfaceFor(this.player));

    this._collide();
    for (var i = 0; i < this.cars.length; i++) {
      this._confine(this.cars[i]);
      this._advance(this.cars[i], dt);
    }
    this._rank();

    if (this.state === 'racing' && this.cars.every(function (c) { return c.finished; })) {
      this.state = 'finished';
    }
    return this;
  };

  /* Track position, laps and lap times. */
  Race.prototype._advance = function (car, dt) {
    var track = this.track, n = track.count;
    var previous = car.station;
    car.station = track.nearest(car.x, car.y, previous).index;

    var delta = car.station - previous;
    if (delta < -n / 2) {
      /* Crossed the line going the right way. */
      if (!car.started) {
        car.started = true;
        car.lapStart = this.time;
      } else if (!car.finished) {
        car.lapsDone += 1;
        var lap = this.time - car.lapStart;
        car.lastLap = lap * 1000;
        car.lapTimes.push(car.lastLap);
        if (car.bestLap == null || car.lastLap < car.bestLap) car.bestLap = car.lastLap;
        car.lapStart = this.time;
        if (car.lapsDone >= this.totalLaps) {
          car.finished = true;
          car.finishTime = this.time * 1000;
        }
      }
    } else if (delta > n / 2 && car.started) {
      /* Went back over it; do not hand out a free lap for driving in reverse. */
      car.lapsDone = Math.max(0, car.lapsDone - 1);
    }

    car.progress = (car.started ? car.lapsDone : -1) + car.station / n;
    if (car.surface === 'grass') car.offTrackFor += dt; else car.offTrackFor = 0;
  };

  /* Cars are two overlapping discs — close enough to a rectangle that nose to
     tail contact feels different from side by side. */
  var DISC = 13;

  Race.prototype._discs = function (car) {
    var cos = Math.cos(car.heading), sin = Math.sin(car.heading);
    var d = car.spec.length / 2 - DISC;
    return [
      { x: car.x + cos * d, y: car.y + sin * d },
      { x: car.x - cos * d, y: car.y - sin * d }
    ];
  };

  Race.prototype._collide = function () {
    var cars = this.cars;
    for (var i = 0; i < cars.length; i++) {
      for (var j = i + 1; j < cars.length; j++) {
        var a = cars[i], b = cars[j];
        if (Math.abs(a.x - b.x) > 70 || Math.abs(a.y - b.y) > 70) continue;
        var da = this._discs(a), db = this._discs(b);
        for (var p = 0; p < 2; p++) {
          for (var q = 0; q < 2; q++) {
            var dx = db[q].x - da[p].x, dy = db[q].y - da[p].y;
            var d2 = dx * dx + dy * dy;
            var min = DISC * 2;
            if (d2 >= min * min || d2 < 1e-9) continue;
            var d = Math.sqrt(d2);
            var nx = dx / d, ny = dy / d;
            var overlap = min - d;

            a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;

            var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) {
              var impulse = -rel * 0.62;           /* equal masses, part elastic */
              a.vx -= nx * impulse; a.vy -= ny * impulse;
              b.vx += nx * impulse; b.vy += ny * impulse;
              this.contacts.push({
                x: (da[p].x + db[q].x) / 2, y: (da[p].y + db[q].y) / 2,
                force: Math.min(1, Math.abs(rel) / 260)
              });
            }
          }
        }
      }
    }
  };

  /* Grass runs out eventually. */
  Race.prototype._confine = function (car) {
    var track = this.track;
    var station = track.nearest(car.x, car.y, car.station).index;
    var frame = track.frames[station], centre = track.centre[station];
    var lat = (car.x - centre.x) * frame.nx + (car.y - centre.y) * frame.ny;
    var wall = track.halfWidth + WALL_GAP;
    if (Math.abs(lat) <= wall) return;

    var sign = lat > 0 ? 1 : -1;
    car.x = centre.x + frame.nx * sign * wall;
    car.y = centre.y + frame.ny * sign * wall;

    /* Scrub off the velocity heading into the barrier, keep most of the rest. */
    var into = car.vx * frame.nx * sign + car.vy * frame.ny * sign;
    if (into > 0) {
      car.vx -= frame.nx * sign * into * 1.35;
      car.vy -= frame.ny * sign * into * 1.35;
      car.vx *= 0.86; car.vy *= 0.86;
      this.contacts.push({ x: car.x, y: car.y, force: Math.min(1, into / 200), wall: true });
    }
  };

  Race.prototype._rank = function () {
    var order = this.cars.slice().sort(function (a, b) {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    for (var i = 0; i < order.length; i++) order[i].position = i + 1;
    this.order = order;
    return order;
  };

  /* Gap to the car ahead: how long it would take to cover the road between
     them at the chasing car's current pace. Available from the first corner,
     unlike anything based on lap times. */
  Race.prototype.gapAhead = function (car) {
    var idx = this.order.indexOf(car);
    if (idx <= 0) return null;
    var ahead = this.order[idx - 1];
    var laps = ahead.progress - car.progress;
    if (laps <= 0) return { lapsBehind: 0, ms: 0 };
    var road = laps * this.track.length;
    var pace = Math.max(car.speed, 90);
    return { lapsBehind: Math.floor(laps), ms: (road / pace) * 1000 };
  };

  Racer.race = { Race: Race, LIVERIES: LIVERIES, WALL_GAP: WALL_GAP };
})(globalThis.Racer = globalThis.Racer || {});
