/* audio.js — engine, wind and impacts, synthesised on the fly. Nothing is
   loaded from disk, and nothing starts until the player presses Start,
   which is also what browsers require. */
(function (global) {
  'use strict';

  function create() {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return { start() {}, update() {}, thud() {}, beep() {}, toggle() { return false; }, enabled: false };

    let ctx = null, master = null, engine = null, wind = null, started = false;
    let muted = false;

    function noiseBuffer() {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function start() {
      if (started) return;
      started = true;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);

      /* Engine: two detuned saws an octave apart through a low-pass, which
         gives a rough, bassy note that sweeps with the revs. */
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      filter.Q.value = 1.4;
      const oscA = ctx.createOscillator(); oscA.type = 'sawtooth';
      const oscB = ctx.createOscillator(); oscB.type = 'square';
      const oscBGain = ctx.createGain(); oscBGain.gain.value = 0.35;
      oscA.connect(gain);
      oscB.connect(oscBGain).connect(gain);
      gain.connect(filter).connect(master);
      oscA.start(); oscB.start();
      engine = { oscA, oscB, gain, filter };

      /* Wind and tyre roar: filtered noise that opens up with speed. */
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      src.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass';
      wf.frequency.value = 700;
      wf.Q.value = 0.6;
      const wg = ctx.createGain();
      wg.gain.value = 0.0001;
      src.connect(wf).connect(wg).connect(master);
      src.start();
      wind = { gain: wg, filter: wf };
    }

    /* rpm 0..1, load 0..1, speed in m/s, offRoad true on the grass. */
    function update(rpm, load, speed, offRoad) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      const base = 42 + rpm * 165;
      engine.oscA.frequency.setTargetAtTime(base, t, 0.05);
      engine.oscB.frequency.setTargetAtTime(base * 0.5, t, 0.05);
      engine.filter.frequency.setTargetAtTime(500 + rpm * 2600 + load * 900, t, 0.08);
      engine.gain.gain.setTargetAtTime(0.055 + load * 0.075 + rpm * 0.03, t, 0.08);
      const w = Math.min(speed / 80, 1);
      wind.gain.gain.setTargetAtTime(w * w * 0.16 + (offRoad ? 0.13 : 0), t, 0.1);
      wind.filter.frequency.setTargetAtTime(offRoad ? 420 : 620 + w * 1500, t, 0.1);
      wind.filter.Q.setTargetAtTime(offRoad ? 0.8 : 0.6, t, 0.1);
    }

    function thud(strength) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1800, t);
      f.frequency.exponentialRampToValueAtTime(120, t + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.7, 0.18 + strength * 0.5), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.35);
    }

    function beep(freq, length) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + length + 0.05);
    }

    function toggle() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
      return !muted;
    }

    function resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    return { start, update, thud, beep, toggle, resume, enabled: true };
  }

  global.Sound = { create };
})(window);
