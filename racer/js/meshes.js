/* meshes.js — turns the track description into geometry: tarmac, kerbs,
   terrain, the start gantry, the scenery and the cars. */
(function (global) {
  'use strict';

  const MeshBuilder = global.GLX.MeshBuilder;

  /* ---- tarmac ------------------------------------------------------- */
  function road(gl, track) {
    const b = new MeshBuilder();
    const P = track.points, n = track.count, hw = track.roadHalf;
    const ring = [];
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const v = p.dist / 16;               // one texture tile every 16 m
      const l = b.vertex(p.x + p.nxv * hw, p.y, p.z + p.nzv * hw, 0, 1, 0, 0, v, 1, 1, 1, 0);
      const r = b.vertex(p.x - p.nxv * hw, p.y, p.z - p.nzv * hw, 0, 1, 0, 1, v, 1, 1, 1, 0);
      ring.push([l, r]);
    }
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n];
      b.quad(c[0], c[1], a[1], a[0]);
    }
    return b.build(gl);
  }

  /* ---- kerbs: alternating blocks just outside the white lines -------- */
  function kerbs(gl, track) {
    const b = new MeshBuilder();
    const P = track.points, n = track.count;
    const inner = track.roadHalf, outer = track.roadHalf + track.kerb;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      const red = (i % 2) === 0;
      const col = red ? [0.78, 0.16, 0.16] : [0.92, 0.92, 0.9];
      for (const side of [1, -1]) {
        const lift = 0.09;
        const p0 = [p.x + p.nxv * inner * side, p.y + lift, p.z + p.nzv * inner * side];
        const p1 = [q.x + q.nxv * inner * side, q.y + lift, q.z + q.nzv * inner * side];
        const p2 = [q.x + q.nxv * outer * side, q.y + lift * 0.55, q.z + q.nzv * outer * side];
        const p3 = [p.x + p.nxv * outer * side, p.y + lift * 0.55, p.z + p.nzv * outer * side];
        if (side === 1) b.face(p3, p2, p1, p0, col);
        else b.face(p0, p1, p2, p3, col);
      }
    }
    return b.build(gl);
  }

  /* ---- ground -------------------------------------------------------
     Two pieces. A narrow ribbon hugs the kerbs so the verges match the road
     exactly, and a coarse grid covers everything else. The ribbon is kept
     inside the tightest corner radius on the circuit, because a ribbon wider
     than the corner it goes around folds over itself. */
  const RIBBON = [0, 4, 12, 26];

  function terrain(gl, track) {
    const b = new MeshBuilder();
    const P = track.points, n = track.count;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const row = { left: [], right: [] };
      for (const side of [1, -1]) {
        const key = side === 1 ? 'left' : 'right';
        for (const band of RIBBON) {
          const off = (track.edge + band) * side;
          const x = p.x + p.nxv * off;
          const z = p.z + p.nzv * off;
          const y = track.verticalOffset(p.y, track.edge + band, x, z);
          row[key].push([x, y, z]);
        }
      }
      rows.push(row);
    }
    const grass = [1, 1, 1];
    for (let i = 0; i < n; i++) {
      const a = rows[i], c = rows[(i + 1) % n];
      for (let k = 0; k < RIBBON.length - 1; k++) {
        quadUV(b, c.left[k], c.left[k + 1], a.left[k + 1], a.left[k], grass);
        quadUV(b, a.right[k], a.right[k + 1], c.right[k + 1], c.right[k], grass);
      }
      // Skirts: a lip dropped at the outer edge so the seam with the grid
      // below can never be seen through.
      const last = RIBBON.length - 1;
      const drop = 1.8;
      const dl = [a.left[last][0], a.left[last][1] - drop, a.left[last][2]];
      const dl2 = [c.left[last][0], c.left[last][1] - drop, c.left[last][2]];
      quadUV(b, a.left[last], c.left[last], dl2, dl, grass);
      const dr = [a.right[last][0], a.right[last][1] - drop, a.right[last][2]];
      const dr2 = [c.right[last][0], c.right[last][1] - drop, c.right[last][2]];
      quadUV(b, c.right[last], a.right[last], dr, dr2, grass);
    }
    return b.build(gl);
  }

  /* Quad with grass texture coordinates taken from world position, so the
     tiling never stretches however the ground bends. */
  function quadUV(b, p0, p1, p2, p3, colour) {
    const uv = [p0, p1, p2, p3].map(p => [p[0] / 14, p[2] / 14]);
    b.face(p0, p1, p2, p3, colour, uv);
  }

  /* The world beyond the ribbon: one grid over the whole circuit, dropped
     slightly where the ribbon covers it so the two never fight. */
  function ground(gl, track) {
    const b = new MeshBuilder();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 340, cell = 18;
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    const cols = Math.ceil((maxX - minX) / cell), rowCount = Math.ceil((maxZ - minZ) / cell);
    const H = new Float32Array((cols + 1) * (rowCount + 1));
    let hint = 0;
    for (let r = 0; r <= rowCount; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = minX + c * cell, z = minZ + r * cell;
        const hit = track.heightAt(x, z, hint);
        hint = hit.projection.index;
        const lateral = Math.abs(hit.projection.lateral);
        const dig = 1.1 * Math.max(0, Math.min(1, 1 - (lateral - track.edge - RIBBON[RIBBON.length - 1]) / 44));
        H[r * (cols + 1) + c] = hit.y - dig;
      }
    }
    const grass = [1, 1, 1];
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = minX + c * cell, x1 = x0 + cell;
        const z0 = minZ + r * cell, z1 = z0 + cell;
        const h = (cc, rr) => H[rr * (cols + 1) + cc];
        quadUV(b,
          [x0, h(c, r + 1), z1], [x1, h(c + 1, r + 1), z1],
          [x1, h(c + 1, r), z0], [x0, h(c, r), z0], grass);
      }
    }
    return b.build(gl);
  }

  /* ---- start line and gantry ---------------------------------------- */
  function startLine(gl, track) {
    const b = new MeshBuilder();
    const hw = track.roadHalf;
    const lift = 0.03;
    const a = track.sample(-4), c = track.sample(4);
    const pa = track.points[a.index], pc = track.points[c.index];
    b.face(
      [a.x + pa.nxv * hw, a.y + lift, a.z + pa.nzv * hw],
      [a.x - pa.nxv * hw, a.y + lift, a.z - pa.nzv * hw],
      [c.x - pc.nxv * hw, c.y + lift, c.z - pc.nzv * hw],
      [c.x + pc.nxv * hw, c.y + lift, c.z + pc.nzv * hw],
      [1, 1, 1], [[0, 0], [4, 0], [4, 1], [0, 1]]
    );
    return b.build(gl);
  }

  function gantry(gl, track) {
    const b = new MeshBuilder();
    const s = track.sample(6);
    const p = track.points[s.index];
    const hw = track.roadHalf + track.kerb + 1.2;
    const post = 0.55, top = 9.2, beam = 1.6;
    const dark = [0.16, 0.18, 0.22];
    for (const side of [1, -1]) {
      const cx = s.x + p.nxv * hw * side;
      const cz = s.z + p.nzv * hw * side;
      addBox(b, cx, cz, s.y, s.y + top, post, post, p, dark);
    }
    // Cross beam, built as a box spanning the road at the top of the posts.
    const lx = s.x + p.nxv * hw, lz = s.z + p.nzv * hw;
    const rx = s.x - p.nxv * hw, rz = s.z - p.nzv * hw;
    const bx = (lx + rx) / 2, bz = (lz + rz) / 2;
    addBox(b, bx, bz, s.y + top - beam, s.y + top, hw * 2 + post, 0.9, p, [0.22, 0.25, 0.3]);
    addBox(b, bx, bz, s.y + top - beam + 0.15, s.y + top - 0.15, hw * 2 - 2, 1.05, p, [0.86, 0.12, 0.14]);
    return b.build(gl);
  }

  /* A box aligned to the track at a point: `halfW` across the road,
     `halfL` along it. */
  function addBox(b, cx, cz, y0, y1, width, length, p, colour, tint) {
    const nx = p.nxv, nz = p.nzv, dx = p.dx, dz = p.dz;
    const hwid = width / 2, hlen = length / 2;
    function corner(u, v) {
      return [cx + nx * u * hwid + dx * v * hlen, 0, cz + nz * u * hwid + dz * v * hlen];
    }
    const c00 = corner(-1, -1), c10 = corner(1, -1), c11 = corner(1, 1), c01 = corner(-1, 1);
    const lo = y0, hi = y1;
    const at = (c, y) => [c[0], y, c[2]];
    b.face(at(c00, hi), at(c10, hi), at(c11, hi), at(c01, hi), colour, null, tint);
    b.face(at(c01, lo), at(c11, lo), at(c10, lo), at(c00, lo), colour, null, tint);
    b.face(at(c00, lo), at(c10, lo), at(c10, hi), at(c00, hi), colour, null, tint);
    b.face(at(c11, lo), at(c01, lo), at(c01, hi), at(c11, hi), colour, null, tint);
    b.face(at(c10, lo), at(c11, lo), at(c11, hi), at(c10, hi), colour, null, tint);
    b.face(at(c01, lo), at(c00, lo), at(c00, hi), at(c01, hi), colour, null, tint);
  }

  /* ---- guardrails: the thing you feel when you run out of talent ----- */
  function barriers(gl, track, offset) {
    const b = new MeshBuilder();
    const P = track.points, n = track.count;
    const lo = 0.55, hi = 1.3;
    const rail = [0.74, 0.76, 0.8], post = [0.36, 0.38, 0.42];
    for (const side of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const p = P[i], q = P[(i + 1) % n];
        const px = p.x + p.nxv * offset * side, pz = p.z + p.nzv * offset * side;
        const qx = q.x + q.nxv * offset * side, qz = q.z + q.nzv * offset * side;
        const py = track.verticalOffset(p.y, offset, px, pz);
        const qy = track.verticalOffset(q.y, offset, qx, qz);
        // Both faces, so the rail reads from either side without culling tricks.
        b.face([px, py + lo, pz], [qx, qy + lo, qz], [qx, qy + hi, qz], [px, py + hi, pz], rail);
        b.face([qx, qy + lo, qz], [px, py + lo, pz], [px, py + hi, pz], [qx, qy + hi, qz], rail);
        if (i % 5 === 0) addBox(b, px, pz, py - 0.2, py + hi, 0.18, 0.18, p, post);
      }
    }
    return b.build(gl);
  }

  /* ---- roadside furniture: marker boards and grandstands ------------- */
  function furniture(gl, track) {
    const b = new MeshBuilder();
    for (const board of track.scenery.boards) {
      const p = { nxv: -Math.cos(board.yaw), nzv: -Math.sin(board.yaw), dx: Math.sin(board.yaw), dz: -Math.cos(board.yaw) };
      // Two legs and a panel facing the oncoming cars.
      addBox(b, board.x, board.z, board.y, board.y + 1.1, 0.16, 0.16, p, [0.3, 0.3, 0.33]);
      addBox(b, board.x, board.z, board.y + 1.1, board.y + 2.3, 2.6, 0.16, p, [0.92, 0.86, 0.2]);
      addBox(b, board.x, board.z, board.y + 1.45, board.y + 1.95, 2.0, 0.2, p, [0.15, 0.15, 0.17]);
    }
    for (const stand of track.scenery.stands) {
      const p = { nxv: -Math.cos(stand.yaw), nzv: -Math.sin(stand.yaw), dx: Math.sin(stand.yaw), dz: -Math.cos(stand.yaw) };
      const w = 13, l = 46;
      addBox(b, stand.x, stand.z, stand.y, stand.y + 1.2, w, l, p, [0.62, 0.62, 0.6]);
      // Stepped seating tiers, each one further from the track and higher.
      for (let t = 0; t < 5; t++) {
        const off = (t - 2) * 2.1;
        const px = stand.x + p.nxv * off, pz = stand.z + p.nzv * off;
        const shade = t % 2 ? [0.24, 0.33, 0.52] : [0.75, 0.76, 0.78];
        addBox(b, px, pz, stand.y + 1.2 + t * 0.85, stand.y + 2.05 + t * 0.85, 2.1, l, p, shade);
      }
      // Roof on four columns.
      for (const s of [-1, 1]) {
        for (const e of [-1, 1]) {
          const px = stand.x + p.nxv * s * (w / 2 - 0.6) + p.dx * e * (l / 2 - 1.5);
          const pz = stand.z + p.nzv * s * (w / 2 - 0.6) + p.dz * e * (l / 2 - 1.5);
          addBox(b, px, pz, stand.y, stand.y + 7.4, 0.4, 0.4, p, [0.4, 0.42, 0.45]);
        }
      }
      addBox(b, stand.x, stand.z, stand.y + 7.4, stand.y + 7.9, w + 2, l, p, [0.58, 0.61, 0.66]);
      addBox(b, stand.x, stand.z, stand.y + 7.0, stand.y + 7.4, w + 2.4, l, p, [0.8, 0.34, 0.22]);
    }
    return b.build(gl);
  }

  /* ---- a car ---------------------------------------------------------
     Local space: -Z is forward, so a car shares the camera's convention.
     Colour alpha carries "tint me", which lets one mesh be repainted per
     driver while glass, tyres and lights keep their own colours. */
  function car(gl) {
    const b = new MeshBuilder();
    const body = [1, 1, 1], glass = [0.13, 0.17, 0.22], tyre = [0.07, 0.07, 0.08];
    const w = 0.92, nose = -2.25, tail = 2.15;

    // Main tub, slightly narrower at the nose.
    b.face([-w, 0.32, tail], [w, 0.32, tail], [w * 0.86, 0.32, nose], [-w * 0.86, 0.32, nose], body, null, 1);   // floor seen from below
    b.face([-w, 0.95, nose + 0.1], [w, 0.95, nose + 0.1], [w, 0.95, tail], [-w, 0.95, tail], body, null, 1);      // bonnet/deck
    b.face([-w * 0.86, 0.32, nose], [w * 0.86, 0.32, nose], [w * 0.9, 0.86, nose + 0.05], [-w * 0.9, 0.86, nose + 0.05], body, null, 1); // nose
    b.face([w, 0.32, tail], [-w, 0.32, tail], [-w, 0.95, tail], [w, 0.95, tail], body, null, 1);                  // tail
    b.face([w * 0.86, 0.32, nose], [w, 0.32, tail], [w, 0.95, tail], [w * 0.9, 0.9, nose + 0.05], body, null, 1); // right flank
    b.face([-w, 0.32, tail], [-w * 0.86, 0.32, nose], [-w * 0.9, 0.9, nose + 0.05], [-w, 0.95, tail], body, null, 1);

    // Cabin with a sloped screen and rear glass.
    const cf = -0.55, cb = 1.15, ch = 1.42, cw = 0.78;
    b.face([-cw, ch, cf + 0.35], [cw, ch, cf + 0.35], [cw, ch, cb - 0.3], [-cw, ch, cb - 0.3], body, null, 1);    // roof
    b.face([-cw, 0.95, cf], [cw, 0.95, cf], [cw, ch, cf + 0.35], [-cw, ch, cf + 0.35], glass);                    // windscreen
    b.face([cw, 0.95, cb], [-cw, 0.95, cb], [-cw, ch, cb - 0.3], [cw, ch, cb - 0.3], glass);                      // rear glass
    b.face([cw, 0.95, cf], [cw, 0.95, cb], [cw, ch, cb - 0.3], [cw, ch, cf + 0.35], glass);                       // side glass
    b.face([-cw, 0.95, cb], [-cw, 0.95, cf], [-cw, ch, cf + 0.35], [-cw, ch, cb - 0.3], glass);

    // Rear wing.
    const wingY = 1.28;
    b.box(-w - 0.05, wingY, tail - 0.5, w + 0.05, wingY + 0.09, tail - 0.05, [0.12, 0.12, 0.14]);
    b.box(-0.5, 0.95, tail - 0.42, -0.36, wingY, tail - 0.24, [0.12, 0.12, 0.14]);
    b.box(0.36, 0.95, tail - 0.42, 0.5, wingY, tail - 0.24, [0.12, 0.12, 0.14]);

    // Lights.
    b.face([-w * 0.78, 0.62, nose - 0.01], [-w * 0.3, 0.62, nose - 0.01], [-w * 0.3, 0.8, nose - 0.01], [-w * 0.78, 0.8, nose - 0.01], [0.95, 0.95, 0.85]);
    b.face([w * 0.3, 0.62, nose - 0.01], [w * 0.78, 0.62, nose - 0.01], [w * 0.78, 0.8, nose - 0.01], [w * 0.3, 0.8, nose - 0.01], [0.95, 0.95, 0.85]);
    b.face([-w * 0.3, 0.6, tail + 0.01], [-w * 0.82, 0.6, tail + 0.01], [-w * 0.82, 0.82, tail + 0.01], [-w * 0.3, 0.82, tail + 0.01], [0.85, 0.1, 0.08]);
    b.face([w * 0.82, 0.6, tail + 0.01], [w * 0.3, 0.6, tail + 0.01], [w * 0.3, 0.82, tail + 0.01], [w * 0.82, 0.82, tail + 0.01], [0.85, 0.1, 0.08]);

    // Wheels: eight-sided prisms, which read as round at racing speed.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = sx * (w - 0.04), cz = sz * 1.45, r = 0.36, sides = 10;
        const xo = cx + sx * 0.08, xi = cx - sx * 0.24;   // outer and inner faces
        const hubO = b.vertex(xo, r, cz, sx, 0, 0, 0.5, 0.5, 0.5, 0.52, 0.56, 0);
        const hubI = b.vertex(xi, r, cz, -sx, 0, 0, 0.5, 0.5, 0.2, 0.2, 0.22, 0);
        for (let k = 0; k < sides; k++) {
          const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
          const y0 = r + Math.sin(a0) * r, z0 = cz + Math.cos(a0) * r;
          const y1 = r + Math.sin(a1) * r, z1 = cz + Math.cos(a1) * r;
          // Tread.
          if (sx > 0) b.face([xi, y0, z0], [xo, y0, z0], [xo, y1, z1], [xi, y1, z1], tyre);
          else b.face([xo, y0, z0], [xi, y0, z0], [xi, y1, z1], [xo, y1, z1], tyre);
          // Rim faces, wound outward on each side.
          const n0 = [sx, 0, 0];
          const o0 = b.vertex(xo, y0, z0, n0[0], 0, 0, 0, 0, 0.5, 0.52, 0.56, 0);
          const o1 = b.vertex(xo, y1, z1, n0[0], 0, 0, 0, 0, 0.5, 0.52, 0.56, 0);
          const i0 = b.vertex(xi, y0, z0, -sx, 0, 0, 0, 0, 0.2, 0.2, 0.22, 0);
          const i1 = b.vertex(xi, y1, z1, -sx, 0, 0, 0, 0, 0.2, 0.2, 0.22, 0);
          if (sx > 0) { b.tri(hubO, o1, o0); b.tri(hubI, i0, i1); }
          else { b.tri(hubO, o0, o1); b.tri(hubI, i1, i0); }
        }
      }
    }
    return b.build(gl);
  }

  /* ---- billboard sprites (the trees) ---------------------------------
     Layout: centre(3) offset(2) uv(2). The vertex shader swings each quad
     around the world's up axis to face the camera, so trees stay upright. */
  function sprites(gl, list) {
    const verts = [];
    const index = [];
    let v = 0;
    for (const s of list) {
      const hw = s.w / 2;
      const corners = [[-hw, 0, 0, 0], [hw, 0, 1, 0], [hw, s.h, 1, 1], [-hw, s.h, 0, 1]];
      for (const c of corners) verts.push(s.x, s.y, s.z, c[0], c[1], c[2], c[3]);
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    const big = v > 65535;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(index) : new Uint16Array(index), gl.STATIC_DRAW);
    return { vbo, ibo, count: index.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  /* ---- sky dome: a cylinder with a cap, textured with the panorama ---- */
  function sky(gl) {
    const b = new MeshBuilder();
    const R = 2200, top = 2500, bottom = -520, seg = 48;
    const ring = [], cap = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.sin(a) * R, z = -Math.cos(a) * R;
      const u = i / seg;
      ring.push([
        b.vertex(x, bottom, z, 0, 1, 0, u, 1, 1, 1, 1, 0),
        b.vertex(x, top, z, 0, 1, 0, u, 0.02, 1, 1, 1, 0)
      ]);
      cap.push(b.vertex(x * 0.3, top + 500, z * 0.3, 0, -1, 0, u, 0, 1, 1, 1, 0));
    }
    const apex = b.vertex(0, top + 700, 0, 0, -1, 0, 0.5, 0, 1, 1, 1, 0);
    for (let i = 0; i < seg; i++) {
      b.quad(ring[i][0], ring[i + 1][0], ring[i + 1][1], ring[i][1]);
      b.tri(cap[i], cap[i + 1], apex);
      b.quad(ring[i][1], ring[i + 1][1], cap[i + 1], cap[i]);
    }
    return b.build(gl);
  }

  global.Meshes = { road, kerbs, terrain, ground, startLine, gantry, furniture, barriers, car, sprites, sky, addBox };
})(window);
