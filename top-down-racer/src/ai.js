/* Rival drivers. Each one chases a point further along the racing line, and
   holds the speed the track's own profile says that stretch is worth. Skill
   scales both, so the field spreads out instead of running nose to tail. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var clamp = util.clamp;

  function Driver(car, track, opts) {
    this.car = car;
    this.track = track;
    this.skill = opts.skill;                 /* 0..1, scales corner speed */
    this.aggression = opts.aggression;       /* how late it lifts near others */
    this.rand = opts.rand;
    this.lineBias = (this.rand() - 0.5) * 26;  /* its own take on the line */
    this.wobblePhase = this.rand() * Math.PI * 2;
    this.recovering = 0;
    this.stuckFor = 0;
  }

  /* Distance to look ahead grows with speed: enough to see the corner, not so
     far that the car cuts across the apex of the one it is still in. */
  Driver.prototype._lookahead = function () {
    return 58 + this.car.speed * 0.42;
  };

  Driver.prototype.update = function (dt, field, elapsed) {
    var car = this.car, track = this.track;
    var station = car.station;
    var spacing = track.spacing;

    var lookahead = this._lookahead();
    var aimStation = track.station(station + Math.round(lookahead / spacing));
    var aim = track.racingLine[aimStation];
    var frame = track.frames[aimStation];

    /* A small, slow lateral bias keeps rivals from stacking on one line. */
    var wobble = Math.sin(elapsed * 0.6 + this.wobblePhase) * 8;
    var bias = this.lineBias + wobble;

    /* Nudge the aim point around anyone directly ahead. */
    var dodge = this._avoid(field, station);
    bias += dodge;
    var limit = track.halfWidth - 20;
    var aimOffset = clamp(aim.offset + bias, -limit, limit);
    var centre = track.centre[aimStation];
    var targetX = centre.x + frame.nx * aimOffset;
    var targetY = centre.y + frame.ny * aimOffset;

    var toTarget = Math.atan2(targetY - car.y, targetX - car.x);
    var error = util.angleDelta(car.heading, toTarget);

    /* Counter-steer into a slide, the way you would. */
    var slipAngle = Math.atan2(car.slip, Math.abs(car.forwardSpeed) + 40);
    var steer = clamp(error * 2.4 - slipAngle * 1.15, -1, 1);

    /* Speed: the lowest target between here and the far end of the braking
       zone, so the car is already slowing before it arrives. */
    var brakingWindow = Math.max(lookahead, 80 + car.speed * car.speed / 900);
    var steps = Math.round(brakingWindow / spacing);
    var target = Infinity;
    for (var i = 0; i <= steps; i += 2) {
      var v = track.targetSpeed[track.station(station + i)];
      /* Allow for the fact that the car can still slow down on the way there. */
      var reachable = Math.sqrt(v * v + 2 * 520 * i * spacing);
      if (reachable < target) target = reachable;
    }
    target = Math.min(target, track.targetSpeed[station] * 1.06) * this.skill;

    if (car.surface === 'grass') target = Math.min(target, 190);

    var throttle = 0, brake = 0;
    if (car.speed < target * 0.99) throttle = 1;
    else if (car.speed > target * 1.02) brake = clamp((car.speed - target) / 55, 0.15, 1);

    /* Hard to steer with the fronts locked: ease off the brake when the wheel
       is turned a long way. */
    if (brake > 0 && Math.abs(steer) > 0.7) brake *= 0.55;

    /* If it has beached itself, back up and try again rather than sit there. */
    if (car.speed < 26 && !car.finished) this.stuckFor += dt; else this.stuckFor = 0;
    if (this.stuckFor > 1.4) this.recovering = 1.1;
    if (this.recovering > 0) {
      this.recovering -= dt;
      var behind = Math.abs(error) > Math.PI / 2;
      throttle = behind ? 0 : 1;
      brake = behind ? 1 : 0;
      steer = behind ? -clamp(error * 2, -1, 1) : clamp(error * 2.4, -1, 1);
    }

    return { throttle: throttle, brake: brake, steer: steer, handbrake: false };
  };

  /* Look for a car just ahead on a similar line and pick a side to go. */
  Driver.prototype._avoid = function (field, station) {
    var car = this.car, track = this.track, n = track.count;
    var myLat = track.lateral(car.x, car.y, station);
    var push = 0;
    for (var i = 0; i < field.length; i++) {
      var other = field[i];
      if (other === car) continue;
      var gap = other.station - station;
      if (gap < -n / 2) gap += n; else if (gap > n / 2) gap -= n;
      var ahead = gap * track.spacing;
      if (ahead < 4 || ahead > 190) continue;          /* behind, or too far to matter */
      var theirLat = track.lateral(other.x, other.y, other.station);
      var sideways = theirLat - myLat;
      if (Math.abs(sideways) > 46) continue;           /* already on another line */
      var urgency = (190 - ahead) / 190 * (1.1 - this.aggression * 0.45);
      /* Go for the side with more road, unless that side is the outside of a
         corner the car is about to need. */
      var dir = sideways >= 0 ? -1 : 1;
      if (Math.abs(myLat + dir * 40) > track.halfWidth - 24) dir = -dir;
      push += dir * 56 * urgency;
    }
    return clamp(push, -70, 70);
  };

  /* A field whose pace fans out, then gets shuffled across the grid: if the
     quickest rival always started from pole, every race would be the same
     race. */
  function makeField(cars, track, difficulty, seed) {
    var rand = util.mulberry32(seed || 1);
    var base = { relaxed: 0.85, even: 0.93, ruthless: 0.995 }[difficulty] || 0.93;

    var skills = cars.map(function (_, i) {
      return clamp(base - i * 0.012 + (rand() - 0.5) * 0.02, 0.7, 1.04);
    });
    for (var i = skills.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var swap = skills[i]; skills[i] = skills[j]; skills[j] = swap;
    }

    return cars.map(function (car, i) {
      return new Driver(car, track, {
        skill: skills[i],
        aggression: clamp(0.35 + rand() * 0.5, 0, 1),
        rand: rand
      });
    });
  }

  Racer.ai = { Driver: Driver, makeField: makeField };
})(globalThis.Racer = globalThis.Racer || {});
