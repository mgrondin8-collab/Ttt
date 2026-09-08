/* War Tower — engine, renderer and interface.
   Depends on config.js. No build step, no dependencies. */
'use strict';

/* ============================================================
   1. State
   ============================================================ */

const S = {
  screen: 'menu',          // menu | brief | play | round | end
  level: LEVELS[1],
  roundIndex: 0,
  waveIndex: 0,            // waves completed this round
  terrain: TERRAINS[0],

  money: 0,
  enemyCredits: 0,        // enemy command's war chest — opens equal to yours
  plunder: 0,             // what they earned off you this wave
  towersLost: 0,
  integrity: 0,
  maxIntegrity: 0,
  kills: 0,
  wavesCleared: 0,

  grid: [],                // grid[y][x] = { kind, v, decor }
  path: [],                // tile coords in order
  geo: null,               // ground polyline in tile units
  airGeo: null,            // straight flight line

  towers: [],
  enemies: [],
  shots: [],
  parts: [],
  zaps: [],
  rings: [],
  tracers: [],

  shopSel: null,           // tower def being placed
  towerSel: null,          // placed tower under inspection
  hover: null,             // { x, y } tile under the pointer

  waveRunning: false,
  paused: false,
  speed: 1,
  spawnQueue: [],
  spawnTimer: 0,

  dmg: { kinetic: 0, explosive: 0, energy: 0, frost: 0 },      // this wave
  dmgRecent: { kinetic: 0, explosive: 0, energy: 0, frost: 0 },// decayed history
  intel: '',
  nextWave: null,          // planned composition

  t: 0,
};

/* ============================================================
   2. Canvas plumbing
   ============================================================ */

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const stat = document.createElement('canvas');   // pre-rendered terrain
const sctx = stat.getContext('2d');
let TS = 24;                                     // tile size, css px
let DPR = 1;

function resize() {
  const stage = document.getElementById('stage');
  const availW = stage.clientWidth - 12;
  const availH = stage.clientHeight - 12;
  if (availW <= 0 || availH <= 0) return;
  TS = Math.max(14, Math.floor(Math.min(availW / GRID_W, availH / GRID_H)));
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const w = TS * GRID_W;
  const h = TS * GRID_H;
  for (const c of [cv, stat]) {
    c.width = Math.round(w * DPR);
    c.height = Math.round(h * DPR);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (S.grid.length) paintTerrain();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* helpers */
const px = (t) => t * TS;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
const tileAt = (x, y) => (inBounds(x, y) ? S.grid[y][x] : null);

/* ============================================================
   3. Map generation
   ============================================================ */

function carvePath(rng) {
  const path = [];
  let x = rng.int(1, GRID_W - 2);
  let y = 0;
  path.push({ x, y });
  let guard = 0;
  while (y < GRID_H - 1 && guard++ < 200) {
    const runV = Math.min(rng.int(2, 4), GRID_H - 1 - y);
    for (let i = 0; i < runV; i++) { y++; path.push({ x, y }); }
    if (y >= GRID_H - 1) break;
    let dir = rng.pick([-1, 1]);
    if (x <= 1) dir = 1;
    if (x >= GRID_W - 2) dir = -1;
    const runH = rng.int(2, 4);
    for (let i = 0; i < runH; i++) {
      const nx = x + dir;
      if (nx < 0 || nx > GRID_W - 1) break;
      x = nx;
      path.push({ x, y });
    }
  }
  return path;
}

function generateMap(seed) {
  S.seed = seed >>> 0;
  const rng = makeRng(seed);
  const terrain = S.terrain;
  const path = carvePath(rng);
  const onPath = new Set(path.map((p) => p.y * GRID_W + p.x));

  const grid = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      row.push({
        kind: onPath.has(y * GRID_W + x) ? 'path' : 'ground',
        v: rng.next(),
        decor: 0,
      });
    }
    grid.push(row);
  }

  /* obstacle clusters — they never block movement, only construction */
  const plant = (kind, chance, maxSize) => {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (grid[y][x].kind !== 'ground' || !rng.chance(chance)) continue;
        const size = rng.int(1, maxSize);
        for (let i = 0; i < size; i++) {
          const cx = clamp(x + rng.int(-1, 1), 0, GRID_W - 1);
          const cy = clamp(y + rng.int(-1, 1), 0, GRID_H - 1);
          if (grid[cy][cx].kind === 'ground') grid[cy][cx].kind = kind;
        }
      }
    }
  };
  plant('rock', terrain.density.rock, 3);
  plant('liquid', terrain.density.liquid, 4);

  /* keep the field playable: at least 55% open ground, and rocks to earth pylons on */
  let ground = 0, rocks = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x].kind === 'ground') ground++;
      if (grid[y][x].kind === 'rock') rocks++;
    }
  }
  const open = GRID_W * GRID_H - path.length;
  let guard = 0;
  while (ground < open * 0.55 && guard++ < 400) {
    const x = rng.int(0, GRID_W - 1), y = rng.int(0, GRID_H - 1);
    const c = grid[y][x];
    if (c.kind === 'rock' || c.kind === 'liquid') {
      if (c.kind === 'rock') rocks--;
      c.kind = 'ground';
      ground++;
    }
  }
  guard = 0;
  while (rocks < 5 && guard++ < 400) {
    const x = rng.int(0, GRID_W - 1), y = rng.int(1, GRID_H - 2);
    const c = grid[y][x];
    if (c.kind === 'ground' && countNeighbours(grid, x, y, 'ground') >= 3) {
      c.kind = 'rock';
      rocks++;
    }
  }

  /* scatter decoration on open ground */
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = grid[y][x];
      if (c.kind === 'ground' && rng.chance(terrain.density.decor)) c.decor = rng.int(1, 3);
    }
  }

  S.hasLiquid = grid.some((row) => row.some((c) => c.kind === 'liquid'));
  S.grid = grid;
  S.path = path;
  S.geo = buildGeometry(path);
  S.airGeo = buildAirGeometry(path);
  cachePathDistance();
}

function countNeighbours(grid, x, y, kind) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      if (grid[ny][nx].kind === kind) n++;
    }
  }
  return n;
}

/* polyline through tile centres, with an off-map entry and exit */
function buildGeometry(path) {
  const pts = [{ x: path[0].x + 0.5, y: -0.8 }];
  for (const p of path) pts.push({ x: p.x + 0.5, y: p.y + 0.5 });
  const last = path[path.length - 1];
  pts.push({ x: last.x + 0.5, y: GRID_H + 0.8 });
  return measure(pts);
}

function buildAirGeometry(path) {
  const last = path[path.length - 1];
  return measure([
    { x: path[0].x + 0.5, y: -0.8 },
    { x: last.x + 0.5, y: GRID_H + 0.8 },
  ]);
}

function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + dist(pts[i].x, pts[i].y, pts[i - 1].x, pts[i - 1].y));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

function posAt(geo, d) {
  const { pts, cum } = geo;
  if (d <= 0) return { x: pts[0].x, y: pts[0].y, a: Math.PI / 2 };
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i]) {
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / seg;
      const a = pts[i - 1], b = pts[i];
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        a: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
  }
  const e = pts[pts.length - 1];
  return { x: e.x, y: e.y, a: Math.PI / 2 };
}

/* chebyshev distance from every tile to the nearest road tile — placement rules use it */
let pathDist = [];
function cachePathDistance() {
  pathDist = [];
  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      let best = 99;
      for (const p of S.path) {
        const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
        if (d < best) best = d;
        if (best === 0) break;
      }
      row.push(best);
    }
    pathDist.push(row);
  }
}

/* ============================================================
   4. Placement rules — "site it where the weapon can work"
   ============================================================ */

function towerAt(x, y) {
  return S.towers.find((t) => t.gx === x && t.gy === y) || null;
}

function placement(def, x, y) {
  const c = tileAt(x, y);
  if (!c) return { ok: false, why: 'Off the map.' };
  if (c.kind === 'path') return { ok: false, why: 'That is the enemy road.' };
  if (c.kind === 'rock') return { ok: false, why: 'Solid rock — nothing anchors here.' };
  if (c.kind === 'liquid') return { ok: false, why: 'Cannot build on ' + S.terrain.liquidName + '.' };
  if (towerAt(x, y)) return { ok: false, why: 'Tile already occupied.' };

  switch (def.place) {
    case 'nearPath':
      if (pathDist[y][x] > 1) return { ok: false, why: def.name + ' only reaches one tile from the road.' };
      break;
    case 'farPath':
      if (pathDist[y][x] < 2) return { ok: false, why: def.name + ' needs two tiles of standoff from the road.' };
      break;
    case 'nearRock':
      if (countNeighbours(S.grid, x, y, 'rock') === 0)
        return { ok: false, why: def.name + ' must be earthed against rock.' };
      break;
  }
  return { ok: true };
}

