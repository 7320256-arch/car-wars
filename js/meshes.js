/* =====================================================================
   meshes.js — Catálogo de modelos 3D procedurales y materiales.
   Ningún asset externo: todo se genera con el Builder de primitives.js.
   Piezas por coche (cada una es una malla instanciable):
     body · glass · trim · wing · lightsF · lightsR · glow
   ===================================================================== */
(function (G) {
  'use strict';
  const B = G.Builder, clamp = G.clamp, lerp = G.lerp;

  /* ============================================================ *
   *  Definicines de coches (geometría + prestaciones)
   * ============================================================ */
  const CARS = [
    {
      id: 'coupe', name: 'Vortex GT', cls: 'Deportivo',
      desc: 'Equilibrado, gran paso por curva. El mejor para circuitos.',
      L: 4.45, W: 1.90, clr: 0.115, wheelR: 0.325, wheelW: 0.245, wb: 2.62, track: 1.60,
      cabin: { front: 0.30, back: -0.62, h1: 0.50, h2: 0.90, hw: 0.80 },
      style: 'coupe',
      color: '#d8203a', color2: '#16181d',
      stats: { power: 1.00, grip: 1.03, brake: 1.00, mass: 1280, top: 236, downforce: 0.9, drift: 1.00, gear: 5.2,
        gears: 6, redline: 7200, cyl: 6, drive: 'rwd', balance: 0.05, agility: 1.00, ride: 0.55, boost: 1.00,
        offRoad: 0.75, fragility: 1.00, torqueK: 1.00 },
          },
    {
      id: 'muscle', name: 'Hammer V8', cls: 'Muscle',
      desc: 'Bestial en recta, sobreviraje brutal. Derrapa de maravilla.',
      L: 4.90, W: 1.98, clr: 0.135, wheelR: 0.345, wheelW: 0.285, wb: 2.86, track: 1.68,
      cabin: { front: 0.14, back: -0.78, h1: 0.55, h2: 0.96, hw: 0.84 },
      style: 'muscle',
      color: '#f2a10c', color2: '#101114',
      stats: { power: 1.22, grip: 0.90, brake: 0.94, mass: 1660, top: 252, downforce: 0.5, drift: 1.35, gear: 4.6,
        gears: 4, redline: 6400, cyl: 8, drive: 'rwd', balance: 0.42, agility: 0.84, ride: 0.86, boost: 1.16,
        offRoad: 0.62, fragility: 1.10, torqueK: 1.14 },
          },
    {
      id: 'hatch', name: 'Pixel Turbo', cls: 'Hot Hatch',
      desc: 'Pequeño, ágil y pegajoso. Rey de los tramos lentos.',
      L: 3.95, W: 1.80, clr: 0.145, wheelR: 0.315, wheelW: 0.225, wb: 2.42, track: 1.55,
      cabin: { front: 0.34, back: -0.90, h1: 0.55, h2: 1.10, hw: 0.83 },
      style: 'hatch',
      color: '#1e9bff', color2: '#141619',
      stats: { power: 0.88, grip: 1.12, brake: 1.05, mass: 1090, top: 208, downforce: 0.6, drift: 1.15, gear: 5.8,
        gears: 5, redline: 8200, cyl: 3, drive: 'fwd', balance: -0.34, agility: 1.22, ride: 0.62, boost: 1.08,
        offRoad: 0.70, fragility: 0.92, torqueK: 0.96 },
          },
    {
      id: 'suv', name: 'Grizzly 4x4', cls: 'SUV',
      desc: 'Pesado pero imparable: perdona errores y golpea fuerte.',
      L: 4.80, W: 2.05, clr: 0.245, wheelR: 0.40, wheelW: 0.30, wb: 2.80, track: 1.74,
      cabin: { front: 0.20, back: -0.92, h1: 0.66, h2: 1.28, hw: 0.90 },
      style: 'suv',
      color: '#2f7d4f', color2: '#101215',
      stats: { power: 1.02, grip: 0.86, brake: 0.90, mass: 2150, top: 214, downforce: 0.35, drift: 0.80, gear: 4.2,
        gears: 6, redline: 5000, cyl: 4, drive: 'awd', balance: 0.02, agility: 0.76, ride: 1.18, boost: 1.22,
        offRoad: 1.00, fragility: 0.80, torqueK: 1.22 },
          },
    {
      id: 'proto', name: 'NF-01 Evo', cls: 'Prototipo',
      desc: 'Aerodinámica extrema y potencia bruta. Sólo para expertos.',
      L: 4.95, W: 2.00, clr: 0.055, wheelR: 0.345, wheelW: 0.32, wb: 2.95, track: 1.72,
      cabin: { front: 0.10, back: -0.70, h1: 0.44, h2: 0.80, hw: 0.62 },
      style: 'proto',
      color: '#e6e9ee', color2: '#1a1d24',
      stats: { power: 1.34, grip: 1.17, brake: 1.10, mass: 1010, top: 294, downforce: 1.60, drift: 0.95, gear: 6.0,
        gears: 7, redline: 11000, cyl: 6, drive: 'awd', balance: -0.08, agility: 1.08, ride: 0.30, boost: 1.34,
        offRoad: 0.68, fragility: 1.35, torqueK: 0.92 },
          }
  ];
  G.CARS = CARS;

  /* ---------- utilidades de perfil ---------- */
  function prof(hx, hz, r, taperF, taperR, seg) {
    /* perfil en XZ con la nariz (+z) y la zaga (-z) afiladas */
    const base = G.roundedRect(hx, hz, r, seg == null ? 2 : seg);
    return base.map(p => {
      const tz = clamp(p[1] / hz, -1, 1);
      const t = tz > 0 ? lerp(1, taperF, Math.pow(tz, 1.6)) : lerp(1, taperR, Math.pow(-tz, 1.6));
      return [p[0] * t, p[1]];
    });
  }
  function plate(b, cx, cy, cz, w, l, th, tilt, r) {
    /* placa inclinada: dos niveles desplazados en z */
    const p = G.roundedRect(w / 2, l / 2, r == null ? th : r, 1);
    const dz = Math.tan(tilt || 0) * th;
    b.loft([
      { y: -th / 2, pts: p, off: [0, -dz] },
      { y: th / 2, pts: p, off: [0, dz] }
    ], { base: cy, cx: cx, cz: cz });
    return b;
  }

  /* ============================================================ *
   *  Constructores de carrocería por estilo
   * ============================================================ */
  const BUILD = {
    coupe(b, d, part) {
      const hz = d.L / 2, hw = d.W / 2, c = d.cabin;
      if (part === 'body') {
        b.loft([
          { y: d.clr, pts: prof(hw * 0.90, hz - 0.10, 0.16) },
          { y: d.clr + 0.14, pts: prof(hw, hz, 0.30, 0.90, 0.98) },
          { y: d.clr + 0.34, pts: prof(hw * 0.985, hz - 0.02, 0.22, 0.86, 0.97) },
          { y: d.clr + 0.47, pts: prof(hw * 0.93, hz - 0.10, 0.14, 0.60, 0.88) }
        ]);
        /* capó y maletero (líneas de hombro) */
        b.box(0, d.clr + 0.40, hz * 0.55, hw * 1.5, 0.05, hz * 0.62, { taperTop: [0.94, 0.96] });
        /* techo */
        b.box(0, c.h2 + 0.02, (c.front + c.back) * hz / 2, hw * 1.44, 0.06, (c.front - c.back) * hz / 2 * 0.92, { taperTop: [0.94, 0.9] });
        /* pilares A/B/C */
        const zc = (c.front + c.back) * hz / 2, zl = c.front * hz, zr = c.back * hz;
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.88, c.h1 + 0.19, zl - 0.10, 0.075, 0.42, 0.13, {});
          b.box(s * hw * 0.90, c.h1 + 0.21, zr + 0.18, 0.085, 0.44, 0.16, {});
        }
        /* parachoques */
        b.box(0, d.clr + 0.14, hz - 0.02, hw * 1.9, 0.24, 0.20, { taperTop: [0.94, 0.86] });
        b.box(0, d.clr + 0.16, -hz + 0.03, hw * 1.9, 0.26, 0.22, { taperTop: [0.94, 0.88] });
        /* faldones */
        for (const s of [-1, 1]) b.box(s * (hw * 0.985), d.clr + 0.06, 0, 0.10, 0.14, d.wb * 0.86, {});
        /* escapes */
        b.cyl(sx(-1, 0.52), d.clr + 0.09, -hz - 0.06, 0.055, 0.05, 0.16, 8, { axis: 'z', caps: false });
        b.cyl(sx(1, 0.52), d.clr + 0.09, -hz - 0.06, 0.055, 0.05, 0.16, 8, { axis: 'z', caps: false });
      } else if (part === 'glass') {
        const zl = c.front * hz, zr = c.back * hz;
        b.loft([
          { y: c.h1, pts: prof(hw * 0.90, (zl - zr) / 2, 0.10), cxOff: 0 },
          { y: c.h2 - 0.02, pts: prof(hw * 0.78, (zl - zr) / 2 * 0.70, 0.08), off: [0, (zl + zr) / 2 * 0.35] }
        ]);
      } else if (part === 'trim') {
        const zl = c.front * hz;
        /* parrilla + tomas */
        b.box(0, d.clr + 0.20, hz + 0.055, hw * 1.05, 0.14, 0.08, {});
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.62, d.clr + 0.21, hz - 0.02, 0.28, 0.11, 0.06, {});
          /* retrovisores */
          b.box(s * (hw + 0.11), c.h1 + 0.10, zl - 0.34, 0.16, 0.09, 0.07, {});
          b.box(s * (hw + 0.03), c.h1 + 0.09, zl - 0.30, 0.09, 0.05, 0.12, {});
          /* alerón lateral / quilla */
          b.box(s * hw * 0.99, d.clr + 0.30, -hz * 0.55, 0.05, 0.06, 0.5, {});
        }
        /* difusor trasero */
        b.box(0, d.clr + 0.03, -hz - 0.03, hw * 1.5, 0.12, 0.16, {});
      } else if (part === 'wing') {
        plate(b, 0, d.clr + 0.62, -hz + 0.16, hw * 1.62, 0.34, 0.045, -0.16);
        for (const s of [-1, 1]) b.box(s * hw * 0.66, d.clr + 0.52, -hz + 0.20, 0.05, 0.20, 0.10, {});
      }
    },
    muscle(b, d, part) {
      const hz = d.L / 2, hw = d.W / 2, c = d.cabin;
      if (part === 'body') {
        b.loft([
          { y: d.clr, pts: prof(hw * 0.90, hz - 0.12, 0.12) },
          { y: d.clr + 0.16, pts: prof(hw, hz, 0.20, 0.94, 0.99) },
          { y: d.clr + 0.40, pts: prof(hw * 0.98, hz - 0.03, 0.14, 0.92, 0.97) },
          { y: d.clr + 0.50, pts: prof(hw * 0.92, hz - 0.14, 0.10, 0.70, 0.92) }
        ]);
        b.box(0, c.h2 + 0.02, (c.front + c.back) * hz / 2, hw * 1.52, 0.07, (c.front - c.back) * hz / 2 * 0.94, { taperTop: [0.96, 0.94] });
        b.box(0, d.clr + 0.44, hz * 0.50, hw * 1.6, 0.06, hz * 0.72, { taperTop: [0.96, 0.98] });
        /* entrada de aire en el capó */
        b.box(0, d.clr + 0.55, hz * 0.42, 0.34, 0.16, 0.42, { taperTop: [1.06, 0.86] });
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.88, c.h1 + 0.17, c.front * hz - 0.12, 0.08, 0.40, 0.14, {});
          b.box(s * hw * 0.90, c.h1 + 0.20, c.back * hz + 0.24, 0.09, 0.44, 0.18, {});
        }
        b.box(0, d.clr + 0.16, hz - 0.01, hw * 1.94, 0.30, 0.24, { taperTop: [0.92, 0.84] });
        b.box(0, d.clr + 0.18, -hz + 0.02, hw * 1.94, 0.30, 0.24, { taperTop: [0.92, 0.86] });
        for (const s of [-1, 1]) {
          b.box(s * (hw * 0.99), d.clr + 0.07, 0, 0.11, 0.16, d.wb * 0.9, {});
          b.cyl(s * 0.60, d.clr + 0.10, -hz - 0.08, 0.065, 0.06, 0.2, 8, { axis: 'z', caps: false });
        }
      } else if (part === 'glass') {
        b.loft([
          { y: c.h1, pts: prof(hw * 0.88, (c.front - c.back) * hz / 2 * 0.92, 0.08) },
          { y: c.h2 - 0.03, pts: prof(hw * 0.80, (c.front - c.back) * hz / 2 * 0.62, 0.07), off: [0, (c.front + c.back) * hz * 0.28] }
        ]);
      } else if (part === 'trim') {
        b.box(0, d.clr + 0.30, hz + 0.06, hw * 1.25, 0.22, 0.09, {});
        for (const s of [-1, 1]) {
          b.box(s * (hw + 0.13), c.h1 + 0.13, c.front * hz - 0.40, 0.19, 0.11, 0.08, {});
          b.box(s * hw * 0.55, d.clr + 0.13, hz - 0.03, 0.30, 0.10, 0.06, {});
        }
        b.box(0, d.clr + 0.05, -hz - 0.04, hw * 1.6, 0.14, 0.18, {});
      } else if (part === 'wing') {
        plate(b, 0, d.clr + 0.66, -hz + 0.20, hw * 1.5, 0.42, 0.055, -0.10);
        for (const s of [-1, 1]) b.box(s * hw * 0.62, d.clr + 0.55, -hz + 0.24, 0.06, 0.24, 0.12, {});
      }
    },
    hatch(b, d, part) {
      const hz = d.L / 2, hw = d.W / 2, c = d.cabin;
      if (part === 'body') {
        b.loft([
          { y: d.clr, pts: prof(hw * 0.92, hz - 0.08, 0.14) },
          { y: d.clr + 0.15, pts: prof(hw, hz, 0.22, 0.88, 0.99) },
          { y: d.clr + 0.42, pts: prof(hw * 0.985, hz - 0.04, 0.16, 0.80, 0.98) },
          { y: d.clr + 0.52, pts: prof(hw * 0.95, hz - 0.16, 0.12, 0.66, 0.95) }
        ]);
        /* techo alto y corto (monovolumen) */
        b.box(0, c.h2 + 0.01, (c.front + c.back) * hz / 2, hw * 1.60, 0.10, (c.front - c.back) * hz / 2 * 0.98, { taperTop: [0.9, 0.86] });
        b.box(0, d.clr + 0.14, hz - 0.02, hw * 1.86, 0.24, 0.22, { taperTop: [0.9, 0.82] });
        b.box(0, d.clr + 0.20, -hz + 0.02, hw * 1.86, 0.34, 0.20, { taperTop: [0.9, 0.9] });
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.86, c.h1 + 0.24, c.front * hz - 0.16, 0.075, 0.46, 0.13, {});
          b.box(s * hw * 0.90, c.h1 + 0.28, c.back * hz + 0.14, 0.09, 0.56, 0.16, {});
          b.box(s * (hw + 0.10), c.h1 + 0.16, c.front * hz - 0.42, 0.15, 0.10, 0.08, {});
        }
        b.cyl(0.42, d.clr + 0.10, -hz - 0.05, 0.05, 0.045, 0.14, 8, { axis: 'z', caps: false });
      } else if (part === 'glass') {
        b.loft([
          { y: c.h1, pts: prof(hw * 0.9, (c.front - c.back) * hz / 2 * 0.94, 0.10) },
          { y: c.h2 - 0.05, pts: prof(hw * 0.84, (c.front - c.back) * hz / 2 * 0.88, 0.09), off: [0, (c.front + c.back) * hz * 0.06] }
        ]);
      } else if (part === 'trim') {
        b.box(0, d.clr + 0.24, hz + 0.05, hw * 1.0, 0.12, 0.07, {});
        for (const s of [-1, 1]) b.box(s * hw * 0.5, d.clr + 0.16, hz - 0.02, 0.26, 0.10, 0.05, {});
        b.box(0, d.clr + 0.5, -hz + 0.06, hw * 1.5, 0.20, 0.06, {});
      } else if (part === 'wing') {
        plate(b, 0, c.h2 + 0.10, -hz + 0.10, hw * 1.25, 0.26, 0.05, -0.30);
      }
    },
    suv(b, d, part) {
      const hz = d.L / 2, hw = d.W / 2, c = d.cabin;
      if (part === 'body') {
        b.loft([
          { y: d.clr, pts: prof(hw * 0.94, hz - 0.14, 0.14) },
          { y: d.clr + 0.20, pts: prof(hw, hz, 0.22, 0.92, 0.99) },
          { y: d.clr + 0.55, pts: prof(hw * 0.99, hz - 0.05, 0.16, 0.9, 0.98) },
          { y: d.clr + 0.68, pts: prof(hw * 0.96, hz - 0.14, 0.12, 0.80, 0.96) }
        ]);
        b.box(0, c.h2 + 0.02, (c.front + c.back) * hz / 2, hw * 1.66, 0.10, (c.front - c.back) * hz / 2 * 0.96, { taperTop: [0.94, 0.92] });
        /* barras de techo */
        for (const s of [-1, 1]) b.box(s * hw * 0.80, c.h2 + 0.11, -0.02, 0.06, 0.06, (c.front - c.back) * hz * 0.78, {});
        b.box(0, d.clr + 0.24, hz - 0.01, hw * 1.9, 0.40, 0.24, { taperTop: [0.92, 0.86] });
        b.box(0, d.clr + 0.26, -hz + 0.02, hw * 1.9, 0.42, 0.22, { taperTop: [0.92, 0.9] });
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.9, c.h1 + 0.28, c.front * hz - 0.20, 0.09, 0.58, 0.16, {});
          b.box(s * hw * 0.92, c.h1 + 0.30, c.back * hz + 0.20, 0.10, 0.62, 0.20, {});
          b.box(s * (hw * 0.99), d.clr + 0.10, 0, 0.12, 0.20, d.wb * 0.88, {});
        }
        b.cyl(0.62, d.clr + 0.14, -hz - 0.06, 0.06, 0.055, 0.16, 8, { axis: 'z', caps: false });
      } else if (part === 'glass') {
        b.loft([
          { y: c.h1, pts: prof(hw * 0.9, (c.front - c.back) * hz / 2 * 0.92, 0.10) },
          { y: c.h2 - 0.04, pts: prof(hw * 0.86, (c.front - c.back) * hz / 2 * 0.86, 0.09) }
        ]);
      } else if (part === 'trim') {
        b.box(0, d.clr + 0.44, hz + 0.055, hw * 1.15, 0.26, 0.10, {});
        b.box(0, d.clr + 0.60, hz + 0.03, hw * 1.5, 0.10, 0.06, {});
        for (const s of [-1, 1]) {
          b.box(s * (hw + 0.14), c.h1 + 0.24, c.front * hz - 0.46, 0.20, 0.13, 0.10, {});
          b.box(s * hw * 0.98, d.clr + 0.30, -hz * 0.2, 0.06, 0.5, 1.4, {});
        }
        /* baca / cofre de techo */
        b.box(0, c.h2 + 0.20, -0.15, 0.7, 0.18, 1.5, { taperTop: [0.9, 0.9] });
      }
    },
    proto(b, d, part) {
      const hz = d.L / 2, hw = d.W / 2, c = d.cabin;
      if (part === 'body') {
        /* monocasco estrecho + pontones laterales */
        b.loft([
          { y: d.clr, pts: prof(hw * 0.42, hz - 0.05, 0.10, 0.55, 0.75) },
          { y: d.clr + 0.16, pts: prof(hw * 0.46, hz - 0.02, 0.10, 0.34, 0.7) },
          { y: d.clr + 0.34, pts: prof(hw * 0.44, hz * 0.62, 0.10, 0.5, 0.9) }
        ]);
        /* morro fino */
        b.loft([
          { y: d.clr, pts: prof(hw * 0.30, hz * 0.42, 0.06, 0.45, 1) },
          { y: d.clr + 0.20, pts: prof(hw * 0.26, hz * 0.44, 0.05, 0.35, 1) }
        ], { });
        /* pontones / sidepods */
        for (const s of [-1, 1]) {
          b.loft([
            { y: d.clr + 0.02, pts: prof(hw * 0.30, hz * 0.30, 0.12), off: [s * hw * 0.62, -hz * 0.02] },
            { y: d.clr + 0.30, pts: prof(hw * 0.28, hz * 0.28, 0.10), off: [s * hw * 0.60, -hz * 0.02] },
            { y: d.clr + 0.40, pts: prof(hw * 0.20, hz * 0.20, 0.08), off: [s * hw * 0.58, -hz * 0.06] }
          ]);
        }
        /* cubierta motor trasera */
        b.loft([
          { y: d.clr + 0.20, pts: prof(hw * 0.40, hz * 0.34, 0.10), off: [0, -hz * 0.5] },
          { y: d.clr + 0.52, pts: prof(hw * 0.30, hz * 0.24, 0.10), off: [0, -hz * 0.52] },
          { y: d.clr + 0.58, pts: prof(hw * 0.24, hz * 0.10, 0.08), off: [0, -hz * 0.62] }
        ]);
        b.box(0, d.clr + 0.02, hz - 0.02, hw * 1.95, 0.07, 0.5, {});
      } else if (part === 'glass') {
        b.loft([
          { y: c.h1 - 0.06, pts: prof(hw * 0.40, hz * 0.19, 0.08), off: [0, -hz * 0.06] },
          { y: c.h2, pts: prof(hw * 0.30, hz * 0.13, 0.08), off: [0, -hz * 0.16] }
        ]);
      } else if (part === 'trim') {
        /* halo + arco de seguridad + entradas */
        b.cyl(0, d.clr + 0.62, -hz * 0.16, 0.055, 0.05, 0.26, 8, {});
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.34, d.clr + 0.52, -hz * 0.02, 0.05, 0.05, 0.5, {});
          b.box(s * hw * 0.95, d.clr + 0.18, -hz * 0.05, 0.06, 0.22, hz * 0.4, {});
          b.cyl(s * hw * 0.30, d.clr + 0.50, -hz * 0.30, 0.05, 0.045, 0.3, 6, {});
        }
        b.box(0, d.clr - 0.03, -hz + 0.10, hw * 1.5, 0.10, 0.4, {});
        for (let i = -2; i <= 2; i++) b.box(i * 0.28, d.clr - 0.02, -hz + 0.10, 0.05, 0.14, 0.44, {});
      } else if (part === 'wing') {
        /* alerón doble trasero + alerón delantero */
        plate(b, 0, d.clr + 0.66, -hz + 0.10, hw * 1.55, 0.46, 0.04, -0.24);
        plate(b, 0, d.clr + 0.52, -hz + 0.30, hw * 1.4, 0.30, 0.035, -0.30);
        for (const s of [-1, 1]) {
          b.box(s * hw * 0.70, d.clr + 0.44, -hz + 0.16, 0.05, 0.30, 0.12, {});
          b.box(s * hw * 0.74, d.clr + 0.30, -hz + 0.06, 0.06, 0.5, 0.34, {});
        }
        plate(b, 0, d.clr + 0.02, hz - 0.10, hw * 1.9, 0.6, 0.045, 0.10);
        for (const s of [-1, 1]) plate(b, s * hw * 0.62, d.clr + 0.10, hz - 0.34, hw * 0.7, 0.5, 0.04, 0.14);
      }
    }
  };
  function sx(s, v) { return s * v; }

  /* faros y pilotos: geometría común a todos los estilos */
  function buildLights(b, d, front) {
    const hz = d.L / 2, hw = d.W / 2;
    const y = front ? d.clr + (d.style === 'proto' ? 0.20 : 0.30) : d.clr + (d.style === 'hatch' ? 0.52 : 0.40);
    const z = front ? hz - 0.02 : -hz + 0.02;
    if (d.style === 'proto') {
      b.box(0, y, z, hw * 0.44, 0.075, 0.07, {});
      return;
    }
    for (const s of [-1, 1]) {
      const w = front ? 0.36 : 0.44;
      b.box(s * (hw - w * 0.55), y, z, w, front ? 0.13 : 0.11, 0.07, { taperTop: [0.92, 1] });
      if (front) b.box(s * (hw - 0.06), y - 0.10, z + 0.005, 0.16, 0.07, 0.05, {});
      else b.box(s * 0.16, y, z, 0.24, 0.06, 0.05, {});
    }
  }

  /* ============================================================ *
   *  Materiales por mapa
   * ============================================================ */
  function makeMats(R, tx, cfg) {
    const P = R.addMaterial.bind(R);
    const M0 = (o) => P(new G.Material(o));
    const m = {};
    m.ground = M0({
      name: 'ground', color: cfg.groundCol, roughness: cfg.groundRough == null ? 0.95 : cfg.groundRough,
      texture: tx.ground, uvWorld: true, uvScale: [1 / (cfg.groundTile || 4), 1 / (cfg.groundTile || 4)], texAmount: 1, shadow: true
    });
    m.road = M0({
      name: 'road', color: cfg.roadCol || [0.72, 0.72, 0.75], roughness: cfg.roadRough == null ? 0.62 : cfg.roadRough,
      metalness: 0.02, texture: tx.road, texAmount: 1
    });
    m.shoulder = M0({
      name: 'shoulder', color: cfg.shoulderCol || [0.66, 0.64, 0.60], roughness: 0.88,
      texture: tx.concrete, uvWorld: true, uvScale: [1 / 2.6, 1 / 2.6], texAmount: 0.9
    });
    m.curb = M0({ name: 'curb', color: [0.9, 0.9, 0.9], roughness: 0.7, texture: tx.hazard, texAmount: 1 });
    /* sombra falsa (blob): barata y SIEMPRE activa, también en calidad baja,
       para que el coche no "flote" cuando el shadow-map está apagado */
    m.blob = M0({
      name: 'shadowBlob', color: [0.035, 0.035, 0.045], roughness: 1, metalness: 0,
      opacity: 0.50, blend: 'blend', shadow: false
    });
    m.wall = M0({
      name: 'wall', color: [0.78, 0.77, 0.74], roughness: 0.85, texture: tx.concrete, texAmount: 0.8
    });
    m.building = M0({
      name: 'building', color: cfg.buildingCol || [0.78, 0.76, 0.72], roughness: 0.72, metalness: 0.02,
      texture: tx.facade, texAmount: 1, emTexture: tx.facadeEm, emUvScale: [1, 1], emScale: cfg.windowGlow == null ? 0 : cfg.windowGlow
    });
    m.roofTop = M0({
      name: 'roof', color: [0.62, 0.61, 0.60], roughness: 0.9, texture: tx.concrete, texAmount: 0.7
    });
    m.rock = M0({
      name: 'rock', color: cfg.rockCol || [0.8, 0.72, 0.62], roughness: 0.92, texture: tx.rock, texAmount: 1
    });
    m.leaf = M0({
      name: 'leaf', color: cfg.leafCol || [0.22, 0.46, 0.18], roughness: 0.82, texAmount: 0
    });
    m.leafDry = M0({ name: 'leafDry', color: cfg.leafDry || [0.42, 0.48, 0.22], roughness: 0.86 });
    m.bark = M0({ name: 'bark', color: [0.35, 0.26, 0.18], roughness: 0.9 });
    m.metal = M0({
      name: 'metal', color: [0.62, 0.64, 0.66], roughness: 0.36, metalness: 0.85, texture: tx.metal, texAmount: 0.5
    });
    m.dark = M0({ name: 'dark', color: [0.11, 0.115, 0.13], roughness: 0.55, metalness: 0.15 });
    m.paint = M0({
      name: 'paint', color: [1, 1, 1], roughness: cfg.paintRough == null ? 0.22 : cfg.paintRough,
      metalness: cfg.paintMetal == null ? 0.45 : cfg.paintMetal, texture: tx.metal, texAmount: 0.12
    });
    m.paintFlat = M0({ name: 'paintFlat', color: [1, 1, 1], roughness: 0.62, metalness: 0.1 });
    m.chrome = M0({ name: 'chrome', color: [0.86, 0.88, 0.9], roughness: 0.09, metalness: 1 });
    m.glass = M0({
      name: 'glass', color: [0.10, 0.13, 0.16], roughness: 0.06, metalness: 0.35,
      opacity: 0.72, blend: 'blend', shadow: false
    });
    m.head = M0({
      name: 'headlight', color: [0.85, 0.86, 0.82], roughness: 0.28, emissive: [1, 0.96, 0.86],
      emissiveScale: cfg.night ? 3.0 : 0.25, shadow: false
    });
    m.tail = M0({
      name: 'taillight', color: [0.32, 0.04, 0.04], roughness: 0.4, emissive: [1, 0.06, 0.03],
      emissiveScale: cfg.night ? 1.1 : 0.5, shadow: false
    });
    m.tire = M0({ name: 'tire', color: [0.055, 0.055, 0.06], roughness: 0.92 });
    m.rim = M0({ name: 'rim', color: [0.72, 0.73, 0.75], roughness: 0.22, metalness: 0.9 });
    m.neon = M0({
      name: 'neon', color: [0, 0, 0], emissive: [0.35, 0.9, 1.0], emissiveScale: 1.6,
      opacity: 0.85, blend: 'add', shadow: false, roughness: 1
    });
    m.beam = M0({
      name: 'beam', color: [0, 0, 0], emissive: [1, 0.95, 0.8], emissiveScale: 0.5,
      opacity: 0.11, blend: 'add', shadow: false, roughness: 1
    });
    m.smoke = M0({ name: 'smoke', color: [0.8, 0.8, 0.8], opacity: 0.5, blend: 'blend', shadow: false, roughness: 1 });
    m.water = M0({
      name: 'water', color: cfg.waterCol || [0.06, 0.16, 0.24], roughness: 0.06, metalness: 0.5,
      opacity: 0.82, blend: 'blend', shadow: false
    });
    m.banner = M0({ name: 'banner', color: [0.9, 0.9, 0.9], roughness: 0.6, texture: tx.banner, texAmount: 1 });
    m.lampGlow = M0({
      name: 'lampGlow', color: [0.2, 0.18, 0.14], emissive: [1, 0.82, 0.5],
      emissiveScale: cfg.night ? 5.0 : 0.05, shadow: false, roughness: 0.4, pulse: false
    });
    m.neonSign = M0({
      name: 'neonSign', color: [0.02, 0.02, 0.03], emissive: [1, 0.2, 0.5], emissiveScale: cfg.night ? 3.4 : 0.2,
      shadow: false, roughness: 0.4, pulse: true
    });
    m.plastic = M0({ name: 'plastic', color: [0.92, 0.32, 0.05], roughness: 0.5, emissive: [0.5, 0.12, 0.0], emissiveScale: cfg.night ? 0.6 : 0.1 });
    m.mount = M0({
      name: 'mountain', color: cfg.mountCol || [0.44, 0.42, 0.46], roughness: 0.95, texture: tx.rock, texAmount: 0.6
    });
    m.checkpoint = M0({
      name: 'checkpoint', color: [0.05, 0.06, 0.07], emissive: [0.2, 1.0, 0.55], emissiveScale: 2.2,
      shadow: false, roughness: 0.4
    });
    m.checkpointBad = M0({
      name: 'checkpointBad', color: [0.05, 0.06, 0.07], emissive: [1.0, 0.25, 0.15], emissiveScale: 2.2,
      shadow: false, roughness: 0.4
    });
    m.glow = M0({
      name: 'glow', color: [0, 0, 0], emissive: [1, 1, 1], emissiveScale: 1, opacity: 0.55,
      blend: 'add', shadow: false, roughness: 1
    });
    return m;
  }

  /* ============================================================ *
   *  Ensamblado: mallas compartidas + kits de coche
   * ============================================================ */
  function buildMeshes(R, mats, cfg) {
    const mesh = {};
    const mk = (name, fn, o) => { const b = new B({ uvScale: o && o.uvScale || 1 }); fn(b, o || {}); return b.toMesh(R, name); };
    mesh.unitBox = (() => { const b = new B(); b.unitBox(); return b.toMesh(R, 'unitBox'); })();
    mesh.wheel = mk('wheel', b => b.wheel(1, 1, 18, { rimRatio: 0.63 }));
    mesh.peak = (() => { const b = new B(); b.peak(1, 1, 1); return b.toMesh(R, 'peak'); })();
    mesh.mesa = (() => { const b = new B(); b.mesa(1, 1); return b.toMesh(R, 'mesa'); })();
    mesh.checkpointRing = mk('ckRing', b => { b.cyl(0, 0.02, 0, 3.1, 2.55, 0.05, 22, {}); });
    mesh.plane = (() => {
      const b = new B();
      b.p = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1];
      b.n = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      b.u = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
      b.tris = 2;
      return b.toMesh(R, 'plane', { radius: 1.45 });
    })();
    mesh.quadY = (() => {   /* plano vertical para carteles */
      const b = new B();
      b.p = [-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 0, 0, 1, 2, 0, -1, 2, 0];
      b.n = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
      b.u = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
      return b.toMesh(R, 'quadY', { radius: 2.24 });
    })();
    mesh.beam = (() => {   /* cono de luz de carretera (vértice en el origen) */
      const b = new B();
      const S = 14, len = 15, spread = 3.4;
      const a = [], brr = [];
      for (let i = 0; i < S; i++) {
        const t = i / S * Math.PI * 2;
        a.push([Math.cos(t) * 0.22, Math.sin(t) * 0.10, 0]);
        brr.push([Math.cos(t) * spread, Math.sin(t) * spread * 0.42 - 1.5, len]);
      }
      for (let i = 0; i < S; i++) {
        const j = (i + 1) % S;
        b.poly([a[i], brr[i], brr[j]], { normal: [0, 1, 0] });
      }
      b.poly(a, { normal: [0, 0, -1] });
      return b.toMesh(R, 'beam', { radius: len * 1.05 });
    })();
    mesh.smokePuff = (() => {
      const b = new B();
      b.sphere(0, 0, 0, 1, 8, 6, 1, 0.28);
      return b.toMesh(R, 'puff');
    })();
    return mesh;
  }

  G.Assets = {
    makeMats, buildMeshes, CARS, BUILD, prof, plate,
    /* construye la geometría de una pieza del coche */
    carPart(b, def, part) {
      if (part === 'lightsF') { buildLights(b, def, true); return; }
      if (part === 'lightsR') { buildLights(b, def, false); return; }
      const fn = BUILD[def.style] || BUILD.coupe;
      fn(b, def, part);
      if (part === 'trim') {
        /* llantas: tapa central (cromo) y pinzas de freno */
        for (const s of [-1, 1]) {
          for (const f of [-1, 1]) {
            const zf = f > 0 ? def.wb / 2 : -def.wb / 2;
            b.box(s * (def.track / 2 + 0.055), def.wheelR, zf, 0.05, 0.16, 0.30, {});
          }
        }
      }
    }
  };
})(window.CW);
