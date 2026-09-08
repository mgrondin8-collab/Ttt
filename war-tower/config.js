/* War Tower — static game data.
   Everything here is pure data plus a seeded RNG; no DOM, no state. */
'use strict';

const GRID_W = 9;
const GRID_H = 15;
const WAVES_PER_ROUND = 8;

/* ---------- seeded rng ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (lo, hi) => lo + r() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + r() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
  };
}

/* ---------- damage types ---------- */
const DMG = {
  kinetic: { label: 'Kinetic', color: '#ffd479' },
  explosive: { label: 'Explosive', color: '#ff9152' },
  energy: { label: 'Energy', color: '#7ce7ff' },
  frost: { label: 'Cryo', color: '#a9d8ff' },
};

/* ---------- terrain ---------- */
/* Each battlefield paints differently and bends the rules a little. */
const TERRAINS = [
  {
    id: 'verdant',
    name: 'Verdant Basin',
    brief: 'Open grassland. Nothing here fights you but the enemy.',
    sky: '#101a14',
    ground: ['#2c4a2e', '#325432', '#294427', '#375b36'],
    accent: '#4e7a45',
    road: '#6b5a3c',
    roadEdge: '#3a3120',
    liquid: ['#1d4b57', '#2a6a75'],
    liquidRim: '#132b31',
    rock: ['#5c6455', '#454c40'],
    decor: 'grass',
    liquidName: 'pond',
    density: { rock: 0.06, liquid: 0.05, decor: 0.22 },
    mods: { enemySpeed: 1, towerRange: 1, towerCooldown: 1 },
    modNote: 'No environmental modifiers.',
  },
  {
    id: 'dunes',
    name: 'Ashfall Dunes',
    brief: 'Heat shimmer off the sand degrades every optic on the field.',
    sky: '#1d160f',
    ground: ['#8a6f42', '#96794a', '#7e6539', '#9c8154'],
    accent: '#b79a63',
    road: '#5f4b2a',
    roadEdge: '#3f3119',
    liquid: ['#5d5a3a', '#6f6b45'],
    liquidRim: '#3f3d25',
    rock: ['#7b6a4e', '#5e5138'],
    decor: 'dune',
    liquidName: 'saltpan',
    density: { rock: 0.08, liquid: 0.03, decor: 0.26 },
    mods: { enemySpeed: 1.05, towerRange: 0.9, towerCooldown: 1 },
    modNote: 'Heat haze: tower range −10%. Firm sand: enemies +5% speed.',
  },
  {
    id: 'glacier',
    name: 'Glacier Shelf',
    brief: 'Packed ice. The advance is slow, but so is anything you build on it.',
    sky: '#0e1620',
    ground: ['#d7e4f0', '#e8f2fa', '#c8dbea', '#f2f8fc'],
    accent: '#7fa3bf',
    road: '#75899c',
    roadEdge: '#4a5a6b',
    liquid: ['#6a9cbd', '#8dbcd8'],
    liquidRim: '#93aec4',
    rock: ['#9fb2c2', '#7d8f9e'],
    decor: 'ice',
    liquidName: 'meltwater',
    density: { rock: 0.07, liquid: 0.07, decor: 0.18 },
    mods: { enemySpeed: 0.86, towerRange: 1, towerCooldown: 1.1 },
    modNote: 'Deep cold: enemies −14% speed, towers reload 10% slower.',
  },
  {
    id: 'cinder',
    name: 'Cinder Rift',
    brief: 'Live magma channels. Updrafts push the enemy forward and cool your barrels.',
    sky: '#170d0c',
    ground: ['#3a2f2c', '#453734', '#312826', '#4d3d39'],
    accent: '#6b4b3f',
    road: '#59403a',
    roadEdge: '#301f1c',
    liquid: ['#8f2f14', '#df6a24'],
    liquidRim: '#2c1610',
    rock: ['#5a4a44', '#3f3230'],
    decor: 'ember',
    liquidName: 'lava',
    density: { rock: 0.09, liquid: 0.08, decor: 0.2 },
    mods: { enemySpeed: 1.12, towerRange: 1, towerCooldown: 0.9 },
    modNote: 'Thermals: enemies +12% speed, towers reload 10% faster.',
  },
  {
    id: 'mire',
    name: 'Mirewood',
    brief: 'Standing water and rot. Everything bogs down, sightlines close in.',
    sky: '#0d1512',
    ground: ['#26372f', '#2d4036', '#1f2f28', '#334a3d'],
    accent: '#456b52',
    road: '#4a4634',
    roadEdge: '#282619',
    liquid: ['#1c3b39', '#2b5651'],
    liquidRim: '#101f1e',
    rock: ['#4c534a', '#383e37'],
    decor: 'reed',
    liquidName: 'bog',
    density: { rock: 0.05, liquid: 0.13, decor: 0.28 },
    mods: { enemySpeed: 0.84, towerRange: 0.92, towerCooldown: 1 },
    modNote: 'Mud and mist: enemies −16% speed, tower range −8%.',
  },
  {
    id: 'sector7',
    name: 'Sector Seven',
    brief: 'A dead city. Long clean firing lanes, and paved roads the enemy loves.',
    sky: '#12151a',
    ground: ['#3e4349', '#474d54', '#363b41', '#4f555c'],
    accent: '#646c75',
    road: '#33363b',
    roadEdge: '#1d1f23',
    liquid: ['#243038', '#2f3f49'],
    liquidRim: '#161c21',
    rock: ['#6a7079', '#4d525a'],
    decor: 'rubble',
    liquidName: 'flooded pit',
    density: { rock: 0.11, liquid: 0.04, decor: 0.24 },
    mods: { enemySpeed: 1.06, towerRange: 1.08, towerCooldown: 1 },
    modNote: 'Clear lanes: tower range +8%. Paved roads: enemies +6% speed.',
  },
];