/* terrain-adjusted stats */
function statsOf(t) {
  const def = t.def;
  let dmg = def.damage, rng = def.range, cd = def.cooldown, hp = def.hp;
  for (let l = 2; l <= t.level; l++) {
    const u = UPGRADES[l];
    dmg *= u.damage; rng *= u.range; cd *= u.cooldown; hp *= u.hp;
  }
  const m = S.terrain.mods;
  return {
    damage: dmg,
    range: rng * m.towerRange,
    cooldown: cd * m.towerCooldown,
    maxHp: Math.round(hp),
    dps: dmg / (cd * m.towerCooldown),
  };
}
function upgradeCost(t) {
  return Math.round(t.def.cost * UPGRADES[t.level + 1].costMul);
}
function sellValue(t) {
  return Math.round(t.spent * SELL_REFUND);
}

/* ============================================================
   5. Combat
   ============================================================ */

function spawnEnemy(id, waveNo) {
  const def = ENEMIES[id];
  const L = S.level;
  const scale = def.boss ? 0.6 + 0.12 * waveNo : 1 + 0.15 * waveNo;
  const hp = def.hp * scale * L.hpMul;
  S.enemies.push({
    def,
    id,
    hp,
    maxHp: hp,
    armor: def.armor * (1 + 0.025 * waveNo),
    speed: def.speed * L.speedMul * S.terrain.mods.enemySpeed,
    d: -Math.random() * 0.15,
    x: 0, y: 0, a: Math.PI / 2,
    slow: 0, slowT: 0,
    flash: 0,
    wob: Math.random() * 6.28,
    gunCool: Math.random() * 1.5,
    gunDamage: def.gun ? def.gun.damage * (1 + 0.035 * waveNo) : 0,
  });
}

function hurt(e, amount, type) {
  const res = e.def.resist[type] || 0;
  let a = amount * (1 - res);
  /* armour subtracts, but never fully negates — heavy plate blunts kinetic, it does not erase it */
  if (a > 0) {
    if (type === 'kinetic') a = Math.max(a * 0.15, a - e.armor);
    else if (type === 'explosive') a = Math.max(a * 0.35, a - e.armor * 0.35);
  }
  if (a <= 0) {
    if (type === 'frost') return;             // immune: no damage, no slow
    a = 0;
  }
  e.hp -= a;
  e.flash = 0.14;
  S.dmg[type] += a;
  if (e.hp <= 0) killEnemy(e);
}

function chill(e, factor, time) {
  if (e.def.slowImmune) return;
  e.slow = Math.max(e.slow, factor);
  e.slowT = Math.max(e.slowT, time);
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  S.kills++;
  S.money += Math.round(e.def.bounty * S.level.bountyMul);
  burst(e.x, e.y, e.def.color, e.def.boss ? 34 : 12, e.def.boss ? 1.9 : 1);
  if (e.def.boss) S.rings.push({ x: e.x, y: e.y, r: 0.4, max: 3.4, life: 0.7, t: 0.7, color: '#ffb14d' });
}

function splashDamage(x, y, radius, dmg, type, airToo) {
  for (const e of S.enemies) {
    if (e.dead) continue;
    if (e.def.air && !airToo) continue;
    const d = dist(x, y, e.x, e.y);
    if (d <= radius + e.def.radius) {
      const falloff = 1 - 0.45 * (d / (radius + 0.001));
      hurt(e, dmg * Math.max(0.4, falloff), type);
    }
  }
  S.rings.push({ x, y, r: radius * 0.35, max: radius, life: 0.28, t: 0.28, color: '#ffb98a' });
  burst(x, y, '#ffb07a', 9, 0.9);
}

function canHit(def, e) {
  if (def.targets === 'both') return true;
  if (def.targets === 'air') return !!e.def.air;
  return !e.def.air;
}

function acquire(t, st) {
  let best = null, bestD = -1;
  for (const e of S.enemies) {
    if (e.dead || !canHit(t.def, e)) continue;
    const d = dist(t.x, t.y, e.x, e.y);
    if (d > st.range + e.def.radius) continue;
    if (t.def.minRange && d < t.def.minRange) continue;
    if (e.d > bestD) { bestD = e.d; best = e; }
  }
  return best;
}

function fire(t, st, target) {
  const def = t.def;
  t.recoil = 1;
  switch (def.fire) {
    case 'bullet':
      S.shots.push({ kind: 'bullet', x: t.x, y: t.y, target, speed: 15,
        dmg: st.damage, type: def.dmgType, color: def.color });
      muzzle(t, def.color);
      break;
    case 'shell':
      S.shots.push({ kind: 'shell', x: t.x, y: t.y, target, speed: 9.5,
        dmg: st.damage, type: def.dmgType, splash: def.splash, color: def.color });
      muzzle(t, '#ffd0a0');
      break;
    case 'missile':
      S.shots.push({ kind: 'missile', x: t.x, y: t.y, target, speed: 8, accel: 14,
        dmg: st.damage, type: def.dmgType, splash: 0.7, color: def.color, air: true });
      break;
    case 'arc': {
      const lead = Math.min(1.4, dist(t.x, t.y, target.x, target.y) / 7);
      const p = posAt(S.geo, target.d + target.speed * (1 - target.slow) * lead);
      S.shots.push({ kind: 'arc', x: t.x, y: t.y, sx: t.x, sy: t.y, tx: p.x, ty: p.y,
        f: 0, speed: 1 / Math.max(0.55, dist(t.x, t.y, p.x, p.y) / 7),
        dmg: st.damage, type: def.dmgType, splash: def.splash, color: def.color });
      muzzle(t, '#ffd0a0');
      break;
    }
    case 'pulse': {
      S.rings.push({ x: t.x, y: t.y, r: 0.2, max: st.range, life: 0.42, t: 0.42, color: def.color });
      for (const e of S.enemies) {
        if (e.dead || !canHit(def, e)) continue;
        if (dist(t.x, t.y, e.x, e.y) <= st.range + e.def.radius) {
          hurt(e, st.damage, def.dmgType);
          chill(e, def.slow, def.slowTime);
        }
      }
      break;
    }
    case 'chain': {
      let src = t, dmg = st.damage;
      const hitSet = new Set();
      let cur = target;
      const seg = [];
      for (let i = 0; i < def.chain && cur; i++) {
        seg.push({ ax: src.x, ay: src.y, bx: cur.x, by: cur.y });
        hurt(cur, dmg, def.dmgType);
        hitSet.add(cur);
        dmg *= def.chainFalloff;
        const from = cur;
        cur = null;
        let bd = def.chainRange;
        for (const e of S.enemies) {
          if (e.dead || hitSet.has(e) || !canHit(def, e)) continue;
          const d = dist(from.x, from.y, e.x, e.y);
          if (d < bd) { bd = d; cur = e; }
        }
        src = from;
      }
      S.zaps.push({ seg, t: 0.16, life: 0.16, color: def.color });
      break;
    }
  }
}

function updateTowers(dt) {
  for (const t of S.towers) {
    const st = statsOf(t);
    t.cool -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 5);
    const target = acquire(t, st);
    if (target) {
      const want = Math.atan2(target.y - t.y, target.x - t.x);
      let diff = want - t.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      t.a += clamp(diff, -8 * dt, 8 * dt);
      t.spin += dt * 9;
      if (t.cool <= 0 && Math.abs(diff) < 0.5) {
        t.cool = st.cooldown;
        fire(t, st, target);
      }
    } else {
      t.spin += dt * 0.6;
      if (t.cool < 0) t.cool = 0;
    }
  }
}

function updateShots(dt) {
  for (const s of S.shots) {
    if (s.kind === 'arc') {
      s.f += dt * s.speed;
      if (s.f >= 1) {
        s.done = true;
        splashDamage(s.tx, s.ty, s.splash, s.dmg, s.type, false);
      } else {
        s.x = s.sx + (s.tx - s.sx) * s.f;
        s.y = s.sy + (s.ty - s.sy) * s.f;
      }
      continue;
    }
    const tg = s.target;
    if (!tg || tg.dead || tg.gone) {
      s.life = (s.life ?? 0.25) - dt;
      s.x += Math.cos(s.a || 0) * s.speed * dt;
      s.y += Math.sin(s.a || 0) * s.speed * dt;
      if (s.life <= 0) s.done = true;
      continue;
    }
    if (s.accel) s.speed += s.accel * dt;
    const dx = tg.x - s.x, dy = tg.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    s.a = Math.atan2(dy, dx);
    const step = s.speed * dt;
    if (d <= step + tg.def.radius * 0.7) {
      s.done = true;
      if (s.splash) splashDamage(tg.x, tg.y, s.splash, s.dmg, s.type, !!s.air);
      else { hurt(tg, s.dmg, s.type); sparks(tg.x, tg.y, s.color); }
    } else {
      s.x += (dx / d) * step;
      s.y += (dy / d) * step;
      if (s.kind === 'missile' && Math.random() < 0.7) {
        S.parts.push({ x: s.x, y: s.y, vx: 0, vy: 0, t: 0.28, life: 0.28, r: 0.06, c: '#ffd9c0' });
      }
    }
  }
  S.shots = S.shots.filter((s) => !s.done);
}

