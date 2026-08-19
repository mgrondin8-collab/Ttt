/* Runs whole races headless: the field has to get round, at a believable pace,
   without anyone beaching themselves or leaving the circuit.
   Run with: node tools/check-race.js */
'use strict';

var path = require('path');
['util', 'physics', 'track', 'ai', 'race'].forEach(function (m) {
  require(path.join(__dirname, '..', 'src', m + '.js'));
});
var Racer = globalThis.Racer;
var util = Racer.util;

var track = Racer.track.build();
var failures = [];
var dt = 1 / 120;

/* Drive the player car with an AI too, so the whole grid is racing. */
function runRace(opts) {
  var race = new Racer.race.Race(track, opts);
  var pilot = new Racer.ai.Driver(race.player, track, {
    skill: 0.93, aggression: 0.5, rand: util.mulberry32(7)
  });
  var maxSeconds = 60 * opts.laps + 60;
  var steps = Math.round(maxSeconds / dt);
  var offTrack = 0, worstLateral = 0, samples = 0;

  for (var i = 0; i < steps; i++) {
    var controls = race.state === 'racing' && !race.player.finished
      ? pilot.update(dt, race.cars, race.time)
      : { throttle: 0, brake: 0, steer: 0, handbrake: false };
    race.step(dt, controls);

    if (i % 30 === 0) {
      for (var c = 0; c < race.cars.length; c++) {
        var car = race.cars[c];
        var lat = Math.abs(track.lateral(car.x, car.y, car.station));
        worstLateral = Math.max(worstLateral, lat);
        if (lat > track.halfWidth + 12) offTrack++;
        samples++;
        if (!isFinite(car.x) || !isFinite(car.y) || !isFinite(car.speed)) {
          failures.push('a car went non-finite during the ' + opts.difficulty + ' race');
          return null;
        }
      }
    }
    if (race.state === 'finished') break;
  }
  return { race: race, offTrackFraction: offTrack / Math.max(1, samples), worstLateral: worstLateral };
}

['relaxed', 'even', 'ruthless'].forEach(function (difficulty) {
  var result = runRace({ laps: 3, opponents: 4, difficulty: difficulty, seed: 4242 });
  if (!result) return;
  var race = result.race;

  var unfinished = race.cars.filter(function (c) { return !c.finished; });
  var laps = race.cars.reduce(function (acc, c) { return acc.concat(c.lapTimes); }, []);
  var best = Math.min.apply(null, laps.length ? laps : [NaN]);
  var slowest = Math.max.apply(null, laps.length ? laps : [NaN]);
  var winner = race.order[0];

  console.log('--- ' + difficulty);
  console.log('  finished     : ' + (race.cars.length - unfinished.length) + '/' + race.cars.length +
              ' in ' + race.time.toFixed(1) + ' s');
  console.log('  lap times    : ' + util.formatTime(best) + ' .. ' + util.formatTime(slowest) +
              '  (' + laps.length + ' laps recorded)');
  console.log('  winner       : ' + winner.name + ' ' + util.formatTime(winner.finishTime));
  console.log('  off track    : ' + (100 * result.offTrackFraction).toFixed(1) + '% of samples' +
              ', worst ' + result.worstLateral.toFixed(0) + ' px from the centreline');

  if (unfinished.length) failures.push(difficulty + ': ' + unfinished.length + ' car(s) never finished');
  if (laps.length !== race.cars.length * 3) {
    failures.push(difficulty + ': expected ' + (race.cars.length * 3) + ' lap times, got ' + laps.length);
  }
  if (!(best > 9000 && slowest < 45000)) {
    failures.push(difficulty + ': lap times are not believable (' + best + '..' + slowest + ' ms)');
  }
  if (result.offTrackFraction > 0.16) {
    failures.push(difficulty + ': the field spends ' + (100 * result.offTrackFraction).toFixed(0) + '% off track');
  }
  if (result.worstLateral > track.halfWidth + 100) {
    failures.push(difficulty + ': a car got past the barrier (' + result.worstLateral.toFixed(0) + ' px)');
  }

  var positions = race.order.map(function (c) { return c.position; }).sort(function (a, b) { return a - b; });
  var expected = race.cars.map(function (_, i) { return i + 1; });
  if (positions.join(',') !== expected.join(',')) failures.push(difficulty + ': positions are not 1..N');

  race._paceBest = best;
});

/* Harder settings should actually be harder. */
var paces = {};
['relaxed', 'ruthless'].forEach(function (difficulty) {
  var r = runRace({ laps: 2, opponents: 4, difficulty: difficulty, seed: 99 });
  if (!r) return;
  var rivals = r.race.cars.filter(function (c) { return !c.isPlayer && c.bestLap; });
  paces[difficulty] = Math.min.apply(null, rivals.map(function (c) { return c.bestLap; }));
});
console.log('--- pace by difficulty');
console.log('  relaxed best : ' + util.formatTime(paces.relaxed));
console.log('  ruthless best: ' + util.formatTime(paces.ruthless));
if (!(paces.ruthless < paces.relaxed - 300)) {
  failures.push('ruthless rivals are not meaningfully quicker than relaxed ones');
}

/* A grid of one is a legal race too. */
var solo = runRace({ laps: 1, opponents: 0, difficulty: 'even', seed: 5 });
if (solo && !solo.race.player.finished) failures.push('a solo time trial never completes');
console.log('--- solo lap  : ' + util.formatTime(solo && solo.race.player.finishTime));

console.log('');
if (failures.length) { failures.forEach(function (f) { console.log('FAIL  ' + f); }); process.exit(1); }
console.log('PASS  the field races');
