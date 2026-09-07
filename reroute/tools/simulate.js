/* Balance harness. Plays the engine many times with simple strategies and
   reports the spread of final net worth, so the target and the costs are
   tuned against evidence rather than vibes.

   Usage: node reroute/tools/simulate.js [games] */

const R = require('../engine.js');

// Book units on the best available margin, respecting each market's appetite
// so nothing is dumped at the spill price unless there is nowhere better.
function bookGreedy(state) {
  let left = R.capacity(state);
  while (left > 0) {
    const options = R.lanes(state).filter((l) => l.roomAtOrigin > 0 && l.margin > 0);
    if (!options.length) break;
    const best = options
      .map((l) => ({ lane: l, value: l.appetiteLeft > 0 ? l.margin : l.margin * 0.6 }))
      .sort((a, b) => b.value - a.value)[0];
    if (best.value <= 0) break;
    R.book(state, best.lane.id, best.lane.units + 1);
    left -= 1;
  }
}

const STRATEGIES = {
  // Ships, never invests. The floor.
  passive(state) {},

  // Never reroutes: everything from the first plant into the biggest market,
  // whatever the rate is that morning. The way to lose.
  stubborn(state) {
    R.book(state, 'cn-us', R.capacity(state));
  },

  // Builds wherever the margin looks best, keeping a cash buffer.
  builder(state) {
    const buffer = 60;
    const ranked = R.COUNTRIES
      .map((c) => {
        const cost = R.buildCost(state, c.id);
        const best = Math.max(...R.COUNTRIES.map((d) => {
          const rate = R.tariffRate(state, c.id, d.id);
          const unit = R.costOf(state, c.id) + R.freightOf(state, c.id, d.id);
          return R.priceOf(state, d.id) - unit - unit * rate;
        }));
        return { id: c.id, cost, best };
      })
      .filter((c) => c.best > 4)
      .sort((a, b) => b.best / b.cost - a.best / a.cost);
    for (const c of ranked) {
      if (state.cash - c.cost > buffer) R.build(state, c.id);
    }
  },

  // Builds, and buys influence when the Desk starts aiming at it.
  lobbyist(state) {
    if (state.favor < 35 && state.cash > 120) R.donate(state);
    STRATEGIES.builder(state);
    // Buy the carve-out that is worth the most: the duty you would actually
    // pay on that lane, times the units you could actually put on it.
    const hot = R.lanes(state)
      .filter((l) => l.origin !== l.dest && l.rate > 0.2)
      .map((l) => ({ l, value: l.duty * Math.min(l.roomAtOrigin, R.BY_ID[l.dest].absorb) * 3 }))
      .sort((a, b) => b.value - a.value)[0];
    if (hot && hot.value > R.lobbyCost(state) && state.cash > R.lobbyCost(state) + 90) {
      R.lobby(state, hot.l.origin, hot.l.dest);
    }
  },
};

function play(strategy, seed) {
  const state = R.createGame(seed);
  while (state.status === 'playing') {
    strategy(state);
    if (strategy !== STRATEGIES.stubborn) bookGreedy(state);
    R.endTurn(state);
  }
  return { worth: R.netWorth(state), status: state.status };
}

function report(name, results) {
  const worths = results.map((r) => r.worth).sort((a, b) => a - b);
  const at = (p) => worths[Math.floor((worths.length - 1) * p)];
  const bust = results.filter((r) => r.status === 'bust').length;
  const won = results.filter((r) => r.status === 'won').length;
  console.log(
    name.padEnd(10),
    'median', String(at(0.5)).padStart(7),
    ' p10', String(at(0.1)).padStart(7),
    ' p90', String(at(0.9)).padStart(7),
    ' bust', String(Math.round((bust / results.length) * 100)).padStart(3) + '%',
    ' hit target', String(Math.round((won / results.length) * 100)).padStart(3) + '%',
  );
}

const games = Number(process.argv[2] || 400);
for (const name of Object.keys(STRATEGIES)) {
  const results = [];
  for (let seed = 1; seed <= games; seed++) results.push(play(STRATEGIES[name], seed));
  report(name, results);
}