/* Enemy fire: units engage the nearest emplacement inside their weapon's reach
   as they advance — they never stop, so the column keeps flowing. This is what
   makes siting a Cryo Coil beside the road a real risk and a Mortar Pit's
   standoff a real reward. */
function enemyFire(e, dt) {
  const gun = e.def.gun;
  if (!gun || !S.towers.length) return;
  e.gunCool -= dt;
  if (e.gunCool > 0) return;
  let best = null, bd = gun.range;
  for (const t of S.towers) {
    const d = dist(e.x, e.y, t.x, t.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  e.gunCool = gun.cooldown;
  best.hp -= e.gunDamage;
  best.hurt = 0.25;
  S.tracers.push({ ax: e.x, ay: e.y, bx: best.x, by: best.y, t: 0.12, life: 0.12,
    color: '#ff8a6a' });
  sparks(best.x, best.y, '#ffb07a');
  if (best.hp <= 0) destroyTower(best, e);
}

function destroyTower(t, by) {
  S.towers = S.towers.filter((x) => x !== t);
  if (S.towerSel === t) S.towerSel = null;
  S.towersLost++;
  S.plunder += ENEMY_ECON.plunderPerTower;
  burst(t.x, t.y, '#ff9152', 22, 1.4);
  S.rings.push({ x: t.x, y: t.y, r: 0.3, max: 1.6, life: 0.4, t: 0.4, color: '#ff5f6d' });
  shake(0.6);
  flash(t.def.name + ' destroyed', true);
}

function updateEnemies(dt) {
  for (const e of S.enemies) {
    if (e.dead) continue;
    enemyFire(e, dt);
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
    if (e.flash > 0) e.flash -= dt;
    const geo = e.def.air ? S.airGeo : S.geo;
    e.d += e.speed * (1 - e.slow) * dt;
    const p = posAt(geo, e.d);
    e.x = p.x; e.y = p.y; e.a = p.a;
    e.wob += dt * 8;
    if (e.d >= geo.len) {
      e.gone = true;
      e.dead = true;
      S.integrity = Math.max(0, S.integrity - e.def.leak);
      S.plunder += ENEMY_ECON.plunderPerIntegrity * e.def.leak;
      shake(0.5);
      burst(e.x, Math.min(e.y, GRID_H - 0.3), '#ff5f6d', 14, 1.2);
      if (S.integrity <= 0) endGame(false);
    }
  }
  S.enemies = S.enemies.filter((e) => !e.dead);
}

/* particles ------------------------------------------------- */

function burst(x, y, color, n, scale) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283;
    const sp = (0.6 + Math.random() * 2.2) * scale;
    S.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      t: 0.45 + Math.random() * 0.3, life: 0.7, r: (0.04 + Math.random() * 0.07) * scale, c: color });
  }
}
function sparks(x, y, color) {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * 6.283;
    S.parts.push({ x, y, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4,
      t: 0.16, life: 0.16, r: 0.045, c: color });
  }
}
function muzzle(t, color) {
  S.parts.push({ x: t.x + Math.cos(t.a) * 0.4, y: t.y + Math.sin(t.a) * 0.4,
    vx: Math.cos(t.a) * 1.2, vy: Math.sin(t.a) * 1.2, t: 0.1, life: 0.1, r: 0.13, c: color });
}
function updateParticles(dt) {
  for (const p of S.parts) {
    p.t -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
  }
  S.parts = S.parts.filter((p) => p.t > 0);
  for (const r of S.rings) r.t -= dt;
  S.rings = S.rings.filter((r) => r.t > 0);
  for (const z of S.zaps) z.t -= dt;
  S.zaps = S.zaps.filter((z) => z.t > 0);
  for (const r of S.tracers) r.t -= dt;
  S.tracers = S.tracers.filter((r) => r.t > 0);
  for (const t of S.towers) if (t.hurt > 0) t.hurt -= dt;
}

let shakeAmt = 0;
function shake(v) { shakeAmt = Math.min(1.2, shakeAmt + v); }

/* ============================================================
   6. Wave director — the enemy reads your defence
   ============================================================ */

const COUNTER = { kinetic: 'bulwark', explosive: 'scout', energy: 'aegis', frost: 'warhound' };
const INTEL_LINE = {
  bulwark: 'Kinetic fire dominates your line — Bulwark armour rotating forward.',
  scout: 'Blast weapons logged — the column disperses into fast Scout elements.',
  aegis: 'Energy discharge mapped — Aegis walkers deploy shielding.',
  warhound: 'Cryo fields charted — thermally lined Warhounds take point.',
  wasp: 'No credible anti-air over your sector — Wasp flights authorised.',
};

function globalWave() { return S.roundIndex * WAVES_PER_ROUND + S.waveIndex; }

/* Reinforcement funding, plus whatever they took off you last wave. */
function fundEnemy() {
  const L = S.level;
  const opening = S.roundIndex === 0 && S.waveIndex === 0;
  const income = opening
    ? 0
    : Math.round(ENEMY_ECON.income(S.waveIndex, S.roundIndex) * L.threatMul);
  S.enemyCredits += income + S.plunder;
  S.lastIncome = income;
  S.lastPlunder = S.plunder;
  S.plunder = 0;
}

function airCoverage() {
  let total = 0, aa = 0;
  for (const t of S.towers) {
    const dps = statsOf(t).dps;
    total += dps;
    if (t.def.targets !== 'ground') aa += dps;
  }
  return total > 0 ? aa / total : 0;
}

function planWave() {
  const wn = globalWave();
  const L = S.level;
  const rng = makeRng((S.roundIndex * 977 + S.waveIndex * 31 + 7) >>> 0);

  const weights = {
    scout: 1.0,
    trooper: 1.15,
    bulwark: wn >= ENEMIES.bulwark.unlock ? 0.55 : 0,
    wasp: wn >= ENEMIES.wasp.unlock ? 0.5 : 0,
    warhound: wn >= ENEMIES.warhound.unlock ? 0.45 : 0,
    aegis: wn >= ENEMIES.aegis.unlock ? 0.45 : 0,
  };

  /* --- adaptation --- */
  let lead = null, leadGain = 0;
  const hist = S.dmgRecent;
  const total = hist.kinetic + hist.explosive + hist.energy + hist.frost;
  if (total > 0) {
    for (const type of Object.keys(COUNTER)) {
      const share = hist[type] / total;
      const unit = COUNTER[type];
      if (!weights[unit]) continue;
      const gain = L.adapt * 3.0 * Math.max(0, share - 0.15);
      weights[unit] *= 1 + gain;
      if (gain > leadGain) { leadGain = gain; lead = unit; }
    }
  }
  const cover = airCoverage();
  if (weights.wasp && cover < 0.35) {
    const gain = L.adapt * 3.0 * ((0.35 - cover) / 0.35);
    weights.wasp *= 1 + gain;
    if (gain > leadGain) { leadGain = gain; lead = 'wasp'; }
  }

  S.intel = leadGain > 0.12 && lead
    ? INTEL_LINE[lead]
    : (S.towers.length === 0
      ? 'Enemy scouts report an undefended corridor.'
      : 'Enemy command is still probing your line.');
  S.intelAlert = leadGain > 0.4;

  /* --- procurement ---
     The wave is whatever enemy command can actually pay for out of its chest,
     up to the doctrine cap for this stage of the campaign. Weights above decide
     what it buys; the chest decides how much. */
  S.weights = weights;          /* exposed for tuning and diagnostics */
  const isBoss = S.waveIndex === WAVES_PER_ROUND - 1;
  const cap = Math.round(ENEMY_ECON.commitCap(S.waveIndex, S.roundIndex) * L.threatMul);
  let purse = Math.min(S.enemyCredits, cap);
  const spendable = purse;
  const pool = Object.keys(weights).filter((k) => weights[k] > 0);
  const cheapest = Math.min(...pool.map((k) => ENEMIES[k].cost));
  const list = [];
  let guard = 0;
  while (purse >= cheapest && guard++ < 400) {
    const affordable = pool.filter((k) => ENEMIES[k].cost <= purse);
    const sum = affordable.reduce((a, k) => a + weights[k], 0);
    let r = rng.next() * sum, pickId = affordable[0];
    for (const k of affordable) { r -= weights[k]; if (r <= 0) { pickId = k; break; } }
    list.push(pickId);
    purse -= ENEMIES[pickId].cost;
  }
  S.enemyCredits -= spendable - purse;
  S.waveSpend = spendable - purse;
  /* shuffle so the column is mixed, then bosses last */
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (isBoss) list.push('titan');

  const gap = clamp(0.62 - S.roundIndex * 0.03, 0.32, 0.62);
  S.nextWave = { list, gap };
  return S.nextWave;
}

