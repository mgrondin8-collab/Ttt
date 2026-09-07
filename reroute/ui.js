/* Reroute — everything you touch. The economics live in engine.js. */

(function () {
  'use strict';

  const R = window.Reroute;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORE_KEY = 'reroute.best';

  let state = R.createGame();
  const ui = { filter: null, preclearUnits: 4 };

  const el = {
    quarter: document.getElementById('quarter'),
    cash: document.getElementById('stat-cash'),
    worth: document.getElementById('stat-worth'),
    favor: document.getElementById('stat-favor'),
    goalFill: document.getElementById('goal-fill'),
    goalLabel: document.getElementById('goal-label'),
    headline: document.getElementById('headline'),
    headlineTag: document.getElementById('headline-tag'),
    headlineTitle: document.getElementById('headline-title'),
    headlineBody: document.getElementById('headline-body'),
    flows: document.getElementById('map-flows'),
    nodes: document.getElementById('map-nodes'),
    mapHint: document.getElementById('map-hint'),
    effects: document.getElementById('effects'),
    counter: document.getElementById('counter'),
    lanelist: document.getElementById('lanelist'),
    ship: document.getElementById('ship'),
    noteBuild: document.getElementById('note-build'),
    noteLobby: document.getElementById('note-lobby'),
    noteDonate: document.getElementById('note-donate'),
    sheet: document.getElementById('sheet'),
    sheetTitle: document.getElementById('sheet-title'),
    sheetLede: document.getElementById('sheet-lede'),
    sheetBody: document.getElementById('sheet-body'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayBody: document.getElementById('overlay-body'),
    overlayAction: document.getElementById('overlay-action'),
  };

  /* ------------------------------------------------------------ helpers */

  function money(n) {
    const rounded = Math.round(n);
    return (rounded < 0 ? '−$' : '$') + Math.abs(rounded).toLocaleString('en-US') + 'M';
  }

  function signed(n) {
    const v = Math.round(n * 10) / 10;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  }

  function pct(rate) {
    return Math.round(rate * 100) + '%';
  }

  function tag(id) {
    return R.BY_ID[id].tag;
  }

  function svg(name, attrs, text) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function empty(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ------------------------------------------------------------- render */

  function render() {
    const focused = document.activeElement;
    const focusKey = focused && focused.dataset ? focused.dataset.key : null;

    renderStats();
    renderHeadline();
    renderMap();
    renderEffects();
    renderLanes();
    renderDock();

    if (focusKey) {
      const again = document.querySelector('[data-key="' + focusKey + '"]');
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  function renderStats() {
    const worth = R.netWorth(state);
    el.quarter.textContent = 'Q' + state.turn + ' of ' + state.turns;
    el.cash.textContent = money(state.cash);
    el.cash.className = state.cash < 60 ? 'is-down' : '';
    el.worth.textContent = money(worth);
    el.worth.className = worth >= state.goal ? 'is-up' : '';
    el.favor.textContent = Math.round(state.favor);
    el.goalFill.style.width = Math.max(0, Math.min(100, (worth / state.goal) * 100)) + '%';
    el.goalLabel.textContent = worth >= state.goal
      ? 'Target cleared — every quarter from here is gravy.'
      : 'Target ' + money(state.goal) + ' by the end of the term · ' + money(state.goal - worth) + ' to go';
  }

  function renderHeadline() {
    const h = state.headline;
    el.headline.className = 'headline headline--' + (h.tone || 'calm');
    el.headlineTag.textContent = h.tag;
    el.headlineTitle.textContent = h.title;
    el.headlineBody.textContent = h.body;
  }

  function renderMap() {
    empty(el.flows);
    empty(el.nodes);

    const lanes = R.lanes(state);
    for (const lane of lanes) {
      if (!lane.units || lane.origin === lane.dest) continue;
      const a = R.BY_ID[lane.origin];
      const b = R.BY_ID[lane.dest];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - Math.abs(a.x - b.x) / 7 };
      const path = svg('path', {
        d: 'M' + a.x + ' ' + a.y + ' Q' + mid.x + ' ' + mid.y + ' ' + b.x + ' ' + b.y,
        class: 'flow ' + (lane.margin > 8 ? 'flow--good' : lane.margin > 0 ? 'flow--thin' : 'flow--bad'),
        'stroke-width': Math.min(4.5, 1 + lane.units * 0.6),
      });
      el.flows.appendChild(path);
    }

    for (const country of R.COUNTRIES) {
      const mine = state.lines[country.id] || 0;
      const picked = ui.filter === country.id;
      const g = svg('g', {
        class: 'node' + (mine ? ' node--mine' : '') + (picked ? ' node--picked' : ''),
      });
      g.appendChild(svg('circle', { class: 'node__disc', cx: country.x, cy: country.y, r: 11 }));
      g.appendChild(svg('text', { class: 'node__tag', x: country.x, y: country.y + (mine ? -1 : 2.5) }, country.tag));
      if (mine) {
        g.appendChild(svg('text', { class: 'node__lines', x: country.x, y: country.y + 6.5 }, mine + '×' + R.LINE_UNITS));
      }
      g.appendChild(svg('text', { class: 'node__price', x: country.x, y: country.y + 20 }, '$' + R.priceOf(state, country.id).toFixed(0)));

      const hit = svg('circle', { class: 'node__hit', cx: country.x, cy: country.y, r: 19 });
      hit.addEventListener('click', function () {
        ui.filter = ui.filter === country.id ? null : country.id;
        render();
      });
      g.appendChild(hit);
      el.nodes.appendChild(g);
    }

    el.mapHint.textContent = ui.filter
      ? 'Showing lanes touching ' + R.BY_ID[ui.filter].name + '. Tap it again for all of them.'
      : 'Tap a country to filter the lanes below. The figure under each is its price per unit.';
  }

  function renderEffects() {
    empty(el.effects);
    const chips = [];

    for (const e of state.effects) {
      const tone = e.kind === 'exempt' || e.kind === 'pause' || e.kind === 'void' ? 'good'
        : e.kind === 'tariff' || e.kind === 'freight' ? 'bad'
          : 'calm';
      chips.push({ tone: tone, text: e.label + (e.turns < 90 ? ' · ' + e.turns + 'q' : '') });
    }
    for (const dest in state.cleared) {
      chips.push({ tone: 'good', text: state.cleared[dest] + ' units pre-cleared into ' + tag(dest) });
    }
    if (!chips.length) chips.push({ tone: 'calm', text: 'Baseline rates. Enjoy the quiet.' });

    for (const chip of chips) {
      const li = document.createElement('li');
      li.className = 'chip chip--' + chip.tone;
      li.textContent = chip.text;
      el.effects.appendChild(li);
    }
  }

  function renderLanes() {
    empty(el.lanelist);

    const capacity = R.capacity(state);
    const used = R.booked(state);
    el.counter.textContent = used + ' of ' + capacity + ' units booked';

    // Rank by margin once a quarter. Re-sorting on every tap would make rows
    // jump out from under the thumb that just booked them.
    const all = R.lanes(state);
    const signature = all.map(function (lane) { return lane.id; }).join(',');
    if (ui.orderTurn !== state.turn || ui.orderSignature !== signature) {
      ui.orderTurn = state.turn;
      ui.orderSignature = signature;
      ui.order = all.map(function (lane) { return lane.id; });
    }

    const lanes = all
      .filter(function (lane) {
        if (!ui.filter) return true;
        return lane.origin === ui.filter || lane.dest === ui.filter;
      })
      .sort(function (a, b) {
        return ui.order.indexOf(a.id) - ui.order.indexOf(b.id);
      });

    for (const lane of lanes) el.lanelist.appendChild(laneRow(lane));

    if (!lanes.length) {
      const li = document.createElement('li');
      li.className = 'chip chip--calm';
      li.textContent = 'No lanes here. Tap the country again, or build a plant.';
      el.lanelist.appendChild(li);
    }
  }

  function laneRow(lane) {
    const li = document.createElement('li');
    li.className = 'lane' + (lane.units ? ' lane--on' : '') + (lane.margin <= 0 ? ' lane--dead' : '');

    const left = document.createElement('div');

    const route = document.createElement('p');
    route.className = 'lane__route';
    route.style.margin = '0';
    route.appendChild(document.createTextNode(tag(lane.origin)));
    const arrow = document.createElement('span');
    arrow.className = 'lane__arrow';
    arrow.textContent = '→';
    route.appendChild(arrow);
    route.appendChild(document.createTextNode(tag(lane.dest)));
    const margin = document.createElement('span');
    margin.className = 'lane__margin ' + (lane.margin > 0 ? 'is-up' : 'is-down');
    margin.textContent = signed(lane.margin) + '/u';
    route.appendChild(margin);
    left.appendChild(route);

    const meta = document.createElement('p');
    meta.className = 'lane__meta';
    meta.appendChild(bit('sells ' + lane.price.toFixed(1)));
    meta.appendChild(bit('makes ' + lane.cost.toFixed(1) + ' + ship ' + lane.freight.toFixed(1)));

    if (lane.origin === lane.dest) {
      meta.appendChild(bit('domestic, no duty', 'lane__free'));
    } else if (lane.rate === 0 && lane.baseRate > 0) {
      meta.appendChild(bit('duty waived', 'lane__free'));
    } else {
      const hiked = lane.rate > lane.baseRate + 0.001;
      meta.appendChild(bit(
        'duty ' + pct(lane.rate) + ' = ' + lane.duty.toFixed(1) + (hiked ? ' ▲' : ''),
        hiked ? 'lane__hike' : '',
      ));
    }
    if (lane.appetiteLeft <= 0) {
      meta.appendChild(bit(tag(lane.dest) + ' is full — extra units clear at 60%', 'lane__full'));
    }
    left.appendChild(meta);
    li.appendChild(left);

    const stepper = document.createElement('div');
    stepper.className = 'stepper';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.dataset.key = 'minus:' + lane.id;
    minus.setAttribute('aria-label', 'One unit fewer on ' + tag(lane.origin) + ' to ' + tag(lane.dest));
    minus.textContent = '−';
    minus.disabled = lane.units === 0;
    minus.addEventListener('click', function () {
      R.book(state, lane.id, lane.units - 1);
      render();
    });

    const out = document.createElement('output');
    out.textContent = lane.units;

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.dataset.key = 'plus:' + lane.id;
    plus.setAttribute('aria-label', 'One unit more on ' + tag(lane.origin) + ' to ' + tag(lane.dest));
    plus.textContent = '+';
    plus.disabled = lane.roomAtOrigin <= 0;
    plus.addEventListener('click', function () {
      R.book(state, lane.id, lane.units + 1);
      render();
    });

    stepper.appendChild(minus);
    stepper.appendChild(out);
    stepper.appendChild(plus);
    li.appendChild(stepper);
    return li;
  }

  function bit(text, className) {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    return span;
  }

  function renderDock() {
    let cheapest = Infinity;
    for (const country of R.COUNTRIES) cheapest = Math.min(cheapest, R.buildCost(state, country.id));
    el.noteBuild.textContent = 'from ' + money(cheapest);
    el.noteLobby.textContent = money(R.lobbyCost(state));
    el.noteDonate.textContent = money(R.DONATION);
    const booked = R.booked(state);
    el.ship.textContent = booked ? 'Ship ' + booked + ' units →' : 'Sit the quarter out →';
    el.ship.className = booked ? 'ship' : 'ship ship--idle';
  }

  /* ------------------------------------------------------------- sheets */

  let lastFocus = null;
  let onSheetClose = null;

  function openSheet(title, lede, build, options) {
    const opts = options || {};
    lastFocus = document.activeElement;
    onSheetClose = opts.onClose || null;
    el.sheetTitle.textContent = title;
    el.sheetLede.textContent = lede;
    empty(el.sheetBody);
    build(el.sheetBody);
    const closer = el.sheet.querySelector('.sheet__close');
    closer.hidden = !!opts.hideClose;
    el.sheet.hidden = false;
    (opts.hideClose ? el.sheet.querySelector('.sheet__panel') : closer).focus();
  }

  function closeSheet() {
    if (el.sheet.hidden) return;
    el.sheet.hidden = true;
    const after = onSheetClose;
    onSheetClose = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    if (after) after();
  }

  function option(name, price, note, enabled, onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.disabled = !enabled;

    const label = document.createElement('span');
    label.className = 'option__name';
    label.textContent = name;

    const cost = document.createElement('span');
    cost.className = 'option__price';
    cost.textContent = price;

    const detail = document.createElement('span');
    detail.className = 'option__note';
    detail.textContent = note;

    button.appendChild(label);
    button.appendChild(cost);
    button.appendChild(detail);
    button.addEventListener('click', onPick);
    return button;
  }

  const SHEETS = {
    build: function () {
      openSheet(
        'Open a production line',
        'Four units a quarter, and a new origin for your lanes. Where you make it decides which tariff you pay.',
        function (body) {
          const ranked = R.COUNTRIES.slice().sort(function (a, b) {
            return R.buildCost(state, a.id) - R.buildCost(state, b.id);
          });
          for (const country of ranked) {
            const price = R.buildCost(state, country.id);
            const owned = state.lines[country.id] || 0;
            const intoUS = country.id === 'us'
              ? 'sells at home with no duty'
              : 'duty into USA today ' + pct(R.tariffRate(state, country.id, 'us'));
            body.appendChild(option(
              country.name,
              money(price),
              'unit cost ' + R.costOf(state, country.id).toFixed(1) + ' · ' + intoUS
                + (owned ? ' · you have ' + owned : ''),
              state.cash >= price,
              function () {
                R.build(state, country.id);
                closeSheet();
                render();
              },
            ));
          }
        },
      );
    },

    lobby: function () {
      openSheet(
        'Buy an exclusion',
        'Four quarters of no duty on one lane. Nobody calls it a favour, and it costs you less the friendlier you have been.',
        function (body) {
          const price = R.lobbyCost(state);
          const dutied = R.lanes(state).filter(function (lane) {
            return lane.origin !== lane.dest && lane.rate > 0;
          });
          if (!dutied.length) {
            body.appendChild(bit('Nothing you ship pays duty right now.'));
            return;
          }
          for (const lane of dutied.sort(function (a, b) { return b.duty - a.duty; })) {
            body.appendChild(option(
              tag(lane.origin) + ' → ' + tag(lane.dest),
              money(price),
              'duty ' + pct(lane.rate) + ', ' + lane.duty.toFixed(1) + ' a unit — saves that on every unit for four quarters',
              state.cash >= price,
              function () {
                R.lobby(state, lane.origin, lane.dest);
                closeSheet();
                render();
              },
            ));
          }
        },
      );
    },

    preclear: function () {
      openSheet(
        'Pre-clear through customs',
        'Pay today’s duty on units that land later. When the next hike arrives, these come in at the old rate.',
        function (body) {
          const picker = document.createElement('div');
          picker.className = 'chips';
          for (const n of [2, 4, 6]) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (ui.preclearUnits === n ? ' chip--good' : '');
            chip.textContent = n + ' units';
            chip.addEventListener('click', function () {
              ui.preclearUnits = n;
              SHEETS.preclear();
            });
            picker.appendChild(chip);
          }
          body.appendChild(picker);

          for (const country of R.COUNTRIES) {
            const price = R.preclearCost(state, country.id, ui.preclearUnits);
            const held = state.cleared[country.id] || 0;
            body.appendChild(option(
              country.name,
              money(price),
              'covers the ' + ui.preclearUnits + ' costliest units you land here'
                + (held ? ' · ' + held + ' already waiting' : ''),
              state.cash >= price,
              function () {
                R.preclear(state, country.id, ui.preclearUnits);
                closeSheet();
                render();
              },
            ));
          }
        },
      );
    },

    donate: function () {
      openSheet(
        'A friendly contribution',
        'Entirely legal, and everyone in your industry is doing it. Favour makes hikes land on somebody else and carve-outs land on you. It drains a few points a quarter.',
        function (body) {
          body.appendChild(option(
            'Wire it to the inaugural committee',
            money(R.DONATION),
            'favour ' + Math.round(state.favor) + ' → ' + Math.min(100, Math.round(state.favor) + 26),
            state.cash >= R.DONATION,
            function () {
              R.donate(state);
              closeSheet();
              render();
            },
          ));
        },
      );
    },
  };

  /* --------------------------------------------------------- the ledger */

  function showQuarter(result) {
    const r = result.report;
    const done = function () {
      if (result.over) showEnding();
      else window.scrollTo({ top: 0, behavior: 'smooth' });
      render();
    };
    openSheet('Quarter ' + r.turn + ' closed', r.units
      ? r.units + ' units moved.'
      : 'You shipped nothing. The overheads did not care.', function (body) {
      const table = document.createElement('table');
      table.className = 'ledger';
      const rows = [
        ['Revenue', r.revenue, 'up'],
        ['Production', -r.production, 'down'],
        ['Freight', -r.freight, 'down'],
        ['Duty', -r.duty, 'down'],
        ['Overheads', -r.opex, 'down'],
      ];
      for (const row of rows) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = row[0];
        const td = document.createElement('td');
        td.className = 'is-' + row[2];
        td.textContent = money(row[1]);
        tr.appendChild(th);
        tr.appendChild(td);
        table.appendChild(tr);
      }
      const tr = document.createElement('tr');
      tr.className = 'total';
      const th = document.createElement('th');
      th.textContent = r.profit >= 0 ? 'Profit' : 'Loss';
      const td = document.createElement('td');
      td.className = r.profit >= 0 ? 'is-up' : 'is-down';
      td.textContent = money(r.profit);
      tr.appendChild(th);
      tr.appendChild(td);
      table.appendChild(tr);
      body.appendChild(table);

      if (r.duty > 0) {
        const note = document.createElement('p');
        note.className = 'option__note';
        note.textContent = 'Duty was ' + Math.round((r.duty / Math.max(1, r.revenue)) * 100)
          + '% of your revenue this quarter.';
        body.appendChild(note);
      }

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'overlay__action';
      next.textContent = result.over ? 'See how it ended' : 'Next quarter →';
      next.addEventListener('click', closeSheet);
      body.appendChild(next);
    }, { hideClose: true, onClose: done });
  }

  /* ---------------------------------------------------- intro and ending */

  function showOverlay(title, build, actionText, onAction) {
    el.overlayTitle.textContent = title;
    empty(el.overlayBody);
    build(el.overlayBody);
    el.overlayAction.textContent = actionText;
    el.overlayAction.onclick = onAction;
    el.overlay.hidden = false;
    el.overlayAction.focus();
  }

  function para(text, html) {
    const p = document.createElement('p');
    if (html) p.innerHTML = text;
    else p.textContent = text;
    return p;
  }

  function showIntro() {
    showOverlay('Reroute', function (body) {
      body.appendChild(para('You run a manufacturer with one plant in China and $120M. '
        + 'Sixteen quarters — one term — to build it into ' + money(state.goal) + '.', false));
      const ol = document.createElement('ol');
      const steps = [
        '<strong>Book the quarter.</strong> Each production line makes four units. Put them on the lanes with the best margin per unit.',
        '<strong>Watch the duty.</strong> A tariff is charged on what a unit costs to make plus what it costs to ship, so a hike eats the margin, not the price.',
        '<strong>Then he speaks.</strong> Every quarter the Oval Desk changes something: a blanket rate, a pause, a deal, a crackdown, a 4 a.m. post.',
        '<strong>Reroute.</strong> Build somewhere else, buy an exclusion, pre-clear ahead of a hike, or make yourself a friend. Standing still is how you go bankrupt.',
      ];
      for (const step of steps) {
        const li = document.createElement('li');
        li.innerHTML = step;
        ol.appendChild(li);
      }
      body.appendChild(ol);
      const best = bestScore();
      if (best) body.appendChild(para('Your best so far: ' + money(best) + '.', false));
    }, 'Start the term', function () {
      el.overlay.hidden = true;
      render();
    });
  }

  function rankFor(worth) {
    if (state.status === 'bust') return 'Chapter 11';
    if (worth >= state.goal * 1.6) return 'You out-manoeuvred the Desk';
    if (worth >= state.goal) return 'Target cleared';
    if (worth >= state.goal * 0.6) return 'Survived the term';
    return 'Still trading, barely';
  }

  function showEnding() {
    const worth = R.netWorth(state);
    const best = Math.max(bestScore(), state.status === 'bust' ? 0 : worth);
    try { localStorage.setItem(STORE_KEY, String(Math.round(best))); } catch (err) { /* private mode */ }

    let duty = 0;
    for (const d of state.duties) duty += d;
    let plants = 0;
    for (const id in state.lines) plants += state.lines[id];

    showOverlay(state.status === 'bust' ? 'Bankrupt' : 'End of term', function (body) {
      const rank = document.createElement('p');
      rank.className = 'rank';
      rank.textContent = rankFor(worth);
      body.appendChild(rank);
      body.appendChild(para(state.headline.body, false));

      const tally = document.createElement('ul');
      tally.className = 'tally';
      const rows = [
        ['Net worth', money(worth)],
        ['Quarters run', String(state.quarters.length)],
        ['Duty paid', money(duty)],
        ['Production lines', plants + ' across ' + Object.keys(state.lines).length + ' countries'],
        ['Best run', money(best)],
      ];
      for (const row of rows) {
        const li = document.createElement('li');
        li.appendChild(bit(row[0]));
        li.appendChild(bit(row[1]));
        tally.appendChild(li);
      }
      body.appendChild(tally);

      body.appendChild(para('What he did to you:', false));
      const list = document.createElement('ol');
      for (const entry of state.log.slice(-6)) {
        const li = document.createElement('li');
        li.textContent = 'Q' + entry.turn + ' — ' + entry.text;
        list.appendChild(li);
      }
      body.appendChild(list);
    }, 'Play another term', function () {
      state = R.createGame();
      ui.filter = null;
      el.overlay.hidden = true;
      render();
    });
  }

  function bestScore() {
    try { return Number(localStorage.getItem(STORE_KEY)) || 0; } catch (err) { return 0; }
  }

  /* --------------------------------------------------------------- wire */

  for (const button of document.querySelectorAll('[data-sheet]')) {
    button.addEventListener('click', function () {
      SHEETS[button.dataset.sheet]();
    });
  }

  for (const closer of document.querySelectorAll('[data-close]')) {
    closer.addEventListener('click', closeSheet);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !el.sheet.hidden) closeSheet();
  });

  el.ship.addEventListener('click', function () {
    if (state.status !== 'playing') return;
    const result = R.endTurn(state);
    if (!result) return;
    render();
    showQuarter(result);
  });

  render();
  showIntro();
})();
