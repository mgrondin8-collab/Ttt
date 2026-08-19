/* Wiring: the loop, the overlays and the read-outs. Everything that decides
   what happens in the race lives in race.js; this file only shows it. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var clamp = util.clamp;
  var STEP = 1 / 120;          /* physics runs fixed, however the frame lands */
  var MAX_STEPS = 6;
  var STORE_KEY = 'top-down-racer:best-lap';

  function $(id) { return document.getElementById(id); }

  function Game() {
    this.track = Racer.track.build();
    this.canvas = $('stage');
    this.renderer = new Racer.render.Renderer(this.canvas, this.track);
    this.input = new Racer.input.Input(document.body);
    this.minimap = $('minimap');

    this.settings = { laps: 3, opponents: 4, difficulty: 'even' };
    this.race = null;
    this.mode = 'menu';        /* menu | racing | paused | results */
    this.accumulator = 0;
    this.lastFrame = 0;
    this.bestEver = this._loadBest();
    this.standingsClock = 0;

    this._bindUi();
    this._showBestEver();
    $('circuit').textContent = this.track.name + ' \u00b7 ' +
      Math.round(this.track.length / Racer.physics.SPEC.pxPerMetre) + ' m';
    this._newRace(true);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  Game.prototype._loadBest = function () {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var value = raw == null ? NaN : Number(raw);
      return isFinite(value) && value > 0 ? value : null;
    } catch (e) { return null; }
  };

  Game.prototype._saveBest = function (ms) {
    this.bestEver = ms;
    try { window.localStorage.setItem(STORE_KEY, String(Math.round(ms))); } catch (e) { /* private mode */ }
    this._showBestEver();
  };

  Game.prototype._showBestEver = function () {
    $('record').textContent = this.bestEver ? util.formatTime(this.bestEver) : '--:--.---';
  };

  Game.prototype._bindUi = function () {
    var self = this;

    Array.prototype.forEach.call(document.querySelectorAll('[data-setting]'), function (group) {
      var key = group.getAttribute('data-setting');
      group.addEventListener('click', function (e) {
        var button = e.target.closest('button[data-value]');
        if (!button) return;
        var raw = button.getAttribute('data-value');
        self.settings[key] = isNaN(Number(raw)) ? raw : Number(raw);
        Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) {
          var on = b === button;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    });

    $('start').addEventListener('click', function () { self.startRace(); });
    $('again').addEventListener('click', function () { self.startRace(); });
    $('to-menu').addEventListener('click', function () { self.toMenu(); });
    $('resume').addEventListener('click', function () { self.togglePause(); });
    $('quit').addEventListener('click', function () { self.toMenu(); });

    this.input.onRestart = function () {
      if (self.mode === 'racing' || self.mode === 'paused' || self.mode === 'results') self.startRace();
    };
    this.input.onPause = function () {
      if (self.mode === 'racing' || self.mode === 'paused') self.togglePause();
    };

    window.addEventListener('resize', function () { self.renderer.resize(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && self.mode === 'racing') self.togglePause();
    });
  };

  Game.prototype._newRace = function (silent) {
    this.race = new Racer.race.Race(this.track, {
      laps: this.settings.laps,
      opponents: this.settings.opponents,
      difficulty: this.settings.difficulty,
      seed: 20260819
    });
    this.renderer.clearRubber();
    this.renderer.resize();
    this._followCamera(0, true);
    this._buildStandings();
    if (!silent) this._syncHud();
  };

  Game.prototype.startRace = function () {
    this._newRace();
    this.mode = 'racing';
    this.accumulator = 0;
    this.input.releaseAll();
    this._setOverlay(null);
    $('hud').hidden = false;
  };

  Game.prototype.toMenu = function () {
    this.mode = 'menu';
    this._newRace(true);
    this._setOverlay('menu');
    $('hud').hidden = true;
  };

  Game.prototype.togglePause = function () {
    if (this.mode === 'racing') {
      this.mode = 'paused';
      this.input.releaseAll();
      this._setOverlay('paused');
    } else if (this.mode === 'paused') {
      this.mode = 'racing';
      this.accumulator = 0;
      this._setOverlay(null);
    }
  };

  Game.prototype._setOverlay = function (which) {
    ['menu', 'paused', 'results'].forEach(function (name) {
      $(name).hidden = name !== which;
    });
    $('overlay').hidden = which == null;
  };

  /* ------------------------------------------------------------------ */

  Game.prototype._loop = function (now) {
    requestAnimationFrame(this._loop);
    if (!this.lastFrame) this.lastFrame = now;
    var frame = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;

    if (this.mode === 'racing') {
      this.accumulator += frame;
      var steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS) {
        this.race.step(STEP, this.input.controls());
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.accumulator = 0;   /* do not spiral */

      for (var c = 0; c < this.race.contacts.length; c++) {
        this.renderer.camera.bump(this.race.contacts[c].force);
      }
      this.renderer.layRubber(this.race.cars, frame);

      if (this.race.player.finished && this.mode === 'racing') this._finish();
    }

    this._followCamera(this.mode === 'racing' ? frame : 0, false);
    this.renderer.draw(this.race, frame);
    this.renderer.drawMinimap(this.minimap, this.race);
    this._syncHud();
  };

  Game.prototype._followCamera = function (dt, snap) {
    var r = this.renderer;
    r.camera.follow(this.race.player, r.viewW / r.dpr, r.viewH / r.dpr, r.dpr, dt, snap);
  };

  Game.prototype._finish = function () {
    var player = this.race.player;
    this.newRecord = !!(player.bestLap && (!this.bestEver || player.bestLap < this.bestEver));
    if (this.newRecord) this._saveBest(player.bestLap);

    /* Let the rest of the field get home before showing the result, but do not
       wait all day for a rival that has buried itself in a barrier. */
    var self = this;
    var idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    var frames = 0;
    this.mode = 'results-pending';
    (function settle() {
      if (self.mode !== 'results-pending') return;
      var home = self.race.cars.every(function (car) { return car.finished; });
      if (home || frames++ > 240) { self._showResults(); return; }
      for (var i = 0; i < 8; i++) self.race.step(STEP, idle);
      requestAnimationFrame(settle);
    })();
  };

  Game.prototype._showResults = function () {
    this.mode = 'results';
    var player = this.race.player;
    var list = $('result-rows');
    list.innerHTML = '';
    this.race.order.forEach(function (car, i) {
      var row = document.createElement('li');
      row.className = 'result-row' + (car.isPlayer ? ' is-you' : '');
      row.innerHTML =
        '<span class="pos">' + util.ordinal(i + 1) + '</span>' +
        '<span class="swatch" style="background:' + car.colour + '"></span>' +
        '<span class="who">' + car.name + '</span>' +
        '<span class="num">' + (car.finished ? util.formatTime(car.finishTime) : 'DNF') + '</span>' +
        '<span class="num soft">' + util.formatTime(car.bestLap) + '</span>';
      list.appendChild(row);
    });
    $('result-title').textContent = player.position === 1 ? 'You won' : 'You finished ' + util.ordinal(player.position);
    $('result-note').textContent = this.newRecord
      ? 'New best lap: ' + util.formatTime(player.bestLap)
      : 'Best lap this race: ' + util.formatTime(player.bestLap);
    this._setOverlay('results');
  };

  /* ------------------------------------------------------------------ */

  Game.prototype._buildStandings = function () {
    var list = $('standings');
    list.innerHTML = '';
    this.rows = new Map();
    var self = this;
    this.race.cars.forEach(function (car) {
      var row = document.createElement('li');
      row.className = 'standing' + (car.isPlayer ? ' is-you' : '');
      row.innerHTML =
        '<span class="pos"></span>' +
        '<span class="swatch" style="background:' + car.colour + '"></span>' +
        '<span class="who">' + car.name + '</span>' +
        '<span class="gap"></span>';
      list.appendChild(row);
      self.rows.set(car, row);
    });
  };

  Game.prototype._syncHud = function () {
    var race = this.race, player = race.player;

    $('position').textContent = util.ordinal(player.position);
    $('position-of').textContent = 'of ' + race.cars.length;
    $('lap').textContent = Math.min(race.totalLaps, player.lapsDone + 1);
    $('lap-of').textContent = 'of ' + race.totalLaps;

    var current = player.started && !player.finished ? (race.time - player.lapStart) * 1000 : 0;
    $('current-lap').textContent = player.started ? util.formatTime(current) : '0:00.000';
    $('best-lap').textContent = util.formatTime(player.bestLap);
    $('last-lap').textContent = util.formatTime(player.lastLap);
    var mps = Math.abs(player.forwardSpeed) / Racer.physics.SPEC.pxPerMetre;
    $('speed').textContent = Math.round(mps * 3.6);

    var flag = $('flag');
    if (race.state === 'countdown') {
      var n = Math.ceil(race.countdown);
      flag.textContent = n > 3 ? '3' : String(n);
      flag.dataset.tone = 'count';
      flag.hidden = false;
    } else if (race.time < 1.1 && race.state === 'racing') {
      flag.textContent = 'GO';
      flag.dataset.tone = 'go';
      flag.hidden = false;
    } else if (player.finished) {
      flag.textContent = 'FINISH';
      flag.dataset.tone = 'go';
      flag.hidden = false;
    } else flag.hidden = true;

    $('offtrack').hidden = !(player.surface === 'grass' && player.offTrackFor > 0.35);

    /* Standings, re-ordered in place. */
    var list = $('standings');
    var self = this;
    race.order.forEach(function (car, i) {
      var row = self.rows.get(car);
      if (!row) return;
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
      row.querySelector('.pos').textContent = i + 1;
      var gap = row.querySelector('.gap');
      if (car.finished) gap.textContent = util.formatTime(car.finishTime);
      else if (race.state === 'countdown') gap.textContent = 'P' + (car.gridSlot + 1);
      else if (i === 0) gap.textContent = 'leader';
      else {
        var g = race.gapAhead(car);
        if (g == null) gap.textContent = '—';
        else if (g.lapsBehind >= 1) gap.textContent = '+' + g.lapsBehind + (g.lapsBehind === 1 ? ' lap' : ' laps');
        else gap.textContent = util.formatGap(g.ms);
      }
    });
  };

  function boot() {
    try {
      /* Handy from the console, and what the browser test drives. */
      window.__game = new Game();
    } catch (err) {
      var stage = document.getElementById('overlay');
      if (stage) {
        stage.hidden = false;
        stage.innerHTML = '<div class="panel"><h2>The game could not start</h2><p>' +
          String(err && err.message ? err.message : err) + '</p></div>';
      }
      throw err;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();

  Racer.game = { Game: Game };
})(globalThis.Racer = globalThis.Racer || {});