function waveSummary() {
  if (!S.nextWave) return '';
  const count = {};
  for (const id of S.nextWave.list) count[id] = (count[id] || 0) + 1;
  return Object.keys(count)
    .map((id) => ENEMIES[id].name.split(' ')[0] + ' ×' + count[id])
    .join(', ');
}

function startWave() {
  if (S.waveRunning || S.screen !== 'play') return;
  if (!S.nextWave) planWave();
  S.spawnQueue = S.nextWave.list.slice();
  S.spawnGap = S.nextWave.gap;
  S.spawnTimer = 0;
  S.waveRunning = true;
  S.dmg = { kinetic: 0, explosive: 0, energy: 0, frost: 0 };
  syncUI();
}

function updateWave(dt) {
  if (!S.waveRunning) return;
  if (S.spawnQueue.length) {
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      spawnEnemy(S.spawnQueue.shift(), globalWave());
      S.spawnTimer = S.spawnGap * (0.75 + Math.random() * 0.5);
    }
  } else if (S.enemies.length === 0) {
    finishWave();
  }
}

function finishWave() {
  S.waveRunning = false;
  S.waveIndex++;
  S.wavesCleared++;
  for (const k of Object.keys(S.dmgRecent)) {
    S.dmgRecent[k] = S.dmgRecent[k] * 0.5 + S.dmg[k];
  }
  /* emplacements are patched up between waves; anything destroyed stays lost */
  for (const t of S.towers) t.hp = t.maxHp;
  const bonus = Math.round((48 + S.waveIndex * 9 + S.roundIndex * 13) * S.level.bountyMul);
  S.money += bonus;
  if (S.waveIndex >= WAVES_PER_ROUND) {
    finishRound(bonus);
  } else {
    fundEnemy();
    planWave();
    syncUI();
    flash('Wave cleared · +' + bonus + ' credits', false);
  }
}

/* ============================================================
   7. Terrain painting (pre-rendered once per round)
   ============================================================ */

/* The ground is painted as continuous terrain — a base wash, soft organic
   blotches and fine grain — so it never reads as a quilt of coloured tiles. */
function paintTerrain() {
  const T = S.terrain;
  const w = GRID_W * TS, h = GRID_H * TS;
  const rng = makeRng((S.seed ^ 0x9e3779b9) >>> 0);

  sctx.clearRect(0, 0, w, h);
  sctx.fillStyle = T.sky;
  sctx.fillRect(0, 0, w, h);
  sctx.fillStyle = T.ground[0];
  sctx.fillRect(0, 0, w, h);

  /* soft blotches of the other ground tones */
  for (let i = 0; i < 54; i++) {
    const cx = rng.next() * w, cy = rng.next() * h;
    const r = TS * (1.1 + rng.next() * 2.8);
    const col = T.ground[1 + Math.floor(rng.next() * (T.ground.length - 1))];
    const g = sctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.globalAlpha = 0.34;
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(cx, cy, r, 0, 6.283);
    sctx.fill();
  }
  sctx.globalAlpha = 1;

  /* fine grain */
  const grains = Math.min(2600, Math.round(w * h / 70));
  for (let i = 0; i < grains; i++) {
    sctx.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    sctx.fillRect(rng.next() * w, rng.next() * h, 1.4, 1.4);
  }

  /* build grid, barely there */
  sctx.strokeStyle = 'rgba(255,255,255,0.038)';
  sctx.lineWidth = 1;
  sctx.beginPath();
  for (let x = 1; x < GRID_W; x++) { sctx.moveTo(x * TS + 0.5, 0); sctx.lineTo(x * TS + 0.5, h); }
  for (let y = 1; y < GRID_H; y++) { sctx.moveTo(0, y * TS + 0.5); sctx.lineTo(w, y * TS + 0.5); }
  sctx.stroke();

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = S.grid[y][x];
      if (c.kind === 'ground' && c.decor) paintDecor(x, y, c);
    }
  }

  paintRoad();

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (S.grid[y][x].kind === 'rock') paintRock(x, y, S.grid[y][x]);
    }
  }

  const g = sctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.28)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, w, h);
}

