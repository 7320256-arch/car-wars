/* =====================================================================
   mapdata.js — Trazados, máscaras de colisión/progreso y definición
   de los 4 mapas. Sin assets: todo se calcula aquí.
   · Path: Catmull-Rom cerrado → muestreo denso + longitudes + curvatura
   · Mask: rejilla con distancia a la pista e índice de segmento
     (colisiones + vueltas + IA + minimapa en O(1))
   ===================================================================== */
(function (G) {
  'use strict';
  const clamp = G.clamp, lerp = G.lerp;

  /* ---------------- spline Catmull-Rom (Romney) ---------------- */
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
    ];
  }
  /* ctrl: [[x,z],...]  closed:true → bucle */
  function samplePath(ctrl, closed, perSeg, jitter, rng) {
    perSeg = perSeg || 12;
    const n = ctrl.length;
    const pts = [];
    const get = (i) => closed ? ctrl[((i % n) + n) % n] : ctrl[clamp(i, 0, n - 1)];
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let s = 0; s < perSeg; s++) {
        const t = s / perSeg;
        const p = catmull(p0, p1, p2, p3, t);
        if (jitter && s > 0) {
          p[0] += (rng() - 0.5) * jitter;
          p[1] += (rng() - 0.5) * jitter;
        }
        pts.push(p);
      }
    }
    if (!closed) pts.push(ctrl[n - 1].slice());
    return pts;
  }
  function computeMeta(pts, closed) {
    const n = pts.length;
    const L = new Float32Array(n + 1);
    let acc = 0;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      L[i + 1] = acc;
    }
    const total = acc;
    if (!closed) L[n] = acc;
    /* tangente, normal y curvatura por punto */
    const T = [], N = [], K = new Float32Array(n), Y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i], pv = pts[(i - 1 + n) % n], nx = pts[(i + 1) % n];
      let tx = nx[0] - pv[0], tz = nx[1] - pv[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      T.push([tx, tz]); N.push([tz, -tx]);
    }
    for (let i = 0; i < n; i++) {
      const a = T[(i - 1 + n) % n], b = T[(i + 1) % n];
      const cross = a[0] * b[1] - a[1] * b[0];
      const dotc = clamp(a[0] * b[0] + a[1] * b[1], -1, 1);
      const ang = Math.acos(dotc) * Math.sign(cross || 1);
      const dse = Math.max(1e-3, (L[Math.min(i + 2, n)] - L[Math.max(i - 1, 0)]) / 3);
      K[i] = ang / dse;
    }
    /* suavizar curvatura */
    const Ks = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -3; k <= 3; k++) { s += K[(i + k + n) % n]; c++; }
      Ks[i] = s / c;
    }
    return { L, total, T, N, K: Ks };
  }
  /* resampleo por longitud constante (uniforme y sin duplicados en el cierre) */
  function resample(pts, meta, step, closed) {
    const n = pts.length;
    const total = meta.total;
    const count = Math.max(8, Math.round(total / step));
    const d = total / count;
    const out = [];
    let i = 0;
    for (let k = 0; k < count; k++) {
      const s = k * d;
      while (i < n - 1 && meta.L[i + 1] < s) i++;
      const a = pts[i], b2 = pts[(i + 1) % n];
      const segLen = Math.max(1e-4, meta.L[i + 1] - meta.L[i]);
      const t = clamp((s - meta.L[i]) / segLen, 0, 1);
      out.push([lerp(a[0], b2[0], t), lerp(a[1], b2[1], t)]);
    }
    return out;
  }
  /* curvatura sobre puntos ya reuestreados → radio real de cada curva */
  function curveRadius(centers) {
    const n = centers.length, R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = centers[(i - 1 + n) % n], b = centers[i], c = centers[(i + 1) % n];
      const A = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const B = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const C = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      R[i] = area < 1e-5 ? 1e5 : (A * B * C) / (4 * area);
    }
    /* suavizar (mínimo en ventana) para que el límite de la IA sea estable */
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 1e9;
      for (let k = -2; k <= 2; k++) m = Math.min(m, R[(i + k + n) % n]);
      S[i] = m;
    }
    return S;
  }

  /* perfil de elevación: nodos [fracción, altura] + suavizado */
  function elevProfile(n, nodes) {
    const Y = new Float32Array(n);
    if (!nodes || !nodes.length) return Y;
    const nd = nodes.slice().sort((a, b) => a[0] - b[0]);
    const m = nd.length;
    for (let i = 0; i < n; i++) {
      const f = i / n;
      /* buscar el nodo previo (envolvente) */
      let k = 0;
      for (let j = 0; j < m; j++) if (nd[j][0] <= f) k = j;
      const a0 = nd[k], a1 = nd[(k + 1) % m];
      let span = a1[0] - a0[0];
      if (span <= 0) span += 1;
      let t = (f - a0[0] + 1) % 1;
      t = clamp(t / span, 0, 1);
      Y[i] = lerp(a0[1], a1[1], G.smooth(t));
    }
    for (let pass = 0; pass < 34; pass++) {
      const c = Y.slice();
      for (let i = 0; i < n; i++) Y[i] = (c[(i - 1 + n) % n] + c[i] * 2 + c[(i + 1) % n]) / 4;
    }
    return Y;
  }
  /* peralte: 0..1 según |curvatura|, con subida/bajada suave */
  function bankProfile(centers, radius, amt) {
    const n = centers.length, B = new Float32Array(n);
    if (!amt) return B;
    for (let i = 0; i < n; i++) {
      const r = radius[i];
      B[i] = clamp((26 - r) / 16, 0, 1) * amt;
    }
    for (let pass = 0; pass < 40; pass++) {
      const c = B.slice();
      for (let i = 0; i < n; i++) B[i] = (c[(i - 1 + n) % n] + c[i] * 2 + c[(i + 1) % n]) / 4;
    }
    return B;
  }

  /* Limitador de curvatura: suaviza SÓLO los vértices con radio < minR,
     así las rectas y curvas rápidas conservan su carácter. */
  function limitCurvature(centers, minR, lambda, maxIters) {
    let pts = centers.map(p => [p[0], p[1]]);
    const n = pts.length;
    for (let it = 0; it < (maxIters || 60); it++) {
      const R = curveRadius(pts);
      let worst = 1e9;
      for (let i = 0; i < n; i++) worst = Math.min(worst, R[i]);
      if (worst >= minR * 0.99) break;
      const src = pts.map(p => [p[0], p[1]]);
      const need = clamp(minR / Math.max(worst, 1), 1, 2.4);
      const lam = clamp(lambda * need, 0.12, 0.72);
      const reach = worst < minR * 0.5 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        if (R[i] >= minR) continue;
        for (let k = -reach; k <= reach; k++) {
          const j = (i + k + n) % n;
          const w = lam * (1 - Math.abs(k) / (reach + 2));
          const a = src[(j - 1 + n) % n], c = src[(j + 1) % n];
          pts[j][0] = src[j][0] + ((a[0] + c[0]) / 2 - src[j][0]) * w;
          pts[j][1] = src[j][1] + ((a[1] + c[1]) / 2 - src[j][1]) * w;
        }
      }
    }
    return pts;
  }

  /* Trazado completo de un mapa: spline → reuestreado → límite de curvatura
     → elevación, peralte, máscaras. Lo usan el juego y los tests. */
  function makeTrack(spec) {
    const step = spec.step || 2.6;
    let raw = samplePath(spec.ctrl, true, spec.perSeg || 16, 0);
    let meta = computeMeta(raw, true);
    let centers = resample(raw, meta, step, true);
    for (let pass = 0; pass < 2; pass++) {
      centers = limitCurvature(centers, spec.minR || 18, 0.36, 420);
      meta = computeMeta(centers, true);
      centers = resample(centers, meta, step, true);
    }
    meta = computeMeta(centers, true);
    const radius = curveRadius(centers);
    const n = centers.length;
    const Y = elevProfile(n, spec.elev);
    const bank = bankProfile(centers, radius, spec.bank || 0);
    /* normal lateral y tangente por punto (para construir la cinta) */
    const T = new Float32Array(n * 2), N = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = centers[(i - 1 + n) % n], b = centers[(i + 1) % n];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      T[i * 2] = tx / l; T[i * 2 + 1] = tz / l;
      N[i * 2] = tz / l; N[i * 2 + 1] = -tx / l;
    }
    const mask = buildMask(centers, spec.w, spec.world, spec.res, Y, step);
    return {
      spec, centers, meta, total: meta.total, radius, Y, bank, T, N, n, mask,
      halfW: spec.w,
      /* posición/orientación sobre el eje de pista */
      at(i) {
        const k = ((i % n) + n) % n | 0;
        const c = centers[k];
        return { x: c[0], z: c[1], yaw: Math.atan2(T[k * 2], T[k * 2 + 1]), y: Y[k] };
      },
      /* progreso 0..1 a lo largo de la vuelta */
      progressAt(x, z) { return mask.progress(x, z); }
    };
  }

  /* ---------------- máscara de distancia ---------------- */
  function buildMask(centers, halfW, world, res, Y, spacing) {
    const cell = (world * 2) / res;
    const dArr = new Float32Array(res * res);
    const iArr = new Float32Array(res * res);
    const n = centers.length;
    /* --- 1. semillas con precisión sub-celda: sembramos a lo largo de cada
       segmento y guardamos el vector exacto (en celdas) hacia el punto de pista --- */
    const BIG = 4096;
    const vdx = new Float32Array(res * res).fill(BIG);
    const vdy = new Float32Array(res * res).fill(BIG);
    const inv = 1 / cell;
    const seedAt = (px, pz, segIdx) => {
      const u = (px + world) * inv - 0.5, v = (pz + world) * inv - 0.5;
      const i0 = Math.round(u), j0 = Math.round(v);
      if (i0 < 0 || j0 < 0 || i0 >= res || j0 >= res) return;
      const o = j0 * res + i0;
      const fx = u - i0, fy = v - j0;
      if (vdx[o] === BIG || fx * fx + fy * fy < vdx[o] * vdx[o] + vdy[o] * vdy[o]) {
        vdx[o] = fx; vdy[o] = fy; iArr[o] = segIdx;
      }
    };
    for (let i = 0; i < n; i++) {
      const a = centers[i], b2 = centers[(i + 1) % n];
      const dx = b2[0] - a[0], dz = b2[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const steps = Math.max(1, Math.ceil(len * inv * 2));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        seedAt(a[0] + dx * t, a[1] + dz * t, i + t);
      }
    }
    /* --- 2. transformada de distancia por propagación de vectores (2 pasadas).
       v = vector (en celdas) desde la celda hasta el punto de pista más cercano.
       Coste O(res²) y exactitud sub-celda en frentes rectos. --- */
    /* ¿mejora el candidato (bx,by) al actual (ax,ay)?  (un candidato no visitado nunca gana) */
    const better = (ax, ay, bx, by) => bx < BIG && (ax >= BIG || ax * ax + ay * ay > bx * bx + by * by);
    for (let j = 0; j < res; j++) {
      for (let ii = 0; ii < res; ii++) {
        const o = j * res + ii;
        let dx = vdx[o], dy = vdy[o];
        if (j > 0) {
          if (ii > 0) { const q = o - res - 1, cx = vdx[q] + 1, cy = vdy[q] + 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
          if (ii < res - 1) { const q = o - res + 1, cx = vdx[q] - 1, cy = vdy[q] + 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
          { const q = o - res, cx = vdx[q], cy = vdy[q] + 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
        }
        if (ii > 0) { const q = o - 1, cx = vdx[q] + 1, cy = vdy[q]; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
        vdx[o] = dx; vdy[o] = dy;
      }
    }
    for (let j = res - 1; j >= 0; j--) {
      for (let ii = res - 1; ii >= 0; ii--) {
        const o = j * res + ii;
        let dx = vdx[o], dy = vdy[o];
        if (j < res - 1) {
          if (ii < res - 1) { const q = o + res + 1, cx = vdx[q] - 1, cy = vdy[q] - 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
          if (ii > 0) { const q = o + res - 1, cx = vdx[q] + 1, cy = vdy[q] - 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
          { const q = o + res, cx = vdx[q], cy = vdy[q] - 1; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
        }
        if (ii < res - 1) { const q = o + 1, cx = vdx[q] - 1, cy = vdy[q]; if (better(dx, dy, cx, cy)) { dx = cx; dy = cy; iArr[o] = iArr[q]; } }
        vdx[o] = dx; vdy[o] = dy;
        dArr[o] = dx >= BIG ? 1e9 : Math.hypot(dx, dy) * cell;
      }
    }

    /* --- 3. refinado exacto cerca de la pista (donde importa: bordes/colisión) --- */
    const rad = halfW * 1.15 + cell * 2.5;
    for (let i = 0; i < n; i++) {
      const a = centers[i], b = centers[(i + 1) % n];
      const ax = a[0], az = a[1], ex = b[0] - a[0], ez = b[1] - a[1];
      const el2 = ex * ex + ez * ez || 1e-6;
      const i0 = clamp(Math.floor((Math.min(ax, b[0]) - rad + world) / cell), 0, res - 1);
      const i1 = clamp(Math.ceil((Math.max(ax, b[0]) + rad + world) / cell), 0, res - 1);
      const j0 = clamp(Math.floor((Math.min(az, b[1]) - rad + world) / cell), 0, res - 1);
      const j1 = clamp(Math.ceil((Math.max(az, b[1]) + rad + world) / cell), 0, res - 1);
      for (let j = j0; j <= j1; j++) {
        const pz = -world + (j + 0.5) * cell;
        const row = j * res;
        for (let ii = i0; ii <= i1; ii++) {
          const px = -world + (ii + 0.5) * cell;
          let t = ((px - ax) * ex + (pz - az) * ez) / el2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const qx = ax + ex * t, qz = az + ez * t;
          const d = Math.hypot(px - qx, pz - qz);
          const o = row + ii;
          if (d < dArr[o]) { dArr[o] = d; iArr[o] = i + t; }
        }
      }
    }
    const out = {
      res, cell, world, dArr, iArr, Y, halfW, n: n,
      at(x, z) {
        const fx = clamp((x + this.world) / this.cell - 0.5, 0, this.res - 1.001);
        const fz = clamp((z + this.world) / this.cell - 0.5, 0, this.res - 1.001);
        return { i: fx | 0, j: fz | 0, fx, fz };
      },
      /* distancia al eje de la pista (bilineal, continua) */
      dist(x, z) {
        const s = this.at(x, z);
        const tx = s.fx - s.i, tz = s.fz - s.j, R = this.res, D = this.dArr;
        const i1 = Math.min(s.i + 1, R - 1), j1 = Math.min(s.j + 1, R - 1);
        const a = D[s.j * R + s.i], b = D[s.j * R + i1], c = D[j1 * R + s.i], d = D[j1 * R + i1];
        return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
      },
      seg(x, z) { const s = this.at(x, z); return this.iArr[s.j * this.res + s.i]; },
      pull(x, z, out2) {
        const e = this.cell;
        const dx = this.dist(x + e, z) - this.dist(x - e, z);
        const dz = this.dist(x, z + e) - this.dist(x, z - e);
        const l = Math.hypot(dx, dz) || 1;
        out2[0] = -dx / l; out2[1] = -dz / l;
        return out2;
      },
      grad(x, z, out2) { this.pull(x, z, out2); out2[0] = -out2[0]; out2[1] = -out2[1]; return out2; },
      progress(x, z) { return this.seg(x, z) / this.n; }
    };
    return out;
  }

  /* ============================================================ *
   *  Especificaciones de los 4 mapas
   * ============================================================ */
  const MAPS = [
    {
      id: 'bay', name: 'Bahía del Sol', subtitle: 'Circuito costero · curvas amplias',
      laps: 3, w: 8.4, world: 340, res: 288, minR: 20,
      ctrl: [[-150, -90], [-60, -150], [60, -140], [140, -70], [122, 12], [158, 96], [76, 158], [-44, 152], [-132, 100], [-186, 2]],
      elev: [[0.0, 0], [0.18, 2.2], [0.36, 0.4], [0.55, 4.2], [0.72, 1.0], [0.88, 3.2]],
      bank: 0.34,
      env: {
        sun: [-0.52, 0.5, -0.68], sunCol: '#fff0d8', sunPower: 1.3,
        sky: '#a8c8e8', ground: '#8a8266', ambInt: 1.05,
        fog: '#cfe0ea', fogD: 0.0016,
        zenith: '#2e6fc4', horizon: '#cfe2ef', nadir: '#6d6a5e',
        sunColSky: '#fff6e2', sunSize: 0.6, sunGlow: 0.55, stars: 0,
        exposure: 1.02, envAmt: 1.1, cloudAmt: 0.42, cloudHi: 1.0
      },
      ground: { kind: 'sand', colA: [196, 176, 132], colB: [224, 208, 168], tile: 5, rough: 0.9 },
      grass: { kind: 'grass', colA: [64, 92, 44], colB: [104, 122, 62], tile: 4 },
      road: { col: '#8b8b90', rough: 0.6, marks: 'lane', rumble: [196, 40, 40] },
      water: { y: -1.9, col: '#0e3a52' },
      decor: [
        { type: 'palm', n: 160, ring: [11, 64], scale: [0.85, 1.45] },
        { type: 'bush', n: 140, ring: [10, 70], scale: [0.6, 1.5] },
        { type: 'rock1', n: 70, ring: [11, 95], scale: [0.5, 2.2] },
        { type: 'billboard', n: 7, ring: [16, 32], scale: [0.9, 1.3], yawSnap: true },
        { type: 'stand', n: 4, ring: [15, 30], scale: [1, 1.3], yawSnap: true },
        { type: 'house', n: 18, ring: [42, 130], scale: [0.8, 1.5] }
      ],
      props: { curb: true, rail: true, lamps: 0, gantry: true, arches: 4, waterRing: true, grassRing: [46, 400] },
      palette: ['#f4b942', '#ff6b35', '#12b3a0', '#ef476f', '#f9f7f2']
    },
    {
      id: 'neon', name: 'Neón Ciudad', subtitle: 'Circuito urbano nocturno · muro a muro',
      laps: 3, w: 7.8, world: 330, res: 288, minR: 22,
      ctrl: [[-188, -152], [-52, -190], [104, -182], [198, -118], [204, 4], [122, 62], [10, 42], [-104, 84], [-46, 162], [-162, 176], [-214, 86], [-206, -46]],
      elev: [[0.1, 0], [0.42, 0.7], [0.58, 0], [0.84, 1.3]],
      bank: 0.1,
      env: {
        sun: [-0.3, 0.14, -0.72], sunCol: '#3b4a80', sunPower: 0.3,
        sky: '#1b2340', ground: '#14161f', ambInt: 0.5,
        fog: '#141a2c', fogD: 0.0042,
        zenith: '#050a1a', horizon: '#1d2748', nadir: '#0a0c14',
        sunColSky: '#5a6ba0', sunSize: 0.2, sunGlow: 0.15, stars: 0.95,
        exposure: 1.24, envAmt: 1.35, cloudAmt: 0.14, cloudHi: 0.22
      },
      ground: { kind: 'city', colA: [46, 47, 54], colB: [72, 74, 82], tile: 3.4, rough: 0.8 },
      road: { col: '#6f6f76', rough: 0.44, marks: 'lane', rumble: [220, 210, 90] },
      city: {
        cols: 7, rows: 11, litRatio: 0.62, wall: [78, 80, 92], glass: [26, 40, 66],
        lit: [255, 224, 168], minH: 9, maxH: 52, ring: [12, 150], gap: 7.0
      },
      decor: [
        { type: 'billboard', n: 14, ring: [10.5, 22], scale: [0.8, 1.25], yawSnap: true },
        { type: 'tireStack', n: 46, ring: [9.2, 10.6], scale: [0.8, 1.2] },
        { type: 'pole', n: 26, ring: [9.4, 11], scale: [1, 1.3] }
      ],
      props: { curb: false, rail: false, lamps: 1, gantry: true, arches: 6, neon: true, buildings: true, barrierWall: true },
      palette: ['#19d3ff', '#ff2e88', '#c6ff2e', '#ff8a00', '#ffffff']
    },
    {
      id: 'canyon', name: 'Cañón Rojo', subtitle: 'Desierto · túnel, mesetas y salt flats',
      laps: 3, w: 9.0, world: 350, res: 288, minR: 24,
      ctrl: [[-168, -124], [-52, -176], [74, -162], [170, -88], [188, 18], [120, 86], [6, 66], [-96, 112], [-56, 172], [-170, 156], [-214, 42], [-206, -60]],
      elev: [[0.05, 0], [0.25, 3.4], [0.42, 0.6], [0.62, 5.0], [0.8, 1.4], [0.92, 2.4]],
      bank: 0.4,
      env: {
        sun: [0.62, 0.32, 0.55], sunCol: '#ffd9a8', sunPower: 1.5,
        sky: '#d9a878', ground: '#7a5a44', ambInt: 0.95,
        fog: '#d9b190', fogD: 0.0021,
        zenith: '#9c5f2e', horizon: '#eab888', nadir: '#7a5a44',
        sunColSky: '#ffe8c0', sunSize: 0.9, sunGlow: 0.85, stars: 0,
        exposure: 1.04, envAmt: 0.95, cloudAmt: 0.2, cloudHi: 1.0
      },
      ground: { kind: 'sand', colA: [176, 118, 76], colB: [214, 164, 112], tile: 5.5, rough: 0.94 },
      road: { col: '#7d7a78', rough: 0.68, marks: 'lane', rumble: [210, 190, 170] },
      decor: [
        { type: 'cactus', n: 100, ring: [12, 84], scale: [0.7, 1.5] },
        { type: 'rock2', n: 120, ring: [10, 105], scale: [0.7, 3.4] },
        { type: 'rock1', n: 150, ring: [11, 135], scale: [0.4, 1.8] },
        { type: 'bush', n: 70, ring: [13, 62], scale: [0.5, 1.1] },
        { type: 'silo', n: 5, ring: [32, 95], scale: [0.9, 1.4] },
        { type: 'house', n: 8, ring: [34, 92], scale: [0.8, 1.2] }
      ],
      props: { curb: true, rail: true, lamps: 0, gantry: true, arches: 5, tunnel: [0.44, 0.5], mesa: true, wallRing: true },
      palette: ['#ffb703', '#fb8500', '#e63946', '#f1faee', '#a88062']
    },
    {
      id: 'speedway', name: 'Aeródromo 22', subtitle: 'Óvalo de alta velocidad · pista ancha',
      laps: 4, w: 12.5, world: 320, res: 288, minR: 26,
      ctrl: [[-160, -110], [0, -142], [160, -110], [202, 0], [160, 110], [0, 142], [-160, 110], [-202, 0]],
      elev: [[0, 0], [0.25, 0.5], [0.5, 0], [0.75, 0.5]],
      bank: 1.05,
      env: {
        sun: [0.35, 0.42, -0.75], sunCol: '#fff4e0', sunPower: 1.15,
        sky: '#9fc0d8', ground: '#9a958a', ambInt: 1.0,
        fog: '#d8dcd8', fogD: 0.0014,
        zenith: '#3d7fc8', horizon: '#dfe6ea', nadir: '#8f8878',
        sunColSky: '#fff8ea', sunSize: 0.45, sunGlow: 0.4, stars: 0,
        exposure: 1.03, envAmt: 1.15, cloudAmt: 0.5, cloudHi: 1.0
      },
      ground: { kind: 'salt', colA: [196, 190, 176], colB: [228, 226, 214], tile: 6, rough: 0.8 },
      road: { col: '#94948f', rough: 0.55, marks: 'runway', rumble: [240, 240, 240] },
      lawn: { kind: 'grass', colA: [58, 88, 40], colB: [96, 118, 56] },
      decor: [
        { type: 'hangar', n: 6, ring: [24, 64], scale: [0.9, 1.4], yawSnap: true },
        { type: 'tower', n: 3, ring: [26, 50], scale: [0.9, 1.3], yawSnap: true },
        { type: 'silo', n: 8, ring: [30, 84], scale: [0.8, 1.4] },
        { type: 'stand', n: 6, ring: [17, 24], scale: [1.1, 1.7], yawSnap: true },
        { type: 'rock1', n: 40, ring: [44, 160], scale: [0.5, 1.8] },
        { type: 'pole', n: 30, ring: [16, 19], scale: [1, 1.6] },
        { type: 'cone', n: 54, ring: [13.4, 15.6], scale: [0.9, 1.2] },
        { type: 'tireStack', n: 26, ring: [14.2, 18], scale: [0.95, 1.35] },
        { type: 'bush', n: 44, ring: [22, 78], scale: [0.8, 1.4] }
      ],
      props: { curb: true, rail: true, lamps: 1, gantry: true, arches: 3, cones: true, infield: true, apron: true },
      palette: ['#f2f2f2', '#ffd400', '#2f6fed', '#ff5a2b', '#1b1f26']
    }
  ];
  G.MAPS = MAPS;

  G.Path = { catmull, samplePath, computeMeta, resample, elevProfile, curveRadius, bankProfile, limitCurvature };
  G.makeTrack = makeTrack;
  G.Mask = { build: buildMask };

  /* Validación: el trazado no debe cruzarse consigo mismo */
  G.validateTrack = function (centers, halfW) {
    const n = centers.length, minSep = halfW * 2 + 2;
    let bad = 0, worst = 1e9, at = null;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + Math.floor(n * 0.12); j < n; j += 2) {
        if (n - (j - i) < Math.floor(n * 0.12)) continue;
        const d = Math.hypot(centers[i][0] - centers[j][0], centers[i][1] - centers[j][1]);
        if (d < worst) { worst = d; at = [i, j]; }
        if (d < minSep) bad++;
      }
    }
    return { bad, worst, at, minSep };
  };
})(window.CW);
