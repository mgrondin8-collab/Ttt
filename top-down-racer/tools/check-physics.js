/* Behavioural checks on the car model: it should reach a sensible top speed,
   stop in a sensible distance, corner at a grip-limited radius, and slide
   when the handbrake is pulled. Run with: node tools/check-physics.js */
'use strict';

var path = require('path');
require(path.join(__dirname, '..', 'src', 'util.js'));
require(path.join(__dirname, '..', 'src', 'physics.js'));
var Car = globalThis.Racer.physics.Car;
var SPEC = globalThis.Racer.physics.SPEC;

var dt = 1 / 120;
var failures = [];

function drive(car, controls, seconds, surface) {
  var steps = Math.round(seconds / dt);
  for (var i = 0; i < steps; i++) car.update(dt, controls, surface || 'tarmac');
  return car;
}

/* Top speed and the time to get near it. */
var c = new Car({ x: 0, y: 0 });
var timeTo90 = null;
for (var i = 0; i < 120 * 30; i++) {
  c.update(dt, { throttle: 1 }, 'tarmac');
  if (timeTo90 === null && c.forwardSpeed >= 0.9 * SPEC.topSpeed) timeTo90 = i * dt;
}
console.log('top speed        : ' + c.forwardSpeed.toFixed(0) + ' px/s (spec ' + SPEC.topSpeed + ')');
console.log('to 90% top speed : ' + (timeTo90 === null ? 'never' : timeTo90.toFixed(1) + ' s'));
if (Math.abs(c.forwardSpeed - SPEC.topSpeed) > 25) failures.push('top speed misses the spec figure');
if (timeTo90 === null || timeTo90 < 1.5 || timeTo90 > 9) failures.push('acceleration feels wrong: ' + timeTo90);

/* Braking distance from top speed. */
var b = new Car({ x: 0, y: 0 });
drive(b, { throttle: 1 }, 20);
var startX = b.x, brakeTime = 0;
while (b.forwardSpeed > 5 && brakeTime < 20) { b.update(dt, { brake: 1 }, 'tarmac'); brakeTime += dt; }
console.log('braking          : ' + (b.x - startX).toFixed(0) + ' px in ' + brakeTime.toFixed(2) + ' s');
if (b.x - startX > 260 || b.x - startX < 60) failures.push('braking distance is off: ' + (b.x - startX).toFixed(0));

/* Steady-state cornering. Radius should fall out of the grip limit, and the
   car must be able to hold the tightest corner on the circuit (r = 147). */
function corneringRadius(targetSpeed) {
  var car = new Car({ x: 0, y: 0 });
  while (car.forwardSpeed < targetSpeed) car.update(dt, { throttle: 1 }, 'tarmac');
  /* settle into the corner */
  for (var k = 0; k < 120 * 3; k++) {
    car.update(dt, { throttle: car.forwardSpeed < targetSpeed ? 0.35 : 0, steer: 1 }, 'tarmac');
  }
  var h0 = car.heading, x0 = car.x, y0 = car.y, arc = 0, prev = h0;
  for (var j = 0; j < 120; j++) {
    car.update(dt, { throttle: car.forwardSpeed < targetSpeed ? 0.35 : 0, steer: 1 }, 'tarmac');
    arc += globalThis.Racer.util.angleDelta(prev, car.heading);
    prev = car.heading;
  }
  var chord = Math.hypot(car.x - x0, car.y - y0);
  return { radius: Math.abs(arc) > 1e-6 ? chord / (2 * Math.sin(Math.abs(arc) / 2)) : Infinity,
           speed: car.forwardSpeed, slip: Math.abs(car.slip) };
}

[150, 250, 350].forEach(function (v) {
  var r = corneringRadius(v);
  console.log('corner @ ' + String(v).padStart(3) + ' px/s : radius ' + r.radius.toFixed(0) +
              ' px, held ' + r.speed.toFixed(0) + ' px/s, slip ' + r.slip.toFixed(0));
  if (!isFinite(r.radius) || r.radius > 400) failures.push('the car cannot corner at ' + v);
});
var tight = corneringRadius(250);
if (tight.radius > 147) failures.push('the car cannot hold the tightest corner on the circuit');

/* The handbrake has to actually break traction. */
var g = new Car({ x: 0, y: 0 });
drive(g, { throttle: 1 }, 8);
drive(g, { steer: 1, throttle: 0.3 }, 0.6);
var gripSlip = Math.abs(g.slip);
var h = new Car({ x: 0, y: 0 });
drive(h, { throttle: 1 }, 8);
drive(h, { steer: 1, throttle: 0.3, handbrake: true }, 0.6);
console.log('slip gripping    : ' + gripSlip.toFixed(0) + ' px/s');
console.log('slip handbraked  : ' + Math.abs(h.slip).toFixed(0) + ' px/s');
if (Math.abs(h.slip) < gripSlip * 1.6) failures.push('the handbrake does not break traction');

/* Grass should cost real time. */
var t1 = new Car({ x: 0, y: 0 }); drive(t1, { throttle: 1 }, 6, 'tarmac');
var t2 = new Car({ x: 0, y: 0 }); drive(t2, { throttle: 1 }, 6, 'grass');
console.log('6 s on tarmac    : ' + t1.forwardSpeed.toFixed(0) + ' px/s');
console.log('6 s on grass     : ' + t2.forwardSpeed.toFixed(0) + ' px/s');
if (t2.forwardSpeed > 0.7 * t1.forwardSpeed) failures.push('going off track is not slow enough to matter');

/* Nothing may ever go non-finite, whatever it is asked to do. */
var f = new Car({ x: 0, y: 0 });
var seq = [{ throttle: 1 }, { brake: 1 }, { steer: 1, handbrake: true }, { steer: -1, throttle: 1 },
           { brake: 1, steer: 1 }, { throttle: 1, brake: 1, steer: -1, handbrake: true }];
for (var q = 0; q < 4000; q++) {
  f.update(dt, seq[q % seq.length], q % 3 === 0 ? 'grass' : 'tarmac');
  if (!isFinite(f.x) || !isFinite(f.y) || !isFinite(f.heading) || !isFinite(f.speed)) {
    failures.push('the car reached a non-finite state after ' + q + ' steps'); break;
  }
}
console.log('stability        : ' + (isFinite(f.x) && isFinite(f.speed) ? 'finite throughout' : 'BROKEN'));

console.log('');
if (failures.length) { failures.forEach(function (x) { console.log('FAIL  ' + x); }); process.exit(1); }
console.log('PASS  the car behaves');