function paintDecor(x, y, c) {
  const T = S.terrain;
  const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
  const s = TS;
  sctx.save();
  sctx.translate(cx, cy);
  sctx.rotate((c.v - 0.5) * 3);
  sctx.strokeStyle = T.accent;
  sctx.fillStyle = T.accent;
  sctx.lineWidth = Math.max(1, s * 0.045);
  sctx.globalAlpha = 0.55;
  switch (T.decor) {
    case 'grass':
      for (let i = -1; i <= 1; i++) {
        sctx.beginPath();
        sctx.moveTo(i * s * 0.13, s * 0.14);
        sctx.quadraticCurveTo(i * s * 0.16, 0, i * s * 0.1, -s * 0.16);
        sctx.stroke();
      }
      break;
    case 'dune':
      sctx.beginPath();
      sctx.arc(0, s * 0.2, s * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      sctx.stroke();
      sctx.beginPath();
      sctx.arc(0, s * 0.34, s * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      sctx.stroke();
      break;
    case 'ice':
      sctx.beginPath();
      sctx.moveTo(-s * 0.24, -s * 0.06);
      sctx.lineTo(-s * 0.04, s * 0.06);
      sctx.lineTo(s * 0.1, -s * 0.1);
      sctx.lineTo(s * 0.26, s * 0.02);
      sctx.stroke();
      break;
    case 'ember':
      sctx.globalAlpha = 0.8;
      sctx.fillStyle = '#ff7a2f';
      for (let i = 0; i < 3; i++) {
        sctx.beginPath();
        sctx.arc((i - 1) * s * 0.16, (c.v - 0.5) * s * 0.3, s * 0.035, 0, 6.283);
        sctx.fill();
      }
      break;
    case 'reed':
      for (let i = -1; i <= 1; i++) {
        sctx.beginPath();
        sctx.moveTo(i * s * 0.14, s * 0.22);
        sctx.lineTo(i * s * 0.14 + s * 0.05, -s * 0.22);
        sctx.stroke();
      }
      break;
    case 'rubble':
      sctx.globalAlpha = 0.42;
      for (let i = 0; i < 3; i++) {
        sctx.save();
        sctx.rotate(i * 1.1 + c.v * 3);
        sctx.fillRect(-s * 0.16, -s * 0.05, s * 0.22, s * 0.09);
        sctx.restore();
      }
      break;
  }
  sctx.restore();
}

function paintRock(x, y, c) {
  const T = S.terrain;
  const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
  const r = TS * 0.42;
  sctx.save();
  sctx.translate(cx, cy);
  sctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.283;
    const rr = r * (0.72 + ((Math.sin(i * 12.9898 + c.v * 78.233) + 1) / 2) * 0.42);
    const px2 = Math.cos(a) * rr, py2 = Math.sin(a) * rr;
    if (i === 0) sctx.moveTo(px2, py2); else sctx.lineTo(px2, py2);
  }
  sctx.closePath();
  sctx.fillStyle = T.rock[0];
  sctx.shadowColor = 'rgba(0,0,0,0.55)';
  sctx.shadowBlur = TS * 0.3;
  sctx.shadowOffsetY = TS * 0.09;
  sctx.fill();
  sctx.shadowColor = 'transparent';
  sctx.strokeStyle = T.rock[1];
  sctx.lineWidth = Math.max(1, TS * 0.05);
  sctx.stroke();
  sctx.globalAlpha = 0.35;
  sctx.fillStyle = '#ffffff';
  sctx.beginPath();
  sctx.ellipse(-r * 0.15, -r * 0.25, r * 0.35, r * 0.2, -0.5, 0, 6.283);
  sctx.fill();
  sctx.restore();
}

function paintRoad() {
  const T = S.terrain;
  const pts = S.geo.pts;
  const trace = () => {
    sctx.beginPath();
    sctx.moveTo(px(pts[0].x), px(pts[0].y));
    for (let i = 1; i < pts.length; i++) sctx.lineTo(px(pts[i].x), px(pts[i].y));
  };
  sctx.lineCap = 'round';
  sctx.lineJoin = 'round';
  trace();
  sctx.strokeStyle = T.roadEdge;
  sctx.lineWidth = TS * 0.94;
  sctx.stroke();
  trace();
  sctx.strokeStyle = T.road;
  sctx.lineWidth = TS * 0.74;
  sctx.stroke();
  trace();
  sctx.strokeStyle = 'rgba(255,255,255,0.12)';
  sctx.lineWidth = Math.max(1, TS * 0.055);
  sctx.setLineDash([TS * 0.24, TS * 0.3]);
  sctx.stroke();
  sctx.setLineDash([]);
}

/* ============================================================
   8. Tower and enemy art
   ============================================================ */

function drawTowerArt(g, def, level, cx, cy, r, angle, spin, recoil) {
  g.save();
  g.translate(cx, cy);

  /* plinth */
  g.beginPath();
  g.arc(0, r * 0.1, r * 0.92, 0, 6.283);
  g.fillStyle = 'rgba(8,11,16,0.45)';
  g.fill();
  g.beginPath();
  g.arc(0, 0, r * 0.8, 0, 6.283);
  g.fillStyle = '#333c4d';
  g.fill();
  g.strokeStyle = '#141a24';
  g.lineWidth = r * 0.1;
  g.stroke();
  /* accent ring: the weapon's damage colour, so type reads at a glance */
  g.beginPath();
  g.arc(0, 0, r * 0.68, 0, 6.283);
  g.strokeStyle = def.color;
  g.globalAlpha = 0.35;
  g.lineWidth = r * 0.16;
  g.stroke();
  g.globalAlpha = 1;

  if (level > 1) {
    g.beginPath();
    g.arc(0, 0, r * 0.88, -1.9, -1.9 + (level === 3 ? 6.283 : 3.14));
    g.strokeStyle = level === 3 ? '#ffc861' : '#9fb2c9';
    g.lineWidth = r * 0.12;
    g.stroke();
  }

  g.rotate(angle);
  const rec = -(recoil || 0) * r * 0.28;

  switch (def.id) {
    case 'gatling': {
      g.fillStyle = '#4b5568';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.283 + 0.4;
        g.beginPath();
        g.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, r * 0.24, 0, 6.283);
        g.fill();
      }
      g.fillStyle = '#39445a';
      g.beginPath();
      g.arc(0, 0, r * 0.44, 0, 6.283);
      g.fill();
      g.fillStyle = def.color;
      for (const off of [-0.16, 0.16]) {
        g.fillRect(rec + r * 0.1, off * r * 2 - r * 0.09, r * 0.9, r * 0.18);
      }
      g.beginPath();
      g.arc(0, 0, r * 0.2, 0, 6.283);
      g.fillStyle = '#eef3fa';
      g.fill();
      break;
    }
    case 'cannon': {
      g.fillStyle = '#3c4657';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283;
        const x = Math.cos(a) * r * 0.62, y = Math.sin(a) * r * 0.62;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#59667d';
      g.fillRect(rec - r * 0.1, -r * 0.22, r * 1.25, r * 0.44);
      g.fillStyle = def.color;
      g.fillRect(rec + r * 0.85, -r * 0.26, r * 0.28, r * 0.52);
      break;
    }
    case 'frost': {
      g.save();
      g.rotate(-angle + spin * 0.5);
      g.strokeStyle = def.color;
      g.lineWidth = r * 0.1;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(0, 0, r * 0.66, 0, 4.4);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, r * 0.44, 2.2, 5.9);
      g.stroke();
      g.restore();
      g.globalAlpha = 1;
      g.fillStyle = '#dff2ff';
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.283 - 1.57;
        const rr = i % 2 ? r * 0.2 : r * 0.42;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
      g.shadowColor = def.color;
      g.shadowBlur = r * 0.7;
      g.fill();
      g.shadowBlur = 0;
      break;
    }
    case 'tesla': {
      g.strokeStyle = '#4b5568';
      g.lineWidth = r * 0.16;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * 6.283 + spin * 0.02;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, r * 0.34, 0, 6.283);
      g.fillStyle = '#0e1620';
      g.fill();
      g.shadowColor = def.color;
      g.shadowBlur = r * 0.9;
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(0, 0, r * 0.24 + Math.sin(spin * 2) * r * 0.03, 0, 6.283);
      g.fill();
      g.shadowBlur = 0;
      break;
    }
    case 'mortar': {
      g.fillStyle = '#232a36';
      g.beginPath();
      g.arc(0, 0, r * 0.68, 0, 6.283);
      g.fill();
      g.fillStyle = '#4b5568';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.283;
        g.beginPath();
        g.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, r * 0.2, 0, 6.283);
        g.fill();
      }
      g.save();
      g.translate(rec * 0.5, 0);
      g.fillStyle = '#5c6a80';
      g.fillRect(-r * 0.16, -r * 0.5, r * 0.72, r * 0.34);
      g.fillStyle = def.color;
      g.fillRect(r * 0.4, -r * 0.52, r * 0.18, r * 0.38);
      g.restore();
      break;
    }
    case 'sam': {
      g.fillStyle = '#3c4657';
      g.fillRect(-r * 0.5, -r * 0.5, r * 1.0, r * 1.0);
      g.fillStyle = '#59667d';
      g.fillRect(rec - r * 0.1, -r * 0.42, r * 0.9, r * 0.84);
      g.fillStyle = def.color;
      for (const off of [-0.26, 0.26]) {
        g.beginPath();
        g.moveTo(rec + r * 0.85, off * r - r * 0.11);
        g.lineTo(rec + r * 1.12, off * r);
        g.lineTo(rec + r * 0.85, off * r + r * 0.11);
        g.closePath();
        g.fill();
      }
      break;
    }
  }
  g.restore();
}

function drawEnemy(g, e) {
  const r = e.def.radius * TS;
  const x = px(e.x), y = px(e.y);
  const fly = e.def.air ? TS * 0.42 : 0;

  /* shadow */
  g.globalAlpha = e.def.air ? 0.3 : 0.42;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x + fly * 0.3, y + fly * 0.5 + r * 0.35, r * 0.9, r * 0.5, 0, 0, 6.283);
  g.fill();
  g.globalAlpha = 1;

  g.save();
  g.translate(x, y - fly);
  g.rotate(e.a + Math.PI / 2);

  const col = e.flash > 0 ? '#ffffff' : e.def.color;
  g.fillStyle = col;
  g.strokeStyle = 'rgba(6,9,14,0.75)';
  g.lineWidth = r * 0.22;

  switch (e.id) {
    case 'scout':
      g.beginPath();
      g.moveTo(0, -r * 1.15);
      g.lineTo(r * 0.8, r * 0.85);
      g.lineTo(0, r * 0.45);
      g.lineTo(-r * 0.8, r * 0.85);
      g.closePath();
      g.fill(); g.stroke();
      break;
    case 'trooper': {
      const sw = Math.sin(e.wob) * r * 0.25;
      g.fillStyle = '#2b3240';
      g.fillRect(-r * 0.95, -r * 0.2 + sw, r * 0.35, r * 0.8);
      g.fillRect(r * 0.6, -r * 0.2 - sw, r * 0.35, r * 0.8);
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(-r * 0.66, -r * 0.9, r * 1.32, r * 1.6, r * 0.3);
      g.fill(); g.stroke();
      g.fillStyle = '#1b2129';
      g.fillRect(-r * 0.28, -r * 0.95, r * 0.56, r * 0.4);
      break;
    }
    case 'bulwark':
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.283 - 1.57;
        const px2 = Math.cos(a) * r * 1.05, py2 = Math.sin(a) * r * 1.15;
        i ? g.lineTo(px2, py2) : g.moveTo(px2, py2);
      }
      g.closePath();
      g.fill(); g.stroke();
      g.fillStyle = '#e9edf2';
      g.globalAlpha = 0.35;
      g.fillRect(-r * 0.75, -r * 0.15, r * 1.5, r * 0.3);
      g.globalAlpha = 1;
      g.fillStyle = '#2b3240';
      g.fillRect(-r * 0.16, -r * 1.35, r * 0.32, r * 1.1);
      break;
    case 'warhound': {
      const sw = Math.sin(e.wob * 1.4) * r * 0.3;
      g.beginPath();
      g.moveTo(0, -r * 1.2);
      g.lineTo(r * 0.9, 0);
      g.lineTo(0, r * 1.0);
      g.lineTo(-r * 0.9, 0);
      g.closePath();
      g.fill(); g.stroke();
      g.strokeStyle = '#ffcf6e';
      g.lineWidth = r * 0.16;
      g.beginPath();
      g.moveTo(-r * 0.5, r * 0.3 + sw);
      g.lineTo(r * 0.5, r * 0.3 - sw);
      g.stroke();
      break;
    }
    case 'aegis':
      g.beginPath();
      g.arc(0, 0, r * 0.85, 0, 6.283);
      g.fill(); g.stroke();
      g.strokeStyle = '#bfe2ff';
      g.globalAlpha = 0.5 + Math.sin(e.wob) * 0.2;
      g.lineWidth = r * 0.2;
      g.beginPath();
      g.arc(0, 0, r * 1.15, -2.4, -0.75);
      g.stroke();
      g.globalAlpha = 1;
      break;
    case 'wasp': {
      const blur = (e.wob * 3) % 6.283;
      g.strokeStyle = 'rgba(230,240,255,0.4)';
      g.lineWidth = r * 0.1;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(s * r * 0.7, 0, r * 0.5, blur, blur + 4.2);
        g.stroke();
      }
      g.fillStyle = col;
      g.strokeStyle = 'rgba(6,9,14,0.75)';
      g.lineWidth = r * 0.2;
      g.beginPath();
      g.ellipse(0, 0, r * 0.42, r * 0.78, 0, 0, 6.283);
      g.fill(); g.stroke();
      break;
    }
    case 'titan': {
      g.fillStyle = '#2b3240';
      g.fillRect(-r * 1.05, -r * 0.85, r * 0.4, r * 1.7);
      g.fillRect(r * 0.65, -r * 0.85, r * 0.4, r * 1.7);
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(-r * 0.8, -r * 1.0, r * 1.6, r * 2.0, r * 0.25);
      g.fill(); g.stroke();
      g.fillStyle = '#ffcf6e';
      g.beginPath();
      g.arc(0, -r * 0.15, r * 0.34, 0, 6.283);
      g.fill();
      g.fillStyle = '#2b3240';
      g.fillRect(-r * 0.14, -r * 1.7, r * 0.28, r * 1.0);
      break;
    }
  }
  g.restore();

  if (e.slow > 0) {
    g.globalAlpha = 0.35;
    g.fillStyle = '#a9d8ff';
    g.beginPath();
    g.arc(x, y - fly, r * 1.25, 0, 6.283);
    g.fill();
    g.globalAlpha = 1;
  }

  if (e.hp < e.maxHp) {
    const w = r * 2.2, hgt = Math.max(2.5, TS * 0.07);
    const bx = x - w / 2, by = y - fly - r * 1.5;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(bx - 1, by - 1, w + 2, hgt + 2);
    const f = clamp(e.hp / e.maxHp, 0, 1);
    g.fillStyle = f > 0.5 ? '#57e08d' : f > 0.22 ? '#ffc861' : '#ff5f6d';
    g.fillRect(bx, by, w * f, hgt);
  }
}

