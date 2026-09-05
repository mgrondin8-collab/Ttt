/* track.js — the circuit itself: a closed Catmull-Rom spline resampled at an
   even spacing, plus the lookups the rest of the game needs (where am I on
   the track, how high is the ground here, where does the scenery go). */
(function (global) {
  'use strict';

  const ROAD_HALF = 7.0;      // metres from centre line to white line
  const KERB = 1.3;           // kerb strip outside the white line
  const EDGE = ROAD_HALF + KERB;
  const SPACING = 4.0;        // distance between resampled centre-line points

  /* Control points of the circuit: x, z (the ground plane) and y (elevation).
     The loop closes back on itself. */
  const CONTROL = [
    [0, 0, 0],          // start / finish, on the pit straight
    [0, 120, 0],
    [0, 240, 0],
    [16, 400, 7],       // turn 1, uphill and out to the east
    [120, 545, 15],
    [300, 570, 13],
    [400, 470, 4],      // downhill right
    [372, 340, -2],
    [246, 296, -5],     // the slow hairpin at the bottom of the dip
    [206, 176, -3],
    [300, 60, 5],
    [470, 30, 12],      // long climbing right through the trees
    [566, 150, 13],
    [610, 300, 6],
    [700, 392, -1],
    [826, 340, -7],     // fast sweeper at the far end
    [846, 168, -5],
    [762, 20, 0],
    [606, -78, 3],
    [400, -122, 2],     // the back straight, running west
    [240, -126, 0],
    [130, -122, 0],
    [60, -118, 0],
    [20, -100, 0],      // final corner, back onto the pit straight
    [0, -50, 0]
  ];

  function catmull(p0, p1, p2, p3, t, i) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }

  function build() {
    const n = CONTROL.length;

    // Densely sample the spline first, then walk it at an even spacing.
    const dense = [];
    const STEPS = 240;
    for (let seg = 0; seg < n; seg++) {
      const p0 = CONTROL[(seg - 1 + n) % n];
      const p1 = CONTROL[seg];
      const p2 = CONTROL[(seg + 1) % n];
      const p3 = CONTROL[(seg + 2) % n];
      for (let s = 0; s < STEPS; s++) {
        const t = s / STEPS;
        dense.push([catmull(p0, p1, p2, p3, t, 0), catmull(p0, p1, p2, p3, t, 1), catmull(p0, p1, p2, p3, t, 2)]);
      }
    }

    // Cumulative arc length around the dense samples.
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const total = cum[dense.length];
    const count = Math.round(total / SPACING);
    const spacing = total / count;

    const points = [];
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const target = i * spacing;
      while (cursor < dense.length - 1 && cum[cursor + 1] < target) cursor++;
      const span = cum[cursor + 1] - cum[cursor] || 1;
      const f = (target - cum[cursor]) / span;
      const a = dense[cursor], b = dense[(cursor + 1) % dense.length];
      points.push({
        x: a[0] + (b[0] - a[0]) * f,
        z: a[1] + (b[1] - a[1]) * f,
        y: a[2] + (b[2] - a[2]) * f,
        dist: target
      });
    }

    /* Slide the origin down the pit straight so the start line — and the grid
       behind it — sit on the straight rather than in the last corner. */
    const startIndex = Math.round(150 / spacing) % count;
    const rotated = points.slice(startIndex).concat(points.slice(0, startIndex));
    points.length = 0;
    rotated.forEach((p, i) => { p.dist = i * spacing; points.push(p); });

    // Headings, normals and curvature from the evenly spaced points.
    for (let i = 0; i < count; i++) {
      const p = points[i];
      const nx = points[(i + 1) % count];
      const pv = points[(i - 1 + count) % count];
      let dx = nx.x - pv.x, dz = nx.z - pv.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      p.dx = dx; p.dz = dz;
      p.yaw = Math.atan2(dx, -dz);      // 0 looks down -Z, matching the camera
      p.nxv = -dz; p.nzv = dx;          // left-hand normal
      p.slope = (nx.y - pv.y) / (2 * spacing);
    }
    for (let i = 0; i < count; i++) {
      const a = points[(i - 1 + count) % count], b = points[(i + 1) % count];
      let d = b.yaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      points[i].curve = d / (2 * spacing);
    }

    /* Ground height away from the road: flat across the tarmac, a shallow
       ditch just outside it, then rolling terrain further out. The scenery
       and the terrain mesh both read this, so nothing floats. */
    function terrainNoise(x, z) {
      return 2.4 * Math.sin(x * 0.0102) * Math.cos(z * 0.0126) +
        1.5 * Math.sin((x + z) * 0.0071) +
        0.8 * Math.cos(x * 0.0203 - z * 0.0154);
    }

    function verticalOffset(roadY, lateral, x, z) {
      const d = Math.abs(lateral);
      if (d <= EDGE) return roadY;
      const past = d - EDGE;
      const ditch = -1.1 * Math.min(past / 5, 1);
      const blend = Math.min(past / 28, 1);
      return roadY + ditch + blend * terrainNoise(x, z);
    }

    const track = {
      points, count, spacing, length: total,
      roadHalf: ROAD_HALF, kerb: KERB, edge: EDGE,
      terrainNoise, verticalOffset,

      /* Centre-line point at an arbitrary distance around the lap. */
      sample(dist) {
        let d = dist % total;
        if (d < 0) d += total;
        const f = d / spacing;
        const i = Math.floor(f) % count;
        const j = (i + 1) % count;
        const t = f - Math.floor(f);
        const a = points[i], b = points[j];
        let dyaw = b.yaw - a.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
          yaw: a.yaw + dyaw * t,
          curve: a.curve + (b.curve - a.curve) * t,
          slope: a.slope + (b.slope - a.slope) * t,
          index: i
        };
      },

      /* Nearest point on the centre line. `hint` is the last known index, so
         the search stays local and cheap; pass -1 to search the whole lap. */
      project(x, z, hint) {
        let best = -1, bestD = Infinity;
        if (hint >= 0) {
          for (let k = -50; k <= 50; k++) {
            const i = (hint + k + count * 2) % count;
            const p = points[i];
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (d < bestD) { bestD = d; best = i; }
          }
          // Fall back to a full sweep if we clearly lost the car.
          if (bestD > 2500) best = -1;
        }
        if (best < 0) {
          bestD = Infinity;
          for (let i = 0; i < count; i++) {
            const p = points[i];
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (d < bestD) { bestD = d; best = i; }
          }
        }
        const p = points[best];
        const ex = x - p.x, ez = z - p.z;
        const along = ex * p.dx + ez * p.dz;
        const lateral = ex * p.nxv + ez * p.nzv;
        let dist = p.dist + along;
        if (dist < 0) dist += total;
        if (dist >= total) dist -= total;
        return { index: best, dist, lateral, along, point: p };
      },

      /* Ground height under a world position. */
      heightAt(x, z, hint) {
        const pr = this.project(x, z, hint === undefined ? -1 : hint);
        const roadY = pr.point.y + pr.point.slope * pr.along;
        return { y: verticalOffset(roadY, pr.lateral, x, z), projection: pr };
      }
    };

    /* --- scenery: trees, marker boards and grandstands, all kept clear of
       the racing surface and sitting on the terrain --- */
    const rand = global.Textures.rng(1234);
    const scenery = { trees: [], boards: [], stands: [] };
    for (let i = 0; i < count; i += 2) {
      const p = points[i];
      for (const side of [-1, 1]) {
        if (rand() > 0.55) continue;
        const off = side * (EDGE + 9 + rand() * 78);
        const jitter = (rand() - 0.5) * 7;
        const x = p.x + p.nxv * off + p.dx * jitter;
        const z = p.z + p.nzv * off + p.dz * jitter;
        const h = track.heightAt(x, z, i).y;
        const size = 9 + rand() * 12;
        scenery.trees.push({
          x, y: h, z,
          w: size * (0.46 + rand() * 0.12),
          h: size,
          kind: rand() > 0.45 ? 'pine' : 'round'
        });
      }
    }
    // Distance-marker boards on the outside of the quicker corners.
    for (let i = 0; i < count; i += 1) {
      const p = points[i];
      if (Math.abs(p.curve) < 0.008) continue;
      if (i % 10 !== 0) continue;
      const side = p.curve > 0 ? -1 : 1;   // outside of the bend
      const off = side * (EDGE + 3.4);
      scenery.boards.push({
        x: p.x + p.nxv * off,
        y: p.y,
        z: p.z + p.nzv * off,
        yaw: p.yaw
      });
    }
    // Grandstands along the pit straight.
    for (let i = 6; i < 46; i += 8) {
      const p = points[i % count];
      const off = -(EDGE + 16);
      scenery.stands.push({
        x: p.x + p.nxv * off,
        y: track.heightAt(p.x + p.nxv * off, p.z + p.nzv * off, i).y,
        z: p.z + p.nzv * off,
        yaw: p.yaw
      });
    }
    track.scenery = scenery;

    return track;
  }

  global.Track = { build, ROAD_HALF, KERB, EDGE };
})(window);