/* ---------- towers ---------- */
/* `place` is the capability rule: where this weapon can physically be sited. */
const TOWERS = [
  {
    id: 'gatling',
    name: 'Gatling Nest',
    role: 'Sustained anti-everything',
    cost: 90,
    damage: 7,
    cooldown: 0.13,
    range: 2.6,
    dmgType: 'kinetic',
    targets: 'both',
    fire: 'bullet',
    place: 'any',
    short: 'Gatling',
    placeNote: 'Sites on any clear ground.',
    blurb: 'Cheap, relentless, and useless against heavy plate.',
    color: '#ffd479',
  },
  {
    id: 'cannon',
    name: 'Siege Cannon',
    role: 'Ground splash',
    cost: 150,
    damage: 40,
    cooldown: 1.15,
    range: 3.0,
    dmgType: 'explosive',
    targets: 'ground',
    fire: 'shell',
    splash: 0.95,
    place: 'any',
    short: 'Cannon',
    placeNote: 'Sites on any clear ground.',
    blurb: 'Breaks up columns. Cannot elevate on aircraft.',
    color: '#ff9152',
  },
  {
    id: 'frost',
    name: 'Cryo Coil',
    role: 'Area slow',
    cost: 120,
    damage: 6,
    cooldown: 0.85,
    range: 2.2,
    dmgType: 'frost',
    targets: 'both',
    fire: 'pulse',
    slow: 0.45,
    slowTime: 1.7,
    place: 'nearPath',
    short: 'Cryo',
    placeNote: 'Must sit within one tile of the road.',
    blurb: 'Pulses a chilling field. Holds the line for everything else.',
    color: '#a9d8ff',
  },
  {
    id: 'tesla',
    name: 'Tesla Pylon',
    role: 'Chained energy',
    cost: 200,
    damage: 24,
    cooldown: 0.9,
    range: 2.8,
    dmgType: 'energy',
    targets: 'both',
    fire: 'chain',
    chain: 3,
    chainFalloff: 0.62,
    chainRange: 2.1,
    place: 'nearRock',
    short: 'Tesla',
    placeNote: 'Must be built beside a rock outcrop.',
    blurb: 'Arcs between targets. Punishes tight formations.',
    color: '#7ce7ff',
  },
  {
    id: 'mortar',
    name: 'Mortar Pit',
    role: 'Long-range barrage',
    cost: 230,
    damage: 62,
    cooldown: 2.4,
    range: 6.2,
    minRange: 2.2,
    dmgType: 'explosive',
    targets: 'ground',
    fire: 'arc',
    splash: 1.45,
    place: 'farPath',
    short: 'Mortar',
    placeNote: 'Must sit two or more tiles off the road.',
    blurb: 'Enormous reach and blast, blind to anything close.',
    color: '#ffb14d',
  },
  {
    id: 'sam',
    name: 'SAM Battery',
    role: 'Dedicated anti-air',
    cost: 170,
    damage: 74,
    cooldown: 1.5,
    range: 5.0,
    dmgType: 'explosive',
    targets: 'air',
    fire: 'missile',
    place: 'any',
    short: 'SAM',
    placeNote: 'Sites on any clear ground.',
    blurb: 'Homing missiles. Will not fire on anything with wheels.',
    color: '#ff7b9c',
  },
];