/* older WebKit lacks roundRect */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

/* ============================================================
   9. Frame rendering
   ============================================================ */

function draw() {
  const w = GRID_W * TS, h = GRID_H * TS;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!S.grid.length) return;

  if (shakeAmt > 0.01) {
    ctx.translate((Math.random() - 0.5) * shakeAmt * TS * 0.4,
      (Math.random() - 0.5) * shakeAmt * TS * 0.4);
  }

  ctx.drawImage(stat, 0, 0, w, h);
  drawLiquid();
  drawPortals();
  drawPlacementHints();
  drawTowers();
  drawTracers();
  drawRings();
  for (const e of S.enemies) if (!e.def.air) drawEnemy(ctx, e);
  for (const e of S.enemies) if (e.def.air) drawEnemy(ctx, e);
  drawShots();
  drawZaps();
  drawParticles();
  if (S.paused) drawPaused(w, h);
}

/* Liquid is drawn as overlapping blobs so adjacent tiles merge into one pool
   instead of reading as a row of rounded squares. */
function liquidPath(scale) {
  ctx.beginPath();
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = S.grid[y][x];
      if (c.kind !== 'liquid') continue;
      const jx = (c.v - 0.5) * TS * 0.16;
      const jy = ((c.v * 7.13) % 1 - 0.5) * TS * 0.16;
      const cx = x * TS + TS / 2 + jx, cy = y * TS + TS / 2 + jy;
      const r = TS * 0.5 * scale * (0.92 + c.v * 0.16);
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, 6.283);
    }
  }
}

