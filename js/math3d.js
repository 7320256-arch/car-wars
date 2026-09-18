/* =====================================================================
   math3d.js - Vectores y matrices (column-major estilo WebGL/OpenGL)
   convención: v' = M * v  con M[0..3] = primera COLUMNA.
   ===================================================================== */
(function (G) {
  'use strict';

  /* ---------------- Vectores ---------------- */
  function v3(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function len2(a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function scaleInto(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
  function addScaledInto(o, a, s) { o[0] += a[0] * s; o[1] += a[1] * s; o[2] += a[2] * s; return o; }
  function lerpV(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  function dist2XZ(a, b) { const dx = a[0] - b[0], dz = a[2] - b[2]; return dx * dx + dz * dz; }
  /* rotación en plano XZ (Y arriba) */
  function rotY(v, ang) { const c = Math.cos(ang), s = Math.sin(ang); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }

  /* ---------------- Matrices 4x4 ---------------- */
  function m4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function identity(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0; o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1; return o;
  }
  function multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  }
  function fromTRS(o, t, ry, s) {
    const c = Math.cos(ry), sN = Math.sin(ry);
    const sx = s[0], sy = s[1], sz = s[2];
    o[0] = c * sx; o[1] = 0; o[2] = -sN * sx; o[3] = 0;
    o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
    o[8] = sN * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }
  function fromTR(o, t, ry) { return fromTRS(o, t, ry, [1, 1, 1]); }
  function fromAxesY(o, t, fwd, up, scl) {
    const z = norm(fwd);
    const x = norm(cross(up, z));
    const y = cross(z, x);
    const s = scl || [1, 1, 1];
    o[0] = x[0] * s[0]; o[1] = x[1] * s[0]; o[2] = x[2] * s[0]; o[3] = 0;
    o[4] = y[0] * s[1]; o[5] = y[1] * s[1]; o[6] = y[2] * s[1]; o[7] = 0;
    o[8] = z[0] * s[2]; o[9] = z[1] * s[2]; o[10] = z[2] * s[2]; o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }
  function translateBy(o, m, t) {
    if (o !== m) o.set(m);
    o[12] += t[0]; o[13] += t[1]; o[14] += t[2];
    return o;
  }
  /* rotación alrededor de un pivote: p' = R*(p - pv) + pv */
  function fromRotYPivot(o, ang, pivot, t) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const px = pivot[0], py = pivot[1], pz = pivot[2];
    o[0] = c; o[1] = 0; o[2] = -s; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = s; o[9] = 0; o[10] = c; o[11] = 0;
    o[12] = px - (c * px - s * pz) + (t ? t[0] : 0);
    o[13] = (t ? t[1] : 0);
    o[14] = pz - (s * px + c * pz) + (t ? t[2] : 0);
    o[15] = 1;
    return o;
  }
  function fromRotX(o, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
    return o;
  }
  function fromRotZ(o, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    identity(o);
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
    return o;
  }
  /* tinte por instancia: se guarda en la 4ª fila (m[3], m[7], m[11]) — gratis */
  function setColor(m, rgb) {
    if (!rgb) { m[3] = 0; m[7] = 0; m[11] = 0; return m; }
    m[3] = rgb[0]; m[7] = rgb[1]; m[11] = rgb[2];
    return m;
  }
  function clearColor(m) { m[3] = 0; m[7] = 0; m[11] = 0; return m; }
  function copySrc(o, s) { for (let i = 0; i < 16; i++) o[i] = s[i]; return o; }
  function upper3x3(o3, m) {
    o3[0] = m[0]; o3[1] = m[1]; o3[2] = m[2];
    o3[3] = m[4]; o3[4] = m[5]; o3[5] = m[6];
    o3[6] = m[8]; o3[7] = m[9]; o3[8] = m[10];
    return o3;
  }
  function invert(o, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3],
      a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
      a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11],
      a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10,
      b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31,
      b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return identity(o);
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b05) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a02 * b07 + a02 * b06) * det;
    o[13] = (a00 * b09 - a02 * b07 + a03 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }
  function invertRigid(o, m) {
    /* inversa de una matriz ortonormal + traslación (más barata) */
    o[0] = m[0]; o[1] = m[4]; o[2] = m[8]; o[3] = 0;
    o[4] = m[1]; o[5] = m[5]; o[6] = m[9]; o[7] = 0;
    o[8] = m[2]; o[9] = m[6]; o[10] = m[10]; o[11] = 0;
    o[12] = -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]);
    o[13] = -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]);
    o[14] = -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]);
    o[15] = 1;
    return o;
  }
  function transformPoint(o, m, p) {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    o[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return o;
  }
  function transformDir(o, m, d) {
    const x = d[0], y = d[1], z = d[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
    return o;
  }
  function persp(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    identity(o);
    o[0] = f / aspect; o[5] = f; o[11] = -1;   /* w_clip = -z_view (OpenGL, mano izquierda en view) */
    o[10] = (far + near) / (near - far);
    o[14] = (2 * far * near) / (near - far);
    o[15] = 0;
    return o;
  }
  function lookAt(o, eye, center, up) {
    const z = norm([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
    let x = cross(up, z);
    if (len2(x) < 1e-8) x = cross([1, 0, 0], z);
    x = norm(x);
    const y = norm(cross(z, x));
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -dot(x, eye); o[13] = -dot(y, eye); o[14] = -dot(z, eye); o[15] = 1;
    return o;
  }
  function ortho(o, l, r, b, t, n, f) {
    identity(o);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n);
    return o;
  }

  /* Proyectar un punto mundo a coordenadas de pantalla (para flechas/marcadores) */
  function project(o, m, w, h, p) {
    const x = p[0], y = p[1], z = p[2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.0001) { o[0] = -99999; o[1] = -99999; o[2] = 0; return o; }
    o[0] = (cx / cw * 0.5 + 0.5) * w;
    o[1] = (0.5 - cy / cw * 0.5) * h;
    o[2] = 1 / cw;
    return o;
  }

  G.M = {
    v3, add, sub, mul, dot, cross, len, len2, norm, scaleInto, addScaledInto, lerpV, dist, dist2XZ, rotY,
    m4, identity, multiply, fromTRS, fromTR, fromAxesY, translateBy, fromRotYPivot, fromRotX, fromRotZ,
    setColor, clearColor, copySrc, upper3x3, invert, invertRigid, transformPoint, transformDir, persp, lookAt, ortho, project
  };
})(window.CW);
