/* Track geometry: spline -> uniformly spaced centreline -> edges, racing line,
   and a per-station target speed the AI drives to. Built once at start-up. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var catmullRom = util.catmullRom;
  var clamp = util.clamp;

  /* Control points run clockwise. Index 0 sits on the start/finish line, which
     puts the run-up to the grid at the tail of the loop. */
  var CIRCUIT = {
    name: 'Vallon Circuit',
    world: { width: 2600, height: 1700 },
    halfWidth: 105,
    sampleSpacing: 6,
    points: [
      { x: 1700, y: 1420 },                                    /* start/finish */
      { x: 2000, y: 1420 }, { x: 2250, y: 1370 }, { x: 2410, y: 1210 },
      { x: 2430, y: 990 },  { x: 2380, y: 780 },  { x: 2200, y: 650 },
      { x: 2020, y: 560 },  { x: 1880, y: 450 },  { x: 1760, y: 300 },
      { x: 1560, y: 200 },  { x: 1250, y: 190 },  { x: 930, y: 240 },
      { x: 680, y: 330 },   { x: 480, y: 480 },   { x: 370, y: 680 },
      { x: 330, y: 900 },   { x: 350, y: 1120 },
      /* the final corner is a tangent-matched arc: entered heading due south,
         left heading due east, on points close enough together to hold a
         radius tight enough to brake for */
      { x: 350, y: 1250 },  { x: 373, y: 1335 },  { x: 435, y: 1397 },
      { x: 520, y: 1420 },
      /* collinear with the start/finish point: 1050 px of straight run-up */
      { x: 650, y: 1420 },  { x: 900, y: 1420 },  { x: 1300, y: 1420 }
    ]
  };

  /* Dense spline sample, then resample at a uniform arc-length spacing so every
     downstream index step means the same distance on track. */
  function sampleCentreline(points, spacing) {
    var n = points.length;
    var raw = [];
    var sub = 48;
    var tmp = { x: 0, y: 0 };
    for (var i = 0; i < n; i++) {
      var p0 = points[(i - 1 + n) % n], p1 = points[i];
      var p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (var s = 0; s < sub; s++) {
        catmullRom(p0, p1, p2, p3, s / sub, tmp);
        raw.push({ x: tmp.x, y: tmp.y });
      }
    }

    var cum = [0];
    for (var j = 1; j <= raw.length; j++) {
      var a = raw[j - 1], b = raw[j % raw.length];
      cum.push(cum[j - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    var total = cum[raw.length];

    var count = Math.max(64, Math.round(total / spacing));
    var step = total / count;
    var out = [];
    var cursor = 0;
    for (var k = 0; k < count; k++) {
      var target = k * step;
      while (cursor < raw.length - 1 && cum[cursor + 1] < target) cursor++;
      var segLen = cum[cursor + 1] - cum[cursor];
      var t = segLen > 1e-9 ? (target - cum[cursor]) / segLen : 0;
      var ra = raw[cursor], rb = raw[(cursor + 1) % raw.length];
      out.push({ x: ra.x + (rb.x - ra.x) * t, y: ra.y + (rb.y - ra.y) * t });
    }
    return { points: out, length: total, spacing: step };
  }

  /* Tangent/normal from the neighbours either side, so both are centred on the
     station rather than lagging half a step behind it. */
  function buildFrames(pts) {
    var n = pts.length;
    var frames = new Array(n);
    for (var i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      var dx = next.x - prev.x, dy = next.y - prev.y;
      var len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      /* Normal points to the car's left when travelling along the tangent. */
      frames[i] = { tx: dx, ty: dy, nx: dy, ny: -dx, heading: Math.atan2(dy, dx) };
    }
    return frames;
  }

  /* Signed curvature (1/radius) from the heading change per unit distance. */
  function buildCurvature(frames, spacing) {
    var n = frames.length;
    var k = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var d = util.angleDelta(frames[(i - 1 + n) % n].heading, frames[(i + 1) % n].heading);
      k[i] = d / (2 * spacing);
    }
    /* A light smooth: raw curvature off a discrete spline is noisy enough to
       make the AI's speed target jitter. */
    var smooth = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      var acc = 0;
      for (var w = -3; w <= 3; w++) acc += k[(j + w + n) % n];
      smooth[j] = acc / 7;
    }
    return smooth;
  }

  /* Relax the line toward minimum curvature while pinning each point to its own
     station's normal, which keeps it inside the corridor. Converges to a
     recognisable racing line: out-in-out through the corners. */
  function buildRacingLine(centre, frames, halfWidth, margin) {
    var n = centre.length;
    var limit = Math.max(0, halfWidth - margin);
    var offset = new Float64Array(n);
    var strides = [64, 32, 16, 8, 4, 2, 1];
    for (var si = 0; si < strides.length; si++) {
      var s = Math.min(strides[si], Math.floor(n / 4)) || 1;
      for (var pass = 0; pass < 160; pass++) {
        for (var i = 0; i < n; i++) {
          var prev = (i - s + n) % n, next = (i + s) % n;
          var f = frames[i], c = centre[i];
          var ax = centre[prev].x + frames[prev].nx * offset[prev];
          var ay = centre[prev].y + frames[prev].ny * offset[prev];
          var bx = centre[next].x + frames[next].nx * offset[next];
          var by = centre[next].y + frames[next].ny * offset[next];
          /* Project the midpoint of the two neighbours onto this station's
             normal, so the point can only ever move across the track. */
          var want = ((ax + bx) / 2 - c.x) * f.nx + ((ay + by) / 2 - c.y) * f.ny;
          offset[i] = clamp(offset[i] + 0.4 * (want - offset[i]), -limit, limit);
        }
      }
    }
    var line = new Array(n);
    for (var j = 0; j < n; j++) {
      line[j] = {
        x: centre[j].x + frames[j].nx * offset[j],
        y: centre[j].y + frames[j].ny * offset[j],
        offset: offset[j]
      };
    }
    return line;
  }

  function lineCurvature(line, spacing) {
    var n = line.length;
    var headings = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var prev = line[(i - 1 + n) % n], next = line[(i + 1) % n];
      headings[i] = Math.atan2(next.y - prev.y, next.x - prev.x);
    }
    var k = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      var d = util.angleDelta(headings[(j - 1 + n) % n], headings[(j + 1) % n]);
      k[j] = Math.abs(d) / (2 * spacing);
    }
    var smooth = new Float64Array(n);
    for (var m = 0; m < n; m++) {
      var acc = 0;
      for (var w = -2; w <= 2; w++) acc += k[(m + w + n) % n];
      smooth[m] = acc / 5;
    }
    return smooth;
  }

  /* Cornering speed from v = sqrt(a_lat / k), then a backward pass so a car is
     already slowing before the corner rather than at its apex. */
  function buildSpeedProfile(curvature, spacing, opts) {
    var n = curvature.length;
    var speeds = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var k = Math.max(curvature[i], 1e-6);
      speeds[i] = Math.min(opts.topSpeed, Math.sqrt(opts.latAccel / k));
    }
    for (var pass = 0; pass < 3; pass++) {
      for (var j = n - 1; j >= 0; j--) {
        var next = speeds[(j + 1) % n];
        var reachable = Math.sqrt(next * next + 2 * opts.brakeAccel * spacing);
        if (speeds[j] > reachable) speeds[j] = reachable;
      }
    }
    return speeds;
  }

  function build(def) {
    def = def || CIRCUIT;
    var sampled = sampleCentreline(def.points, def.sampleSpacing);
    var centre = sampled.points;
    var frames = buildFrames(centre);
    var curvature = buildCurvature(frames, sampled.spacing);
    var racingLine = buildRacingLine(centre, frames, def.halfWidth, 26);
    var lineK = lineCurvature(racingLine, sampled.spacing);
    var speeds = buildSpeedProfile(lineK, sampled.spacing, {
      topSpeed: 430, latAccel: 420, brakeAccel: 520
    });

    var n = centre.length;
    var left = new Array(n), right = new Array(n);
    for (var i = 0; i < n; i++) {
      left[i] = { x: centre[i].x + frames[i].nx * def.halfWidth, y: centre[i].y + frames[i].ny * def.halfWidth };
      right[i] = { x: centre[i].x - frames[i].nx * def.halfWidth, y: centre[i].y - frames[i].ny * def.halfWidth };
    }

    /* Buckets of station indices by world cell, so a cold lookup (a car being
       placed or respawned) does not have to scan every station. */
    var cell = 160;
    var cols = Math.ceil(def.world.width / cell), rows = Math.ceil(def.world.height / cell);
    var grid = new Array(cols * rows);
    for (var g = 0; g < n; g++) {
      var cx = clamp(Math.floor(centre[g].x / cell), 0, cols - 1);
      var cy = clamp(Math.floor(centre[g].y / cell), 0, rows - 1);
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var gx = cx + ox, gy = cy + oy;
          if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
          var key = gy * cols + gx;
          (grid[key] || (grid[key] = [])).push(g);
        }
      }
    }

    return {
      name: def.name,
      world: def.world,
      halfWidth: def.halfWidth,
      count: n,
      spacing: sampled.spacing,
      length: sampled.length,
      centre: centre,
      frames: frames,
      curvature: curvature,
      left: left,
      right: right,
      racingLine: racingLine,
      lineCurvature: lineK,
      targetSpeed: speeds,
      _grid: { cell: cell, cols: cols, rows: rows, buckets: grid },

      /* Nearest station. `hint` restricts the scan to a window around the car's
         previous station, which is both faster and immune to a car near a
         hairpin snapping to the road on the far side of the apex. */
      nearest: function (x, y, hint) {
        var best = -1, bestD = Infinity, i, dx, dy, d;
        if (hint != null) {
          for (var w = -28; w <= 28; w++) {
            i = (hint + w + n) % n;
            dx = centre[i].x - x; dy = centre[i].y - y;
            d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
          return { index: best, dist: Math.sqrt(bestD) };
        }
        var gx2 = clamp(Math.floor(x / cell), 0, cols - 1);
        var gy2 = clamp(Math.floor(y / cell), 0, rows - 1);
        var bucket = grid[gy2 * cols + gx2];
        if (bucket) {
          for (var b = 0; b < bucket.length; b++) {
            i = bucket[b];
            dx = centre[i].x - x; dy = centre[i].y - y;
            d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
        if (best < 0) {
          for (i = 0; i < n; i++) {
            dx = centre[i].x - x; dy = centre[i].y - y;
            d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
        return { index: best, dist: Math.sqrt(bestD) };
      },

      /* Signed distance from the centreline, positive to the left. */
      lateral: function (x, y, index) {
        var f = frames[index], c = centre[index];
        return (x - c.x) * f.nx + (y - c.y) * f.ny;
      },

      station: function (index) { return (index % n + n) % n; },

      /* Point on the racing line `ahead` pixels further round the lap. */
      lineAhead: function (index, ahead) {
        var step = Math.round(ahead / sampled.spacing);
        return racingLine[((index + step) % n + n) % n];
      }
    };
  }

  Racer.track = { CIRCUIT: CIRCUIT, build: build };
})(globalThis.Racer = globalThis.Racer || {});
