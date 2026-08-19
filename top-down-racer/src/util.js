/* Small shared helpers. Loaded first; everything else hangs off window.Racer. */
(function (Racer) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  /* Shortest signed turn from angle `from` to angle `to`, in (-PI, PI]. */
  function angleDelta(from, to) {
    var d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d <= -Math.PI) d += TAU;
    return d;
  }

  /* Uniform Catmull-Rom: returns the point at t in [0,1] along the p1..p2 span. */
  function catmullRom(p0, p1, p2, p3, t, out) {
    var t2 = t * t, t3 = t2 * t;
    out = out || { x: 0, y: 0 };
    out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    return out;
  }

  /* m:ss.mmm — the way lap times are read out. */
  function formatTime(ms) {
    if (ms == null || !isFinite(ms)) return '--:--.---';
    var total = Math.max(0, Math.round(ms));
    var minutes = Math.floor(total / 60000);
    var seconds = Math.floor((total % 60000) / 1000);
    var millis = total % 1000;
    return minutes + ':' + String(seconds).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
  }

  /* Signed gap, e.g. "+1.204" / "-0.318". */
  function formatGap(ms) {
    if (ms == null || !isFinite(ms)) return '';
    var sign = ms < 0 ? '-' : '+';
    var total = Math.abs(Math.round(ms));
    return sign + (total / 1000).toFixed(3);
  }

  function ordinal(n) {
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return n + 'th';
    switch (n % 10) {
      case 1: return n + 'st';
      case 2: return n + 'nd';
      case 3: return n + 'rd';
      default: return n + 'th';
    }
  }

  /* Deterministic RNG so a given seed always produces the same field of rivals. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  Racer.util = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    dist: dist,
    angleDelta: angleDelta,
    catmullRom: catmullRom,
    formatTime: formatTime,
    formatGap: formatGap,
    ordinal: ordinal,
    mulberry32: mulberry32
  };
})(globalThis.Racer = globalThis.Racer || {});
