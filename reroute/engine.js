/* Reroute — the economic core. No DOM in this file, on purpose: it runs in the
   browser and under node, so the balance can be simulated instead of guessed.
   See tools/simulate.js. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Reroute = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------- the map */

  // cost   — what one unit costs to make here, in $M
  // price  — what one unit sells for here, before elasticity
  // absorb — units this market takes each quarter at full price
  // build  — price of one production line here
  const COUNTRIES = [
    { id: 'us', name: 'United States', tag: 'USA', x: 64,  y: 62,  cost: 34, price: 42, absorb: 10, build: 300 },
    { id: 'mx', name: 'Mexico',        tag: 'MEX', x: 60,  y: 100, cost: 24, price: 23, absorb: 3,  build: 190 },
    { id: 'br', name: 'Brazil',        tag: 'BRA', x: 96,  y: 142, cost: 22, price: 24, absorb: 4,  build: 140 },
    { id: 'eu', name: 'Europe',        tag: 'EU',  x: 156, y: 50,  cost: 31, price: 37, absorb: 8,  build: 260 },
    { id: 'in', name: 'India',         tag: 'IND', x: 214, y: 98,  cost: 19, price: 25, absorb: 5,  build: 145 },
    { id: 'cn', name: 'China',         tag: 'CHN', x: 252, y: 62,  cost: 20, price: 30, absorb: 7,  build: 150 },
    { id: 'vn', name: 'Vietnam',       tag: 'VNM', x: 246, y: 106, cost: 18, price: 20, absorb: 2,  build: 130 },
  ];

  const BY_ID = {};
  for (const c of COUNTRIES) BY_ID[c.id] = c;

  // Tariff a destination charges on goods from an origin, before anything the
  // President does to it. Roughly the pre-2025 picture, rounded off.
  const BASE_TARIFF = {
    us: { cn: 0.20, vn: 0.05, in: 0.05, mx: 0.00, br: 0.05, eu: 0.03 },
    eu: { cn: 0.08, vn: 0.04, in: 0.04, mx: 0.03, br: 0.04, us: 0.03 },
    cn: { us: 0.10, eu: 0.06, vn: 0.03, in: 0.07, mx: 0.06, br: 0.05 },
    in: { us: 0.12, cn: 0.12, eu: 0.08, vn: 0.06, mx: 0.08, br: 0.08 },
    br: { us: 0.10, cn: 0.10, eu: 0.08, vn: 0.08, in: 0.08, mx: 0.06 },
    mx: { us: 0.00, cn: 0.12, eu: 0.05, vn: 0.08, in: 0.08, br: 0.05 },
    vn: { us: 0.06, cn: 0.05, eu: 0.05, in: 0.05, mx: 0.08, br: 0.08 },
  };

  const FREIGHT = {};
  for (const a of COUNTRIES) {
    FREIGHT[a.id] = {};
    for (const b of COUNTRIES) {
      if (a.id === b.id) {
        FREIGHT[a.id][b.id] = 1;                       // domestic distribution
      } else {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        FREIGHT[a.id][b.id] = Math.round((1 + d / 28) * 10) / 10;
      }
    }
  }

  const LINE_UNITS = 4;       // units per quarter from one production line
  const OPEX_BASE = 14;       // head office, every quarter
  const OPEX_LINE = 9;        // per production line
  const SPILL = 0.6;          // price paid for units past a market's appetite
  const MAX_TARIFF = 1.5;
  const GOAL = 1000;          // net worth that counts as winning
  const TURNS = 16;

  /* ------------------------------------------------------- random numbers */

  function nextRandom(state) {
    // mulberry32 — seeded so a game can be replayed and simulated
    state.rng = (state.rng + 0x6d2b79f5) >>> 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function pick(state, list) {
    return list[Math.floor(nextRandom(state) * list.length)];
  }

  /* ---------------------------------------------------------- game state */

  function createGame(seed) {
    const state = {
      rng: (seed === undefined ? Math.floor(Math.random() * 1e9) : seed) >>> 0,
      seed: seed,
      turn: 1,
      turns: TURNS,
      goal: GOAL,
      cash: 120,
      lines: { cn: 1 },       // country -> production lines owned
      cleared: {},            // destination -> units already through customs
      favor: 10,              // how warmly the Oval Desk regards you
      effects: [],            // everything the world is currently doing to you
      alloc: {},              // laneId -> units booked this quarter
      lastFlows: {},          // origin -> units sent into the US last quarter
      duties: [],             // duty paid, per quarter
      headline: null,
      log: [],
      quarters: [],
      status: 'playing',      // 'playing' | 'won' | 'survived' | 'bust'
    };
    state.headline = {
      tag: 'Quarter 1',
      title: 'You inherit one plant in Shenzhen and $120M.',
      body: 'Four years of this. Book your shipments, then see what the Desk does about them.',
      tone: 'calm',
    };
    return state;
  }

  /* ------------------------------------------------- effects and pricing */

  function activeEffects(state, kind) {
    return state.effects.filter((e) => e.kind === kind);
  }

  function tariffScale(state) {
    if (activeEffects(state, 'void').length) return 0;      // courts struck them down
    if (activeEffects(state, 'pause').length) return 0.5;    // the famous 90 days
    return 1;
  }

  function tariffRate(state, origin, dest) {
    if (origin === dest) return 0;
    for (const e of activeEffects(state, 'exempt')) {
      if (e.dest === dest && (e.origin === origin || e.origin === '*')) return 0;
    }
    const base = (BASE_TARIFF[dest] && BASE_TARIFF[dest][origin]) || 0.05;
    let delta = 0;
    for (const e of activeEffects(state, 'tariff')) {
      if (e.dest !== dest) continue;
      if (e.origin === '*' || e.origin === origin) delta += e.delta;
    }
    const rate = base + delta * tariffScale(state);
    return Math.max(0, Math.min(MAX_TARIFF, Math.round(rate * 1000) / 1000));
  }

  function baseRate(origin, dest) {
    if (origin === dest) return 0;
    return (BASE_TARIFF[dest] && BASE_TARIFF[dest][origin]) || 0.05;
  }

  function multiplier(state, kind, id) {
    let m = 1;
    for (const e of activeEffects(state, kind)) {
      if (e.who === '*' || e.who === id) m *= e.mul;
    }
    return m;
  }

  function priceOf(state, dest) {
    return Math.round(BY_ID[dest].price * multiplier(state, 'price', dest) * 10) / 10;
  }

  function costOf(state, origin) {
    return Math.round(BY_ID[origin].cost * multiplier(state, 'cost', origin) * 10) / 10;
  }

  function freightOf(state, origin, dest) {
    return Math.round(FREIGHT[origin][dest] * multiplier(state, 'freight', '*') * 10) / 10;
  }

  /* ----------------------------------------------------------- capacity */

  function capacity(state) {
    let total = 0;
    for (const id in state.lines) total += state.lines[id] * LINE_UNITS;
    return total;
  }

  function booked(state) {
    let total = 0;
    for (const id in state.alloc) total += state.alloc[id];
    return total;
  }

  function bookedFrom(state, origin) {
    let total = 0;
    for (const id in state.alloc) {
      if (id.split('-')[0] === origin) total += state.alloc[id];
    }
    return total;
  }

  function bookedTo(state, dest) {
    let total = 0;
    for (const id in state.alloc) {
      if (id.split('-')[1] === dest) total += state.alloc[id];
    }
    return total;
  }

  /* -------------------------------------------------------------- lanes */

  // Every route you could book this quarter, with the money worked out.
  function lanes(state) {
    const out = [];
    for (const origin of Object.keys(state.lines)) {
      if (!state.lines[origin]) continue;
      for (const dest of COUNTRIES.map((c) => c.id)) {
        const rate = tariffRate(state, origin, dest);
        const cost = costOf(state, origin);
        const freight = freightOf(state, origin, dest);
        const duty = Math.round((cost + freight) * rate * 100) / 100;
        const price = priceOf(state, dest);
        out.push({
          id: origin + '-' + dest,
          origin,
          dest,
          rate,
          baseRate: baseRate(origin, dest),
          cost,
          freight,
          duty,
          price,
          margin: Math.round((price - cost - freight - duty) * 100) / 100,
          units: state.alloc[origin + '-' + dest] || 0,
          roomAtOrigin: state.lines[origin] * LINE_UNITS - bookedFrom(state, origin),
          appetiteLeft: BY_ID[dest].absorb - bookedTo(state, dest),
        });
      }
    }
    out.sort((a, b) => b.margin - a.margin);
    return out;
  }

  function book(state, laneId, units) {
    const [origin, dest] = laneId.split('-');
    if (!state.lines[origin]) return false;
    const n = Math.max(0, Math.round(units));
    const others = bookedFrom(state, origin) - (state.alloc[laneId] || 0);
    const roomHere = state.lines[origin] * LINE_UNITS - others;
    state.alloc[laneId] = Math.min(n, roomHere);
    if (!state.alloc[laneId]) delete state.alloc[laneId];
    return true;
  }

  function clearAlloc(state) {
    state.alloc = {};
  }

  /* ---------------------------------------------------- spending actions */

  function buildCost(state, id) {
    // Second and later lines in the same country come a little cheaper.
    const owned = state.lines[id] || 0;
    return Math.round(BY_ID[id].build * (1 + owned * 0.25));
  }

  function build(state, id) {
    const price = buildCost(state, id);
    if (state.cash < price) return { ok: false, why: 'Not enough cash.' };
    state.cash -= price;
    state.lines[id] = (state.lines[id] || 0) + 1;
    state.log.push({ turn: state.turn, text: 'Opened a line in ' + BY_ID[id].name + ' for $' + price + 'M.' });
    return { ok: true, spent: price };
  }

  function lobbyCost(state) {
    return Math.max(20, Math.round(60 - state.favor * 0.35));
  }

  // Buy a carve-out: one lane, no duty, three quarters.
  function lobby(state, origin, dest) {
    const price = lobbyCost(state);
    if (state.cash < price) return { ok: false, why: 'Not enough cash.' };
    if (origin === dest) return { ok: false, why: 'That lane pays no duty anyway.' };
    state.cash -= price;
    state.favor = Math.min(100, state.favor + 6);
    state.effects.push({
      kind: 'exempt', dest, origin, turns: 4,
      label: 'Exclusion: ' + BY_ID[origin].tag + ' → ' + BY_ID[dest].tag,
    });
    state.log.push({ turn: state.turn, text: 'Filed an exclusion request for ' + BY_ID[origin].tag + ' → ' + BY_ID[dest].tag + '. Granted.' });
    return { ok: true, spent: price };
  }

  // Front-run the next hike: pay today's duty on units that land later.
  function preclearCost(state, dest, units) {
    let worst = 0;
    for (const origin of Object.keys(state.lines)) {
      const rate = tariffRate(state, origin, dest);
      worst = Math.max(worst, (costOf(state, origin) + freightOf(state, origin, dest)) * rate);
    }
    return Math.round((worst + 2) * units);       // duty at today's rate, plus warehousing
  }

  function preclear(state, dest, units) {
    const price = preclearCost(state, dest, units);
    if (state.cash < price) return { ok: false, why: 'Not enough cash.' };
    state.cash -= price;
    state.cleared[dest] = (state.cleared[dest] || 0) + units;
    state.log.push({ turn: state.turn, text: 'Pre-cleared ' + units + ' units into ' + BY_ID[dest].tag + ' at today’s rate.' });
    return { ok: true, spent: price };
  }

  const DONATION = 30;

  function donate(state) {
    if (state.cash < DONATION) return { ok: false, why: 'Not enough cash.' };
    state.cash -= DONATION;
    state.favor = Math.min(100, state.favor + 26);
    state.log.push({ turn: state.turn, text: 'Wired $' + DONATION + 'M to the inaugural committee. Entirely legal.' });
    return { ok: true, spent: DONATION };
  }

  /* ---------------------------------------------------------- settlement */

  function settle(state) {
    const units = [];
    for (const id in state.alloc) {
      const [origin, dest] = id.split('-');
      const rate = tariffRate(state, origin, dest);
      const cost = costOf(state, origin);
      const freight = freightOf(state, origin, dest);
      for (let i = 0; i < state.alloc[id]; i++) {
        units.push({ origin, dest, cost, freight, duty: (cost + freight) * rate });
      }
    }

    // Pre-cleared units waive the heaviest duty first — the point of buying them.
    const byDest = {};
    for (const u of units) (byDest[u.dest] = byDest[u.dest] || []).push(u);
    for (const dest in byDest) {
      const waivers = state.cleared[dest] || 0;
      if (!waivers) continue;
      const sorted = byDest[dest].slice().sort((a, b) => b.duty - a.duty);
      const used = Math.min(waivers, sorted.length);
      for (let i = 0; i < used; i++) sorted[i].duty = 0;
      state.cleared[dest] = waivers - used;
      if (!state.cleared[dest]) delete state.cleared[dest];
    }

    let revenue = 0;
    const sold = {};
    for (const dest in byDest) {
      const n = byDest[dest].length;
      const absorb = BY_ID[dest].absorb;
      const paid = priceOf(state, dest) * (Math.min(n, absorb) + SPILL * Math.max(0, n - absorb));
      sold[dest] = { units: n, revenue: paid, spilled: Math.max(0, n - absorb) };
      revenue += paid;
    }

    let production = 0, freight = 0, duty = 0;
    const flows = {};
    for (const u of units) {
      production += u.cost;
      freight += u.freight;
      duty += u.duty;
      if (u.dest === 'us') flows[u.origin] = (flows[u.origin] || 0) + 1;
    }

    let lineCount = 0;
    for (const id in state.lines) lineCount += state.lines[id];
    const opex = OPEX_BASE + OPEX_LINE * lineCount;
    const profit = revenue - production - freight - duty - opex;

    const report = {
      turn: state.turn,
      units: units.length,
      revenue: round(revenue),
      production: round(production),
      freight: round(freight),
      duty: round(duty),
      opex: round(opex),
      profit: round(profit),
      sold,
    };

    state.cash = round(state.cash + profit);
    state.duties.push(round(duty));
    state.lastFlows = flows;
    state.quarters.push(report);
    clearAlloc(state);
    return report;
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  function netWorth(state) {
    let plant = 0;
    for (const id in state.lines) plant += state.lines[id] * BY_ID[id].build * 0.7;
    return round(state.cash + plant);
  }

  /* ------------------------------------------------------- the Oval Desk */

  // Every headline below is a caricature of a real move from the tariff era:
  // blanket rates announced at a podium, a pause a week later, exclusions for
  // whoever asked nicely. The President here is a stand-in, not a transcript.
  const EVENTS = [
    {
      id: 'blanket', weight: 10,
      run: function (state) {
        const pp = pick(state, [10, 10, 15, 20]);
        state.effects.push({ kind: 'tariff', dest: 'us', origin: '*', delta: pp / 100, turns: 99, label: 'Blanket tariff +' + pp + 'pp' });
        let friend = null;
        if (state.favor >= 65) {
          friend = biggestOrigin(state);
          state.effects.push({ kind: 'exempt', dest: 'us', origin: friend, turns: 3, label: 'Annex B: ' + BY_ID[friend].tag });
          state.favor = Math.max(0, state.favor - 20);
        }
        return {
          tag: 'Rose Garden', tone: friend ? 'good' : 'bad',
          title: 'A ' + pp + '-point tariff on everything, announced off a chart.',
          body: friend
            ? 'Every lane into the United States — except the ones in Annex B, where your ' + BY_ID[friend].name + ' plant appears.'
            : 'Every lane into the United States, every origin, effective immediately. The chart was laminated.',
        };
      },
    },
    {
      id: 'targeted', weight: 12,
      run: function (state) {
        let victim = 'cn', most = -1;
        for (const origin in state.lastFlows) {
          if (state.lastFlows[origin] > most) { most = state.lastFlows[origin]; victim = origin; }
        }
        if (most <= 0) victim = pick(state, ['cn', 'vn', 'in']);
        // Friends get a phone call before the announcement, and it lands on
        // somebody else's supply chain.
        let spared = false;
        if (state.favor >= 55 && most > 0) {
          const others = COUNTRIES.map(function (c) { return c.id; })
            .filter(function (id) { return id !== victim && id !== 'us'; });
          victim = pick(state, others);
          state.favor = Math.max(0, state.favor - 12);
          spared = true;
        }
        const pp = 20 + Math.floor(nextRandom(state) * 3) * 5;
        state.effects.push({ kind: 'tariff', dest: 'us', origin: victim, delta: pp / 100, turns: 4, label: BY_ID[victim].tag + ' +' + pp + 'pp' });
        return {
          tag: 'Truth of the day', tone: 'bad',
          title: BY_ID[victim].name + ' gets ' + pp + ' points, for four quarters.',
          body: spared
            ? 'You were on the list this morning. A call was made. You are not on it now.'
            : most > 0
              ? 'Someone showed him the import figures. Yours were on the page.'
              : 'No particular reason was given, and none was asked for.',
        };
      },
    },
    {
      id: 'neighbours', weight: 7,
      run: function (state) {
        state.effects.push({ kind: 'tariff', dest: 'us', origin: 'mx', delta: 0.25, turns: 4, label: 'MEX +25pp' });
        return {
          tag: 'Border', tone: 'bad',
          title: 'Twenty-five points on Mexico, over something unrelated to trade.',
          body: 'The free-trade agreement he signed himself is described as a disaster he inherited.',
        };
      },
    },
    {
      id: 'pause', weight: 11, needs: function (state) { return hasHikes(state); },
      run: function (state) {
        state.effects.push({ kind: 'pause', turns: 3, label: '90-day pause' });
        return {
          tag: 'Air Force One', tone: 'good',
          title: 'Ninety-day pause. Rates cut in half while it lasts.',
          body: 'The bond market moved first and the position changed second. Ship now.',
        };
      },
    },
    {
      id: 'deal', weight: 9,
      run: function (state) {
        const who = pick(state, ['vn', 'in', 'eu', 'br', 'mx']);
        state.effects.push({ kind: 'exempt', dest: 'us', origin: who, turns: 4, label: 'Deal: ' + BY_ID[who].tag });
        state.effects.push({ kind: 'price', who: who, mul: 1.15, turns: 5, label: BY_ID[who].tag + ' demand +15%' });
        return {
          tag: 'Signing ceremony', tone: 'good',
          title: 'A historic deal with ' + BY_ID[who].name + '. Duty-free for four quarters.',
          body: 'Nobody has read the annex. The number on the poster is bigger than the one in the text.',
        };
      },
    },
    {
      id: 'retaliation', weight: 9,
      run: function (state) {
        const who = pick(state, ['cn', 'eu', 'cn']);
        state.effects.push({ kind: 'tariff', dest: who, origin: 'us', delta: 0.25, turns: 5, label: BY_ID[who].tag + ' hits US goods' });
        return {
          tag: 'Beijing / Brussels', tone: 'bad',
          title: BY_ID[who].name + ' answers: 25 points on American-made goods.',
          body: 'Anything you export out of a US plant just got more expensive to land.',
        };
      },
    },
    {
      id: 's232', weight: 7,
      run: function (state) {
        state.effects.push({ kind: 'tariff', dest: 'us', origin: '*', delta: 0.15, turns: 6, label: 'Section 232 +15pp' });
        return {
          tag: 'National security', tone: 'bad',
          title: 'Steel, aluminium and anything with a bolt in it: +15 points.',
          body: 'Filed as a national security measure, which conveniently needs no vote.',
        };
      },
    },
    {
      id: 'transship', weight: 7,
      run: function (state) {
        const pp = state.lines.vn ? 30 : 20;
        state.effects.push({ kind: 'tariff', dest: 'us', origin: 'vn', delta: pp / 100, turns: 4, label: 'VNM +' + pp + 'pp' });
        return {
          tag: 'Customs', tone: 'bad',
          title: 'Transshipment crackdown: Vietnam +' + pp + ' points.',
          body: state.lines.vn
            ? 'They noticed how quickly your Vietnamese capacity appeared.'
            : 'Everyone who moved a plant to Hanoi last year is now a smuggler.',
        };
      },
    },
    {
      id: 'court', weight: 6, needs: function (state) { return hasHikes(state); },
      run: function (state) {
        const recent = state.duties.slice(-3).reduce(function (a, b) { return a + b; }, 0);
        const refund = round(recent * 0.4);
        state.cash = round(state.cash + refund);
        state.effects.push({ kind: 'void', turns: 2, label: 'Tariffs void pending appeal' });
        return {
          tag: 'Court of International Trade', tone: 'good',
          title: 'The emergency tariffs are void. You are refunded $' + refund + 'M.',
          body: 'Two quarters at baseline while it is appealed. Nobody thinks the appeal will fail quietly.',
        };
      },
    },
    {
      id: 'post', weight: 9,
      run: function (state) {
        const up = pick(state, ['us', 'eu', 'cn']);
        const down = pick(state, ['in', 'br', 'mx', 'vn']);
        state.effects.push({ kind: 'price', who: up, mul: 1.12, turns: 2, label: BY_ID[up].tag + ' prices +12%' });
        state.effects.push({ kind: 'price', who: down, mul: 0.88, turns: 2, label: BY_ID[down].tag + ' prices −12%' });
        return {
          tag: '4:07 a.m.', tone: 'odd',
          title: 'A post, in capitals, about ' + BY_ID[down].name + '.',
          body: 'Buyers there sit on their hands for two quarters. ' + BY_ID[up].name + ' pays up instead.',
        };
      },
    },
    {
      id: 'rare_earth', weight: 6,
      run: function (state) {
        state.effects.push({ kind: 'cost', who: 'cn', mul: 1.3, turns: 4, label: 'China input costs +30%' });
        state.effects.push({ kind: 'cost', who: '*', mul: 1.06, turns: 4, label: 'Inputs +6% everywhere' });
        return {
          tag: 'Export controls', tone: 'bad',
          title: 'Rare earths get licensed. Chinese production costs jump.',
          body: 'It turns out the leverage runs both ways, which surprises exactly one person.',
        };
      },
    },
    {
      id: 'ports', weight: 6,
      run: function (state) {
        state.effects.push({ kind: 'freight', who: '*', mul: 1.45, turns: 2, label: 'Freight +45%' });
        return {
          tag: 'Long Beach', tone: 'bad',
          title: 'Port fees on Chinese-built hulls. Freight is up 45%.',
          body: 'Most hulls are Chinese-built. The fee is passed to you within the hour.',
        };
      },
    },
    {
      id: 'grant', weight: 5,
      run: function (state) {
        if (state.lines.us) {
          const grant = 45 + state.lines.us * 15;
          state.cash = round(state.cash + grant);
          return {
            tag: 'Photo opportunity', tone: 'good',
            title: 'Your American plant is a triumph. Here is $' + grant + 'M.',
            body: 'You are invited to stand behind him while he says the number, which is not the number.',
          };
        }
        state.effects.push({ kind: 'tariff', dest: 'us', origin: '*', delta: 0.05, turns: 4, label: 'Reshoring levy +5pp' });
        return {
          tag: 'Photo opportunity', tone: 'bad',
          title: 'A rival builds in Ohio and gets the grant. You get a levy.',
          body: 'Five points on everything imported, to encourage the rest of you.',
        };
      },
    },
    {
      id: 'exclusion', weight: 8, needs: function (state) { return state.favor >= 45; },
      run: function (state) {
        const origins = Object.keys(state.lines);
        const who = origins.length ? pick(state, origins) : 'cn';
        state.effects.push({ kind: 'exempt', dest: 'us', origin: who, turns: 3, label: 'Carve-out: ' + BY_ID[who].tag });
        state.favor = Math.max(0, state.favor - 18);
        return {
          tag: 'Quiet word', tone: 'good',
          title: 'Your ' + BY_ID[who].name + ' lane is excluded. No announcement.',
          body: 'Nobody will call it a favour and it cost you a favour.',
        };
      },
    },
    {
      id: 'truce', weight: 4, needs: function (state) { return hasHikes(state); },
      run: function (state) {
        state.effects = state.effects.filter(function (e) { return e.kind !== 'tariff'; });
        return {
          tag: 'Summit', tone: 'good',
          title: 'A handshake, and every hike is dropped.',
          body: 'Baseline rates, everywhere, as of this morning. Enjoy it.',
        };
      },
    },
    {
      id: 'dollar', weight: 6,
      run: function (state) {
        const strong = nextRandom(state) < 0.5;
        state.effects.push({ kind: 'price', who: 'us', mul: strong ? 1.08 : 0.93, turns: 3, label: strong ? 'Strong dollar' : 'Weak dollar' });
        state.effects.push({ kind: 'cost', who: '*', mul: strong ? 0.96 : 1.05, turns: 3, label: strong ? 'Imported inputs cheaper' : 'Imported inputs dearer' });
        return {
          tag: 'The Fed', tone: 'odd',
          title: strong ? 'He shouts at the Fed; the dollar goes up anyway.' : 'He shouts at the Fed; the dollar sags.',
          body: strong
            ? 'American buyers pay more per unit, and your inputs get cheaper.'
            : 'US prices soften, and everything you buy abroad costs more.',
        };
      },
    },
  ];

  function biggestOrigin(state) {
    let best = null, most = -1;
    for (const id in state.lines) {
      if (state.lines[id] > most) { most = state.lines[id]; best = id; }
    }
    return best || 'cn';
  }

  function hasHikes(state) {
    return state.effects.some(function (e) { return e.kind === 'tariff' && e.delta > 0; });
  }

  function drawEvent(state) {
    const pool = EVENTS.filter(function (e) {
      if (e.needs && !e.needs(state)) return false;
      return e.id !== state.lastEvent;
    });
    let weight = 0;
    for (const e of pool) weight += weightOf(state, e);
    let roll = nextRandom(state) * weight;
    let chosen = pool[pool.length - 1];
    for (const e of pool) {
      roll -= weightOf(state, e);
      if (roll <= 0) { chosen = e; break; }
    }
    state.lastEvent = chosen.id;
    const headline = chosen.run(state);
    headline.tag = 'Q' + state.turn + ' · ' + headline.tag;
    headline.id = chosen.id;
    return headline;
  }

  // Friends of the administration get hit less and carved out more.
  function weightOf(state, event) {
    if (event.id === 'targeted' || event.id === 'transship' || event.id === 'neighbours') {
      return event.weight * (1 - state.favor / 180);
    }
    if (event.id === 'deal' || event.id === 'exclusion') {
      return event.weight * (1 + state.favor / 120);
    }
    return event.weight;
  }

  /* ------------------------------------------------------- the turn loop */

  function endTurn(state) {
    if (state.status !== 'playing') return null;
    const report = settle(state);

    if (state.cash < 0) {
      state.status = 'bust';
      state.headline = {
        tag: 'Q' + state.turn + ' · Chapter 11',
        tone: 'bad',
        title: 'You run out of money.',
        body: 'The lanes were priced for a world where the rate you were quoted was the rate you paid.',
      };
      return { report: report, headline: state.headline, over: true };
    }

    if (state.turn >= state.turns) {
      state.status = netWorth(state) >= state.goal ? 'won' : 'survived';
      state.headline = {
        tag: 'End of term',
        tone: state.status === 'won' ? 'good' : 'odd',
        title: state.status === 'won'
          ? 'Four years, $' + netWorth(state) + 'M, still standing.'
          : 'Four years survived, $' + netWorth(state) + 'M of it.',
        body: state.status === 'won'
          ? 'You beat the target of $' + state.goal + 'M by rerouting faster than he could sign.'
          : 'Short of the $' + state.goal + 'M target, but the company still exists, which was not guaranteed.',
      };
      return { report: report, headline: state.headline, over: true };
    }

    state.turn += 1;
    state.effects = state.effects
      .map(function (e) { return Object.assign({}, e, { turns: e.turns - 1 }); })
      .filter(function (e) { return e.turns > 0; });
    state.favor = Math.max(0, state.favor - 4);

    const headline = drawEvent(state);
    state.headline = headline;
    state.log.push({ turn: state.turn, text: headline.title });
    return { report: report, headline: headline, over: false };
  }

  return {
    COUNTRIES: COUNTRIES,
    BY_ID: BY_ID,
    LINE_UNITS: LINE_UNITS,
    DONATION: DONATION,
    createGame: createGame,
    lanes: lanes,
    book: book,
    clearAlloc: clearAlloc,
    capacity: capacity,
    booked: booked,
    bookedFrom: bookedFrom,
    bookedTo: bookedTo,
    build: build,
    buildCost: buildCost,
    lobby: lobby,
    lobbyCost: lobbyCost,
    preclear: preclear,
    preclearCost: preclearCost,
    donate: donate,
    endTurn: endTurn,
    netWorth: netWorth,
    tariffRate: tariffRate,
    priceOf: priceOf,
    costOf: costOf,
    freightOf: freightOf,
    activeEffects: activeEffects,
  };
});
