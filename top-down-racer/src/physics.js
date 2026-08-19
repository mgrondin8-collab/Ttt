/* The car. Forces are resolved in the car's own frame: the heading is steered
   kinematically, but the velocity only follows it as fast as lateral grip
   allows — the gap between the two is what a slide is. */
(function (Racer) {
  'use strict';

  var util = Racer.util;
  var clamp = util.clamp;

  var SPEC = {
    length: 46,
    width: 22,
    wheelBase: 46,
    maxSteer: 0.55,          /* rad at a standstill */
    steerFalloff: 0.45,      /* fraction of that lost by top speed */
    steerRate: 7.0,          /* how fast the wheel reaches the input */
    engineAccel: 300,        /* px/s^2 */
    reverseAccel: 200,
    brakeAccel: 560,
    rollingResist: 0.25,     /* linear drag, 1/s */
    dragCoef: 0.00104,       /* quadratic drag, 1/px */
    gripAccel: 700,          /* px/s^2 the tyres can pull sideways */
    lateralBite: 14,         /* how hard grip fights lateral slip, 1/s */
    handbrakeGrip: 0.34,     /* grip multiplier with the handbrake on */
    handbrakeDrag: 320,
    topSpeed: 430,
    pxPerMetre: 8         /* the only place the world's scale is decided */
  };

  /* How the ground under each surface behaves. */
  var SURFACES = {
    tarmac: { grip: 1, drag: 1, power: 1 },
    kerb: { grip: 0.86, drag: 1.25, power: 1 },
    grass: { grip: 0.46, drag: 3.4, power: 0.55 }
  };

  function Car(opts) {
    this.spec = SPEC;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.heading = opts.heading || 0;
    this.vx = 0;
    this.vy = 0;
    this.steer = 0;               /* current wheel angle, rad */
    this.speed = 0;               /* |velocity|, px/s */
    this.forwardSpeed = 0;
    this.slip = 0;                /* lateral speed, px/s — how sideways it is */
    this.surface = 'tarmac';
    this.name = opts.name || 'Car';
    this.colour = opts.colour || '#e2e8f0';
    this.accent = opts.accent || '#0f172a';
    this.isPlayer = !!opts.isPlayer;

    /* Race bookkeeping, owned by game.js but carried on the car. */
    this.station = 0;
    this.lapsDone = 0;
    this.started = false;
    this.lapStart = 0;
    this.bestLap = null;
    this.lastLap = null;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = null;
    this.position = 1;
    this.progress = 0;            /* laps completed, plus fraction of this one */
    this.offTrackFor = 0;
  }

  Car.prototype.reset = function (x, y, heading) {
    this.x = x; this.y = y; this.heading = heading;
    this.vx = 0; this.vy = 0; this.steer = 0;
    this.speed = 0; this.forwardSpeed = 0; this.slip = 0;
    this.surface = 'tarmac';
    this.lapsDone = 0; this.started = false;
    this.bestLap = null; this.lastLap = null; this.lapTimes = [];
    this.finished = false; this.finishTime = null;
    this.offTrackFor = 0;
  };

  /* controls: { throttle, brake, steer, handbrake } — throttle/brake in [0,1],
     steer in [-1,1] with positive turning right. */
  Car.prototype.update = function (dt, controls, surfaceName) {
    var s = this.spec;
    var ground = SURFACES[surfaceName] || SURFACES.tarmac;
    this.surface = surfaceName;

    /* Forward speed in the frame the car is in *now*, which is what the
       steering rack responds to. */
    var cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    var forward = this.vx * cos + this.vy * sin;

    /* Steering eases toward the input, and tightens up less at speed so the
       car is not twitchy down the straight. */
    var speedFrac = clamp(Math.abs(forward) / s.topSpeed, 0, 1);
    var maxSteer = s.maxSteer * (1 - s.steerFalloff * speedFrac);
    var wanted = clamp(controls.steer || 0, -1, 1) * maxSteer;
    this.steer += clamp(wanted - this.steer, -s.steerRate * dt, s.steerRate * dt);
    this.steer = clamp(this.steer, -maxSteer, maxSteer);

    /* Kinematic bicycle: the body rotates whether or not the tyres can hold
       it. The velocity vector is deliberately left alone here — resolving it
       against the *new* heading below is what creates the slip angle, and
       with it the whole feel of the car. */
    var omega = (forward / s.wheelBase) * Math.tan(this.steer);
    this.heading += omega * dt;

    cos = Math.cos(this.heading); sin = Math.sin(this.heading);
    forward = this.vx * cos + this.vy * sin;
    var lateral = -this.vx * sin + this.vy * cos;

    var throttle = clamp(controls.throttle || 0, 0, 1);
    var brake = clamp(controls.brake || 0, 0, 1);
    var handbrake = !!controls.handbrake;

    var along = 0;
    if (brake > 0 && throttle === 0 && Math.abs(forward) < 6) {
      along -= s.reverseAccel * brake;            /* held at a stop: back up */
    } else if (brake > 0) {
      along -= s.brakeAccel * brake * (forward >= 0 ? 1 : -1);
    }
    along += s.engineAccel * throttle * ground.power;
    if (handbrake) along -= s.handbrakeDrag * (forward >= 0 ? 1 : -1);

    along -= forward * s.rollingResist * ground.drag;
    along -= s.dragCoef * forward * Math.abs(forward);

    /* Lateral grip pulls the slip out, but only as hard as the tyres can.
       Once the demand exceeds the cap the car simply keeps sliding. */
    var gripCap = s.gripAccel * ground.grip * (handbrake ? s.handbrakeGrip : 1);
    var across = clamp(-lateral * s.lateralBite, -gripCap, gripCap);

    forward += along * dt;
    lateral += across * dt;

    this.vx = forward * cos - lateral * sin;
    this.vy = forward * sin + lateral * cos;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.forwardSpeed = forward;
    this.slip = lateral;
    this.speed = Math.hypot(this.vx, this.vy);
    return this;
  };

  Racer.physics = { Car: Car, SPEC: SPEC, SURFACES: SURFACES };
})(globalThis.Racer = globalThis.Racer || {});
