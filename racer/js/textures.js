/* textures.js — every texture in the game is painted here with a 2D canvas,
   so the whole thing still runs straight off the file system. */
(function (global) {
  'use strict';

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* Deterministic noise so the track looks the same on every run. */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function speckle(ctx, w, h, rand, count, shade, alpha, size) {
    for (let i = 0; i < count; i++) {
      const x = rand() * w, y = rand() * h;
      const v = shade(rand());
      ctx.fillStyle = 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + alpha + ')';
      const s = size * (0.4 + rand());
      ctx.fillRect(x, y, s, s);
    }
  }

  /* Asphalt: one tile spans the full width of the road and 16 m of its length,
     so the lane markings live in the texture rather than in geometry. */
  function asphalt() {
    const w = 256, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    const rand = rng(7);
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 9000, r => {
      const v = 40 + r * 60 | 0;
      return [v, v + 2, v + 5];
    }, 0.5, 2.5);
    // A couple of tar seams down the length of the road.
    ctx.strokeStyle = 'rgba(24,25,28,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const x = rand() * w;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 12, h * 0.3, x - 14, h * 0.7, x + 4, h);
      ctx.stroke();
    }
    // Solid white edge lines just inside the kerbs.
    ctx.fillStyle = 'rgba(232,236,240,0.85)';
    ctx.fillRect(w * 0.045, 0, 5, h);
    ctx.fillRect(w * 0.955 - 5, 0, 5, h);
    // Dashed centre line: two dashes per tile.
    ctx.fillStyle = 'rgba(226,214,150,0.8)';
    ctx.fillRect(w / 2 - 3, h * 0.06, 6, h * 0.32);
    ctx.fillRect(w / 2 - 3, h * 0.56, 6, h * 0.32);
    return c;
  }

  function grass() {
    const w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
    const rand = rng(31);
    ctx.fillStyle = '#4d7a3a';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rand, 5000, r => [50 + r * 55 | 0, 95 + r * 60 | 0, 40 + r * 40 | 0], 0.7, 3);
    speckle(ctx, w, h, rand, 600, r => [30 + r * 20 | 0, 60 + r * 25 | 0, 28 + r * 15 | 0], 0.5, 6);
    return c;
  }

  /* A tree drawn once and used as a billboard, alpha cut out. */
  function tree(kind) {
    // Power of two, so the texture can be mipmapped: WebGL 1 insists.
    const w = 128, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    const rand = rng(kind === 'pine' ? 21 : 42);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#4a3527';
    ctx.fillRect(w / 2 - 7, h * 0.62, 14, h * 0.38);
    if (kind === 'pine') {
      for (let tier = 0; tier < 5; tier++) {
        const t = tier / 5;
        const cy = h * (0.66 - t * 0.6);
        const halfW = w * (0.44 - t * 0.3);
        const drop = h * 0.13;
        ctx.fillStyle = 'rgb(' + (28 + tier * 6) + ',' + (78 + tier * 11) + ',' + (44 + tier * 6) + ')';
        ctx.beginPath();
        ctx.moveTo(w / 2, cy - drop * 1.5);
        ctx.lineTo(w / 2 + halfW, cy);
        ctx.lineTo(w / 2, cy - drop * 0.25);
        ctx.lineTo(w / 2 - halfW, cy);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      for (let i = 0; i < 70; i++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * 0.9;
        const x = w / 2 + Math.cos(a) * r * w * 0.44;
        const y = h * 0.33 + Math.sin(a) * r * h * 0.26;
        const rad = 12 + rand() * 20;
        const g = 92 + rand() * 60 | 0;
        ctx.fillStyle = 'rgb(' + (34 + rand() * 30 | 0) + ',' + g + ',' + (38 + rand() * 24 | 0) + ')';
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c;
  }

  /* Sky dome: gradient, sun, a band of cloud and a distant mountain range,
     wrapped horizontally around the world. */
  function sky() {
    const w = 1024, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a5f9e');
    grad.addColorStop(0.3, '#5b97c8');
    grad.addColorStop(0.58, '#93c1de');
    grad.addColorStop(0.8, '#d2e2ec');
    grad.addColorStop(1, '#c9d8d3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Sun with a soft halo, sitting over the main straight.
    const sx = w * 0.22, sy = h * 0.3;
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 190);
    halo.addColorStop(0, 'rgba(255,252,232,0.95)');
    halo.addColorStop(0.12, 'rgba(255,246,206,0.7)');
    halo.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - 200, sy - 200, 400, 400);

    const rand = rng(99);
    /* Clouds: soft blobs, thinning towards the horizon so they read as
       distance rather than as stripes across the windscreen. */
    for (let i = 0; i < 34; i++) {
      const cx = rand() * w, cy = h * (0.05 + rand() * 0.46);
      const scale = 0.5 + rand() * 1.2;
      const fade = 1 - Math.max(0, (cy / h - 0.32) / 0.28);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + rand() * 0.09) * Math.max(0.25, fade) + ')';
      for (let j = 0; j < 12; j++) {
        const bx = cx + (rand() - 0.5) * 150 * scale;
        const by = cy + (rand() - 0.5) * 26 * scale;
        const rx = (20 + rand() * 40) * scale, ry = (8 + rand() * 14) * scale;
        // Drawn again either side of the seam, so the panorama wraps cleanly
        // — otherwise the join shows up as a line in the mirror.
        for (const wrap of [-w, 0, w]) {
          ctx.beginPath();
          ctx.ellipse(bx + wrap, by, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Two mountain ranges, the far one hazier.
    function ridge(baseY, amp, colour, seed) {
      const r = rng(seed);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(0, h);
      let y = baseY;
      ctx.lineTo(0, y);
      for (let x = 0; x <= w; x += 16) {
        y += (r() - 0.5) * amp;
        y = Math.max(baseY - amp * 3.2, Math.min(baseY + amp * 1.6, y));
        // Wrap the range so the seam of the panorama does not show.
        const wrapped = x > w - 160 ? y + (baseY - y) * ((x - (w - 160)) / 160) : y;
        ctx.lineTo(x, wrapped);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ridge(h * 0.70, 15, 'rgba(118,148,172,0.8)', 5);
    ridge(h * 0.745, 10, 'rgba(92,122,140,0.85)', 11);

    /* Haze along the horizon, so the dome meets the ground without a seam.
       It starts below the mountains, which would otherwise be washed out. */
    const hz = ctx.createLinearGradient(0, h * 0.79, 0, h);
    hz.addColorStop(0, 'rgba(201,216,211,0)');
    hz.addColorStop(0.6, 'rgba(201,216,211,0.7)');
    hz.addColorStop(1, 'rgba(201,216,211,1)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, h * 0.79, w, h * 0.21);
    return c;
  }

  /* Start/finish chequer, used on the gantry and across the road. */
  function chequer() {
    const n = 8, s = 32, c = canvas(n * s, n * s), ctx = c.getContext('2d');
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#161616' : '#f2f2f2';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    return c;
  }

  global.Textures = { asphalt, grass, tree, sky, chequer, rng, canvas };
})(window);
