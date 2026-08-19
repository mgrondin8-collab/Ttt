/* Geometry check for the circuit: no self-overlap, sane width clearance,
   everything inside the world box, and a plausible speed profile.
   Run with: node tools/check-track.js */
'use strict';

var path = require('path');
require(path.join(__dirname, '..', 'src', 'util.js'));
require(path.join(__dirname, '..', 'src', 'track.js'));
var Racer = globalThis.Racer;

var t = Racer.track.build();
var n = t.count;
var failures = [];

console.log('circuit      : ' + t.name);
console.log('length       : ' + t.length.toFixed(0) + ' px over ' + n + ' stations');
console.log('spacing      : ' + t.spacing.toFixed(2) + ' px');
console.log('half width   : ' + t.halfWidth + ' px');

/* 1. Two parts of the track must never come close enough to merge. Stations
      within `skip` of each other along the lap are neighbours, not overlaps. */
var needed = 2 * t.halfWidth + 18;      /* both roads plus a verge between */
var skip = Math.ceil(needed / t.spacing) + 4;
var worst = Infinity, worstAt = null;
for (var i = 0; i < n; i++) {
  for (var j = i + skip; j < n; j++) {
    if (n - (j - i) < skip) continue;   /* wraps back to being a neighbour */
    var d = Math.hypot(t.centre[i].x - t.centre[j].x, t.centre[i].y - t.centre[j].y);
    if (d < worst) { worst = d; worstAt = [i, j]; }
  }
}
console.log('min clearance: ' + worst.toFixed(1) + ' px (need ' + needed + ') at stations ' + worstAt);
if (worst < needed) failures.push('track overlaps itself near stations ' + worstAt);

/* 1b. A corner tighter than the track is wide folds its own inside edge over. */
var minRadius = Infinity, tightAt = 0;
for (var c = 0; c < n; c++) {
  var r = 1 / Math.max(Math.abs(t.curvature[c]), 1e-9);
  if (r < minRadius) { minRadius = r; tightAt = c; }
}
console.log('min radius   : ' + minRadius.toFixed(0) + ' px at station ' + tightAt +
            ' (' + t.centre[tightAt].x.toFixed(0) + ',' + t.centre[tightAt].y.toFixed(0) + ')');
if (minRadius < t.halfWidth + 15) {
  failures.push('corner radius ' + minRadius.toFixed(0) + ' px is tighter than the track is wide');
}

/* 2. Every bit of tarmac, plus a kerb, has to fit in the world box. */
var pad = 16, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
[t.left, t.right].forEach(function (edge) {
  edge.forEach(function (p) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
});
console.log('tarmac bbox  : x ' + minX.toFixed(0) + '..' + maxX.toFixed(0) +
            '  y ' + minY.toFixed(0) + '..' + maxY.toFixed(0) +
            '  (world ' + t.world.width + 'x' + t.world.height + ')');
if (minX - pad < 0 || minY - pad < 0 || maxX + pad > t.world.width || maxY + pad > t.world.height) {
  failures.push('tarmac leaves the world box');
}

/* 3. The racing line must stay on the road. */
var maxOffset = 0;
for (var k = 0; k < n; k++) maxOffset = Math.max(maxOffset, Math.abs(t.racingLine[k].offset));
console.log('line offset  : max ' + maxOffset.toFixed(1) + ' px of ' + t.halfWidth);
if (maxOffset > t.halfWidth) failures.push('racing line runs off the track');

/* 4. Uniform resampling should leave every step the same length. */
var minStep = Infinity, maxStep = 0;
for (var s = 0; s < n; s++) {
  var a = t.centre[s], b = t.centre[(s + 1) % n];
  var st = Math.hypot(b.x - a.x, b.y - a.y);
  minStep = Math.min(minStep, st); maxStep = Math.max(maxStep, st);
}
console.log('step spread  : ' + minStep.toFixed(2) + '..' + maxStep.toFixed(2) + ' px');
if (maxStep / minStep > 1.15) failures.push('centreline sampling is not uniform');

/* 5. Speed profile: fast somewhere, slow somewhere, and a lap time in the
      right ballpark for a circuit this size. */
var vmin = Infinity, vmax = 0, timeSum = 0;
for (var v = 0; v < n; v++) {
  vmin = Math.min(vmin, t.targetSpeed[v]);
  vmax = Math.max(vmax, t.targetSpeed[v]);
  timeSum += t.spacing / t.targetSpeed[v];
}
console.log('target speed : ' + vmin.toFixed(0) + '..' + vmax.toFixed(0) + ' px/s');
console.log('ideal lap    : ~' + timeSum.toFixed(1) + ' s');
console.log('speed spread : slowest corner is ' + (100 * vmin / vmax).toFixed(0) + '% of top speed');
if (vmin > 0.72 * vmax) failures.push('the circuit is effectively flat out — no braking zones');
if (timeSum < 12 || timeSum > 90) failures.push('implausible lap time: ' + timeSum.toFixed(1) + 's');

/* 6. Room on the grid: the run-up to the line must be straight enough. */
var gridDepth = 340;
var straight = true;
for (var g = 0; g <= Math.round(gridDepth / t.spacing); g++) {
  if (Math.abs(t.curvature[(n - g) % n]) > 0.0016) { straight = false; break; }
}
console.log('grid run-up  : ' + (straight ? 'straight for ' + gridDepth + ' px' : 'CURVED'));
if (!straight) failures.push('the grid does not sit on a straight');

console.log('');
if (failures.length) {
  failures.forEach(function (f) { console.log('FAIL  ' + f); });
  process.exit(1);
}
console.log('PASS  track geometry is sound');
