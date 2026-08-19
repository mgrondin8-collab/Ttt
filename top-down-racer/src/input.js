/* Keyboard, and on-screen pads for touch. Produces the same control object the
   AI produces, so the car never knows who is driving it. */
(function (Racer) {
  'use strict';

  function Input(root) {
    this.keys = Object.create(null);
    this.touch = { left: false, right: false, accel: false, brake: false, handbrake: false };
    this.hasTouch = false;
    this.onRestart = null;
    this.onPause = null;
    this._bind(root);
  }

  var HELD = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake', ShiftLeft: 'handbrake', ShiftRight: 'handbrake'
  };

  Input.prototype._bind = function (root) {
    var self = this;

    window.addEventListener('keydown', function (e) {
      var slot = HELD[e.code];
      if (slot) {
        self.keys[slot] = true;
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyR') { if (self.onRestart) self.onRestart(); e.preventDefault(); }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (self.onPause) self.onPause(); e.preventDefault(); }
    });

    window.addEventListener('keyup', function (e) {
      var slot = HELD[e.code];
      if (slot) { self.keys[slot] = false; e.preventDefault(); }
    });

    /* A window that loses focus mid-corner should not leave the throttle pinned. */
    window.addEventListener('blur', function () { self.releaseAll(); });

    var pads = root.querySelectorAll('[data-pad]');
    Array.prototype.forEach.call(pads, function (pad) {
      var slot = pad.getAttribute('data-pad');
      var press = function (e) { self.hasTouch = true; self.touch[slot] = true; pad.classList.add('is-down'); e.preventDefault(); };
      var release = function (e) { self.touch[slot] = false; pad.classList.remove('is-down'); e.preventDefault(); };
      pad.addEventListener('pointerdown', press);
      pad.addEventListener('pointerup', release);
      pad.addEventListener('pointercancel', release);
      pad.addEventListener('pointerleave', release);
      pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  };

  Input.prototype.releaseAll = function () {
    this.keys = Object.create(null);
    for (var k in this.touch) this.touch[k] = false;
  };

  Input.prototype.controls = function () {
    var k = this.keys, t = this.touch;
    var left = !!k.left || t.left;
    var right = !!k.right || t.right;
    return {
      throttle: (k.up || t.accel) ? 1 : 0,
      brake: (k.down || t.brake) ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake: !!k.handbrake || t.handbrake
    };
  };

  Racer.input = { Input: Input };
})(globalThis.Racer = globalThis.Racer || {});
