/* =====================================================================
   primitives.js — Constructor de mallas procedurales (hard surface low-poly)
   Regla de oro: cada cara se emite con winding CCW visto desde el lado que
   indica su normal de sombreado  →  el backface-culling y la iluminación
   siempre coinciden.  `poly()` corrige el orden si el llamador pidió una
   normal concreta.
   UV: proyección triplanar automática por cara (o UV explícita).
   ===================================================================== */
(function (G) {
  'use strict';

  function Builder(opt) {
    opt = opt || {};
    this.p = []; this.n = []; this.u = [];
    this.tris = 0;
    this.center = opt.center || [0, 0, 0];
    this.uvScale = opt.uvScale == null ? 1 : opt.uvScale;
    this.min = [1e9, 1e9, 1e9]; this.max = [-1e9, -1e9, -1e9];
  }
  const B = Builder.prototype;

  B._push = function (x, y, z, nx, ny, nz, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v);
    if (x < this.min[0]) this.min[0] = x; if (y < this.min[1]) this.min[1] = y; if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x; if (y > this.max[1]) this.max[1] = y; if (z > this.max[2]) this.max[2] = z;
  };
  B.uvFor = function (px, py, pz, nx, ny, nz) {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ay >= ax && ay >= az) { u = px; v = pz; }
    else if (ax > ay) { u = pz; v = py; }
    else { u = px; v = py; }
    return [u * this.uvScale, v * this.uvScale];
  };
  function newell(pts) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    return l < 1e-12 ? [0, 1, 0] : [nx / l, ny / l, nz / l];
  }
  /* pts: [[x,y,z],...]  opts: {normal, flip, uv}
     · opts.normal es sólo una *bisagra*: decide si hay que invertir el anillo
     · la normal de sombreado de cada triángulo es la geométrica (flat shading),
       así que el winding y la iluminación nunca se contradicen
     · en quads se elige la diagonal más corta (mejor forma de triángulos) */
  B.poly = function (pts, opts) {
    opts = opts || {};
    let arr = pts, uv = opts.uv || null;
    let g = newell(arr);
    if (opts.flip) { arr = arr.slice().reverse(); uv = uv ? uv.slice().reverse() : null; g = [-g[0], -g[1], -g[2]]; }
    if (opts.normal) {
      const w = opts.normal, l = Math.hypot(w[0], w[1], w[2]) || 1;
      const wn = [w[0] / l, w[1] / l, w[2] / l];
      if (g[0] * wn[0] + g[1] * wn[1] + g[2] * wn[2] < 0) {
        arr = arr.slice().reverse();
        if (uv && uv.length === arr.length) uv = uv.slice().reverse();
      }
    }
    const n = arr.length;
    const emit = (i0, i1, i2) => {
      const a = arr[i0], b = arr[i1], c = arr[i2];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const gl = Math.hypot(nx, ny, nz);
      if (gl < 1e-9) { nx = g[0]; ny = g[1]; nz = g[2]; } else { nx /= gl; ny /= gl; nz /= gl; }
      const tri = [[i0, a], [i1, b], [i2, c]];
      for (let k = 0; k < 3; k++) {
        const v = tri[k][1];
        const uvi = uv ? uv[tri[k][0]] : this.uvFor(v[0], v[1], v[2], nx, ny, nz);
        this._push(v[0], v[1], v[2], nx, ny, nz, uvi[0], uvi[1]);
      }
      this.tris++;
    };
    if (n === 4) {
      const d0 = Math.hypot(arr[0][0] - arr[2][0], arr[0][1] - arr[2][1], arr[0][2] - arr[2][2]);
      const d1 = Math.hypot(arr[1][0] - arr[3][0], arr[1][1] - arr[3][1], arr[1][2] - arr[3][2]);
      if (opts.diagonal === 'alt' || (opts.diagonal !== 'fan' && d1 < d0)) { emit(1, 2, 3); emit(1, 3, 0); }
      else { emit(0, 1, 2); emit(0, 2, 3); }
    } else {
      for (let i = 1; i + 1 < n; i++) emit(0, i, i + 1);
    }
    return this;
  };
  B.quad = function (a, b, c, d, opts) { return this.poly([a, b, c, d], opts); };

  /* ---------- caja (opcional: taper + desplazamiento por cara) ---------- */
  B.box = function (cx, cy, cz, sx, sy, sz, o) {
    o = o || {};
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const tt = o.taperTop || [1, 1], tb = o.taperBottom || [1, 1];
    const ot = o.topOffset || [0, 0], ob = o.bottomOffset || [0, 0];
    const mk = (x, y, z, sxn, szn, ox, oz) => [
      [-sxn * hx + ox, y, -szn * hz + oz], [sxn * hx + ox, y, -szn * hz + oz],
      [sxn * hx + ox, y, szn * hz + oz], [-sxn * hx + ox, y, szn * hz + oz]
    ].map(p => [p[0] + cx, p[1] + cy, p[2] + cz]);
    const bot = mk(0, -hy, 0, tb[0], tb[1], ob[0], ob[1]);
    const top = mk(0, hy, 0, tt[0], tt[1], ot[0], ot[1]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      /* normal radial aproximada (para taper) */
      const mx = (bot[i][0] + bot[j][0] + top[i][0] + top[j][0]) / 4 - cx;
      const mz = (bot[i][2] + bot[j][2] + top[i][2] + top[j][2]) / 4 - cz;
      let nx = mx, nz = mz;
      /* la normal correcta de la cara es perpendicular a la arista */
      const ex = bot[j][0] - bot[i][0], ez = bot[j][2] - bot[i][2];
      nx = -ez; nz = ex;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      this.poly([bot[i], bot[j], top[j], top[i]], { normal: [nx, 0, nz] });
    }
    this.poly(top, { normal: [0, 1, 0] });
    this.poly(bot, { normal: [0, -1, 0] });
    return this;
  };

  /* ---------- loft de perfiles XZ por altura ---------- */
  B.loft = function (levels, o) {
    o = o || {};
    const cx = o.cx || 0, cz = o.cz || 0, base = o.base || 0;
    const prof = levels.map(L => {
      const s = L.scale || [1, 1], of = L.off || [0, 0];
      return L.pts.map(p => [p[0] * s[0] + of[0] + cx, base + L.y, p[1] * s[1] + of[1] + cz]);
    });
    for (let li = 0; li + 1 < prof.length; li++) {
      const A = prof[li], C = prof[li + 1], n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const mx = (A[i][0] + A[j][0] + C[i][0] + C[j][0]) / 4 - cx;
        const mz = (A[i][2] + A[j][2] + C[i][2] + C[j][2]) / 4 - cz;
        let nx = -(A[j][2] - A[i][2]), nz = (A[j][0] - A[i][0]);
        if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
        const tilt = o.sideTilt == null ? 0 : o.sideTilt;
        this.poly([A[i], A[j], C[j], C[i]], { normal: [nx, tilt, nz] });
      }
    }
    if (o.caps !== false) {
      if (prof.length > 1) {
        this.poly(prof[prof.length - 1], { normal: [0, 1, 0] });
        this.poly(prof[0], { normal: [0, -1, 0] });
      }
    }
    return this;
  };

  /* ---------- cilindro / cono (eje Y por defecto; opts.axis: 'y'|'x'|'z') ---------- */
  B.cyl = function (cx, cy, cz, r0, r1, h, seg, o) {
    o = o || {};
    const S = seg || 16;
    const axis = o.axis || 'y';
    const mk = (r, t) => {
      const c = Math.cos(t) * r, s = Math.sin(t) * r;
      return axis === 'y' ? [cx + c, cy, cz + s] : axis === 'x' ? [cx, cy + c, cz + s] : [cx + c, cy + s, cz];
    };
    const off = (v, k) => { const p = v.slice(); p[axis === 'y' ? 1 : axis === 'x' ? 0 : 2] += k; return p; };
    const a0 = [], a1 = [];
    for (let i = 0; i < S; i++) {
      const t = i / S * Math.PI * 2;
      a0.push(off(mk(r0, t), -h / 2));
      a1.push(off(mk(r1, t), h / 2));
    }
    const dirOf = (v, k) => { const d = [v[0] - cx, v[1] - cy, v[2] - cz]; return d; };
    const slope = (r0 - r1) / (h || 1);
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      const t = (i + 0.5) / S * Math.PI * 2;
      let nx = Math.cos(t), ny = Math.sin(t);
      let nrm = axis === 'y' ? [nx, slope, ny] : axis === 'x' ? [slope, nx, ny] : [nx, ny, slope];
      if (r0 < 1e-4 || r1 < 1e-4) {
        /* cono: triángulo al vértice opuesto (evita caras degeneradas) */
        if (r0 < 1e-4) this.poly([a0[0], a1[j], a1[i]], { normal: nrm });
        else this.poly([a1[0], a0[i], a0[j]], { normal: nrm });
      } else this.poly([a0[i], a0[j], a1[j], a1[i]], { normal: nrm });
    }
    if (o.caps !== false) {
      if (r1 > 1e-4) {
        const ax1 = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
        this.poly(a1, { normal: ax1 });
      }
      if (r0 > 1e-4) {
        const ax0 = axis === 'y' ? [0, -1, 0] : axis === 'x' ? [-1, 0, 0] : [0, 0, -1];
        this.poly(a0, { normal: ax0 });
      }
    }
    return this;
  };

  /* ---------- rueda: banda + flancos + cubo (plano XY, eje Z) ---------- */
  B.wheel = function (r, w, seg, o) {
    o = o || {};
    const S = seg || 16, hw = w / 2, rIn = r * (o.rimRatio || 0.62);
    const ring = (z, rr) => {
      const a = [];
      for (let i = 0; i < S; i++) { const t = i / S * Math.PI * 2; a.push([Math.cos(t) * rr, Math.sin(t) * rr, z]); }
      return a;
    };
    const front = ring(hw, r), back = ring(-hw, r);
    const frontIn = ring(hw + 0.004, rIn), backIn = ring(-hw - 0.004, rIn);
    for (let i = 0; i < S; i++) {
      const j = (i + 1) % S;
      const t = (i + 0.5) / S * Math.PI * 2, nx = Math.cos(t), ny = Math.sin(t);
      const k1 = (i % 2 === 0) ? 1 : 0.955, k2 = (i % 2 === 0) ? 0.955 : 1;
      const A = [front[i][0] * k1, front[i][1] * k1, hw];
      const Bv = [front[j][0] * k2, front[j][1] * k2, hw];
      const C = [back[j][0] * k2, back[j][1] * k2, -hw];
      const D = [back[i][0] * k1, back[i][1] * k1, -hw];
      this.poly([A, Bv, C, D], { normal: [nx, ny, 0] });
      this.poly([front[i], front[j], frontIn[j], frontIn[i]], { normal: [0, 0, 1] });
      this.poly([back[j], back[i], backIn[i], backIn[j]], { normal: [0, 0, -1] });
    }
    /* llanta/cubo en el mismo eje Z que la banda */
    this.cyl(0, 0, 0, rIn, rIn * 0.98, w + 0.02, Math.max(8, S >> 1), { axis: 'z' });
    this.cyl(0, 0, 0, r * 0.2, r * 0.2, w + 0.07, 8, { axis: 'z' });
    return this;
  };

  /* ---------- esfera / elipsoide ---------- */
  B.sphere = function (cx, cy, cz, r, su, sv, squash, jitter) {
    su = su || 12; sv = sv || 8;
    const rows = [];
    for (let j = 0; j <= sv; j++) {
      const phi = j / sv * Math.PI, y = Math.cos(phi), rr = Math.sin(phi);
      const ring = [];
      for (let i = 0; i < su; i++) {
        const th = i / su * Math.PI * 2;
        let k = 1;
        if (jitter) k = 1 + (G.hash1(i * 13.7 + j * 71.3 + r * 3.1) - 0.5) * jitter;
        ring.push([cx + Math.cos(th) * rr * r * k, cy + y * r * (squash == null ? 1 : squash) * k, cz + Math.sin(th) * rr * r * k]);
      }
      rows.push(ring);
    }
    for (let j = 0; j < sv; j++) {
      for (let i = 0; i < su; i++) {
        const i2 = (i + 1) % su;
        const quad = (j === 0) ? [rows[0][i], rows[1][i2], rows[1][i]]
          : (j === sv - 1) ? [rows[j][i], rows[j][i2], rows[j + 1][i]]
            : [rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]];
        const c0 = quad[0];
        const dir = [c0[0] - cx, (c0[1] - cy), c0[2] - cz];
        const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        this.poly(quad, { normal: [dir[0] / l, dir[1] / l, dir[2] / l] });
      }
    }
    return this;
  };
  B.rock = function (cx, cy, cz, rx, ry, rz, seed) {
    const su = 8, sv = 5;
    const rows = [];
    const jit = (a, b) => (G.hash1(a * 37.1 + b * 91.7 + (seed || 0) * 13.3) - 0.5);
    for (let j = 0; j <= sv; j++) {
      const phi = j / sv * Math.PI, y = Math.cos(phi), rr = Math.sin(phi);
      const ring = [];
      for (let i = 0; i < su; i++) {
        const th = i / su * Math.PI * 2;
        const k = 1 + jit(i, j) * 0.5;
        ring.push([cx + Math.cos(th) * rr * rx * k, cy + y * ry * (1 + jit(j, i) * 0.3), cz + Math.sin(th) * rr * rz * k]);
      }
      rows.push(ring);
    }
    for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
      const i2 = (i + 1) % su;
      const quad = (j === 0) ? [rows[0][i], rows[1][i2], rows[1][i]] : (j === sv - 1) ? [rows[j][i], rows[j][i2], rows[j + 1][i]] : [rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]];
      const a = quad[0];
      const d = [(a[0] - cx) / rx, (a[1] - cy) / ry, (a[2] - cz) / rz];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      this.poly(quad, { normal: [d[0] / l, d[1] / l, d[2] / l] });
    }
    return this;
  };

  /* ---------- tubo a lo largo de una polilínea ---------- */
  B.tube = function (path, rad, seg, o) {
    o = o || {};
    const S = seg || 6;
    const rings = [], axes = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)];
      let t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let x = [up[1] * t[2] - up[2] * t[1], up[2] * t[0] - up[0] * t[2], up[0] * t[1] - up[1] * t[0]];
      const xl = Math.hypot(x[0], x[1], x[2]) || 1; x = [x[0] / xl, x[1] / xl, x[2] / xl];
      const y = [t[1] * x[2] - t[2] * x[1], t[2] * x[0] - t[0] * x[2], t[0] * x[1] - t[1] * x[0]];
      const r = typeof rad === 'function' ? rad(i / Math.max(1, path.length - 1)) : rad;
      const ring = [];
      for (let s = 0; s < S; s++) {
        const a = s / S * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        ring.push([p[0] + (x[0] * c + y[0] * sn) * r, p[1] + (x[1] * c + y[1] * sn) * r, p[2] + (x[2] * c + y[2] * sn) * r]);
      }
      rings.push(ring); axes.push({ c: p, x: x, y: y });
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let s = 0; s < S; s++) {
        const s2 = (s + 1) % S;
        const mid = [(rings[i][s][0] + rings[i][s2][0]) / 2, (rings[i][s][1] + rings[i][s2][1]) / 2, (rings[i][s][2] + rings[i][s2][2]) / 2];
        const d = [mid[0] - axes[i].c[0], mid[1] - axes[i].c[1], mid[2] - axes[i].c[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        let nrm = [d[0] / l, d[1] / l, d[2] / l];
        if (o.inside) nrm = [-nrm[0], -nrm[1], -nrm[2]];
        this.poly([rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]], { normal: nrm });
      }
    }
    return this;
  };

  /* ---------- carretera / aceras: cinta a lo largo de una polilínea ---------- */
  B.ribbon = function (centers, halfW, yFn, o) {
    o = o || {};
    const n = centers.length, L = o.lengths;
    const us = o.uvU == null ? 1 : o.uvU, vs = o.uvV == null ? 1 : o.uvV;
    const left = [], right = [], leftC = [], rightC = [];
    const cw = o.curbW || 0.6, ch = o.curbH || 0.12;
    for (let i = 0; i < n; i++) {
      const prev = centers[Math.max(0, i - 1)], next = centers[Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0], tz = next[1] - prev[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = tz, nz = -tx;               /* lateral */
      const w = typeof halfW === 'function' ? halfW(i, n) : halfW;
      const y = typeof yFn === 'function' ? yFn(i, n) : (yFn || 0);
      left.push([centers[i][0] + nx * w, y, centers[i][1] + nz * w]);
      right.push([centers[i][0] - nx * w, y, centers[i][1] - nz * w]);
      leftC.push([centers[i][0] + nx * (w + cw), y - ch, centers[i][1] + nz * (w + cw)]);
      rightC.push([centers[i][0] - nx * (w + cw), y - ch, centers[i][1] - nz * (w + cw)]);
    }
    for (let i = 0; i + 1 < n; i++) {
      const ua = L ? L[i] * us : i * 0.25 * us, ub = L ? L[i + 1] * us : (i + 1) * 0.25 * us;
      const up = o.normalFn ? o.normalFn(i, n) : [0, 1, 0];
      this.poly([left[i], right[i], right[i + 1], left[i + 1]], {
        uv: [[ua, 0], [ua, 1], [ub, 1], [ub, 0]],
        normal: up
      });
      if (o.curbs) {
        /* cordillo: solera superior + canto exterior */
        for (let s = 0; s < 2; s++) {
          const inn = s ? right : left, out = s ? rightC : leftC;
          this.poly([inn[i], inn[i + 1], out[i + 1], out[i]], { normal: [0, 1, 0] });
          const dy = [0, ch, 0];
          this.poly([out[i], out[i + 1], [out[i + 1][0] - dy[0], out[i + 1][1] - dy[1], out[i + 1][2] - dy[2]], [out[i][0] - dy[0], out[i][1] - dy[1], out[i][2] - dy[2]]],
            { normal: [out[i][0] - centers[i][0], 0, out[i][2] - centers[i][1]] });
        }
      }
    }
    return this;
  };

  /* ---------- perfil rectangular redondeado en XZ ---------- */
  function roundedRect(hx, hz, r, seg) {
    r = Math.min(r, Math.min(hx, hz) * 0.98);
    const S = Math.max(1, seg || 2);
    const cs = [[hx - r, hz - r, 0], [-hx + r, hz - r, Math.PI / 2], [-hx + r, -hz + r, Math.PI], [hx - r, -hz + r, Math.PI * 1.5]];
    const out = [];
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i <= S; i++) {
        const a = cs[c][2] + i / S * Math.PI / 2;
        const p = [cs[c][0] + Math.cos(a) * r, cs[c][1] + Math.sin(a) * r];
        const prev = out[out.length - 1];
        if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4) out.push(p);
      }
    }
    return out;
  }
  /* perfil a partir de puntos (orden libre: poly() corrige el bobinado) */
  function profile(pts) { return pts.map(p => [p[0], p[1]]); }

  /* caja unitaria: base en y=0, centrada en x/z, con UV 0..1 por cara.
     Pensada para instanciar con escala no uniforme + uvMode en el shader. */
  B.unitBox = function (sx, sy, sz, o) {
    o = o || {};
    sx = sx || 1; sy = sy || 1; sz = sz || 1;
    const hx = sx / 2, hz = sz / 2, y0 = o.base === undefined ? 0 : o.base, y1 = y0 + sy;
    const c = [
      [-hx, y0, -hz], [hx, y0, -hz], [hx, y0, hz], [-hx, y0, hz],
      [-hx, y1, -hz], [hx, y1, -hz], [hx, y1, hz], [-hx, y1, hz]
    ];
    const U = [
      [0, 0], [1, 0], [1, 1], [0, 1]
    ];
    const faces = [
      [0, 1, 2, 3, [0, -1, 0]],   /* abajo */
      [7, 6, 5, 4, [0, 1, 0]],    /* arriba */
      [0, 4, 5, 1, [0, 0, -1]],
      [2, 6, 7, 3, [0, 0, 1]],
      [1, 5, 6, 2, [1, 0, 0]],
      [3, 7, 4, 0, [-1, 0, 0]]
    ];
    for (const f of faces) {
      const q = [c[f[0]], c[f[1]], c[f[2]], c[f[3]]].map(p => p.slice());
      const uvq = [U[0], U[1], U[2], U[3]];
      this.poly(q, { normal: f[4], uv: uvq });
    }
    return this;
  };

  /* pico/monte: loft de perfiles redondeados decrecientes */
  B.peak = function (sx, sy, sz, o) {
    o = o || {};
    const p0 = G.roundedRect(sx / 2, sz / 2, Math.min(sx, sz) * 0.2, 2);
    const jit = o.jitter || 0.18, sd = o.seed || 3;
    const lv = [[0, 1, 1, 0], [0.42, 0.66, 0.62, 0.06], [0.74, 0.34, 0.3, 0.12], [1, 0.09, 0.07, 0.0]];
    const levels = lv.map(L => ({
      y: L[0] * sy,
      pts: p0.map((p, k) => {
        const s1 = 1 + jit * (G.hash1(k * 7.3 + L[0] * 31.1 + sd) - 0.5) * 2;
        return [p[0] * L[1] * s1, p[1] * L[2] * (1 + jit * (G.hash1(k * 3.1 + sd * 2) - 0.5) * 2)];
      }),
      off: [L[3] * sx * 0.3, -L[3] * sz * 0.2]
    }));
    this.loft(levels, { caps: true });
    return this;
  };
  /* meseta desértica: cima plana con cortante */
  B.mesa = function (sx, sy, o) {
    o = o || {};
    const p0 = G.roundedRect(sx / 2, (o.sz || sx) / 2, sx * 0.16, 2);
    const top = 1 / (o.taper || 1.35);
    this.loft([
      { y: 0, pts: p0 },
      { y: sy * 0.7, pts: p0, scale: [top * 1.06, top * 1.06] },
      { y: sy, pts: p0, scale: [top, top], off: [sx * 0.03, -sx * 0.02] }
    ]);
    return this;
  };
  B.toMesh = function (R, name, o) {
    o = o || {};
    const pos = new Float32Array(this.p), nor = new Float32Array(this.n), uv = new Float32Array(this.u);
    let maxR = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] - this.center[0], y = pos[i + 1] - this.center[1], z = pos[i + 2] - this.center[2];
      const r = Math.hypot(x, y, z);
      if (r > maxR) maxR = r;
    }
    const m = new G.Mesh(name);
    m.load(R, pos, nor, uv, o.radius || Math.max(maxR, 0.2));
    m.min = this.min.slice(); m.max = this.max.slice();
    m.tris = this.tris;
    return m;
  };

  G.Builder = Builder;
  G.roundedRect = roundedRect;
  G.profile = profile;
  G.newell = newell;
})(window.CW);
