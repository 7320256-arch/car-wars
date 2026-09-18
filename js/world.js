/* =====================================================================
   world.js — Ensamblado del mundo por mapa:
   texturas procedurales → materiales → mallas → instancias.
   Incluye terreno con altura coherente con la pista (los coches pisan el
   suelo que ves), pista con peralte, cordillos, quitamiedos, decorado,
   ciudad con ventanas encendidas, túnel, montes y luces puntuales.
   ===================================================================== */
(function (G) {
  'use strict';
  const M = G.M, B = G.Builder, clamp = G.clamp, lerp = G.lerp;
  const Tex = G.Tex;

  /* ---------- rejilla de alturas (muestreo O(1) bilineal) ---------- */
  function makeHeights(track, spec, res) {
    const size = spec.world * 2, cell = size / res;
    const data = new Float32Array(res * res);
    const centers = track.centers, n = track.n, Y = track.Y, bank = track.bank, N = track.N;
    const halfW = spec.w;
    /* altura de la superficie en un punto: sigue la pista y decae al terreno base */
    const baseLevel = spec.water ? spec.water.y + 0.55 : -1.4;
    function surface(x, z) {
      let idx = Math.round(track.mask.seg(x, z)) % n;
      /* vecino más cercano dentro de una ventana (suaviza el ruido del índice) */
      let best = -1, bd = 1e9;
      for (let k = -10; k <= 10; k++) {
        const i = (idx + k + n) % n;
        const d = (centers[i][0] - x) * (centers[i][0] - x) + (centers[i][1] - z) * (centers[i][1] - z);
        if (d < bd) { bd = d; best = i; }
      }
      const i = best;
      const dx = x - centers[i][0], dz = z - centers[i][1];
      const lat = dx * N[i * 2] + dz * N[i * 2 + 1];
      const alat = Math.abs(lat);
      const tilt = bank[i] * 0.13;
      const yTrack = Y[i] + Math.sign(lat || 1) * Math.min(alat, halfW) * tilt;
      const out = clamp((alat - halfW - 1.5) / 46, 0, 1);
      let h = lerp(yTrack - 0.10, baseLevel, G.smooth(out));
      if (spec.ground && spec.ground.kind === 'sand') h += (G.fbm2(x * 0.008, z * 0.008, 3, 7) - 0.5) * 4.2 * out;
      else h += (G.fbm2(x * 0.010, z * 0.010, 3, 7) - 0.5) * 5.4 * out;
      if (spec.water) h = Math.max(h, spec.water.y - 6 + (1 - out) * 0);
      return h;
    }
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = -spec.world + (i + 0.5) * cell, z = -spec.world + (j + 0.5) * cell;
        data[j * res + i] = surface(x, z);
      }
    }
    /* suavizado ligero para que el coche no tiemble con la interpolación */
    const sm = data.slice();
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = clamp(i + di, 0, res - 1), jj = clamp(j + dj, 0, res - 1);
        s += sm[jj * res + ii]; c++;
      }
      data[j * res + i] = s / c;
    }
    return {
      res, cell, world: spec.world, data,
      at(x, z) {
        const R = this.res, W = this.world, C = this.cell;
        const fx = clamp((x + W) / C - 0.5, 0, R - 1.001), fz = clamp((z + W) / C - 0.5, 0, R - 1.001);
        const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
        const D = this.data, i1 = Math.min(i + 1, R - 1), j1 = Math.min(j + 1, R - 1);
        return lerp(lerp(D[j * R + i], D[j * R + i1], tx), lerp(D[j1 * R + i], D[j1 * R + i1], tx), tz);
      },
      /* normal aproximada de la superficie */
      normal(x, z, out) {
        const e = this.cell;
        const dx = this.at(x + e, z) - this.at(x - e, z);
        const dz = this.at(x, z + e) - this.at(x, z - e);
        out[0] = -dx / e; out[1] = 1; out[2] = -dz / e;
        const l = Math.hypot(out[0], out[1], out[2]);
        out[0] /= l; out[1] /= l; out[2] /= l;
        return out;
      }
    };
  }

  /* ---------- cinta de pista con peralte ---------- */
  function surfaceRibbon(b, track, o) {
    const centers = track.centers, n = track.n, Y = track.Y, N = track.N, bank = track.bank;
    const inner = o.inner == null ? 0 : o.inner, outer = o.outer;
    const skip = o.skip;
    const L = track.meta.L;
    const us = o.uvU == null ? 1 / 8 : o.uvU;
    const yOff = o.yOff || 0;
    const P = (i, side) => {
      const lat = side > 0 ? outer : inner;
      const nx = N[i * 2], nz = N[i * 2 + 1];
      const tilt = (bank[i] || 0) * 0.13;
      const y = Y[i] + Math.sign(lat || 1) * Math.abs(lat) * tilt + yOff;
      return [centers[i][0] + nx * lat, y, centers[i][1] + nz * lat];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (skip && (skip(i / n) || skip(j / n))) continue;
      const a = P(i, +1), c = P(j, +1), d = P(j, -1), e = P(i, -1);
      const ua = L[i] * us, ub = L[j] * us;
      b.poly([a, c, d, e], {
        uv: [[ua, o.vA == null ? 1 : o.vA[0]], [ub, o.vA == null ? 1 : o.vA[1]], [ub, o.vA == null ? 0 : o.vA[2]], [ua, o.vA == null ? 0 : o.vA[3]]],
        normal: [0, 1, 0]
      });
      if (o.wall) {
        /* faldón lateral para tapar el hueco hasta el terreno */
        for (const side of [1, -1]) {
          const p0 = P(i, side), p1 = P(j, side);
          const dn = o.wall;
          b.poly([p0, p1, [p1[0], p1[1] - dn, p1[2]], [p0[0], p0[1] - dn, p0[2]]], { normal: [N[i * 2] * side, 0, N[i * 2 + 1] * side] });
        }
      }
    }
    return b;
  }

  /* ---------- decorado: definición por tipo (piezas + materiales) ---------- */
  function scenery(name) {
    const T = {};
    switch (name) {
      case 'palm': {
        const path = [], h = 6.2, lean = 0.55;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          path.push([Math.sin(t * 1.5) * lean * t, t * h, Math.cos(t * 1.2) * lean * 0.35 * t]);
        }
        const top = path[path.length - 1];
        T.trunk = (b) => { b.tube(path, t => lerp(0.24, 0.13, t), 6, {}); };
        T.leaf = (b) => {
          const n = 9;
          for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2;
            const len = 2.5 + Math.cos(i * 2.1) * 0.5, wdt = 0.36;
            const dx = Math.cos(a) * len, dz = Math.sin(a) * len, dy = -0.62;
            const mx = Math.cos(a) * len * 0.55, mz = Math.sin(a) * len * 0.55, my = -0.16;
            const nx = -Math.sin(a) * wdt, nz = Math.cos(a) * wdt;
            b.poly([[top[0], top[1], top[2]], [top[0] + mx + nx, top[1] + my, top[2] + mz + nz],
            [top[0] + dx, top[1] + dy, top[2] + dz], [top[0] + mx - nx, top[1] + my, top[2] + mz - nz]]);
          }
          for (let i = 0; i < 3; i++) b.sphere(top[0] + Math.cos(i * 2.1) * 0.3, top[1] - 0.3, top[2] + Math.sin(i * 2.1) * 0.3, 0.15, 6, 4, 1);
        };
        T.shadow = true; T.grow = [0.8, 1.5];
        return T;
      }
      case 'pine': {
        const h = 5.6;
        T.trunk = (b) => b.cyl(0, h * 0.17, 0, 0.2, 0.14, h * 0.34, 6, {});
        T.leaf = (b) => { for (let i = 0; i < 3; i++) { const t = i / 3; b.cyl(0, h * (0.34 + t * 0.26), 0, lerp(1.55, 0.6, t), i === 2 ? 0.06 : 0.001, h * 0.42, 9, {}); } };
        T.grow = [0.75, 1.4];
        return T;
      }
      case 'cactus': {
        T.leaf = (b) => {
          const h = 3.1;
          b.cyl(0, h / 2, 0, 0.32, 0.27, h, 9, {});
          b.cyl(-0.52, h * 0.45 + 0.4, 0, 0.17, 0.15, 0.95, 8, {});
          b.cyl(-0.52, h * 0.45 + 0.05, 0, 0.19, 0.19, 0.4, 8, {});
          b.cyl(0.46, h * 0.6 + 0.5, 0.05, 0.15, 0.13, 1.1, 8, {});
          b.cyl(0.46, h * 0.6 + 0.05, 0.05, 0.17, 0.17, 0.42, 8, {});
        };
        T.grow = [0.7, 1.5];
        return T;
      }
      case 'bush': {
        T.leaf = (b) => {
          b.rock(0, 0.56, 0, 0.82, 0.66, 0.78, 4);
          b.rock(0.5, 0.4, -0.24, 0.6, 0.5, 0.55, 9);
        };
        T.grow = [0.55, 1.6];
        return T;
      }
      case 'rock1': { T.rock = (b) => b.rock(0, 0.6, 0, 1.0, 0.78, 0.92, 6); T.grow = [0.4, 2.2]; return T; }
      case 'rock2': { T.rock = (b) => b.rock(0, 0.55, 0, 2.2, 1.5, 2.0, 11); T.grow = [0.6, 3.2]; return T; }
      case 'cone': {
        T.body = (b) => { b.cyl(0, 0.035, 0, 0.26, 0.24, 0.07, 9, {}); b.cyl(0, 0.28, 0, 0.19, 0.03, 0.46, 9, {}); };
        T.grow = [0.9, 1.1]; T.noShadow = true;
        return T;
      }
      case 'barrier': {
        T.body = (b) => {
          b.loft([
            { y: 0, pts: [[-0.55, 0.22], [0.55, 0.22], [0.42, -0.22], [-0.42, -0.22]] },
            { y: 0.42, pts: [[-0.42, 0.18], [0.42, 0.18], [0.32, -0.18], [-0.32, -0.18]] },
            { y: 0.86, pts: [[-0.25, 0.13], [0.25, 0.13], [0.25, -0.13], [-0.25, -0.13]] }
          ]);
        };
        T.grow = [1, 1]; T.tiled = 1.6;
        return T;
      }
      case 'tireStack': {
        T.body = (b) => { for (let i = 0; i < 3; i++) b.cyl(0, 0.19 + i * 0.35, 0, 0.35, 0.35, 0.32, 10, {}); };
        T.grow = [0.8, 1.3];
        return T;
      }
      case 'pole': {
        T.body = (b) => b.cyl(0, 3.4, 0, 0.08, 0.055, 6.8, 6, {});
        T.grow = [0.9, 1.5];
        return T;
      }
      case 'lamp': {
        T.post = (b) => {
          b.cyl(0, 4.1, 0, 0.15, 0.11, 8.2, 8, {});
          b.box(0.6, 8.1, 0, 1.5, 0.15, 0.18, { taperTop: [0.82, 1] });
        };
        T.head = (b) => b.box(1.15, 7.98, 0, 0.7, 0.16, 0.34, {});
        T.grow = [1, 1]; T.tiled = 2;
        return T;
      }
      case 'stand': {
        T.body = (b) => {
          b.loft([
            { y: 0, pts: [[-6, -2.2], [6, -2.2], [6, 2.2], [-6, 2.2]] },
            { y: 5.0, pts: [[-6, 2.4], [6, 2.4], [6, 3.0], [-6, 3.0]] }
          ]);
          for (let i = 0; i < 6; i++) b.box(0, 0.85 + i * 0.72, -1.7 + i * 0.63, 11.8, 0.18, 0.63, {});
        };
        T.roof = (b) => { b.box(0, 6.1, 1.0, 12.8, 0.32, 4.8, { taperTop: [1.03, 1.03] }); for (const s of [-1, 1]) b.box(s * 5.6, 3.4, 2.9, 0.24, 5.4, 0.24, {}); };
        T.grow = [0.9, 1.7]; T.tiled = 2.4;
        return T;
      }
      case 'billboard': {
        T.body = (b) => { for (const s of [-1, 1]) b.box(s * 3.2, 3.6, 0, 0.36, 7.2, 0.36, {}); b.box(0, 8.5, 0, 9.6, 4.8, 0.42, {}); };
        T.screen = (b) => { b.poly([[-4.6, 6.2, 0.24], [4.6, 6.2, 0.24], [4.6, 10.7, 0.24], [-4.6, 10.7, 0.24]], { normal: [0, 0, 1], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }); };
        T.grow = [0.8, 1.3]; T.neonOnly = 'screen';
        return T;
      }
      case 'house': {
        T.body = (b) => { b.box(0, 1.7, 0, 7, 3.4, 5.4, {}); b.box(0, 2.2, 2.75, 1.5, 1.6, 0.2, {}); };
        T.roof = (b) => { plate(b, 0, 4.15, 0, 7.9, 6.3, 1.5, 0); b.box(0, 3.4, -1.2, 1.2, 1.7, 1.2, {}); };
        T.grow = [0.75, 1.6]; T.tiled = 2.6;
        return T;
      }
      case 'hangar': {
        T.body = (b) => {
          b.loft([
            { y: 0, pts: [[-9, -7], [9, -7], [9, 7], [-9, 7]] },
            { y: 5.2, pts: [[-9, -7], [9, -7], [9, 7], [-9, 7]] },
            { y: 8.6, pts: [[-7.4, -6.4], [7.4, -6.4], [7.4, 6.4], [-7.4, 6.4]] },
            { y: 9.2, pts: [[-5.6, -5.2], [5.6, -5.2], [5.6, 5.2], [-5.6, 5.2]] }
          ]);
        };
        T.door = (b) => b.box(0, 2.6, 6.95, 7.6, 5.0, 0.3, {});
        T.grow = [0.85, 1.5]; T.tiled = 2.8;
        return T;
      }
      case 'tower': {
        T.body = (b) => {
          b.loft([
            { y: 0, pts: [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]] },
            { y: 9, pts: [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]] },
            { y: 12.2, pts: [[-3.0, -2.1], [3.0, -2.1], [3.0, 2.1], [-3.0, 2.1]] },
            { y: 14.0, pts: [[-2.7, -1.9], [2.7, -1.9], [2.7, 1.9], [-2.7, 1.9]] }
          ]);
        };
        T.glass = (b) => { b.box(0, 13.1, 0, 5.6, 1.5, 3.6, {}); b.cyl(0, 16.4, 0, 0.1, 0.06, 4.4, 5, {}); };
        T.grow = [0.85, 1.4]; T.tiled = 2.4;
        return T;
      }
      case 'silo': {
        T.body = (b) => { b.cyl(0, 4, 0, 2.3, 2.3, 8, 12, {}); b.cyl(0, 8.4, 0, 2.3, 1.4, 1.0, 12, {}); };
        T.grow = [0.8, 1.5]; T.tiled = 2.2;
        return T;
      }
      case 'block': {   /* edificio de ciudad */
        T.body = (b) => b.unitBox();
        T.roof = (b) => { b.box(0, 0.5, 0, 0.62, 0.1, 0.62, {}); };
        T.grow = [1, 1]; T.tiled = 3.2;
        return T;
      }
      case 'wall': {
        T.body = (b) => b.unitBox();
        T.grow = [1, 1]; T.tiled = 2.6;
        return T;
      }
      case 'fence': {
        T.body = (b) => {
          for (const s of [-1, 1]) b.box(s * 1.9, 0.62, 0, 0.1, 1.24, 0.1, {});
          b.box(0, 1.08, 0, 4, 0.1, 0.07, {}); b.box(0, 0.56, 0, 4, 0.1, 0.07, {});
        };
        T.grow = [1, 1.3];
        return T;
      }
      case 'gantry': {
        T.body = (b) => {
          for (const s of [-1, 1]) b.box(s * (7.6), 3.5, 0, 0.8, 7.0, 1.0, {});
          b.box(0, 7.3, 0, 16.0, 1.6, 0.9, {});
        };
        T.screen = (b) => b.box(0, 6.1, 0.15, 6.6, 0.9, 0.4, {});
        T.grow = [1, 1]; T.tiled = 2.2;
        return T;
      }
      case 'pit': {
        T.body = (b) => {
          b.loft([
            { y: 0, pts: [[-17, -5], [17, -5], [17, 5], [-17, 5]] },
            { y: 4.4, pts: [[-17, -5], [17, -5], [17, 5], [-17, 5]] },
            { y: 5.2, pts: [[-17.6, -5.6], [17.6, -5.6], [17.6, 5.6], [-17.6, 5.6]] }
          ]);
        };
        T.glass = (b) => b.box(0, 2.5, 5.05, 27, 2.5, 0.3, {});
        T.roof = (b) => b.box(0, 6.3, -1, 11, 1.5, 6.6, { taperTop: [0.9, 0.9] });
        T.grow = [1, 1]; T.tiled = 2.6;
        return T;
      }
      case 'arch': {
        T.body = (b) => {
          for (const s of [-1, 1]) b.box(s * 9.4, 2.7, 0, 0.6, 5.4, 0.6, {});
          b.box(0, 5.7, 0, 19.4, 0.8, 0.9, {});
        };
        T.grow = [1, 1];
        return T;
      }
    }
    return null;
  }
  function plate(b, cx, cy, cz, w, l, th, tilt) {
    const p = G.roundedRect(w / 2, l / 2, Math.min(th, 0.3), 1);
    const dz = Math.tan(tilt || 0) * th;
    b.loft([{ y: -th / 2, pts: p, off: [0, -dz] }, { y: th / 2, pts: p, off: [0, dz] }], { base: cy, cx: cx, cz: cz });
    return b;
  }

  /* ============================================================ *
   *  Construcción del mundo
   * ============================================================ */
  function build(R, spec, onProgress) {
    /* progreso: onProgress(pct, etiqueta) */
    const step = (label, pct, fn) => { if (onProgress) onProgress(pct, label); fn(); };
    /* reconstruir sobre un renderer usado: liberar materiales, texturas y mallas viejas */
    if (R.resetMaterials) R.resetMaterials();
    else { G.resetMaterials(); R.materials.length = 0; if (R.freeTextures) R.freeTextures(); }
    for (const m of R.meshes.slice()) { try { m.dispose(); } catch (e) { } }
    R.meshes.length = 0;
    R.lights.length = 0;

    const W = {
      spec, groups: [], dyn: [], lights: [], lamps: [], peaks: [],
      props: {}, carGroups: {}, decorByType: {}, propsTotal: 0, dispose() { disposeAll(); },
      /* colisionadores sólidos derivados del bbox del mesh visual */
      solids: [], _sg: new Map(), _sgStamp: new Int32Array(1), _sgTick: 0, _sgHit: [],
      solidTopAt(x, z) {
        const S = W.solids; if (!S.length) return -1e9;
        const list = W.solidsNear(x, z);
        let top = -1e9;
        for (let i = 0; i < list.length; i++) {
          const so = list[i];
          if (Math.hypot(x - so.x, z - so.z) <= so.r) top = Math.max(top, so.y + so.h);
        }
        return top;
      },
      solidsNear(x, z) {
        const out = W._sgHit; out.length = 0;
        const S = W.solids; if (!S.length) return out;
        const cell = 18, st = ++W._sgTick;
        const mark = W._sgStamp;
        for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
          const key = (Math.floor(x / cell) + gx) * 4096 + (Math.floor(z / cell) + gz) + 2048;
          const arr = W._sg.get(key);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const id = arr[i];
            if (mark[id] === st) continue;
            mark[id] = st;
            out.push(S[id]);
          }
        }
        return out;
      }
    };
    const allMeshes = [];
    const SOLID_TMP = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 };
    const mkGroup = (mesh, mat, tag) => {
      const g = R.group(mesh, mat); g.tag = tag || ''; W.groups.push(g); return g;
    };
    const regMesh = (m) => { allMeshes.push(m); return m; };

    /* ---------------- texturas ---------------- */
    const tx = {};
    const night = (spec.env.stars || 0) > 0.3;
    step('Asfalto', 0.1, () => {
      tx.road = Tex.roadTexture({
        base: G.hexToRgb01(spec.road.col).map(v => v * 255 * 0.55),
        line: spec.id === 'neon' ? [226, 232, 240] : [236, 236, 228],
        marks: spec.road.marks, rumble: spec.road.rumble, w: 512, h: 512, name: 'road'
      });
    });
    step('Terreno', 0.22, () => {
      tx.ground = Tex.groundTexture(Object.assign({ name: 'ground' }, spec.ground));
      tx.concrete = Tex.concreteTexture({ base: spec.id === 'neon' ? [92, 94, 100] : [172, 168, 158], size: 256 });
      tx.metal = Tex.metalTexture({ size: 128 });
      tx.rock = Tex.rockTexture({ colA: spec.id === 'canyon' ? [148, 92, 58] : [128, 122, 116], colB: spec.id === 'canyon' ? [212, 158, 104] : [176, 170, 162] });
      tx.hazard = Tex.hazardTexture({ a: spec.id === 'canyon' ? '#e0d6c8' : '#d8352c', b: '#f2f2ee' });
      tx.banner = Tex.bannerTexture({ palette: spec.palette, words: spec.id === 'neon' ? ['NEON CITY', 'TURBO', 'NIGHT MILE', 'APEX'] : ['CAR WARS', 'NITRO', 'DRIFT ZONE', 'APEX', 'TURBO', 'PIT 22'] });
      if (spec.grass) tx.grass = Tex.groundTexture(Object.assign({ name: 'grass2' }, spec.grass));
      if (spec.lawn) tx.lawn = Tex.groundTexture(Object.assign({ name: 'lawn', kind: 'grass' }, spec.lawn));
    });
    if (spec.city) step('Fachadas', 0.36, () => {
      const f = Tex.facadeTextures({
        cols: spec.city.cols, rows: spec.city.rows, night, wall: spec.city.wall, glass: spec.city.glass,
        lit: spec.city.lit, litRatio: spec.city.litRatio, name: 'facade', seed: 3
      });
      tx.facade = f.color; tx.facadeEm = f.emissive;
    });
    step('Materiales', 0.46, () => {
      W.mats = G.Assets.makeMats(R, tx, {
        night,
        groundCol: spec.ground.colA ? G.rgbMix(spec.ground.colA, spec.ground.colB, 0.5) : '#888',
        groundRough: spec.ground.rough, groundTile: spec.ground.tile,
        roadCol: spec.road.col, roadRough: spec.road.rough,
        buildingCol: spec.city ? spec.city.wall : [0.8, 0.78, 0.74],
        windowGlow: night ? 1.5 : (spec.id === 'canyon' ? 0.18 : 0.35),
        rockCol: spec.id === 'canyon' ? '#c98a52' : '#8d8880',
        leafCol: spec.id === 'canyon' ? '#6d7a34' : '#3d7a2e',
        mountCol: spec.id === 'canyon' ? '#a06a44' : '#6f6c74',
        waterCol: spec.water ? spec.water.col : '#0e3a52',
        paintRough: night ? 0.16 : 0.22, paintMetal: night ? 0.6 : 0.45
      });
    });
    /* G.hexToRgb01 maneja arrays; necesitamos mezclar dos colores 0..255 */
    step('Mallas', 0.54, () => {
      W.mesh = G.Assets.buildMeshes(R, W.mats, { night });
      for (const k in W.mesh) regMesh(W.mesh[k]);
      /* kits de coche */
      W.mesh.wheel = regMesh(W.mesh.wheel);
      W.cars = {};
      for (const def of G.Assets.CARS) {
        const kit = {};
        for (const part of ['body', 'glass', 'trim', 'wing', 'lightsF', 'lightsR']) {
          const b = new B({ uvScale: 1 });
          G.Assets.carPart(b, def, part);
          kit[part] = regMesh(b.toMesh(R, def.id + '_' + part, { radius: Math.max(def.L, def.W) * 0.72 }));
        }
        W.cars[def.id] = kit;
      }
    });

    /* ---------------- trazado + alturas ---------------- */
    let track = null, H = null;
    step('Trazado', 0.6, () => {
      track = G.makeTrack(spec);
      W.track = track;
      W.mask = track.mask;
      H = makeHeights(track, spec, 200);
      W.height = H;
      R.shadowSpan = Math.max(110, Math.min(190, spec.w * 14));
    });

    /* ---------------- terreno + agua ---------------- */
    step('Terreno', 0.66, () => {
      const GR = 74;                            /* resolución de la malla de terreno */
      const size = spec.world * 2 + 40, cell = size / GR;
      const b = new B({});
      const hh = (x, z) => {
        const fx = (x + spec.world) / H.cell - 0.5, fz = (z + spec.world) / H.cell - 0.5;
        const i = clamp(Math.round(fx), 0, H.res - 1), j = clamp(Math.round(fz), 0, H.res - 1);
        return H.data[j * H.res + i];
      };
      const grid = [];
      for (let j = 0; j <= GR; j++) {
        const row = [];
        for (let i = 0; i <= GR; i++) {
          const x = -spec.world - 20 + i * cell, z = -spec.world - 20 + j * cell;
          row.push([x, hh(x, z), z]);
        }
        grid.push(row);
      }
      for (let j = 0; j < GR; j++) {
        for (let i = 0; i < GR; i++) {
          const a = grid[j][i], b2 = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
          b.poly([a, b2, c, d]);
        }
      }
      W.mesh.terrain = regMesh(b.toMesh(R, 'terrain', { radius: size }));
      W.groundGroup = mkGroup(W.mesh.terrain, W.mats.ground, 'ground');
      M.identity(M._tmpM || (M._tmpM = M.m4()));
      W.groundGroup.add(M._tmpM);
      W.groundGroup.lock();
      if (spec.water) {
        W.mesh.water = regMesh(planeMesh(R));
        W.waterGroup = mkGroup(W.mesh.water, W.mats.water, 'water');
        const m = M.m4();
        M.fromTRS(m, [0, spec.water.y, 0], 0, [spec.world * 3, 1, spec.world * 3]);
        W.waterGroup.add(m); W.waterGroup.lock();
      }
    });

    /* ---------------- pista ---------------- */
    step('Pista', 0.72, () => {
      const halfW = spec.w;
      /* hombrillo (por debajo del asfalto, sin z-fighting) */
      const bs = new B({});
      surfaceRibbon(bs, track, { inner: -(halfW + 4.6), outer: halfW + 4.6, yOff: -0.10, uvU: 1 / 5, wall: 3.0 });
      W.mesh.shoulder = regMesh(bs.toMesh(R, 'shoulder', { radius: spec.world * 1.3 }));
      const g1 = mkGroup(W.mesh.shoulder, W.mats.shoulder, 'shoulder');
      const m0 = M.m4(); M.identity(m0); g1.add(m0); g1.lock();
      /* asfalto */
      const br = new B({});
      const tunnelF = spec.props.tunnel ? [spec.props.tunnel[0], spec.props.tunnel[1]] : null;
      const skip = tunnelF ? (f => f > tunnelF[0] - 0.004 && f < tunnelF[1] + 0.004) : null;
      surfaceRibbon(br, track, { inner: -halfW, outer: halfW, yOff: 0.0, uvU: 1 / 9.5, skip });
      W.mesh.road = regMesh(br.toMesh(R, 'road', { radius: spec.world * 1.3 }));
      const g2 = mkGroup(W.mesh.road, W.mats.road, 'road');
      const m1 = M.m4(); M.identity(m1); g2.add(m1); g2.lock();
      /* cordillos */
      if (spec.props.curb) {
        const bc = new B({});
        for (const side of [1, -1]) {
          surfaceRibbon(bc, track, {
            inner: side > 0 ? halfW - 0.02 : -halfW + 0.62, outer: side > 0 ? halfW - 0.62 : halfW - 0.02,
            yOff: 0.045, uvU: 1 / 1.5, skip
          });
        }
        W.mesh.curb = regMesh(bc.toMesh(R, 'curb', { radius: spec.world * 1.3 }));
        const g3 = mkGroup(W.mesh.curb, W.mats.curb, 'curb');
        const m2 = M.m4(); M.identity(m2); g3.add(m2); g3.lock();
      }
      /* línea de meta a cuadros */
      {
        const bg = new B({});
        surfaceRibbon(bg, track, {
          inner: -halfW, outer: halfW, yOff: 0.014, uvU: 1 / 1.05,
          skip: f => f > 0.0075
        });
        W.mesh.grid = regMesh(bg.toMesh(R, 'grid', { radius: spec.world }));
        tx.grid = Tex.checkerTexture({ cells: 8, size: 128 });
        W.mats.grid = R.addMaterial(new G.Material({ name: 'grid', color: '#ffffff', roughness: 0.5, texture: tx.grid, texAmount: 1, uvScale: [1, 1] }));
        const g4 = mkGroup(W.mesh.grid, W.mats.grid, 'grid');
        const m3 = M.m4(); M.identity(m3); g4.add(m3); g4.lock();
      }
      /* quitamiedos / muros */
      if (spec.props.rail) {
        const bl = new B({}), bp = new B({});
        const n = track.n;
        for (const side of [1, -1]) {
          const railPath = [], railPath2 = [];
          for (let i = 0; i <= n; i++) {
            const k = i % n;
            const f = k / n;
            if (skip && skip(f)) { railPath.push(null); railPath2.push(null); continue; }
            const off = (halfW + 1.15) * side;
            const tilt = track.bank[k] * 0.13;
            const y = track.Y[k] + Math.sign(off) * Math.abs(off) * tilt + 0.05;
            const x = track.centers[k][0] + track.N[k * 2] * off;
            const z = track.centers[k][1] + track.N[k * 2 + 1] * off;
            railPath.push([x, y + 0.92, z]);
            railPath2.push([x, y + 0.5, z]);
            if (i % 3 === 0) bp.cyl(x, y + 0.5, z, 0.1, 0.09, 1.05, 5, {});
          }
          const seg = (path, r) => {
            let cur = [];
            for (const p of path) {
              if (!p) { if (cur.length > 1) bl.tube(cur, r, 5, {}); cur = []; continue; }
              cur.push(p);
            }
            if (cur.length > 1) bl.tube(cur, r, 5, {});
          };
          seg(railPath, 0.14); seg(railPath2, 0.12);
        }
        W.mesh.rail = regMesh(bl.toMesh(R, 'rail', { radius: spec.world * 1.3 }));
        W.mesh.railPost = regMesh(bp.toMesh(R, 'railPost', { radius: spec.world * 1.3 }));
        let mm = M.m4(); M.identity(mm);
        const gr = mkGroup(W.mesh.rail, W.mats.metal, 'rail'); gr.add(mm); gr.lock();
        const gp = mkGroup(W.mesh.railPost, W.mats.metal, 'railPost'); gp.add(mm); gp.lock();
      }
      if (spec.props.barrierWall) {
        const sdb = scenery('barrier');
        const mb = regMesh((() => { const bb = new B({ uvScale: 1 / 1.6 }); sdb.body(bb); return bb.toMesh(R, 'barrierM', { radius: 1.4 }); })());
        const gb = mkGroup(mb, W.mats.wall, 'wall.barrier');
        const mt2 = regMesh((() => { const bb = new B({ uvScale: 0.6 }); scenery('tireStack').body(bb); return bb.toMesh(R, 'tires', { radius: 1.2 }); })());
        const gt2 = mkGroup(mt2, W.mats.tire, 'wall.tires');
        const nb = track.n;
        const rng3 = G.rngFrom(31337);
        for (const side of [1, -1]) {
          for (let i = 0; i < nb; i += 1) {
            const off = (halfW + 1.25) * side;
            const tilt = track.bank[i] * 0.13;
            const x = track.centers[i][0] + track.N[i * 2] * off;
            const z = track.centers[i][1] + track.N[i * 2 + 1] * off;
            const y = track.Y[i] + Math.sign(off) * Math.abs(off) * tilt - 0.06;
            const yaw = Math.atan2(track.T[i * 2], track.T[i * 2 + 1]);
            const mm2 = M.m4();
            M.fromTRS(mm2, [x, y, z], yaw, [2.6 / (track.meta.total / nb), 1, 1]);
            gb.add(mm2);
            if (i % 6 === 0) {
              const mm3 = M.m4();
              M.fromTRS(mm3, [x + track.N[i * 2] * side * 0.9, y + 0.02, z + track.N[i * 2 + 1] * side * 0.9], rng3() * 3, [1, 1, 1]);
              gt2.add(mm3);
            }
          }
        }
        gb.lock(); gt2.lock();
      }
    });

    /* ---------------- decorado ---------------- */
    step('Decorado', 0.8, () => {
      const rng = G.rngFrom(spec.id.split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 7));
      const n = track.n;
      const placed = new Map();
      const cellS = 9;
      const key = (x, z) => ((x / cellS) | 0) + ',' + ((z / cellS) | 0);
      const tooClose = (x, z, sep) => {
        const ci = (x / cellS) | 0, cj = (z / cellS) | 0;
        for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) {
          const arr = placed.get((ci + a) + ',' + (cj + b2));
          if (!arr) continue;
          for (const p of arr) if ((p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z) < sep * sep) return true;
        }
        return false;
      };
      const mark = (x, z) => {
        const k = key(x, z);
        let a = placed.get(k); if (!a) placed.set(k, a = []);
        a.push([x, z]);
      };
      const defs = spec.decor || [];
      for (const d of defs) {
        const sd = scenery(d.type);
        if (!sd) continue;
        const groups = {};
        /* el collider se deriva del propio mesh (bounding box), no a ojo */
        let footR = 0, topH = 0;
        const SOLIDTYPE = {
          rock1: 1, rock2: 1, mesa: 1, boulder: 1, house: 1, silo: 1, hangar: 1, tower: 1,
          block: 1, wall: 1, pit: 1, stand: 1, billboard: 1, fence: 0
          /* OJO: arch/gantry/pole/cone/bush/tireStack NO son sólidos: los arcos y
             pórticos cruzan POR ENCIMA de la pista a propósito */
        };
        const isSolidType = !!SOLIDTYPE[d.type];
        for (const part in sd) {
          if (part === 'grow' || part === 'tiled' || part === 'shadow' || part === 'noShadow' || part === 'neonOnly') continue;
          const b = new B({ uvScale: sd.tiled ? 1 / sd.tiled : 0.45 });
          sd[part](b);
          const meshName = d.type + '_' + part;
          const mesh = regMesh(b.toMesh(R, meshName, { radius: 9 }));
          if (mesh && mesh.min) {
            footR = Math.max(footR, Math.max(Math.abs(mesh.min[0]), Math.abs(mesh.max[0]),
              Math.abs(mesh.min[2]), Math.abs(mesh.max[2])));
            topH = Math.max(topH, mesh.max[1]);
          }
          const MATMAP = {
            trunk: 'bark', leaf: (spec.id === 'canyon' ? 'leafDry' : 'leaf'), rock: 'rock',
            roof: 'roofTop', glass: night ? 'lampGlow' : 'glass', head: 'lampGlow',
            door: 'metal', post: 'metal', screen: night ? 'neonSign' : 'banner'
          };
          const TYPEMAT = {
            cone: 'plastic', tireStack: 'tire', pole: 'metal', barrier: 'wall',
            hangar: 'wall', silo: 'wall', tower: 'wall', stand: 'wall', house: 'wall',
            pit: 'wall', gantry: 'wall', billboard: 'wall', arch: 'wall', fence: 'metal',
            block: 'building', wall: 'wall'
          };
          let mat = W.mats[MATMAP[part]] || W.mats[TYPEMAT[d.type]] || W.mats.rock;
          if (d.type === 'block' && part !== 'roof') mat = W.mats.building;
          const g = mkGroup(mesh, mat, d.type + '.' + part);
          if (sd.noShadow) g.shadow = false;
          groups[part] = g;
        }
        /* distribuir a lo largo de la pista */
        /* el anillo se mide desde el eje: nunca dentro del asfalto */
        const lo = Math.max(d.ring[0], spec.w + 1.5), hi = Math.max(d.ring[1], lo + 1.2);
        let count = 0, tries = 0;
        while (count < d.n && tries < d.n * 26) {
          tries++;
          const i = (rng() * n) | 0;
          const side = rng() < 0.5 ? -1 : 1;
          const off = side * (lo + rng() * (hi - lo));
          const dmeas = track.mask.dist(
            track.centers[i][0] + track.N[i * 2] * off,
            track.centers[i][1] + track.N[i * 2 + 1] * off);
          if (dmeas < spec.w + 1.2 || dmeas > hi + 8) continue;
          const tilt = track.bank[i] * 0.13;
          const x = track.centers[i][0] + track.N[i * 2] * off;
          const z = track.centers[i][1] + track.N[i * 2 + 1] * off;
          const y = track.Y[i] + Math.sign(off) * Math.abs(off) * tilt;
          const sep = (d.type === 'billboard' || d.type === 'stand' || d.type === 'hangar' || d.type === 'tower' || d.type === 'house' || d.type === 'silo') ? 13 : 4.2;
          if (tooClose(x, z, sep * (d.scale ? d.scale[1] : 1) * 0.8)) continue;
          const sc = d.scale ? lerp(d.scale[0], d.scale[1], rng()) : 1;
          /* un sólido no puede tocar el asfalto: su radio cuenta, no sólo su centro.
             (antes una roca con radio 5-7 m podía quedar con la mitad sobre la pista) */
          if (isSolidType && footR > 0.35) {
            const latX = G.limitAt ? G.limitAt({ track: track, spec: spec, mask: track.mask }, x, z, i, SOLID_TMP).d : Math.abs(off);
            if (latX - footR * sc < spec.w + 0.35) continue;
          }
          let yaw = d.yawSnap ? Math.atan2(track.T[i * 2], track.T[i * 2 + 1]) + (side > 0 ? 0 : Math.PI) : rng() * Math.PI * 2;
          if (sd.grow) { }
          mark(x, z);
          if (isSolidType && footR > 0.55 && d.type !== 'fence') {
            const idx = W.solids.length;
            W.solids.push({ x, z, y: y - 0.05, h: topH * sc + 0.25, r: Math.max(0.7, footR * sc * 0.94) });
            const cell = 18;
            const g0x = Math.floor((x - W.solids[idx].r) / cell), g1x = Math.floor((x + W.solids[idx].r) / cell);
            const g0z = Math.floor((z - W.solids[idx].r) / cell), g1z = Math.floor((z + W.solids[idx].r) / cell);
            for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
              const key = gx * 4096 + gz + 2048;
              let a = W._sg.get(key);
              if (!a) { a = []; W._sg.set(key, a); }
              a.push(idx);
            }
            if (W._sgStamp.length < W.solids.length) {
              const ns = new Int32Array(Math.max(1024, W.solids.length * 2));
              ns.set(W._sgStamp); W._sgStamp = ns;
            }
          }
          for (const part in groups) {
            const mm = M.m4();
            const yRot = (d.type === 'pine' || d.type === 'palm' || d.type === 'cactus' || d.type === 'bush' || d.type === 'rock1' || d.type === 'rock2') ? rng() * 6.28 : yaw;
            M.fromTRS(mm, [x, y - 0.05, z], yRot, [sc, sc, sc]);
            groups[part].add(mm);
          }
          count++;
        }
        for (const part in groups) groups[part].lock();
        W.props[d.type] = groups;
        W.decorByType[d.type] = count;
        W.propsTotal += count;
      }
      /* farolas con luz (neón / speedway) */
      if (spec.props.lamps) {
        const sd = scenery('lamp');
        const b1 = new B({ uvScale: 1 / 2 }), b2 = new B({ uvScale: 0.4 });
        sd.post(b1); sd.head(b2);
        const mPost = regMesh(b1.toMesh(R, 'lampPost', { radius: 12 }));
        const mHead = regMesh(b2.toMesh(R, 'lampHead', { radius: 12 }));
        const gPost = mkGroup(mPost, W.mats.metal, 'lamp.post');
        const gHead = mkGroup(mHead, W.mats.lampGlow, 'lamp.head');
        gHead.shadow = false;
        const stepI = Math.max(6, Math.round(34 / (track.meta.total / track.n)));
        for (let i = 0; i < n; i += stepI) {
          for (const side of [1, -1]) {
            const off = (spec.w + 2.4) * side;
            const x = track.centers[i][0] + track.N[i * 2] * off;
            const z = track.centers[i][1] + track.N[i * 2 + 1] * off;
            const y = track.Y[i] + Math.sign(off) * Math.abs(off) * track.bank[i] * 0.13;
            const yaw = Math.atan2(track.T[i * 2], track.T[i * 2 + 1]) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
            const mm = M.m4();
            M.fromTRS(mm, [x, y - 0.04, z], yaw, [1, 1, 1]);
            gPost.add(mm); gHead.add(mm);
            if (night) W.lamps.push([x + Math.cos(yaw) * 0, y + 8.0, z, 0]);
            else W.lamps.push([x, y + 8.0, z, 1]);
          }
        }
        gPost.lock(); gHead.lock();
      }
      /* ciudad */
      if (spec.props.buildings && spec.city) {
        const sd = scenery('block');
        const mb = regMesh((() => { const b = new B({}); sd.body(b); return b.toMesh(R, 'bldg', { radius: 2.6 }); })());
        const gb = mkGroup(mb, W.mats.building, 'city.body');
        gb.shadow = true;
        const C = spec.city;
        const n2 = n, rng2 = G.rngFrom(991);
        let cnt = 0, tries = 0;
        const target = 190;
        while (cnt < target && tries < target * 30) {
          tries++;
          const i = (rng2() * n2) | 0;
          const side = rng2() < 0.5 ? -1 : 1;
          const off = side * (C.ring[0] + spec.w + rng2() * (C.ring[1] - C.ring[0]));
          const x = track.centers[i][0] + track.N[i * 2] * off;
          const z = track.centers[i][1] + track.N[i * 2 + 1] * off;
          const dRoad = track.mask.dist(x, z);
          const fw = lerp(9, 26, rng2());
          const fd = lerp(9, 26, rng2());
          const room = dRoad - spec.w - C.gap;
          if (room < Math.hypot(fw, fd) / 2 * 0.85) continue;
          const cy = H.at(x, z);
          const dist0 = Math.hypot(x, z);
          const downtown = clamp(1 - dist0 / (spec.world * 0.92), 0, 1);
          const hgt = lerp(C.minH, C.maxH, Math.pow(rng2() * 0.55 + downtown * 0.62, 1.35));
          const mm = M.m4();
          const yaw = Math.round(rng2() * 4) * Math.PI / 2 + (spec.id === 'neon' ? 0.0 : rng2() * 0.4);
          M.fromTRS(mm, [x, cy - 0.4, z], yaw, [fw, hgt, fd]);
          M.setColor(mm, null);
          gb.add(mm, { uvTile: 3.1 });
          cnt++;
        }
        gb.lock();
      }
      /* montes / mesetas en el horizonte */
      {
        const mp = regMesh((() => { const b = new B({}); b.peak(2, 1, 2, { jitter: 0.22, seed: 5 }); return b.toMesh(R, 'peak', { radius: 2.4 }); })());
        const gm = mkGroup(mp, W.mats.mount, 'mountain');
        const mrng = G.rngFrom(4242);
        const R0 = spec.world * 0.98, R1 = spec.world * 1.75;
        const count = 34;
        for (let i = 0; i < count; i++) {
          const a = i / count * Math.PI * 2 + (mrng() - 0.5) * 0.14;
          const r = lerp(R0, R1, mrng());
          const sx = lerp(40, 120, mrng()), sz = lerp(40, 130, mrng());
          const sy = lerp(16, 70, Math.pow(mrng(), 1.2)) * (spec.id === 'speedway' ? 0.6 : 1);
          const mm = M.m4();
          M.fromTRS(mm, [Math.cos(a) * r, -3.5, Math.sin(a) * r], mrng() * 6.28, [sx, sy, sz]);
          const fade = clamp(1 - (r - R0) / (R1 - R0), 0, 1);
          M.setColor(mm, spec.id === 'canyon' ? [0.8 + fade * 0.3, 0.55 + fade * 0.3, 0.42 + fade * 0.3] : [0.7 + fade * 0.35, 0.72 + fade * 0.33, 0.78 + fade * 0.3]);
          gm.add(mm);
        }
        if (spec.id === 'canyon') {
          const mm2 = regMesh((() => { const b = new B({}); b.mesa(2, 1, { taper: 1.5 }); return b.toMesh(R, 'mesa', { radius: 2.2 }); })());
          const gm2 = mkGroup(mm2, W.mats.mount, 'mesa');
          for (let i = 0; i < 16; i++) {
            const a = i / 16 * Math.PI * 2 + 0.3;
            const r = lerp(spec.world * 0.72, spec.world * 1.1, mrng());
            const sx = lerp(26, 66, mrng()), sy = lerp(12, 34, mrng());
            const m3 = M.m4();
            M.fromTRS(m3, [Math.cos(a) * r, -2, Math.sin(a) * r], mrng() * 3, [sx, sy, sx * lerp(0.8, 1.4, mrng())]);
            gm2.add(m3);
            gm2.shadow = true;
          }
          gm2.lock();
        }
        gm.lock();
      }
      /* muros de cañón a los lados */
      if (spec.props.wallRing) {
        const bw = new B({ uvScale: 1 / 3 });
        const bl = new B({ uvScale: 1 / 3 });
        const wallOn = (i) => {
          const f = i / n;
          return !(spec.props.tunnel && f > spec.props.tunnel[0] - 0.03 && f < spec.props.tunnel[1] + 0.03);
        };
        for (const side of [1, -1]) {
          const rows = [];
          for (let k = 0; k <= n; k++) {
            const i = k % n;
            const off = (spec.w + 13.5) * side;
            const x = track.centers[i][0] + track.N[i * 2] * off;
            const z = track.centers[i][1] + track.N[i * 2 + 1] * off;
            const base = H.at(x, z);
            const top = base + lerp(14, 30, 0.5 + 0.5 * Math.sin(i * 0.11 + side));
            rows.push([[x, base - 3, z], [x, top, z], wallOn(i)]);
          }
          let cur = [];
          for (let k = 0; k < rows.length; k++) {
            if (!rows[k][2] || !rows[Math.min(k + 1, rows.length - 1)][2]) { cur = []; continue; }
            const a = rows[k], b2 = rows[Math.min(k + 1, rows.length - 1)];
            bw.poly([a[0], b2[0], b2[1], a[1]], { normal: [-track.N[k % n * 2] * side, 0, -track.N[k % n * 2 + 1] * side] });
          }
        }
        W.mesh.canyonWall = regMesh(bw.toMesh(R, 'canyonWall', { radius: spec.world * 1.4 }));
        const gw = mkGroup(W.mesh.canyonWall, W.mats.rock, 'canyonWall');
        const mm = M.m4(); M.identity(mm); gw.add(mm); gw.lock();
      }
      /* túnel */
      if (spec.props.tunnel) {
        const [a0, a1] = spec.props.tunnel;
        const i0 = Math.floor(a0 * n), i1 = Math.floor(a1 * n);
        const bt = new B({ uvScale: 1 / 4 });
        const path = [];
        for (let i = i0 - 2; i <= i1 + 2; i++) {
          const k = ((i % n) + n) % n;
          path.push([track.centers[k][0], track.Y[k] + 2.6, track.centers[k][1]]);
        }
        bt.tube(path, spec.w + 5.2, 12, { inside: true });
        W.mesh.tunnel = regMesh(bt.toMesh(R, 'tunnel', { radius: spec.world }));
        const gt = mkGroup(W.mesh.tunnel, W.mats.rock, 'tunnel');
        gt.shadow = false;
        let mm2 = M.m4(); M.identity(mm2); gt.add(mm2); gt.lock();
        /* cubrimiento rocoso + portales */
        const br = new B({ uvScale: 1 / 3 });
        for (let i = i0 - 1; i <= i1 + 1; i++) {
          const k = ((i % n) + n) % n;
          const c = track.centers[k];
          br.rock(c[0], track.Y[k] + 12.5, c[1], spec.w + 9, 9, spec.w * 0.9 + 8, i * 1.7);
        }
        W.mesh.tunnelTop = regMesh(br.toMesh(R, 'tunnelTop', { radius: spec.world }));
        const gt2 = mkGroup(W.mesh.tunnelTop, W.mats.rock, 'tunnelTop');
        let mm3 = M.m4(); M.identity(mm3); gt2.add(mm3); gt2.lock();
      }
    });

    /* ---------------- anillos de checkpoint (dinámicos) ---------------- */
    step('Checkpoints', 0.9, () => {
      const mr = regMesh((() => { const b = new B({}); b.cyl(0, 0, 0, 1.0, 0.86, 0.09, 20, {}); return b.toMesh(R, 'ckRing', { radius: 1.05 }); })());
      const mp = regMesh((() => { const b = new B({}); b.box(0, 2.4, 0, 0.24, 4.8, 0.24, {}); return b.toMesh(R, 'ckPillar', { radius: 2.6 }); })());
      W.ckRing = mkGroup(mr, W.mats.checkpoint, 'ck.ring');
      W.ckPillar = mkGroup(mp, W.mats.checkpoint, 'ck.pillar');
      W.ckRing.shadow = false; W.ckPillar.shadow = false;
      const n = track.n;
      const spacing = clamp(track.meta.total / 7, 90, 260);
      const stepI = Math.round(spacing / (track.meta.total / n));
      W.checkpoints = [];
      for (let i = 0; i < n; i += stepI) {
        const c = track.centers[i];
        W.checkpoints.push({
          x: c[0], z: c[1], y: track.Y[i], yaw: Math.atan2(track.T[i * 2], track.T[i * 2 + 1]),
          i, prog: i / n, r: spec.w + 3.2
        });
      }
      if (W.checkpoints.length < 2) W.checkpoints.push({ x: track.centers[0][0], z: track.centers[0][1], y: track.Y[0], yaw: 0, i: 0, prog: 0, r: spec.w + 3.2 });
      /* rejilla de salida: 8 puestos */
      W.gridSlots = [];
      for (let k = 0; k < 8; k++) {
        const i = ((n - Math.round((k * 7 + 12) / (track.meta.total / n))) % n + n) % n;
        const side = k % 2 ? 1 : -1;
        const off = side * spec.w * 0.42;
        W.gridSlots.push({
          x: track.centers[i][0] + track.N[i * 2] * off,
          z: track.centers[i][1] + track.N[i * 2 + 1] * off,
          y: track.Y[i], yaw: Math.atan2(track.T[i * 2], track.T[i * 2 + 1]), i
        });
      }
    });

    /* ---------------- grupos dinámicos de coches ---------------- */
    step('Preparando', 0.96, () => {
      const mk = W.mats;
      for (const def of G.Assets.CARS) {
        const kit = W.cars[def.id];
        W.carGroups[def.id] = {
          body: mkGroup(kit.body, mk.paint, 'car.body'),
          trim: mkGroup(kit.trim, mk.dark, 'car.trim'),
          wing: mkGroup(kit.wing, mk.paint, 'car.wing'),
          glass: mkGroup(kit.glass, mk.glass, 'car.glass'),
          lightsF: mkGroup(kit.lightsF, mk.head, 'car.head'),
          lightsR: mkGroup(kit.lightsR, mk.tail, 'car.tail'),
          wheel: mkGroup(W.mesh.wheel, mk.tire, 'car.wheel'),
          rim: mkGroup(W.mesh.wheel, mk.rim, 'car.rim'),
          beam: mkGroup(W.mesh.beam, mk.beam, 'car.beam'),
          under: mkGroup(W.mesh.plane, mk.neon, 'car.under')
        };
        W.carGroups[def.id].rim.shadow = false;
        W.carGroups[def.id].beam.shadow = false;
        W.carGroups[def.id].under.shadow = false;
        W.carGroups[def.id].glass.shadow = false;
        W.carGroups[def.id].lightsR.shadow = false;
        W.carGroups[def.id].lightsF.shadow = false;
        W.dyn.push(...Object.values(W.carGroups[def.id]));
      }
      /* marcador de meta / flechas */
      W.marker = mkGroup(regMesh((() => { const b = new B({}); b.loft([{ y: 0, pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }, { y: 1, pts: [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]] }]); return b.toMesh(R, 'beacon'); })()), W.mats.checkpoint, 'beacon');
      W.marker.shadow = false;
      /* agua animada / nada */
      W.night = night;
      W.lampLights = W.lamps.slice();
      /* resumen para el minimapa */
      const n = track.n;
      const xs = new Float32Array(n), zs = new Float32Array(n);
      for (let i = 0; i < n; i++) { xs[i] = track.centers[i][0]; zs[i] = track.centers[i][1]; }
      W.minimap = { xs, zs, world: spec.world, w: spec.w };
      /* luces del entorno */
      R.setEnv(Object.assign({}, spec.env));
      if (spec.water) R.env.water = spec.water.y;
      /* ---- sombra falsa (blob) por coche: disco plano, escalado por instancia.
             Está siempre activa: en calidad baja el shadow-map no se dibuja y
             sin esto los coches «flotan». ---- */
      {
        const bb = new B({});
        bb.cyl(0, 0, 0, 1, 1, 0.02, 16, {});
        const bm = regMesh(bb.toMesh(R, 'shadowBlob', { radius: 0 }));
        W.blobGroup = mkGroup(bm, W.mats.blob, 'car.shadow');
        W.blobGroup.shadow = false;
      }
      W.stats = { meshes: R.meshes.length, groups: W.groups.length, draws: R.meshes.length, props: W.propsTotal, decor: W.decorByType };
    });


    function disposeAll() {
      for (const m of allMeshes) { try { m.dispose(); } catch (e) { } }
      allMeshes.length = 0;
      W.groups.length = 0; W.dyn.length = 0; W.lights.length = 0;
      R.meshes.length = 0;
      R.freeTextures();
      R.materials.length = 0;
      G.resetMaterials();
    }
    return W;
  }

  function planeMesh(R) {
    const b = new G.Builder();
    b.poly([[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]], { normal: [0, 1, 0] });
    return b.toMesh(R, 'plane', { radius: 1.45 });
  }

  /* utilidades de color usadas por world */
  G.rgbMix = (a, b, t) => {
    const A = Array.isArray(a) ? a.map(v => v / 255) : G.hexToRgb01(a);
    const Bv = Array.isArray(b) ? b.map(v => v / 255) : G.hexToRgb01(b);
    return [lerp(A[0], Bv[0], t), lerp(A[1], Bv[1], t), lerp(A[2], Bv[2], t)];
  };

  G.World = { build, makeHeights, surfaceRibbon, scenery };
})(window.CW);
