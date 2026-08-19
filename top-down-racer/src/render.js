/* Drawing. The circuit never changes, so it is painted once into an offscreen
   canvas the size of the world and blitted from there; only the cars, the
   rubber they leave and the camera move each frame. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var clamp = util.clamp;

  var PALETTE = {
    grass: '#24402c',
    grassAlt: '#1f3826',
    runoff: '#8a7f63',
    kerbA: '#d94f4f',
    kerbB: '#f2f2f2',
    tarmac: '#3a3f47',
    tarmacEdge: '#2c3038',
    paint: '#e8ecf1',
    startDark: '#1c1f24',
    startLight: '#f1f5f9'
  };

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function traceCorridor(ctx, track, width) {
    var n = track.count, half = width / 2;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var f = track.frames[i], c = track.centre[i];
      var x = c.x + f.nx * half, y = c.y + f.ny * half;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (var j = n - 1; j >= 0; j--) {
      var f2 = track.frames[j], c2 = track.centre[j];
      ctx.lineTo(c2.x - f2.nx * half, c2.y - f2.ny * half);
    }
    ctx.closePath();
  }

  function traceOffset(ctx, track, offset) {
    var n = track.count;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var k = i % n;
      var f = track.frames[k], c = track.centre[k];
      var x = c.x + f.nx * offset, y = c.y + f.ny * offset;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* Kerbs go on the inside of anything tight enough to be worth cutting, and
     on the outside of the same corner where a car would run wide. */
  function paintKerbs(ctx, track) {
    var n = track.count, half = track.halfWidth;
    var runs = [];
    var open = null;
    for (var i = 0; i < n; i++) {
      var k = track.curvature[i];
      if (Math.abs(k) > 0.0016) {
        if (!open || Math.sign(k) !== open.sign) {
          open = { start: i, end: i, sign: Math.sign(k) };
          runs.push(open);
        } else open.end = i;
      } else open = null;
    }

    runs.forEach(function (run) {
      var length = run.end - run.start;
      if (length < 14) return;
      [1, -1].forEach(function (side) {
        var inner = side === -run.sign;
        var offset = side * (half - 9);
        var stripe = 0;
        for (var s = run.start; s < run.end; s += 7) {
          var a = track.frames[s], ca = track.centre[s];
          var e = Math.min(s + 7, run.end);
          var b = track.frames[e], cb = track.centre[e];
          ctx.beginPath();
          ctx.moveTo(ca.x + a.nx * offset, ca.y + a.ny * offset);
          ctx.lineTo(cb.x + b.nx * offset, cb.y + b.ny * offset);
          ctx.strokeStyle = (stripe++ % 2) ? PALETTE.kerbA : PALETTE.kerbB;
          ctx.lineWidth = inner ? 17 : 13;
          ctx.globalAlpha = inner ? 1 : 0.75;
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    });
  }

  function paintStartLine(ctx, track) {
    var half = track.halfWidth;
    var f = track.frames[0], c = track.centre[0];
    var cols = 12, depth = 34;
    var cell = (half * 2) / cols;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(f.heading);
    for (var col = 0; col < cols; col++) {
      for (var row = 0; row < 2; row++) {
        ctx.fillStyle = ((col + row) % 2) ? PALETTE.startLight : PALETTE.startDark;
        ctx.fillRect(-depth / 2 + row * (depth / 2), -half + col * cell, depth / 2, cell);
      }
    }
    ctx.restore();

    /* Grid boxes, so the start looks like a start. */
    ctx.strokeStyle = 'rgba(232,236,241,0.5)';
    ctx.lineWidth = 3;
    for (var slot = 0; slot < 8; slot++) {
      var row2 = Math.floor(slot / 2), col2 = slot % 2;
      var back = 64 + row2 * 96;
      var station = track.station(track.count - Math.round(back / track.spacing));
      var sf = track.frames[station], sc = track.centre[station];
      var side = col2 === 0 ? 1 : -1;
      ctx.save();
      ctx.translate(sc.x + sf.nx * side * 44, sc.y + sf.ny * side * 44);
      ctx.rotate(sf.heading);
      ctx.strokeRect(-30, -20, 60, 40);
      ctx.restore();
    }
  }

  /* A little seeded speckle so the grass and tarmac are not flat colour. */
  function speckle(ctx, track, world) {
    var rand = util.mulberry32(90210);
    ctx.save();
    for (var i = 0; i < 7000; i++) {
      var x = rand() * world.width, y = rand() * world.height;
      var r = 0.8 + rand() * 2.6;
      ctx.globalAlpha = 0.03 + rand() * 0.045;
      ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, util.TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function buildScenery(track) {
    var world = track.world;
    var canvas = makeCanvas(world.width, world.height);
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = PALETTE.grassAlt;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 64;
    for (var band = -world.height; band < world.width; band += 190) {
      ctx.beginPath();
      ctx.moveTo(band, 0);
      ctx.lineTo(band + world.height, world.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* Run-off, then the road on top of it. */
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    traceOffset(ctx, track, 0);
    ctx.strokeStyle = PALETTE.runoff;
    /* The painted run-off ends exactly at the barrier, so what you can see is
       what you can still drive on. */
    ctx.lineWidth = (track.halfWidth + Racer.race.WALL_GAP) * 2;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    traceCorridor(ctx, track, track.halfWidth * 2 + 12);
    ctx.fillStyle = PALETTE.tarmacEdge;
    ctx.fill('evenodd');

    traceCorridor(ctx, track, track.halfWidth * 2);
    ctx.fillStyle = PALETTE.tarmac;
    ctx.fill('evenodd');

    paintKerbs(ctx, track);

    /* Edge paint. */
    [1, -1].forEach(function (side) {
      traceOffset(ctx, track, side * (track.halfWidth - 4));
      ctx.strokeStyle = PALETTE.paint;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.65;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    paintStartLine(ctx, track);
    speckle(ctx, track, world);
    return canvas;
  }

  /* ------------------------------------------------------------------ */

  function Camera(track) {
    this.track = track;
    this.x = track.centre[0].x;
    this.y = track.centre[0].y;
    this.scale = 1;
    this.shake = 0;
    this.reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  }

  Camera.prototype.follow = function (car, cssW, cssH, dpr, dt, snap) {
    /* Look where the car is going, not where it is. */
    var lead = clamp(car.speed / 430, 0, 1);
    var targetX = car.x + car.vx * 0.28;
    var targetY = car.y + car.vy * 0.28;
    var ease = snap ? 1 : clamp(dt * 6.5, 0, 1);
    this.x += (targetX - this.x) * ease;
    this.y += (targetY - this.y) * ease;

    /* Show a fixed span of circuit whatever the screen: about 1150 world px
       across, a little more when the car is travelling quickly. */
    var want = Math.max(cssW / 1150, cssH / 730) * (1 - 0.11 * lead);
    var target = clamp(want, 0.55, 2.1) * dpr;
    this.scale += (target - this.scale) * (snap ? 1 : clamp(dt * 3, 0, 1));

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);
  };

  Camera.prototype.bump = function (force) {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, this.shake + force * 0.8);
  };

  Camera.prototype.apply = function (ctx, viewW, viewH) {
    var jitterX = 0, jitterY = 0;
    if (this.shake > 0) {
      var s = this.shake * this.shake * 9;
      jitterX = (Math.random() - 0.5) * s;
      jitterY = (Math.random() - 0.5) * s;
    }
    ctx.setTransform(this.scale, 0, 0, this.scale,
      viewW / 2 - this.x * this.scale + jitterX,
      viewH / 2 - this.y * this.scale + jitterY);
  };

  /* ------------------------------------------------------------------ */

  function Renderer(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.scenery = buildScenery(track);
    this.rubber = makeCanvas(track.world.width, track.world.height);
    this.rubberCtx = this.rubber.getContext('2d');
    this.camera = new Camera(track);
    this.fadeClock = 0;
    this.dpr = 1;
    this.viewW = canvas.width;
    this.viewH = canvas.height;
  }

  Renderer.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.viewW = w;
    this.viewH = h;
  };

  Renderer.prototype.clearRubber = function () {
    this.rubberCtx.clearRect(0, 0, this.rubber.width, this.rubber.height);
  };

  /* Rubber goes down where a tyre is being dragged sideways. */
  Renderer.prototype.layRubber = function (cars, dt) {
    var ctx = this.rubberCtx;
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i];
      if (car.surface === 'grass') continue;
      var slip = Math.abs(car.slip);
      if (slip < 42 || car.speed < 30) continue;
      var alpha = clamp((slip - 42) / 150, 0, 1) * 0.5;
      var cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      var lx = car.spec.length / 2 - 8, wy = car.spec.width / 2 - 1;
      ctx.strokeStyle = 'rgba(16,18,22,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (var s = -1; s <= 1; s += 2) {
        for (var f = -1; f <= 1; f += 2) {
          var wx = car.x + cos * lx * f - sin * wy * s;
          var wy2 = car.y + sin * lx * f + cos * wy * s;
          ctx.beginPath();
          ctx.moveTo(wx - car.vx * dt, wy2 - car.vy * dt);
          ctx.lineTo(wx, wy2);
          ctx.stroke();
        }
      }
    }

    /* Let old marks go, slowly, so a long race does not end up solid black. */
    this.fadeClock += dt;
    if (this.fadeClock > 1.5) {
      this.fadeClock = 0;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fillRect(0, 0, this.rubber.width, this.rubber.height);
      ctx.restore();
    }
  };

  function drawCar(ctx, car, isPlayer) {
    var s = car.spec;
    var L = s.length, W = s.width;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, -L / 2 + 2, -W / 2 + 4, L, W, 6);
    ctx.fill();

    /* Wheels: the fronts show the steering angle. */
    ctx.fillStyle = '#15171c';
    var axle = L / 2 - 9;
    [[axle, car.steer], [-axle, 0]].forEach(function (pair) {
      [-1, 1].forEach(function (side) {
        ctx.save();
        ctx.translate(pair[0], side * (W / 2 - 1));
        ctx.rotate(pair[1]);
        roundRect(ctx, -7, -3.2, 14, 6.4, 2.4);
        ctx.fill();
        ctx.restore();
      });
    });

    var body = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    body.addColorStop(0, car.colour);
    body.addColorStop(0.55, car.colour);
    body.addColorStop(1, shade(car.colour, -0.28));
    ctx.fillStyle = body;
    roundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.fill();

    ctx.fillStyle = car.accent;
    roundRect(ctx, -L / 2 + 3, -W / 2 + 2, 9, W - 4, 3);
    ctx.fill();
    roundRect(ctx, L / 2 - 12, -W / 2 + 2, 9, W - 4, 3);
    ctx.fill();

    ctx.fillStyle = 'rgba(12,16,24,0.82)';
    roundRect(ctx, -3, -W / 2 + 3, 13, W - 6, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.stroke();

    if (isPlayer) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, L / 2 + 7, 0, util.TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function shade(hex, amount) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    var rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].map(function (v) {
      return clamp(Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount)), 0, 255);
    });
    return 'rgb(' + rgb.join(',') + ')';
  }

  Renderer.prototype.draw = function (race, dt) {
    var ctx = this.ctx;
    var viewW = this.viewW, viewH = this.viewH;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, viewW, viewH);

    this.camera.apply(ctx, viewW, viewH);
    ctx.imageSmoothingEnabled = true;

    /* Only the visible slice of the world is worth blitting. */
    var pad = 80;
    var sx = this.camera.x - viewW / (2 * this.camera.scale) - pad;
    var sy = this.camera.y - viewH / (2 * this.camera.scale) - pad;
    var sw = viewW / this.camera.scale + pad * 2;
    var sh = viewH / this.camera.scale + pad * 2;
    var cx = clamp(sx, 0, this.scenery.width);
    var cy = clamp(sy, 0, this.scenery.height);
    var cw = clamp(sx + sw, 0, this.scenery.width) - cx;
    var ch = clamp(sy + sh, 0, this.scenery.height) - cy;
    if (cw > 0 && ch > 0) {
      ctx.drawImage(this.scenery, cx, cy, cw, ch, cx, cy, cw, ch);
      ctx.drawImage(this.rubber, cx, cy, cw, ch, cx, cy, cw, ch);
    }

    for (var i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      if (car === race.player) continue;
      drawCar(ctx, car, false);
    }
    drawCar(ctx, race.player, true);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* The inset map: the whole circuit, with everyone on it. */
  Renderer.prototype.drawMinimap = function (canvas, race) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    var track = this.track, world = track.world;
    var pad = 8 * dpr;
    var scale = Math.min((w - pad * 2) / world.width, (h - pad * 2) / world.height);
    var ox = (w - world.width * scale) / 2;
    var oy = (h - world.height * scale) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);

    ctx.beginPath();
    for (var i = 0; i <= track.count; i++) {
      var p = track.centre[i % track.count];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(148,163,184,0.8)';
    ctx.lineWidth = 66;
    ctx.lineJoin = 'round';
    ctx.stroke();

    var start = track.centre[0], sf = track.frames[0];
    ctx.beginPath();
    ctx.moveTo(start.x + sf.nx * track.halfWidth, start.y + sf.ny * track.halfWidth);
    ctx.lineTo(start.x - sf.nx * track.halfWidth, start.y - sf.ny * track.halfWidth);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 14;
    ctx.stroke();

    for (var c = 0; c < race.cars.length; c++) {
      var car = race.cars[c];
      ctx.beginPath();
      ctx.arc(car.x, car.y, car.isPlayer ? 46 : 34, 0, util.TAU);
      ctx.fillStyle = car.isPlayer ? '#38bdf8' : car.colour;
      ctx.fill();
      if (car.isPlayer) {
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#0f172a';
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  Racer.render = { Renderer: Renderer, PALETTE: PALETTE, buildScenery: buildScenery };
})(globalThis.Racer = globalThis.Racer || {});