function drawLiquid() {
  const T = S.terrain;
  if (!S.hasLiquid) return;
  const h = GRID_H * TS;
  const lava = T.id === 'cinder';
  const pulse = 0.5 + Math.sin(S.t * (lava ? 2.2 : 1.4)) * 0.5;

  ctx.save();
  /* rim */
  liquidPath(1.1);
  ctx.fillStyle = T.liquidRim;
  ctx.fill();

  /* body */
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, T.liquid[0]);
  g.addColorStop(0.5, T.liquid[1]);
  g.addColorStop(1, T.liquid[0]);
  liquidPath(1);
  ctx.fillStyle = g;
  if (lava) {
    ctx.shadowColor = '#ff7a2f';
    ctx.shadowBlur = TS * (0.5 + pulse * 0.6);
  }
  ctx.fill();
  ctx.shadowBlur = 0;

  /* surface motion, clipped to the pools */
  liquidPath(1);
  ctx.clip();
  ctx.globalAlpha = lava ? 0.35 + pulse * 0.3 : 0.18;
  ctx.strokeStyle = lava ? '#ffd08a' : '#eaf6ff';
  ctx.lineWidth = Math.max(1, TS * 0.05);
  for (let i = 0; i < GRID_H * 2; i++) {
    const yy = (i / 2) * TS + Math.sin(S.t * 1.1 + i) * TS * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    for (let x = 0; x <= GRID_W * TS; x += TS * 0.5) {
      ctx.lineTo(x, yy + Math.sin(x / TS + S.t * 1.6 + i) * TS * 0.06);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPortals() {
  const inP = S.geo.pts[1];
  const outP = S.geo.pts[S.geo.pts.length - 2];
  /* spawn gate */
  ctx.save();
  ctx.globalAlpha = 0.5 + Math.sin(S.t * 3) * 0.2;
  ctx.strokeStyle = '#ff6b5c';
  ctx.lineWidth = Math.max(2, TS * 0.09);
  for (let i = 0; i < 2; i++) {
    const yy = px(inP.y) - TS * (0.5 + i * 0.32) + ((S.t * TS * 0.9) % (TS * 0.34));
    ctx.beginPath();
    ctx.moveTo(px(inP.x) - TS * 0.28, yy - TS * 0.16);
    ctx.lineTo(px(inP.x), yy + TS * 0.08);
    ctx.lineTo(px(inP.x) + TS * 0.28, yy - TS * 0.16);
    ctx.stroke();
  }
  ctx.restore();

  /* core */
  const f = S.integrity / S.maxIntegrity;
  const col = f > 0.5 ? '#57e08d' : f > 0.25 ? '#ffc861' : '#ff5f6d';
  ctx.save();
  ctx.translate(px(outP.x), px(outP.y) + TS * 0.15);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, TS * 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, TS * 0.4, 0, 6.283);
  ctx.stroke();
  ctx.globalAlpha = 0.25 + Math.sin(S.t * 2.2) * 0.12;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(0, 0, TS * (0.5 + Math.sin(S.t * 2.2) * 0.08), 0, 6.283);
  ctx.fill();
  ctx.restore();
}

function drawPlacementHints() {
  if (!S.shopSel) return;
  const def = S.shopSel;
  ctx.save();
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const ok = placement(def, x, y).ok;
      if (!ok) continue;
      const bx = x * TS, by = y * TS, m = TS * 0.18, k = TS * 0.2;
      ctx.fillStyle = 'rgba(89,215,242,0.055)';
      ctx.fillRect(bx + m * 0.6, by + m * 0.6, TS - m * 1.2, TS - m * 1.2);
      ctx.strokeStyle = 'rgba(120,228,250,0.5)';
      ctx.lineWidth = Math.max(1, TS * 0.035);
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx2 = bx + (sx > 0 ? m : TS - m), cy2 = by + (sy > 0 ? m : TS - m);
        ctx.moveTo(cx2 + sx * k, cy2);
        ctx.lineTo(cx2, cy2);
        ctx.lineTo(cx2, cy2 + sy * k);
      }
      ctx.stroke();
    }
  }
  if (S.hover) {
    const { x, y } = S.hover;
    const res = placement(def, x, y);
    const good = res.ok && S.money >= def.cost;
    ctx.fillStyle = good ? 'rgba(87,224,141,0.28)' : 'rgba(255,95,109,0.3)';
    ctx.fillRect(x * TS, y * TS, TS, TS);
    const st = { range: def.range * S.terrain.mods.towerRange };
    ctx.strokeStyle = good ? 'rgba(87,224,141,0.75)' : 'rgba(255,95,109,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x * TS + TS / 2, y * TS + TS / 2, px(st.range), 0, 6.283);
    ctx.stroke();
    if (def.minRange) {
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x * TS + TS / 2, y * TS + TS / 2, px(def.minRange), 0, 6.283);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.75;
    drawTowerArt(ctx, def, 1, x * TS + TS / 2, y * TS + TS / 2, TS * 0.4, -Math.PI / 2, S.t * 2, 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawTowers() {
  const sel = S.towerSel;
  if (sel) {
    const st = statsOf(sel);
    ctx.save();
    ctx.fillStyle = 'rgba(89,215,242,0.09)';
    ctx.strokeStyle = 'rgba(89,215,242,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px(sel.x), px(sel.y), px(st.range), 0, 6.283);
    ctx.fill();
    ctx.stroke();
    if (sel.def.minRange) {
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(px(sel.x), px(sel.y), px(sel.def.minRange), 0, 6.283);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  for (const t of S.towers) {
    if (t.hurt > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(t.hurt / 0.25, 0, 1) * 0.5;
      ctx.fillStyle = '#ff5f6d';
      ctx.beginPath();
      ctx.arc(px(t.x), px(t.y), TS * 0.5, 0, 6.283);
      ctx.fill();
      ctx.restore();
    }
    drawTowerArt(ctx, t.def, t.level, px(t.x), px(t.y), TS * 0.42, t.a, t.spin, t.recoil);
    if (t.hp < t.maxHp) {
      const w = TS * 0.66, h = Math.max(2.5, TS * 0.07);
      const bx = px(t.x) - w / 2, by = px(t.y) + TS * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      const f = clamp(t.hp / t.maxHp, 0, 1);
      ctx.fillStyle = f > 0.5 ? '#7ce7ff' : f > 0.25 ? '#ffc861' : '#ff5f6d';
      ctx.fillRect(bx, by, w * f, h);
    }
  }
}

function drawShots() {
  for (const s of S.shots) {
    const x = px(s.x), y = px(s.y);
    if (s.kind === 'bullet') {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1.5, TS * 0.07);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(s.a || 0) * TS * 0.3, y - Math.sin(s.a || 0) * TS * 0.3);
      ctx.stroke();
    } else if (s.kind === 'arc') {
      const lift = Math.sin(s.f * Math.PI) * TS * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(x, y, TS * 0.1, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y - lift, TS * 0.13, 0, 6.283);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.a || 0);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = TS * 0.35;
      if (s.kind === 'missile') {
        ctx.fillRect(-TS * 0.16, -TS * 0.05, TS * 0.32, TS * 0.1);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, TS * 0.11, 0, 6.283);
        ctx.fill();
      }
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawTracers() {
  for (const r of S.tracers) {
    ctx.save();
    ctx.globalAlpha = clamp(r.t / r.life, 0, 1) * 0.9;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(1.2, TS * 0.045);
    ctx.setLineDash([TS * 0.16, TS * 0.12]);
    ctx.beginPath();
    ctx.moveTo(px(r.ax), px(r.ay));
    ctx.lineTo(px(r.bx), px(r.by));
    ctx.stroke();
    ctx.restore();
  }
}

function drawZaps() {
  for (const z of S.zaps) {
    const a = z.t / z.life;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = z.color;
    ctx.shadowColor = z.color;
    ctx.shadowBlur = TS * 0.5;
    ctx.lineWidth = Math.max(1.5, TS * 0.08);
    for (const s of z.seg) {
      ctx.beginPath();
      ctx.moveTo(px(s.ax), px(s.ay));
      const steps = 4;
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const jx = (Math.random() - 0.5) * TS * 0.35;
        const jy = (Math.random() - 0.5) * TS * 0.35;
        ctx.lineTo(px(s.ax + (s.bx - s.ax) * f) + jx, px(s.ay + (s.by - s.ay) * f) + jy);
      }
      ctx.lineTo(px(s.bx), px(s.by));
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawRings() {
  for (const r of S.rings) {
    const f = 1 - r.t / r.life;
    ctx.save();
    ctx.globalAlpha = (1 - f) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(1.5, TS * 0.06);
    ctx.beginPath();
    ctx.arc(px(r.x), px(r.y), px(r.r + (r.max - r.r) * f), 0, 6.283);
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of S.parts) {
    ctx.globalAlpha = clamp(p.t / p.life, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(px(p.x), px(p.y), px(p.r), 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPaused(w, h) {
  ctx.fillStyle = 'rgba(6,9,14,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8eef7';
  ctx.font = '700 ' + Math.round(TS * 0.7) + 'px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PAUSED', w / 2, h / 2);
  ctx.textAlign = 'left';
}

/* ============================================================
   10. Interface
   ============================================================ */

const $ = (id) => document.getElementById(id);
const el = {
  terrainName: $('terrainName'), roundLabel: $('roundLabel'), budget: $('budget'),
  integrityFill: $('integrityFill'), integrityNum: $('integrityNum'),
  enemyCredits: $('enemyCredits'),
  shop: $('shop'), status: $('status'), statusTag: $('statusTag'), statusText: $('statusText'),
  inspect: $('inspect'), inspectName: $('inspectName'), inspectStats: $('inspectStats'),
  inspectIcon: $('inspectIcon'), upgradeBtn: $('upgradeBtn'), sellBtn: $('sellBtn'),
  waveBtn: $('waveBtn'),
  speedBtn: $('speedBtn'), pauseBtn: $('pauseBtn'), toast: $('toast'),
};

let toastTimer = null;
function flash(msg, bad = true) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  el.toast.style.borderColor = bad ? 'rgba(255,95,109,0.5)' : 'rgba(87,224,141,0.5)';
  el.toast.style.color = bad ? '#ffd9dc' : '#d6ffe6';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1900);
}

function iconCanvas(def, size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  drawTowerArt(g, def, 1, size / 2, size / 2, size * 0.36, -Math.PI / 2, 1, 0);
  return c;
}

function buildShop() {
  el.shop.innerHTML = '';
  for (const def of TOWERS) {
    const b = document.createElement('button');
    b.className = 'card';
    b.dataset.id = def.id;
    b.appendChild(iconCanvas(def));
    const n = document.createElement('span');
    n.className = 'card-name';
    n.textContent = def.short;
    const c = document.createElement('span');
    c.className = 'card-cost';
    c.textContent = def.cost;
    b.append(n, c);
    b.addEventListener('click', () => {
      S.towerSel = null;
      S.shopSel = S.shopSel === def ? null : def;
      syncUI();
    });
    el.shop.appendChild(b);
  }
}

function describe(def) {
  const targets = def.targets === 'both' ? 'ground + air'
    : def.targets === 'air' ? 'air only' : 'ground only';
  return '<b>' + def.name + '</b> — ' + def.placeNote +
    ' DMG ' + def.damage + ' · RNG ' + def.range.toFixed(1) + ' · ' + targets;
}

function syncUI() {
  el.budget.textContent = S.money;
  el.enemyCredits.textContent = S.waveSpend || 0;
  el.terrainName.textContent = S.terrain.name;
  el.roundLabel.textContent = 'R' + (S.roundIndex + 1) + '/' + S.level.rounds +
    ' · W' + Math.min(S.waveIndex + 1, WAVES_PER_ROUND) + '/' + WAVES_PER_ROUND +
    ' · ' + S.level.name;

  const f = clamp(S.integrity / S.maxIntegrity, 0, 1);
  el.integrityFill.style.width = (f * 100) + '%';
  el.integrityFill.className = f > 0.5 ? '' : f > 0.25 ? 'warn' : 'crit';
  el.integrityNum.textContent = S.integrity;

  for (const card of el.shop.children) {
    const def = TOWERS.find((t) => t.id === card.dataset.id);
    card.classList.toggle('sel', S.shopSel === def);
    card.classList.toggle('broke', S.money < def.cost);
  }

  /* one strip carries either the siting rule for the weapon being placed,
     or what enemy command has concluded about your line */
  if (S.shopSel) {
    el.statusTag.textContent = 'SITE';
    el.status.classList.add('site');
    el.status.classList.remove('alert');
    el.statusText.innerHTML = describe(S.shopSel);
  } else {
    el.statusTag.textContent = 'INTEL';
    el.status.classList.remove('site');
    el.status.classList.toggle('alert', !!S.intelAlert);
    el.statusText.textContent = S.waveRunning
      ? S.intel
      : S.intel + (S.nextWave
        ? ' · Reserve ' + S.enemyCredits + ' · Inbound: ' + waveSummary()
        : '');
  }

  const showInspect = !!S.towerSel;
  el.inspect.hidden = !showInspect;
  el.status.hidden = showInspect;
  if (showInspect) renderInspect();

  el.waveBtn.classList.toggle('running', S.waveRunning);
  el.waveBtn.textContent = S.waveRunning
    ? 'Wave ' + (S.waveIndex + 1) + ' in progress…'
    : 'Start Wave ' + (S.waveIndex + 1);
  el.waveBtn.disabled = S.waveRunning;

  el.speedBtn.textContent = S.speed + '×';
  el.pauseBtn.textContent = S.paused ? '▶' : '❚❚';
}

function renderInspect() {
  const t = S.towerSel;
  const st = statsOf(t);
  el.inspectName.textContent = t.def.name + ' · Mk ' + t.level;
  el.inspectStats.textContent =
    'DPS ' + st.dps.toFixed(0) + ' · DMG ' + st.damage.toFixed(0) +
    ' · RNG ' + st.range.toFixed(1) + ' · ' + DMG[t.def.dmgType].label;
  const g = el.inspectIcon.getContext('2d');
  g.clearRect(0, 0, 96, 96);
  drawTowerArt(g, t.def, t.level, 48, 48, 34, -Math.PI / 2, S.t * 2, 0);

  if (t.level >= MAX_TOWER_LEVEL) {
    el.upgradeBtn.textContent = 'Fully upgraded';
    el.upgradeBtn.disabled = true;
  } else {
    const c = upgradeCost(t);
    el.upgradeBtn.textContent = 'Upgrade · ' + c;
    el.upgradeBtn.disabled = S.money < c;
  }
  el.sellBtn.textContent = 'Sell · +' + sellValue(t);
}

/* ============================================================
   11. Input
   ============================================================ */

function pointerTile(ev) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * GRID_W);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * GRID_H);
  return inBounds(x, y) ? { x, y } : null;
}

cv.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  if (S.screen !== 'play') return;
  const t = pointerTile(ev);
  if (!t) return;
  S.hover = t;

  const existing = towerAt(t.x, t.y);
  if (existing) {
    S.shopSel = null;
    S.towerSel = S.towerSel === existing ? null : existing;
    syncUI();
    return;
  }
  if (S.shopSel) {
    const def = S.shopSel;
    const res = placement(def, t.x, t.y);
    if (!res.ok) { flash(res.why); return; }
    if (S.money < def.cost) { flash('Not enough credits — need ' + def.cost + '.'); return; }
    S.money -= def.cost;
    const built = {
      def, gx: t.x, gy: t.y,
      x: t.x + 0.5, y: t.y + 0.5,
      level: 1, cool: 0, a: -Math.PI / 2, spin: 0, recoil: 0,
      spent: def.cost, hp: 0, maxHp: 0, hurt: 0,
    };
    built.maxHp = statsOf(built).maxHp;
    built.hp = built.maxHp;
    S.towers.push(built);
    S.rings.push({ x: t.x + 0.5, y: t.y + 0.5, r: 0.2, max: 1.1, life: 0.3, t: 0.3, color: '#7ce7ff' });
    if (S.money < def.cost) S.shopSel = null;
    syncUI();
    return;
  }
  S.towerSel = null;
  syncUI();
}, { passive: false });

cv.addEventListener('pointermove', (ev) => {
  if (S.screen !== 'play' || !S.shopSel) return;
  S.hover = pointerTile(ev);
});
cv.addEventListener('pointerleave', () => { S.hover = null; });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

el.upgradeBtn.addEventListener('click', () => {
  const t = S.towerSel;
  if (!t || t.level >= MAX_TOWER_LEVEL) return;
  const c = upgradeCost(t);
  if (S.money < c) { flash('Not enough credits — need ' + c + '.'); return; }
  S.money -= c;
  t.spent += c;
  t.level++;
  t.maxHp = statsOf(t).maxHp;
  t.hp = t.maxHp;
  S.rings.push({ x: t.x, y: t.y, r: 0.2, max: 1.2, life: 0.35, t: 0.35, color: '#ffc861' });
  syncUI();
});

el.sellBtn.addEventListener('click', () => {
  const t = S.towerSel;
  if (!t) return;
  S.money += sellValue(t);
  S.towers = S.towers.filter((x) => x !== t);
  burst(t.x, t.y, '#9fb2c9', 10, 0.9);
  S.towerSel = null;
  syncUI();
});

$('inspectClose').addEventListener('click', () => { S.towerSel = null; syncUI(); });
el.waveBtn.addEventListener('click', startWave);
el.speedBtn.addEventListener('click', () => {
  S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 3 : 1;
  syncUI();
});
el.pauseBtn.addEventListener('click', () => { S.paused = !S.paused; syncUI(); });

/* ============================================================
   12. Campaign flow
   ============================================================ */

function show(id) {
  for (const s of ['screenMenu', 'screenBrief', 'screenRound', 'screenEnd']) {
    $(s).hidden = s !== id;
  }
}

let pickedLevel = LEVELS[1];
function buildMenu() {
  const list = $('levelList');
  list.innerHTML = '';
  for (const L of LEVELS) {
    const b = document.createElement('button');
    b.className = 'level' + (L === pickedLevel ? ' sel' : '');
    b.innerHTML = '<i>' + L.tag + '</i><b>' + L.name + '</b><p>' + L.note + '</p>';
    b.addEventListener('click', () => { pickedLevel = L; buildMenu(); });
    list.appendChild(b);
  }
}

function newCampaign(L) {
  S.level = L;
  S.roundIndex = 0;
  S.money = L.budget;
  S.enemyCredits = L.budget;      /* they open with exactly what you do */
  S.plunder = 0;
  S.towersLost = 0;
  S.integrity = L.integrity;
  S.maxIntegrity = L.integrity;
  S.kills = 0;
  S.wavesCleared = 0;
  S.dmgRecent = { kinetic: 0, explosive: 0, energy: 0, frost: 0 };
  S.speed = 1;
  S.paused = false;
  startRound();
}

function startRound() {
  S.terrain = TERRAINS[S.roundIndex % TERRAINS.length];
  S.waveIndex = 0;
  S.towers = [];
  S.enemies = [];
  S.shots = [];
  S.parts = [];
  S.zaps = [];
  S.rings = [];
  S.shopSel = null;
  S.towerSel = null;
  S.waveRunning = false;
  S.tracers = [];
  S.plunder = 0;
  S.intel = 'Enemy command is still probing your line.';
  S.intelAlert = false;
  generateMap((S.roundIndex + 1) * 7919 + S.level.id.length * 131 + Date.now() % 1000);
  resize();
  paintTerrain();
  fundEnemy();
  $('briefEnemy').textContent = S.enemyCredits;
  planWave();

  $('briefRound').textContent = 'Round ' + (S.roundIndex + 1) + ' of ' + S.level.rounds;
  $('briefName').textContent = S.terrain.name;
  $('briefText').textContent = S.terrain.brief;
  $('briefMod').textContent = S.terrain.modNote;
  $('briefBudget').textContent = S.money;
  $('briefIntegrity').textContent = S.integrity;
  $('briefWaves').textContent = WAVES_PER_ROUND;
  S.screen = 'brief';
  show('screenBrief');
  syncUI();
}

function finishRound(waveBonus) {
  const salvage = Math.round(S.towers.reduce((a, t) => a + t.spent, 0) * 0.5);
  const bonus = Math.round(140 + S.roundIndex * 70) + salvage;
  const repair = Math.min(4, S.maxIntegrity - S.integrity);
  S.money += bonus;
  S.integrity += repair;
  S.roundIndex++;

  if (S.roundIndex >= S.level.rounds) { endGame(true); return; }

  $('roundTitle').textContent = S.terrain.name + ' held';
  $('roundText').textContent =
    'Emplacements recovered for ' + salvage + ' credits in salvage. ' +
    'Next sector: ' + TERRAINS[S.roundIndex % TERRAINS.length].name + '.';
  $('roundBonus').textContent = '+' + (bonus + waveBonus);
  $('roundRepair').textContent = '+' + repair;
  $('roundKills').textContent = S.kills;
  S.screen = 'round';
  show('screenRound');
  syncUI();
}

function endGame(won) {
  S.screen = 'end';
  S.waveRunning = false;
  $('endTitle').textContent = won ? 'Campaign won' : 'Core lost';
  $('endText').textContent = won
    ? 'Every sector held on ' + S.level.name + '. The enemy never found the seam.'
    : 'The line broke on ' + S.terrain.name + '. Enemy command adapted faster than the defence.';
  $('endRounds').textContent = won ? S.level.rounds : S.roundIndex + 1;
  $('endWaves').textContent = S.wavesCleared;
  $('endKills').textContent = S.kills;
  show('screenEnd');
}

$('startBtn').addEventListener('click', () => { show(null); newCampaign(pickedLevel); });
$('briefBtn').addEventListener('click', () => { show(null); S.screen = 'play'; syncUI(); });
$('roundBtn').addEventListener('click', () => { show(null); startRound(); });
$('endBtn').addEventListener('click', () => { buildMenu(); show('screenMenu'); S.screen = 'menu'; });

/* ============================================================
   13. Main loop
   ============================================================ */

function step(dt) {
  S.t += dt;
  updateWave(dt);
  updateTowers(dt);
  updateEnemies(dt);
  updateShots(dt);
  updateParticles(dt);
}

let last = performance.now();
let uiTick = 0;
function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.screen === 'play' && !S.paused) {
    let acc = raw * S.speed;
    while (acc > 0) {
      const s = Math.min(acc, 1 / 60);
      step(s);
      acc -= s;
    }
  } else {
    S.t += raw;
  }
  shakeAmt = Math.max(0, shakeAmt - raw * 3);
  draw();
  uiTick += raw;
  if (uiTick > 0.15) {
    uiTick = 0;
    if (S.screen === 'play') syncUI();
  }
  requestAnimationFrame(frame);
}

/* boot */
S.terrain = TERRAINS[0];
S.maxIntegrity = S.level.integrity;
buildShop();
buildMenu();
resize();
requestAnimationFrame(frame);