/* indexed by the level being bought into: UPGRADES[2] takes a tower to Mk 2 */
const UPGRADES = [
  null,
  null,
  { costMul: 0.85, damage: 1.55, range: 1.1, cooldown: 0.88 },
  { costMul: 1.4, damage: 1.7, range: 1.12, cooldown: 0.85 },
];
const MAX_TOWER_LEVEL = 3;
const SELL_REFUND = 0.6;

/* ---------- enemies ---------- */
const ENEMIES = {
  scout: {
    id: 'scout', name: 'Scout Bike', hp: 36, speed: 2.45, armor: 0,
    resist: { explosive: 0.35 }, bounty: 9, leak: 1, radius: 0.2, points: 6,
    unlock: 0, color: '#e2734c', counters: 'explosive',
  },
  trooper: {
    id: 'trooper', name: 'Trooper Mech', hp: 78, speed: 1.35, armor: 3,
    resist: {}, bounty: 12, leak: 1, radius: 0.26, points: 9,
    unlock: 0, color: '#b9744f', counters: null,
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark Tank', hp: 165, speed: 0.98, armor: 11,
    resist: { kinetic: 0.45 }, bounty: 22, leak: 2, radius: 0.31, points: 17,
    unlock: 2, color: '#8a8f6f', counters: 'kinetic',
  },
  warhound: {
    id: 'warhound', name: 'Warhound', hp: 105, speed: 1.75, armor: 2,
    resist: { frost: 1 }, slowImmune: true, bounty: 19, leak: 1, radius: 0.25, points: 14,
    unlock: 3, color: '#d05a5a', counters: 'frost',
  },
  aegis: {
    id: 'aegis', name: 'Aegis Walker', hp: 140, speed: 1.15, armor: 4,
    resist: { energy: 0.65 }, bounty: 21, leak: 2, radius: 0.29, points: 16,
    unlock: 3, color: '#6f86c4', counters: 'energy',
  },
  wasp: {
    id: 'wasp', name: 'Wasp Drone', hp: 66, speed: 2.05, armor: 0,
    resist: {}, air: true, bounty: 16, leak: 1, radius: 0.24, points: 12,
    unlock: 2, color: '#c9a2e8', counters: 'noAir',
  },
  titan: {
    id: 'titan', name: 'Siege Titan', hp: 1500, speed: 0.72, armor: 16,
    resist: { kinetic: 0.3, explosive: 0.2 }, bounty: 180, leak: 5, radius: 0.46,
    points: 0, unlock: 99, boss: true, color: '#9d5b3a', counters: null,
  },
};

/* ---------- difficulty ---------- */
const LEVELS = [
  {
    id: 'recruit', name: 'Recruit', tag: 'Learn the ground',
    budget: 780, integrity: 25, hpMul: 0.85, speedMul: 0.95, threatMul: 0.8,
    bountyMul: 1.15, adapt: 0.18, rounds: 6,
    note: 'Generous budget. The enemy barely reads your defence.',
  },
  {
    id: 'veteran', name: 'Veteran', tag: 'A fair fight',
    budget: 620, integrity: 20, hpMul: 1, speedMul: 1, threatMul: 1,
    bountyMul: 1, adapt: 0.45, rounds: 6,
    note: 'Standard war. Enemy command studies your damage profile.',
  },
  {
    id: 'elite', name: 'Elite', tag: 'They are watching',
    budget: 580, integrity: 16, hpMul: 1.2, speedMul: 1.08, threatMul: 1.15,
    bountyMul: 0.92, adapt: 0.75, rounds: 6,
    note: 'Waves are rebuilt each round to beat whatever you leaned on.',
  },
  {
    id: 'nightmare', name: 'Nightmare', tag: 'Counter-doctrine',
    budget: 520, integrity: 14, hpMul: 1.4, speedMul: 1.16, threatMul: 1.35,
    bountyMul: 0.85, adapt: 1, rounds: 6,
    note: 'Every weakness is exploited within a single wave.',
  },
];
