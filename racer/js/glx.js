/* glx.js — tiny matrix math and WebGL helpers. No dependencies. */
(function (global) {
  'use strict';

  /* ---------- 4x4 matrices, column-major, the way GL wants them ---------- */
  const m4 = {
    create() {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },

    identity(out) {
      out.fill(0);
      out[0] = out[5] = out[10] = out[15] = 1;
      return out;
    },

    perspective(out, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      out.fill(0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[14] = 2 * far * near * nf;
      return out;
    },

    multiply(out, a, b) {
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
      }
      return out;
    },

    fromTranslation(out, x, y, z) {
      m4.identity(out);
      out[12] = x; out[13] = y; out[14] = z;
      return out;
    },

    fromRotationY(out, r) {
      const s = Math.sin(r), c = Math.cos(r);
      m4.identity(out);
      out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
      return out;
    },

    fromRotationX(out, r) {
      const s = Math.sin(r), c = Math.cos(r);
      m4.identity(out);
      out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
      return out;
    },

    fromRotationZ(out, r) {
      const s = Math.sin(r), c = Math.cos(r);
      m4.identity(out);
      out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
      return out;
    },

    /* Model matrix for an object standing on the ground: yaw, then translate,
       with an optional uniform scale and a pitch/roll for banking.

       Yaw is measured clockwise from -Z, so forward is (sin yaw, 0, -cos yaw)
       — the convention the track and the driving model both use. That is a
       rotation of -yaw about Y, and getting the sign wrong here mirrors the
       whole world: everything still looks right along -Z, where sin yaw is
       zero, and is reflected everywhere else. */
    compose(out, x, y, z, yaw, pitch, roll, scale) {
      const sy = -Math.sin(yaw), cy = Math.cos(yaw);
      const sp = Math.sin(pitch || 0), cp = Math.cos(pitch || 0);
      const sr = Math.sin(roll || 0), cr = Math.cos(roll || 0);
      const s = scale === undefined ? 1 : scale;
      // R = Ry * Rx * Rz
      out[0] = (cy * cr + sy * sp * sr) * s;
      out[1] = (cp * sr) * s;
      out[2] = (-sy * cr + cy * sp * sr) * s;
      out[3] = 0;
      out[4] = (-cy * sr + sy * sp * cr) * s;
      out[5] = (cp * cr) * s;
      out[6] = (sy * sr + cy * sp * cr) * s;
      out[7] = 0;
      out[8] = (sy * cp) * s;
      out[9] = -sp * s;
      out[10] = (cy * cp) * s;
      out[11] = 0;
      out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
      return out;
    },

    /* View matrix from an eye point and yaw/pitch/roll, in the same yaw
       convention as compose: yaw 0 looks down -Z, and the camera looks along
       (sin yaw, 0, -cos yaw). The view matrix is the inverse of the camera's
       placement, so the rotation of -yaw about Y inverts to +yaw here. */
    view(out, x, y, z, yaw, pitch, roll) {
      const a = m4.create(), b = m4.create(), c = m4.create();
      m4.fromRotationZ(a, -(roll || 0));
      m4.fromRotationX(b, -(pitch || 0));
      m4.multiply(c, a, b);
      m4.fromRotationY(b, yaw);
      m4.multiply(a, c, b);
      m4.fromTranslation(b, -x, -y, -z);
      return m4.multiply(out, a, b);
    }
  };

  /* ---------- shaders and programs ---------- */
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader failed to compile: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Program failed to link: ' + gl.getProgramInfoLog(p));
    }
    // Cache every attribute and uniform location up front.
    const wrap = { program: p, attrib: {}, uniform: {} };
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      wrap.attrib[info.name] = gl.getAttribLocation(p, info.name);
    }
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      wrap.uniform[name] = gl.getUniformLocation(p, name);
    }
    return wrap;
  }

  /* ---------- mesh building ----------
     Vertex layout: position(3) normal(3) uv(2) colour(4).
     The fourth colour channel is "how much of the object tint applies here",
     so one car mesh can be repainted per driver without touching its glass
     or its tyres. */
  const STRIDE = 12;

  class MeshBuilder {
    constructor() {
      this.verts = [];
      this.index = [];
    }

    get vertexCount() { return this.verts.length / STRIDE; }

    vertex(px, py, pz, nx, ny, nz, u, v, r, g, b, tint) {
      this.verts.push(px, py, pz, nx, ny, nz, u, v, r, g, b, tint === undefined ? 0 : tint);
      return this.vertexCount - 1;
    }

    tri(a, b, c) { this.index.push(a, b, c); }

    quad(a, b, c, d) { this.index.push(a, b, c, a, c, d); }

    /* Flat quad from four corners, given as [x,y,z] triples wound counter
       clockwise when seen from the front. */
    face(p0, p1, p2, p3, colour, uv, tint) {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const t = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
      const c = colour;
      const a = this.vertex(p0[0], p0[1], p0[2], nx, ny, nz, t[0][0], t[0][1], c[0], c[1], c[2], tint);
      const b = this.vertex(p1[0], p1[1], p1[2], nx, ny, nz, t[1][0], t[1][1], c[0], c[1], c[2], tint);
      const d = this.vertex(p2[0], p2[1], p2[2], nx, ny, nz, t[2][0], t[2][1], c[0], c[1], c[2], tint);
      const e = this.vertex(p3[0], p3[1], p3[2], nx, ny, nz, t[3][0], t[3][1], c[0], c[1], c[2], tint);
      this.quad(a, b, d, e);
    }

    /* Axis-aligned box centred on x/z, sitting between y0 and y1. */
    box(x0, y0, z0, x1, y1, z1, colour, tint) {
      const c = colour;
      this.face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], c, null, tint); // top
      this.face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, null, tint); // bottom
      this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, null, tint); // front (+z)
      this.face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c, null, tint); // back
      this.face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c, null, tint); // right
      this.face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c, null, tint); // left
    }

    build(gl) {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.verts), gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      const big = this.vertexCount > 65535;
      const data = big ? new Uint32Array(this.index) : new Uint16Array(this.index);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return {
        vbo, ibo,
        count: this.index.length,
        type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      };
    }
  }

  function bindMesh(gl, prog, mesh) {
    const bytes = STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    const a = prog.attrib;
    gl.enableVertexAttribArray(a.aPos);
    gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(a.aNormal);
    gl.vertexAttribPointer(a.aNormal, 3, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(a.aUV);
    gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, bytes, 24);
    gl.enableVertexAttribArray(a.aColor);
    gl.vertexAttribPointer(a.aColor, 4, gl.FLOAT, false, bytes, 32);
  }

  function texture(gl, source, opts) {
    const o = opts || {};
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.clampT || o.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  global.GLX = { m4, program, MeshBuilder, bindMesh, texture, STRIDE };
})(window);
