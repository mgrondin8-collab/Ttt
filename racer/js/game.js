/* game.js — the race itself: renderer, driving model, rivals and race rules.
   The camera lives where the driver's eyes are, so everything you see is
   from behind the wheel. */
(function () {
  'use strict';

  const { m4, MeshBuilder } = window.GLX;

  /* ---------------------------------------------------------------- shaders */

  const WORLD_VS = `
    attribute vec3 aPos;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec4 aColor;
    uniform mat4 uMVP;
    uniform mat4 uModel;
    uniform mat4 uView;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    varying float vDepth;
    void main() {
      gl_Position = uMVP * vec4(aPos, 1.0);
      vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
      vUV = aUV;
      vColor = aColor;
      vDepth = -(uView * (uModel * vec4(aPos, 1.0))).z;
    }`;

  const WORLD_FS = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    varying float vDepth;
    uniform sampler2D uTex;
    uniform float uUseTex;
    uniform vec3 uTint;
    uniform vec3 uLight;
    uniform float uAmbient;
    uniform vec3 uFog;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uUnlit;
    void main() {
      vec3 base = vColor.rgb * mix(vec3(1.0), uTint, vColor.a);
      if (uUseTex > 0.5) base *= texture2D(uTex, vUV).rgb;
      vec3 col = base;
      if (uUnlit < 0.5) {
        float d = max(dot(normalize(vNormal), uLight), 0.0);
        col = base * (uAmbient + (1.0 - uAmbient) * d);
      }
      float fog = uUnlit > 0.5 ? 0.0
        : clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
    }`;

  const SPRITE_VS = `
    attribute vec3 aCenter;
    attribute vec2 aOffset;
    attribute vec2 aUV;
    uniform mat4 uVP;
    uniform mat4 uView;
    uniform vec3 uRight;
    varying vec2 vUV;
    varying float vDepth;
    void main() {
      vec3 world = aCenter + uRight * aOffset.x + vec3(0.0, 1.0, 0.0) * aOffset.y;
      gl_Position = uVP * vec4(world, 1.0);
      vUV = aUV;
      vDepth = -(uView * vec4(world, 1.0)).z;
    }`;

  const SPRITE_FS = `
    precision mediump float;
    varying vec2 vUV;
    varying float vDepth;
    uniform sampler2D uTex;
    uniform vec3 uFog;
    uniform float uFogNear;
    uniform float uFogFar;
    void main() {
      vec4 t = texture2D(uTex, vUV);
      if (t.a < 0.45) discard;
      float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      gl_FragColor = vec4(mix(t.rgb * 0.94, uFog, fog), 1.0);
    }`;

  /* ---------------------------------------------------------------- setup */

  const FOG = [0.784, 0.847, 0.827];
  const FOG_NEAR = 150, FOG_FAR = 900;
  const LIGHT = (function () {
    const v = [-0.42, 0.78, 0.46];
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  })();

  const TOP_SPEED = 80;          // m/s at the rev limit; drag settles it near 68
  const RIVAL_TOP = 68;          // what a rival will actually run down a straight
  const WHEELBASE = 2.75;
  const CAR_HALF_W = 0.95, CAR_HALF_L = 2.3;
  const GEAR_TOPS = [15, 27, 40, 53, 66, 78];

  const el = id => document.getElementById(id);
  const canvas = el('view');
  const sound = window.Sound.create();

  let gl, worldProg, spriteProg;
  let tex = {}, mesh = {};
  let track = null;
  let barrierOffset = 0;

  const state = {
    phase: 'menu',            // menu | countdown | race | finished | paused
    laps: 3,
    skill: 0.94,
    time: 0,
    countdown: 0,
    cars: [],
    player: null,
    best: null,
    last: null,
    lookBack: false,
    shake: 0,
    mirrorRect: null
  };

  const input = { throttle: 0, brake: 0, steer: 0, hand: false, raw: {} };

  /* ---------------------------------------------------------------- world */

  function initGL() {
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;
    gl.getExtension('OES_element_index_uint');
    worldProg = window.GLX.program(gl, WORLD_VS, WORLD_FS);
    spriteProg = window.GLX.program(gl, SPRITE_VS, SPRITE_FS);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    return true;
  }

  function buildWorld() {
    const T = window.Textures;
    tex.asphalt = window.GLX.texture(gl, T.asphalt());
    tex.grass = window.GLX.texture(gl, T.grass());
    tex.chequer = window.GLX.texture(gl, T.chequer());
    tex.sky = window.GLX.texture(gl, T.sky(), { clampT: true });
    tex.pine = window.GLX.texture(gl, T.tree('pine'), { clamp: true });
    tex.round = window.GLX.texture(gl, T.tree('round'), { clamp: true });
    track = window.Track.build();
    barrierOffset = track.edge + 6;

    mesh.road = window.Meshes.road(gl, track);
    mesh.kerbs = window.Meshes.kerbs(gl, track);
    mesh.terrain = window.Meshes.terrain(gl, track);
    mesh.ground = window.Meshes.ground(gl, track);
    mesh.startLine = window.Meshes.startLine(gl, track);
    mesh.gantry = window.Meshes.gantry(gl, track);
    mesh.furniture = window.Meshes.furniture(gl, track);
    mesh.barriers = window.Meshes.barriers(gl, track, barrierOffset);
    mesh.car = window.Meshes.car(gl);
    mesh.sky = window.Meshes.sky(gl);
    const trees = track.scenery.trees;
    mesh.pines = window.Meshes.sprites(gl, trees.filter(t => t.kind === 'pine'));
    mesh.rounds = window.Meshes.sprites(gl, trees.filter(t => t.kind !== 'pine'));
  }

  /* ---------------------------------------------------------------- cars */

  const RIVALS = [
    { name: 'Vasquez', colour: [0.85, 0.16, 0.13], edge: 1.00 },
    { name: 'Okonkwo', colour: [0.15, 0.42, 0.85], edge: 0.985 },
    { name: 'Lindqvist', colour: [0.95, 0.72, 0.10], edge: 0.97 },
    { name: 'Barone', colour: [0.12, 0.62, 0.36], edge: 0.955 },
    { name: 'Sato', colour: [0.72, 0.24, 0.72], edge: 0.94 }
  ];

  function makePlayer() {
    return {
      isPlayer: true,
      name: 'You',
      colour: [0.92, 0.93, 0.95],
      x: 0, y: 0, z: 0, yaw: 0,
      vx: 0, vz: 0,
      speed: 0,
      slip: 0,
      pitch: 0, roll: 0,
      bounce: 0, bounceV: 0,
      hint: 0, dist: 0, lateral: 0,
      lap: 1, halfway: false, progress: 0,
      offRoad: false, onKerb: false,
      lapStart: 0, lapTimes: [], finishTime: null
    };
  }

  function makeRival(def, i) {
    return {
      isPlayer: false,
      name: def.name,
      colour: def.colour,
      edge: def.edge,
      x: 0, y: 0, z: 0, yaw: 0,
      dist: 0, lateral: 0, targetLateral: 0,
      speed: 0, lap: 1, halfway: false, progress: 0,
      bias: ((i % 2) ? 1 : -1) * (1.2 + (i * 0.5) % 2.4),
      wobble: Math.random() * Math.PI * 2,
      lapStart: 0, lapTimes: [], finishTime: null,
      pitch: 0, roll: 0
    };
  }

  function gridSlot(i) {
    // Row of two, the player at the back of the grid.
    const row = Math.floor(i / 2), side = (i % 2) ? 1 : -1;
    return { dist: -14 - row * 9, lateral: side * 3.1 };
  }

  function placeOnTrack(car, dist, lateral) {
    const s = track.sample(dist);
    const p = track.points[s.index];
    car.x = s.x + p.nxv * lateral;
    car.z = s.z + p.nzv * lateral;
    car.y = track.verticalOffset(s.y, lateral, car.x, car.z);
    car.yaw = s.yaw;
    car.dist = (dist % track.length + track.length) % track.length;
    car.lateral = lateral;
    car.hint = s.index;
    car.pitch = -s.slope;
  }

  function resetRace() {
    state.cars = [];
    const player = makePlayer();
    const order = RIVALS.map(makeRival);
    order.forEach((c, i) => {
      const slot = gridSlot(i);
      placeOnTrack(c, slot.dist, slot.lateral);
      c.speed = 0;
      c.targetLateral = slot.lateral;
      state.cars.push(c);
    });
    const pslot = gridSlot(RIVALS.length);
    placeOnTrack(player, pslot.dist, pslot.lateral);
    player.vx = player.vz = 0;
    state.cars.push(player);
    state.player = player;
    state.time = 0;
    state.best = null;
    state.last = null;
    state.shake = 0;
    for (const c of state.cars) { c.lap = 1; c.halfway = false; c.lapStart = 0; c.lapTimes = []; c.finishTime = null; c.progress = c.dist - track.length; }
  }

  /* ---------------------------------------------------------------- driving */

  function updatePlayer(car, dt) {
    const racing = state.phase === 'race';
    const coasting = state.phase === 'finished';
    const throttle = racing ? input.throttle : 0;
    const brake = racing ? input.brake : (coasting ? 0.3 : 1);

    // Velocity in the car's own frame: forward is -Z at yaw 0.
    const fx = Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw), rz = Math.sin(car.yaw);
    let vf = car.vx * fx + car.vz * fz;
    let vl = car.vx * rx + car.vz * rz;

    const surface = car.offRoad ? 'grass' : (car.onKerb ? 'kerb' : 'road');
    const grip = surface === 'grass' ? 7 : surface === 'kerb' ? 11.5 : 16.5;
    // Sideways bite. The handbrake takes most of it away, which is what lets
    // the back step out without changing how fast the car can rotate.
    const gripLat = grip * (input.hand ? 0.34 : 1);
    const rollResist = surface === 'grass' ? 3.5 : surface === 'kerb' ? 0.9 : 0.28;
    const drivePower = surface === 'grass' ? 6.5 : 11;

    /* Engine, air drag and rolling resistance. Drive falls away towards the
       rev limit and drag climbs with the square of speed, so the two meet at
       about 245 km/h on tarmac and 115 on the grass. */
    const drive = throttle * drivePower * Math.max(0, 1 - vf / TOP_SPEED);
    vf += (drive - 0.0003 * vf * Math.abs(vf)) * dt;
    const rr = rollResist * dt;
    if (Math.abs(vf) <= rr) vf = 0; else vf -= Math.sign(vf) * rr;
    if (brake > 0) {
      if (vf > 0.4) vf = Math.max(0, vf - brake * 24 * dt);
      else vf = Math.max(-9, vf - brake * 7 * dt);   // hold brake at rest to reverse
    }
    if (input.hand) vf = Math.max(0, vf - 12 * dt);

    /* Steering. The front wheels can only turn the car as hard as the tyres
       will hold, so the rate is capped by grip over speed: ask for more than
       that and the car understeers instead of spinning on the spot. */
    const lock = 0.52 / (1 + Math.abs(vf) * 0.05);
    const steerAngle = input.steer * lock;
    let yawRate = (Math.abs(vf) < 0.3) ? 0 : (vf / WHEELBASE) * Math.tan(steerAngle);
    const maxYaw = grip / Math.max(Math.abs(vf), 4);
    yawRate = Math.max(-maxYaw, Math.min(maxYaw, yawRate));
    car.yaw += yawRate * dt;

    // Rebuild the world velocity around the new heading, then let the tyres
    // scrub off whatever sideways speed they can hold.
    const nfx = Math.sin(car.yaw), nfz = -Math.cos(car.yaw);
    const nrx = Math.cos(car.yaw), nrz = Math.sin(car.yaw);
    if (!racing && !coasting) { vf = 0; vl = 0; }   // held on the grid
    const bite = gripLat * dt;
    if (Math.abs(vl) <= bite) vl = 0; else vl -= Math.sign(vl) * bite;
    vf -= Math.min(Math.abs(vf), Math.abs(vl) * 0.25 * dt) * Math.sign(vf);

    car.vx = nfx * vf + nrx * vl;
    car.vz = nfz * vf + nrz * vl;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.speed = vf;
    car.slip = Math.abs(vl);

    // Where are we on the track now?
    const pr = track.project(car.x, car.z, car.hint);
    car.hint = pr.index;
    car.lateral = pr.lateral;
    car.dist = pr.dist;
    const roadY = pr.point.y + pr.point.slope * pr.along;
    const absLat = Math.abs(pr.lateral);
    car.offRoad = absLat > track.edge;
    car.onKerb = !car.offRoad && absLat > track.roadHalf;

    // Guardrails.
    const limit = barrierOffset - CAR_HALF_W;
    if (absLat > limit) {
      const side = Math.sign(pr.lateral);
      const p = pr.point;
      const nx = p.nxv * side, nz = p.nzv * side;
      car.x -= nx * (absLat - limit);
      car.z -= nz * (absLat - limit);
      const into = car.vx * nx + car.vz * nz;
      if (into > 0) {
        car.vx -= into * 1.35 * nx;
        car.vz -= into * 1.35 * nz;
        car.vx *= 0.72; car.vz *= 0.72;
        const bang = Math.min(1, into / 22);
        if (bang > 0.06) { hit(bang); }
      }
      car.lateral = limit * side;
    }

    // Suspension: a light spring under the driver, poked by kerbs and grass.
    const ground = track.verticalOffset(roadY, pr.lateral, car.x, car.z);
    const rumble = car.onKerb ? Math.sin(car.dist * 5.2) * 0.055 * Math.min(1, Math.abs(vf) / 12)
      : car.offRoad ? (Math.random() - 0.5) * 0.08 * Math.min(1, Math.abs(vf) / 14) : 0;
    car.bounceV += (-(car.bounce) * 120 - car.bounceV * 13) * dt;
    car.bounceV += rumble * 8;
    car.bounce += car.bounceV * dt;
    car.bounce = Math.max(-0.16, Math.min(0.16, car.bounce));
    car.y = ground;
    car.pitch = -pr.point.slope;
    car.roll = Math.max(-0.09, Math.min(0.09, -(vl) * 0.012));

    trackLaps(car);
  }

  function hit(strength) {
    state.shake = Math.max(state.shake, 0.25 + strength * 0.75);
    sound.thud(strength);
    const flash = el('flash');
    flash.classList.remove('is-hit');
    void flash.offsetWidth;
    flash.classList.add('is-hit');
  }

  /* Rivals drive the racing line: they aim for the inside of whatever is
     coming, brake for it in advance, and shuffle sideways to avoid company. */
  function updateRival(car, dt) {
    if (state.phase !== 'race' && state.phase !== 'finished') return;
    const L = track.length;

    let worst = 0;
    for (let ahead = 8; ahead < 95; ahead += 9) {
      const s = track.sample(car.dist + ahead);
      const weight = 1 - ahead / 150;
      worst = Math.max(worst, Math.abs(s.curve) * weight);
    }
    const cornerSpeed = worst > 0.0006 ? Math.sqrt(15.5 * state.skill * car.edge / worst) : RIVAL_TOP;
    let target = Math.min(RIVAL_TOP * state.skill * car.edge, cornerSpeed);
    // Once a driver has taken the flag they wind it down on the slowing lap.
    if (state.phase === 'finished' || car.finishTime !== null) target *= 0.5;

    const accel = car.speed < target ? 1.5 + 9 * (1 - car.speed / TOP_SPEED) : -20;
    car.speed += accel * dt;
    car.speed = Math.max(3, Math.min(car.speed, RIVAL_TOP));

    // Racing line: hug the inside of the bend just ahead of the nose.
    const ahead = track.sample(car.dist + 30 + car.speed * 0.5);
    car.wobble += dt * 0.7;
    let want = Math.max(-4.2, Math.min(4.2, ahead.curve * 420)) + car.bias * 0.35
      + Math.sin(car.wobble) * 0.35;

    // Give way rather than drive through anyone in front.
    for (const other of state.cars) {
      if (other === car) continue;
      let gap = other.dist - car.dist;
      if (gap > L / 2) gap -= L;
      if (gap < -L / 2) gap += L;
      if (gap > 0 && gap < 16 && Math.abs(other.lateral - car.lateral) < 3.2) {
        want += (car.lateral - other.lateral >= 0 ? 1 : -1) * 3.4;
        car.speed -= 5 * dt * (1 - gap / 16);
      }
    }
    want = Math.max(-track.roadHalf + 1.2, Math.min(track.roadHalf - 1.2, want));
    car.targetLateral += (want - car.targetLateral) * Math.min(1, dt * 1.8);
    car.lateral += (car.targetLateral - car.lateral) * Math.min(1, dt * 2.4);

    car.dist += car.speed * dt;
    if (car.dist >= L) { car.dist -= L; }
    const s = track.sample(car.dist);
    const p = track.points[s.index];
    car.x = s.x + p.nxv * car.lateral;
    car.z = s.z + p.nzv * car.lateral;
    car.y = s.y;
    car.yaw = s.yaw + s.curve * car.lateral * 0.5;
    car.pitch = -s.slope;
    car.roll = Math.max(-0.07, Math.min(0.07, s.curve * car.speed * car.speed * 0.0012));
    trackLaps(car);
  }

  /* Lap bookkeeping, shared by everyone on track. */
  function trackLaps(car) {
    const L = track.length;
    if (!car.halfway && car.dist > L * 0.45 && car.dist < L * 0.75) car.halfway = true;
    if (car.halfway && car.dist < L * 0.15 && car.prevDist > L * 0.75) {
      car.halfway = false;
      const t = state.time;
      const lapTime = t - car.lapStart;
      car.lapStart = t;
      car.lapTimes.push(lapTime);
      car.lap += 1;
      if (car.isPlayer) {
        state.last = lapTime;
        if (state.best === null || lapTime < state.best) {
          state.best = lapTime;
          const record = readRecord();
          if (record === null || lapTime < record) {
            writeRecord(lapTime);
            toast('Track record  ' + formatTime(lapTime));
          } else {
            toast('Best lap  ' + formatTime(lapTime));
          }
        } else {
          toast('Lap ' + formatTime(lapTime));
        }
        sound.beep(760, 0.16);
      }
      if (car.lap > state.laps && car.finishTime === null) {
        car.finishTime = t;
        if (car.isPlayer) finishRace();
      }
    }
    car.prevDist = car.dist;
    car.progress = (car.lap - 1) * L + car.dist;
  }

  /* Cars are solid: shove them apart and take the speed out of both. */
  function resolveContacts() {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const min = 3.2;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const push = (min - d) / 2;
        if (a.isPlayer || b.isPlayer) {
          const player = a.isPlayer ? a : b;
          const rival = a.isPlayer ? b : a;
          // Unit vector pointing from the rival towards the player.
          const awayX = a.isPlayer ? -nx : nx;
          const awayZ = a.isPlayer ? -nz : nz;
          player.x += awayX * push * 1.4;
          player.z += awayZ * push * 1.4;
          const closing = -(player.vx * awayX + player.vz * awayZ);
          if (closing > 0) {
            player.vx += awayX * closing * 1.1;
            player.vz += awayZ * closing * 1.1;
            player.vx *= 0.88; player.vz *= 0.88;
            hit(Math.min(1, closing / 26));
          }
          // Rivals live in track coordinates, so nudge them sideways there.
          const side = Math.sign(rival.lateral - player.lateral) || 1;
          rival.lateral += side * push * 0.6;
          rival.targetLateral = rival.lateral;
          rival.speed *= 0.97;
        } else {
          a.lateral -= push * 0.5 * Math.sign(b.lateral - a.lateral || 1);
          b.lateral += push * 0.5 * Math.sign(b.lateral - a.lateral || 1);
          a.speed *= 0.995; b.speed *= 0.995;
        }
      }
    }
  }

  function standings() {
    return state.cars.slice().sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.progress - a.progress;
    });
  }

  /* ---------------------------------------------------------------- camera */

  function cameraFor(car, back) {
    // Driver's eyes: left of centre, up at screen height, just behind the
    // windscreen. Add the bounce and a little shake from contact.
    const fx = Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw), rz = Math.sin(car.yaw);
    const shake = state.shake;
    const jitterX = shake * (Math.random() - 0.5) * 0.5;
    const jitterY = shake * (Math.random() - 0.5) * 0.5;
    return {
      x: car.x - rx * 0.34 + fx * 0.15 + jitterX,
      y: car.y + 1.14 + car.bounce + jitterY,
      z: car.z - rz * 0.34 + fz * 0.15,
      yaw: car.yaw + (back ? Math.PI : 0) + car.roll * 0.15,
      pitch: (back ? -car.pitch : car.pitch) + car.bounce * 0.35 + shake * (Math.random() - 0.5) * 0.02,
      roll: back ? -car.roll : car.roll
    };
  }

  /* ---------------------------------------------------------------- render */

  const matMVP = m4.create(), matVP = m4.create(), matModel = m4.create();
  const matProj = m4.create(), matView = m4.create();

  function setCommon(prog) {
    gl.uniform3fv(prog.uniform.uFog, FOG);
    gl.uniform1f(prog.uniform.uFogNear, FOG_NEAR);
    gl.uniform1f(prog.uniform.uFogFar, FOG_FAR);
  }

  function drawMesh(m, texture, options) {
    const o = options || {};
    window.GLX.bindMesh(gl, worldProg, m);
    gl.uniformMatrix4fv(worldProg.uniform.uModel, false, o.model || identity);
    m4.multiply(matMVP, matVP, o.model || identity);
    gl.uniformMatrix4fv(worldProg.uniform.uMVP, false, matMVP);
    gl.uniform1f(worldProg.uniform.uUseTex, texture ? 1 : 0);
    gl.uniform1f(worldProg.uniform.uUnlit, o.unlit ? 1 : 0);
    gl.uniform3fv(worldProg.uniform.uTint, o.tint || WHITE);
    gl.uniform1f(worldProg.uniform.uAmbient, o.ambient === undefined ? 0.62 : o.ambient);
    if (texture) gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
  }

  const identity = m4.create();
  const WHITE = new Float32Array([1, 1, 1]);

  function renderScene(cam, aspect, fov, mirrored) {
    m4.perspective(matProj, fov, aspect, 0.35, 3000);
    if (mirrored) { matProj[0] = -matProj[0]; }
    m4.view(matView, cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll);
    m4.multiply(matVP, matProj, matView);

    gl.cullFace(mirrored ? gl.FRONT : gl.BACK);
    gl.useProgram(worldProg.program);
    setCommon(worldProg);
    gl.uniformMatrix4fv(worldProg.uniform.uView, false, matView);
    gl.uniform3fv(worldProg.uniform.uLight, LIGHT);
    gl.uniform1i(worldProg.uniform.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    drawMesh(mesh.ground, tex.grass, { ambient: 0.7 });
    drawMesh(mesh.terrain, tex.grass, { ambient: 0.72 });
    drawMesh(mesh.road, tex.asphalt, { ambient: 0.74 });
    drawMesh(mesh.startLine, tex.chequer, { ambient: 0.8 });
    drawMesh(mesh.kerbs, null, { ambient: 0.72 });
    drawMesh(mesh.barriers, null, { ambient: 0.6 });
    drawMesh(mesh.furniture, null, { ambient: 0.58 });
    drawMesh(mesh.gantry, null, { ambient: 0.55 });

    for (const car of state.cars) {
      if (car.isPlayer) continue;      // you are sitting in it, not looking at it
      m4.compose(matModel, car.x, car.y, car.z, car.yaw, car.pitch, car.roll, 1);
      drawMesh(mesh.car, null, { model: matModel, tint: car.colour, ambient: 0.5 });
    }

    // Trees last: they are alpha-cut billboards.
    gl.useProgram(spriteProg.program);
    setCommon(spriteProg);
    gl.uniformMatrix4fv(spriteProg.uniform.uVP, false, matVP);
    gl.uniformMatrix4fv(spriteProg.uniform.uView, false, matView);
    const right = [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)];
    gl.uniform3fv(spriteProg.uniform.uRight, new Float32Array(right));
    gl.uniform1i(spriteProg.uniform.uTex, 0);
    drawSprites(mesh.pines, tex.pine);
    drawSprites(mesh.rounds, tex.round);

    /* Sky last, pinned to the camera and depth-tested, so it only shades the
       pixels the world did not already cover. */
    gl.useProgram(worldProg.program);
    setCommon(worldProg);
    gl.uniformMatrix4fv(worldProg.uniform.uView, false, matView);
    gl.uniform1i(worldProg.uniform.uTex, 0);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);            // the dome is seen from the inside
    m4.fromTranslation(matModel, cam.x, cam.y, cam.z);
    drawMesh(mesh.sky, tex.sky, { model: matModel, unlit: true });
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  function drawSprites(m, texture) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    const a = spriteProg.attrib;
    gl.enableVertexAttribArray(a.aCenter);
    gl.vertexAttribPointer(a.aCenter, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(a.aOffset);
    gl.vertexAttribPointer(a.aOffset, 2, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(a.aUV);
    gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, 28, 20);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    gl.disableVertexAttribArray(a.aCenter);
    gl.disableVertexAttribArray(a.aOffset);
    gl.disableVertexAttribArray(a.aUV);
  }

  function render() {
    const w = canvas.width, h = canvas.height;
    const car = state.player;
    const speedFactor = Math.min(1, Math.abs(car.speed) / TOP_SPEED);
    // The view opens up with speed, which is the oldest trick in racing games.
    const fov = (50 + speedFactor * 13) * Math.PI / 180;

    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    renderScene(cameraFor(car, state.lookBack), w / h, fov, false);

    // The mirror: the same world again, looking the other way, drawn into
    // the rectangle the mirror frame leaves open.
    const r = state.mirrorRect;
    if (r && !state.lookBack && r.w > 8 && r.h > 8) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(r.x, r.y, r.w, r.h);
      gl.viewport(r.x, r.y, r.w, r.h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      /* A mirror is a wide, shallow window: fix how much of the world it
         shows across, and let its height follow from the shape of the glass. */
      const aspect = r.w / r.h;
      const across = 64 * Math.PI / 180;
      renderScene(cameraFor(car, true), aspect, 2 * Math.atan(Math.tan(across / 2) / aspect), true);
      gl.disable(gl.SCISSOR_TEST);
      gl.cullFace(gl.BACK);
    }
  }

  /* ---------------------------------------------------------------- HUD */

  const dom = {
    lap: el('lap'), place: el('place'), laptime: el('laptime'),
    best: el('best'), last: el('last'), gear: el('gear'),
    speedDigital: el('speed-digital'),
    tachNeedle: el('tach-needle'), speedNeedle: el('speed-needle'),
    map: el('map'), toast: el('toast'),
    screen: el('screen'), lights: el('lights'),
    wheel: el('wheel'), readouts: el('readouts'),
    pieces: [].slice.call(document.querySelectorAll('.cp--dash, .cp--console, .cp--roof, .cp--pillar'))
  };

  /* The one thing worth keeping between visits: your best lap here. */
  const RECORD_KEY = 'apex-drive-best-lap';

  function readRecord() {
    try {
      const v = parseFloat(localStorage.getItem(RECORD_KEY));
      return isFinite(v) && v > 0 ? v : null;
    } catch (err) {
      return null;                 // private mode, or storage turned off
    }
  }

  function writeRecord(t) {
    try { localStorage.setItem(RECORD_KEY, String(t)); } catch (err) { /* never mind */ }
  }

  function formatTime(t) {
    if (t === null || t === undefined) return '—:—.—';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function buildDials() {
    const tach = el('tach-ticks'), speed = el('speed-ticks');
    const NS = 'http://www.w3.org/2000/svg';
    const arc = (t) => (-125 + t * 250) * Math.PI / 180;
    for (let i = 0; i <= 9; i++) {
      const a = arc(i / 9);
      const line = document.createElementNS(NS, 'line');
      const r0 = 78, r1 = 95;
      line.setAttribute('x1', Math.sin(a) * r0); line.setAttribute('y1', -Math.cos(a) * r0);
      line.setAttribute('x2', Math.sin(a) * r1); line.setAttribute('y2', -Math.cos(a) * r1);
      line.setAttribute('class', 'tick');
      tach.appendChild(line);
      const num = document.createElementNS(NS, 'text');
      num.setAttribute('x', Math.sin(a) * 60); num.setAttribute('y', -Math.cos(a) * 60);
      num.setAttribute('class', 'tick-num');
      num.textContent = String(i);
      tach.appendChild(num);
    }
    const red = el('tach-redline');
    const a0 = arc(7.5 / 9), a1 = arc(1);
    const R = 96;
    red.setAttribute('d', 'M' + Math.sin(a0) * R + ' ' + (-Math.cos(a0) * R) +
      ' A' + R + ' ' + R + ' 0 0 1 ' + Math.sin(a1) * R + ' ' + (-Math.cos(a1) * R));

    for (let v = 0; v <= 300; v += 25) {
      const a = arc(v / 300);
      const major = v % 50 === 0;
      const line = document.createElementNS(NS, 'line');
      const r0 = major ? 64 : 71, r1 = 81;
      line.setAttribute('x1', Math.sin(a) * r0); line.setAttribute('y1', -Math.cos(a) * r0);
      line.setAttribute('x2', Math.sin(a) * r1); line.setAttribute('y2', -Math.cos(a) * r1);
      line.setAttribute('class', major ? 'tick' : 'tick--minor tick');
      speed.appendChild(line);
      if (major && v % 100 === 0) {
        const num = document.createElementNS(NS, 'text');
        num.setAttribute('x', Math.sin(a) * 50); num.setAttribute('y', -Math.cos(a) * 50);
        num.setAttribute('class', 'tick-num');
        num.textContent = String(v);
        speed.appendChild(num);
      }
    }
  }

  function gearAndRevs(speed) {
    const v = Math.abs(speed);
    if (speed < -0.5) return { gear: 'R', revs: Math.min(1, v / 9) * 0.55 };
    let gear = 0;
    while (gear < GEAR_TOPS.length - 1 && v > GEAR_TOPS[gear]) gear++;
    const bottom = gear === 0 ? 0 : GEAR_TOPS[gear - 1];
    const span = GEAR_TOPS[gear] - bottom;
    const revs = 0.2 + 0.78 * Math.min(1, (v - bottom) / span);
    if (v < 0.6) return { gear: 'N', revs: 0.13 + input.throttle * 0.3 };
    return { gear: String(gear + 1), revs };
  }

  let hudClock = 0;
  function updateHUD(dt) {
    const car = state.player;
    const kmh = Math.abs(car.speed) * 3.6;
    const gr = gearAndRevs(car.speed);
    dom.speedNeedle.setAttribute('transform', 'rotate(' + (-125 + Math.min(kmh, 300) / 300 * 250) + ')');
    dom.tachNeedle.setAttribute('transform', 'rotate(' + (-125 + gr.revs * 250) + ')');
    dom.gear.textContent = gr.gear;
    dom.gear.parentNode.classList.toggle('is-reverse', gr.gear === 'R');
    dom.speedDigital.textContent = Math.round(kmh);

    /* The cockpit leans and bobs with the car, which is most of what sells
       the sense of sitting in it. Each piece is moved on its own so the
       browser can shift finished layers around instead of redrawing them. */
    const lean = Math.max(-1, Math.min(1, car.roll * 8 + input.steer * 0.25));
    const lift = car.bounce * 90 + state.shake * (Math.random() - 0.5) * 14;
    const shift = 'translate3d(' + (-lean * 15).toFixed(1) + 'px,' + lift.toFixed(1) + 'px,0)';
    for (let i = 0; i < dom.pieces.length; i++) dom.pieces[i].style.transform = shift;
    dom.readouts.style.transform = shift;
    dom.wheel.style.transform = shift + ' rotate(' + (input.steer * 118).toFixed(1) + 'deg)';

    hudClock += dt;
    if (hudClock < 0.06) return;
    hudClock = 0;
    const order = standings();
    const place = order.indexOf(car) + 1;
    dom.lap.innerHTML = Math.min(car.lap, state.laps) + '<i>/' + state.laps + '</i>';
    dom.place.innerHTML = place + '<i>/' + state.cars.length + '</i>';
    dom.laptime.textContent = formatTime(Math.max(0, state.time - car.lapStart));
    dom.best.textContent = formatTime(state.best);
    dom.last.textContent = formatTime(state.last);
    drawMap();
  }

  let mapPath = null;
  function drawMap() {
    const c = dom.map, ctx = c.getContext('2d');
    if (!mapPath) {
      // Work out the mapping from world metres to the little canvas once.
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of track.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const pad = 16;
      const scale = Math.min((c.width - pad * 2) / (maxX - minX), (c.height - pad * 2) / (maxZ - minZ));
      const to = (x, z) => [
        pad + (x - minX) * scale + (c.width - pad * 2 - (maxX - minX) * scale) / 2,
        c.height - (pad + (z - minZ) * scale + (c.height - pad * 2 - (maxZ - minZ) * scale) / 2)
      ];
      const outline = new Path2D();
      for (let i = 0; i < track.count; i += 3) {
        const [x, y] = to(track.points[i].x, track.points[i].z);
        if (i === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
      }
      outline.closePath();
      mapPath = { to, outline };
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 7;
    ctx.stroke(mapPath.outline);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke(mapPath.outline);
    const [sx, sy] = mapPath.to(track.points[0].x, track.points[0].z);
    ctx.fillStyle = '#ffb648';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    for (const car of state.cars) {
      const [x, y] = mapPath.to(car.x, car.z);
      ctx.beginPath();
      ctx.arc(x, y, car.isPlayer ? 4.5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = car.isPlayer ? '#ffffff'
        : 'rgb(' + car.colour.map(v => Math.round(v * 255)).join(',') + ')';
      ctx.fill();
      if (car.isPlayer) { ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  let toastTimer = 0;
  function toast(text) {
    dom.toast.textContent = text;
    dom.toast.hidden = false;
    toastTimer = 2.2;
  }

  /* ---------------------------------------------------------------- flow */

  function startRace() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    resetRace();
    sound.start();
    sound.resume();
    dom.screen.hidden = true;
    dom.lights.hidden = false;
    dom.lights.classList.remove('go');
    [].forEach.call(dom.lights.children, s => s.classList.remove('on'));
    state.phase = 'countdown';
    state.countdown = 5.4;
    mapPath = null;
  }

  function finishRace() {
    state.phase = 'finished';
    const order = standings();
    const place = order.indexOf(state.player) + 1;
    const you = state.player;
    const rows = order.map((c, i) => {
      const best = c.lapTimes.length ? Math.min.apply(null, c.lapTimes) : null;
      // Anyone still out on track is shown by how far behind they are.
      const behind = (you.progress - c.progress) / Math.max(c.speed, 25);
      const result = c.finishTime !== null ? formatTime(c.finishTime)
        : '+' + behind.toFixed(1) + 's';
      return '<tr class="' + (c.isPlayer ? 'is-you' : '') + '"><td>' + (i + 1) +
        '</td><td>' + c.name + '</td><td>' + result +
        '</td><td>' + formatTime(best) + '</td></tr>';
    }).join('');
    dom.screen.innerHTML =
      '<div class="screen__card">' +
      '<p class="screen__eyebrow">Chequered flag</p>' +
      '<h1 class="screen__title">' + (place === 1 ? 'Race won' : 'P' + place) + '</h1>' +
      '<p class="screen__blurb">' + state.laps + ' lap' + (state.laps > 1 ? 's' : '') +
      ' of Apex Drive. Your best was ' + formatTime(state.best) + '.</p>' +
      '<table class="results"><tr><th></th><th>Driver</th><th>Race</th><th>Best lap</th></tr>' +
      rows + '</table>' +
      '<button type="button" class="start" id="again">Race again</button></div>';
    dom.screen.hidden = false;
    el('again').addEventListener('click', () => {
      dom.screen.innerHTML = menuHTML;
      wireMenu();
      dom.screen.hidden = true;
      startRace();
    });
    sound.beep(520, 0.5);
  }

  function togglePause() {
    if (state.phase === 'race') {
      state.phase = 'paused';
      dom.screen.innerHTML =
        '<div class="screen__card"><p class="screen__eyebrow">Paused</p>' +
        '<h1 class="screen__title">Take a breath</h1>' +
        '<p class="screen__blurb">The race is waiting. Press P to go again, or restart from the grid.</p>' +
        '<button type="button" class="start" id="resume">Resume</button> ' +
        '<button type="button" class="choice" id="quit" style="margin-left:10px">Back to grid</button></div>';
      dom.screen.hidden = false;
      el('resume').addEventListener('click', togglePause);
      el('quit').addEventListener('click', () => {
        dom.screen.innerHTML = menuHTML;
        wireMenu();
        state.phase = 'menu';
        resetRace();
      });
    } else if (state.phase === 'paused') {
      dom.screen.hidden = true;
      state.phase = 'race';
    }
  }

  function respawn() {
    const car = state.player;
    const pr = track.project(car.x, car.z, car.hint);
    const lateral = Math.max(-3, Math.min(3, pr.lateral));
    placeOnTrack(car, pr.dist - 6, lateral);
    car.vx = 0; car.vz = 0; car.speed = 0; car.bounce = 0; car.bounceV = 0;
    toast('Back on track');
  }

  /* ---------------------------------------------------------------- input */

  const KEYS = {
    ArrowUp: 'gas', KeyW: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'hand', KeyB: 'look'
  };

  function bindInput() {
    addEventListener('keydown', e => {
      if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); e.preventDefault(); return; }
      if (e.code === 'KeyM') { toast(sound.toggle() ? 'Sound on' : 'Sound off'); return; }
      if (e.code === 'KeyR' && state.phase === 'race') { respawn(); return; }
      const k = KEYS[e.code];
      if (!k) return;
      input.raw[k] = true;
      e.preventDefault();
    }, { passive: false });

    addEventListener('keyup', e => {
      const k = KEYS[e.code];
      if (k) { input.raw[k] = false; e.preventDefault(); }
    }, { passive: false });

    addEventListener('blur', () => { input.raw = {}; });

    // Touch pads map straight onto the same flags.
    const padKeys = { ArrowUp: 'gas', ArrowDown: 'brake', ArrowLeft: 'left', ArrowRight: 'right' };
    [].forEach.call(document.querySelectorAll('.pad'), pad => {
      const k = padKeys[pad.dataset.key];
      const down = e => { input.raw[k] = true; pad.classList.add('is-down'); e.preventDefault(); };
      const up = e => { input.raw[k] = false; pad.classList.remove('is-down'); e.preventDefault(); };
      pad.addEventListener('pointerdown', down);
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
      pad.addEventListener('pointerleave', up);
      pad.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  function readInput(dt) {
    const target = (input.raw.right ? 1 : 0) - (input.raw.left ? 1 : 0);
    // Ease the steering in and let it centre itself, so taps are usable.
    const rate = target === 0 ? 7 : 4.5;
    input.steer += (target - input.steer) * Math.min(1, dt * rate);
    if (Math.abs(input.steer) < 0.004) input.steer = 0;
    input.throttle += ((input.raw.gas ? 1 : 0) - input.throttle) * Math.min(1, dt * 9);
    input.brake += ((input.raw.brake ? 1 : 0) - input.brake) * Math.min(1, dt * 12);
    input.hand = !!input.raw.hand;
    state.lookBack = !!input.raw.look;
  }

  /* ---------------------------------------------------------------- menu */

  let menuHTML = '';

  function wireMenu() {
    const lapsChoice = el('laps-choice'), skillChoice = el('skill-choice');
    if (lapsChoice) {
      lapsChoice.addEventListener('click', e => {
        const b = e.target.closest('.choice');
        if (!b) return;
        [].forEach.call(lapsChoice.children, c => c.classList.toggle('is-on', c === b));
        state.laps = parseInt(b.dataset.laps, 10);
      });
    }
    if (skillChoice) {
      skillChoice.addEventListener('click', e => {
        const b = e.target.closest('.choice');
        if (!b) return;
        [].forEach.call(skillChoice.children, c => c.classList.toggle('is-on', c === b));
        state.skill = parseFloat(b.dataset.skill);
      });
    }
    const start = el('start');
    if (start) start.addEventListener('click', startRace);
    const record = el('record');
    if (record) {
      const best = readRecord();
      record.innerHTML = best === null ? 'No lap of this circuit recorded yet.'
        : 'Your track record here: <b>' + formatTime(best) + '</b>';
    }
  }

  /* ---------------------------------------------------------------- loop */

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    const glass = el('mirror-glass').getBoundingClientRect();
    state.mirrorRect = {
      x: Math.round(glass.left * dpr),
      y: Math.round((innerHeight - glass.bottom) * dpr),
      w: Math.round(glass.width * dpr),
      h: Math.round(glass.height * dpr)
    };
  }

  const STEP = 1 / 120;
  let acc = 0, prev = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    let dt = prev ? Math.min(t - prev, 0.1) : 0;
    prev = t;

    readInput(dt);

    if (state.phase === 'countdown') {
      const before = Math.ceil(state.countdown - 0.4);
      state.countdown -= dt;
      const after = Math.ceil(state.countdown - 0.4);
      if (after !== before) {
        const lit = 5 - Math.max(0, after);
        [].forEach.call(dom.lights.children, (s, i) => s.classList.toggle('on', i < lit));
        if (after >= 0 && after < 5) sound.beep(440, 0.16);
      }
      if (state.countdown <= 0.4 && !dom.lights.classList.contains('go')) {
        dom.lights.classList.add('go');
        sound.beep(880, 0.5);
      }
      if (state.countdown <= 0) {
        state.phase = 'race';
        state.time = 0;
        for (const c of state.cars) c.lapStart = 0;
        setTimeout(() => { dom.lights.hidden = true; }, 700);
      }
    }

    if (state.phase === 'race' || state.phase === 'finished') {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 8) {
        acc -= STEP;
        if (state.phase === 'race') state.time += STEP;
        updatePlayer(state.player, STEP);
        for (const c of state.cars) if (!c.isPlayer) updateRival(c, STEP);
        resolveContacts();
        state.shake = Math.max(0, state.shake - STEP * 2.2);
      }
    } else {
      updatePlayer(state.player, 0.0001);
    }

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) dom.toast.hidden = true;
    }

    const gr = gearAndRevs(state.player.speed);
    sound.update(gr.revs, input.throttle, Math.abs(state.player.speed), state.player.offRoad);

    updateHUD(dt);
    render();
  }

  /* ---------------------------------------------------------------- boot */

  function fail(message) {
    dom.screen.innerHTML = '<div class="screen__card"><h1 class="screen__title">No WebGL</h1>' +
      '<p class="screen__blurb">' + message + '</p></div>';
    dom.screen.hidden = false;
  }

  function boot() {
    menuHTML = dom.screen.innerHTML;
    buildDials();
    if (!initGL()) {
      fail('This browser could not open a WebGL context, so the track cannot be drawn. ' +
        'Try a different browser, or switch hardware acceleration back on.');
      return;
    }
    try {
      buildWorld();
    } catch (err) {
      fail('Something went wrong building the circuit: ' + err.message);
      throw err;
    }
    resetRace();
    wireMenu();
    window.ApexDrive = { state, track, input, formatTime, standings };
    bindInput();
    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();
