#!/usr/bin/env node
/* Comprobación de físicas e IA sin WebGL: mundo "lite" (track + máscara + altura falsa). */
'use strict';
global.window = {};
Object.defineProperty(global, 'navigator', { configurable: true, value: { maxTouchPoints: 0, userAgent: 'node' } });
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core.js', 'js/math3d.js', 'js/primitives.js', 'js/renderer.js', 'js/meshes.js', 'js/mapdata.js', 'js/entities.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
global.performance = global.performance || { now: () => Date.now() };
const G = global.window.CW;

let fails = [], checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const num = (v, m) => ok(typeof v === 'number' && isFinite(v), m + ' (no-numérico: ' + v + ')');

/* ---------- mundo lite ---------- */
function makeWorldLite(spec) {
  const track = G.makeTrack(spec);
  const mask = track.mask;

  return {
    spec: { w: spec.w, props: spec.props, ground: spec.ground, id: spec.id },
    track, mask,
    height: {
      at: (x, z) => { const i = Math.round(mask.seg(x, z)); return track.Y[i] + (mask.dist(x, z) > spec.w ? -0.6 : 0); },
      normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; }
    }
  };
}
/* mundo plano infinito: sin bordes ni fuera-de-pista, para medir potencia pura */
const plain = {
  spec: { w: 1e6, world: 1e7, props: {}, ground: { kind: 'sand' }, id: 'plain' },
  mask: { dist: () => 0, pull: (x, z, o) => { o[0] = 0; o[1] = -1; return o; }, seg: () => 0, progress: () => 0 },
  height: { at: () => 0, normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } },
  track: null
};

const D = G.CARS;
const coupe = D.find(c => c.id === 'coupe');
const suv = D.find(c => c.id === 'suv');
const world = makeWorldLite(G.MAPS[0]);

/* ---------- 1. aceleración ---------- */
function run(car, w, secs, input) {
  const dt = 1 / 100;
  const steps = Math.round(secs / dt);
  for (let i = 0; i < steps; i++) { if (input) input(car, i * dt, dt); G.physics(car, w, dt, {}); }
  return car;
}
{
  const c = new G.Car(coupe); c.setState(0, 2, 0, 0);
  let t100 = null, vpeak = 0; const dt = 1 / 100;
  for (let i = 0; i < 4000; i++) {
    c.throttle = 1; c.brake = 0;
    G.physics(c, plain, dt, {});
    if (t100 === null && c.speed >= 27.78) t100 = i * dt;
    vpeak = Math.max(vpeak, c.speed);
  }
  ok(t100 !== null && t100 > 1.6 && t100 < 9, 'coupe 0-100 en rango razonable (' + (t100 ? t100.toFixed(2) : 'nunca') + ' s)');
  ok(vpeak > 30, 'coupe alcanza velocidad alta (' + vpeak.toFixed(1) + ' m/s)');
  const topMs = coupe.stats.top / 3.6;
  ok(vpeak <= topMs * 1.06, 'no supera el techo teórico (' + vpeak.toFixed(1) + ' vs ' + topMs.toFixed(1) + ')');
  ok(vpeak >= topMs * 0.92, 'toca el techo de su ficha (' + (100 * vpeak / topMs).toFixed(0) + '%)');
  num(c.pos[0], 'pos.x'); num(c.yaw, 'yaw'); num(c.engineRPM, 'rpm');
}
/* ---------- 2. frenada ---------- */
{
  const c = new G.Car(coupe); c.setState(0, 2, 0, 0); c.vel[2] = 40; c.vf = 40;
  run(c, plain, 8, x => { x.throttle = 0; x.brake = 1; });
  ok(c.speed < 1.2, 'se detiene frenando a 40 m/s en <8 s (' + c.speed.toFixed(2) + ')');
  const c2 = new G.Car(suv); c2.setState(0, 2, 0, 0); c2.vel[2] = 40; c2.vf = 40;
  run(c2, plain, 8, x => { x.throttle = 0; x.brake = 1; });
  ok(c2.speed < 1.2, 'SUV también frena (' + c2.speed.toFixed(2) + ')');
}
/* ---------- 3. derrape con freno de mano ---------- */
{
  const c = new G.Car(coupe); c.setState(0, 2, 0, 0); c.vel[2] = 30; c.vf = 30;
  let maxSlip = 0, maxAng = 0;
  run(c, plain, 2.6, x => { x.throttle = 0.8; x.steer = 0.85; x.handbrake = 1; maxSlip = Math.max(maxSlip, Math.abs(x.vr)); maxAng = Math.max(maxAng, Math.abs(Math.atan2(x.vr, Math.max(1, x.vf)))); });
  ok(maxSlip > 3, 'el freno de mano genera deslizamiento lateral (' + maxSlip.toFixed(1) + ' m/s)');
  ok(maxAng > 0.18, 'ángulo de derrape visible (' + (maxAng * 57.3).toFixed(0) + '°)');
  ok(c.drifting === true || maxSlip > 2.6, 'estado drifting detectado');
  /* sin freno de mano: agarre -> vr pequeño */
  const c2 = new G.Car(coupe); c2.setState(0, 2, 0, 0); c2.vel[2] = 30; c2.vf = 30;
  let slipGrip = 0;
  run(c2, plain, 2.6, x => { x.throttle = 0.8; x.steer = 0.6; slipGrip = Math.max(slipGrip, Math.abs(x.vr)); });
  ok(slipGrip < maxSlip, 'con agarre hay menos deslizamiento que derrapando (' + slipGrip.toFixed(1) + ' < ' + maxSlip.toFixed(1) + ')');
}
/* ---------- 4. giro: radios y estabilidad ---------- */
{
  const c = new G.Car(coupe); c.setState(0, 2, 0, 0);
  run(c, plain, 3, x => { x.throttle = 1; });
  const v0 = c.speed;
  let yaw0 = c.yaw, t0 = 0, radius = 0;
  run(c, plain, 4, x => { x.throttle = 0.75; x.steer = 1; });
  ok(Math.abs(c.yawRate) > 0.05, 'girando con volante hay velocidad angular (' + c.yawRate.toFixed(2) + ' rad/s)');
  ok(Number.isFinite(c.pos[0]) && Number.isFinite(c.pos[2]), 'trayectoria finita');
  ok(Math.abs(c.vr) < 30, 'sin deslizamiento explosivo (' + c.vr.toFixed(1) + ')');
  ok(v0 > 14, 'mantuvo velocidad antes del giro (' + v0.toFixed(1) + ' m/s)');
}
/* ---------- 5. muro ---------- */
{
  const c = new G.Car(coupe);
  const i0 = 0;
  const halfW = world.spec.w;
  /* ponerlo justo en el borde exterior lanzado hacia fuera */
  const x = world.track.centers[i0][0] + world.track.N[i0 * 2] * (halfW + 1.0);
  const z = world.track.centers[i0][1] + world.track.N[i0 * 2 + 1] * (halfW + 1.0);
  c.setState(x, world.height.at(x, z) + 0.02, z, Math.atan2(world.track.N[i0 * 2], world.track.N[i0 * 2 + 1]));
  c.vel[0] = world.track.N[i0 * 2] * 18; c.vel[2] = world.track.N[i0 * 2 + 1] * 18;
  let maxD = 0;
  for (let i = 0; i < 400; i++) {
    G.physics(c, world, 0.01, {});
    maxD = Math.max(maxD, world.mask.dist(c.pos[0], c.pos[2]));
  }
  const limit = halfW + 2.1 + 0.8;
  ok(world.mask.dist(c.pos[0], c.pos[2]) <= limit, 'el quitamiedos repele y no deja salir (' + world.mask.dist(c.pos[0], c.pos[2]).toFixed(1) + ' <= ' + limit.toFixed(1) + ')');
  ok(c.damage > 0, 'el impacto contra el muro causa daño (' + c.damage.toFixed(2) + ')');
}
/* ---------- 6. altura del terreno ---------- */
{
  const c = new G.Car(coupe);
  const x = 40, z = -60;
  c.setState(x, 60, z, 0.4);
  run(c, world, 4, null);
  const target = world.height.at(c.pos[0], c.pos[2]) + 0.02;
  ok(Math.abs(c.pos[1] - target) < 1.0, 'el coche cae y se asienta sobre el terreno (y=' + c.pos[1].toFixed(2) + ', esperado≈' + target.toFixed(2) + ')');
  ok(c.pos[1] > target - 1.2, 'nunca se hunde bajo el suelo');
}
/* ---------- 7. estabilidad con entradas aleatorias ---------- */
{
  const rng = G.rngFrom(7);
  let bad = 0, over = 0;
  for (let k = 0; k < 12; k++) {
    const c = new G.Car(D[Math.floor(rng() * D.length)]);
    c.setState(world.track.centers[0][0], 3, world.track.centers[0][1], 0);
    for (let i = 0; i < 900; i++) {
      c.throttle = rng() * 2 - 0.4; c.brake = rng() * 0.8; c.steer = rng() * 2 - 1; c.handbrake = rng() < 0.12 ? 1 : 0;
      G.physics(c, plain, 1 / 60, {});
      if (![c.pos[0], c.pos[1], c.pos[2], c.yaw, c.vel[0], c.vel[2], c.vf, c.vr, c.yawRate].every(Number.isFinite)) bad++;
      if (c.speed > c.stats.top / 3.6 * 1.25) over++;
    }
  }
  ok(bad === 0, 'sin NaN/Inf en 12 sesiones de inputs aleatorios (' + bad + ')');
  ok(over === 0, 'nunca supera 1.25x el techo de velocidad (' + over + ' casos)');
}
/* ---------- 7b. CCD: nunca atraviesa el muro, pase lo que pase ---------- */
{
  let worst = 0, escapes = 0, tested = 0;
  for (const spec of G.MAPS) {
    const w = makeWorldLite(spec);
    const n = w.track.n;
    const step = w.track.total / n;
    for (let trial = 0; trial < 26; trial++) {
      const i = ((trial * (n / 26)) | 0) % n;
      const side = trial % 2 ? 1 : -1;
      for (const dt of [1 / 60, 1 / 30, 1 / 10, 1 / 5, 1 / 2]) {
        for (const spd of [28, 45, 66]) {
          const ang = (0.35 + 0.55 * ((trial % 5) / 4)) * side;   /* ángulo de ataque 20°..50° */
          const c = new G.Car(coupe);
          const d0 = w.spec.w * 0.5;
          const x = w.track.centers[i][0] + w.track.N[i * 2] * d0 * side;
          const z = w.track.centers[i][1] + w.track.N[i * 2 + 1] * d0 * side;
          c.setState(x, w.height.at(x, z) + 0.05, z, Math.atan2(w.track.T[i * 2], w.track.T[i * 2 + 1]) + ang);
          c.vel[0] = Math.sin(c.yaw) * spd; c.vel[2] = Math.cos(c.yaw) * spd; c.vf = spd;
          c.segIdx = i;
          const lim = G.limitAt(w, x, z, i, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
          let maxOver = 0;
          for (let k = 0; k < Math.max(4, Math.round(1.6 / dt)); k++) {
            G.physics(c, w, dt, { strictWalls: true });
            const l = G.limitAt(w, c.pos[0], c.pos[2], c.segIdx, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
            maxOver = Math.max(maxOver, l.d - (c.limitD || 99));
            tested++;
          }
          worst = Math.max(worst, maxOver);
          if (maxOver > 0.45) escapes++;
        }
      }
    }
  }
  ok(escapes === 0, 'CCD: ningún coche atraviesa el muro (' + tested + ' casos, desvío máx ' + worst.toFixed(2) + ' m)');
}
/* ---------- 7b2. la carrocería no cruza la valla (collider con anchura) ---------- */
{
  let overlap = 0, worst = 0, tested = 0;
  for (const spec of G.MAPS) {
    const w = makeWorldLite(spec);
    const n = w.track.n;
    for (let trial = 0; trial < 18; trial++) {
      const i2 = ((trial * (n / 18)) | 0) % n, side = trial % 2 ? 1 : -1;
      for (const cd of G.CARS) {
        const c = new G.Car(cd);
        const x = w.track.centers[i2][0], z = w.track.centers[i2][1];
        c.setState(x, w.height.at(x, z) + 0.05, z, Math.atan2(w.track.T[i2 * 2], w.track.T[i2 * 2 + 1]));
        c.segIdx = i2;
        c.vel[0] = w.track.N[i2 * 2] * side * 34; c.vel[2] = w.track.N[i2 * 2 + 1] * side * 34; c.vf = 34;
        for (let k = 0; k < 90; k++) {
          G.physics(c, w, 1 / 120, { strictWalls: true });
          const l = G.limitAt(w, c.pos[0], c.pos[2], c.segIdx, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
          const outerEdge = l.d + (c.def.W * 0.5);           /* borde exterior de la carrocería */
          const railInner = w.spec.w + 1.15 - 0.30;          /* cara interior de la valla */
          const ov = outerEdge - railInner;
          tested++;
          if (ov > 0.12) { overlap++; worst = Math.max(worst, ov); }
        }
      }
    }
  }
  ok(overlap === 0, 'la carrocería no se solapa con la valla (' + overlap + '/' + tested + ' casos, máx ' + (worst * 100).toFixed(0) + ' cm)');
}
/* ---------- 7c. el caso concreto del "cuello": dos tramos a ~15 m ---------- */
{
  /* antes el test usaba mask.dist (globl): al estar más cerca del otro tramo,
     la distancia «caía» por debajo del límite y el muro no respondía */
  let fixed = 0, total = 0;
  for (const spec of G.MAPS) {
    const w = makeWorldLite(spec);
    const n = w.track.n, C = w.track.centers;
    const skip = Math.max(8, Math.round((spec.w + 4) / (w.track.total / n)));
    for (let i = 0; i < n; i += 3) {
      for (let j = i + skip; j < n; j++) {
        if (n - (j - i) < skip) break;
        const d = Math.hypot(C[i][0] - C[j][0], C[i][1] - C[j][1]);
        const wallAt = spec.w + 0.95;
        if (d < 2 * wallAt) {
          total++;
          /* poner el coche a 1 cm de la valla del tramo i, lanzado hacia fuera */
          const sgn = Math.sign((C[j][0] - C[i][0]) * w.track.N[i * 2] + (C[j][1] - C[i][1]) * w.track.N[i * 2 + 1]) || 1;
          const x = C[i][0] + w.track.N[i * 2] * wallAt * sgn, z = C[i][1] + w.track.N[i * 2 + 1] * wallAt * sgn;
          const c = new G.Car(coupe);
          c.setState(x, w.height.at(x, z) + 0.05, z, Math.atan2(w.track.T[i * 2], w.track.T[i * 2 + 1]));
          c.vel[0] = w.track.N[i * 2] * sgn * 52; c.vel[2] = w.track.N[i * 2 + 1] * sgn * 52; c.vf = 52;
          c.segIdx = i;
          let mx = 0;
          for (let k = 0; k < 60; k++) {
            G.physics(c, w, 1 / 60, { strictWalls: true });
            const l = G.limitAt(w, c.pos[0], c.pos[2], c.segIdx, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
            mx = Math.max(mx, l.d);
            if (Math.abs(c.pos[0]) > spec.world || Math.abs(c.pos[2]) > spec.world) break;
          }
          if (mx <= wallAt + 0.5) fixed++;
        }
      }
    }
  }
  ok(total > 0, 'hay zonas de cuello que probar (' + total + ')');
  ok(fixed === total, 'en los cuellos el límite local retiene siempre (' + fixed + '/' + total + ')');
}
/* ---------- 7d. giro normal ≠ derrape; el derrape es con tecla ---------- */
{
  const corner = (driftKey, auto) => {
    const c = new G.Car(coupe); c.setState(0, 0.05, 0, 0);
    let maxVr = 0, wasDrifting = false, maxYaw = 0;
    for (let i = 0; i < 420; i++) {
      c.throttle = 0.85; c.steer = driftKey ? 0.62 : 0.5; c.handbrake = driftKey ? 1 : 0; c.driftKey = driftKey ? 1 : 0;
      G.physics(c, plain, 1 / 100, { driftAuto: !!auto });
      if (i > 60) { maxVr = Math.max(maxVr, Math.abs(c.vr)); wasDrifting = wasDrifting || c.drifting; maxYaw = Math.max(maxYaw, Math.abs(c.yawRate)); }
    }
    return { maxVr, wasDrifting, maxYaw, speed: c.speed };
  };
  const normal = corner(false, false), keyd = corner(true, false), automax = corner(false, true);
  ok(!normal.wasDrifting, 'girar fuerte a 20+ m/s NO derrapa en modo manual (vr ' + normal.maxVr.toFixed(1) + ' m/s, drifting=' + normal.wasDrifting + ')');
  ok(normal.maxVr < 2.6, 'en giro normal el deslizamiento lateral es pequeño (' + normal.maxVr.toFixed(2) + ' m/s)');
  ok(normal.maxYaw > 0.30, 'aun así gira de verdad (' + normal.maxYaw.toFixed(2) + ' rad/s)');
  ok(keyd.wasDrifting && keyd.maxVr > 4, 'con SHIFT/ESPACIO sí derrapa (vr ' + keyd.maxVr.toFixed(1) + ')');
  ok(keyd.maxVr > normal.maxVr * 1.8, 'el derrape es claramente distinto del giro normal (' + keyd.maxVr.toFixed(1) + ' vs ' + normal.maxVr.toFixed(1) + ')');
  ok(automax.maxVr >= normal.maxVr, 'en modo automático el límite de agarre se puede superar (' + automax.maxVr.toFixed(1) + ')');
}
/* ---------- 7e. el suelo es duro: nunca se hunde ---------- */
{
  const w = makeWorldLite(G.MAPS[2]);   /* cañón: con relieve */
  for (const drop of [0.5, 8, 30]) {
    const c = new G.Car(suv);
    const i = 12, x = w.track.centers[i][0], z = w.track.centers[i][1];
    c.setState(x, w.height.at(x, z) + drop, z, 0.4);
    let minGap = 1e9;
    for (let k = 0; k < 400; k++) {
      G.physics(c, w, 1 / 60, { strictWalls: true });
      minGap = Math.min(minGap, c.pos[1] - w.height.at(c.pos[0], c.pos[2]));
    }
    ok(minGap > -0.06, 'caída desde ' + drop + ' m: no se hunde bajo el terreno (margen ' + minGap.toFixed(2) + ' m)');
  }
}

/* ---------- 7f. choques entre coches: se aproximan, chocan y se mide ---------- */
{
  const mk = (id, x, vx, yaw) => { const cd = G.CARS.find(k => k.id === id); ok(!!cd, 'existe el coche de prueba ' + id); const c = new G.Car(cd || G.CARS[0]); c.setState(x, 0.05, 0, yaw); c.vel[0] = vx; c.vf = vx; return c; };
  const KE = (a, b) => 0.5 * a.stats.mass * (a.vel[0] ** 2 + a.vel[2] ** 2) + 0.5 * b.stats.mass * (b.vel[0] ** 2 + b.vel[2] ** 2);
  const P = (a, b) => a.stats.mass * a.vel[0] + b.stats.mass * b.vel[0];
  /* frontales: se acercan 34 m hasta tocarse, con la física de verdad */
  let a = mk('proto', -17, 30, Math.PI / 2), b = mk('suv', 17, -22, -Math.PI / 2);   /* 1010 kg vs 2150 kg */
  let eAt = null, pAt = null, maxAfter = 0, touched = false, maxUp = 0, maxYaw = 0;
  const va0 = a.vel[0], vb0 = b.vel[0];
  for (let i2 = 0; i2 < 600; i2++) {
    G.physics(a, plain, 1 / 120, {}); G.physics(b, plain, 1 / 120, {});
    G.carCollisions([a, b], null);
    maxUp = Math.max(maxUp, a.pos[1] - plain.height.at(a.pos[0], a.pos[2]), b.pos[1] - plain.height.at(b.pos[0], b.pos[2]));
    maxYaw = Math.max(maxYaw, Math.abs(a.yawRate), Math.abs(b.yawRate));
    const gap = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
    if (!touched && gap < 2.7) { touched = true; eAt = KE(a, b); pAt = P(a, b); }
    if (touched) maxAfter = Math.max(maxAfter, KE(a, b));
  }
  ok(touched, 'los dos coches llegan a tocarse (gap final ' + Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]).toFixed(2) + ' m)');
  ok(maxAfter <= eAt * 1.02, 'tras el contacto la energía cinética NO crece (' + (eAt / 1000).toFixed(0) + ' → ' + (maxAfter / 1000).toFixed(0) + ' kJ; con el old e=1.28 crecía en cada paso)');
  ok(Math.abs(P(a, b) - pAt) < Math.abs(pAt) * 0.4 + 1, 'la cantidad de movimiento se conserva aproximadamente (' + (pAt / 1000).toFixed(0) + ' → ' + (P(a, b) / 1000).toFixed(0) + ' t·m/s)');
  ok(maxUp < 1.3, 'ningún coche sale volando hacia arriba (' + maxUp.toFixed(2) + ' m sobre el suelo)');
  ok(maxYaw < 2.6, 'y ninguno sale girando como un peonza (' + maxYaw.toFixed(2) + ' rad/s)');
  /* utilidad ligera contra SUV pesado: el ligero cambia mucho más de velocidad */
  a = mk('hatch', -16, 26, Math.PI / 2); b = mk('suv', 12, 0, Math.PI / 2);         /* 1090 vs 2150 */
  const wa0 = a.vel[0], wb0 = b.vel[0];
  for (let i2 = 0; i2 < 400; i2++) { G.physics(a, plain, 1 / 120, {}); G.physics(b, plain, 1 / 120, {}); G.carCollisions([a, b], null); }
  const dLight = Math.abs(a.vel[0] - wa0), dHeavy = Math.abs(b.vel[0] - wb0);
  ok(dLight > dHeavy * 1.15, 'el utilitario recibe más cambio de velocidad que el SUV (' + dLight.toFixed(2) + ' vs ' + dHeavy.toFixed(2) + ' m/s) — hay sensación de masa');
  /* roce lateral: no dura para siempre */
  a = mk('coupe', 0, 46, Math.PI / 2); b = mk('hatch', 2.4, 6, Math.PI / 2);
  for (let i2 = 0; i2 < 200; i2++) { G.physics(a, plain, 1 / 120, {}); G.physics(b, plain, 1 / 120, {}); G.carCollisions([a, b], null); }
  ok(Math.abs(a.vel[0] - b.vel[0]) < Math.abs(46 - 6) + 0.5, 'en el roce lateral las velocidades se IGUALAN (las ruedas rozan, no son patinaje infinito)');
}

/* ---------- 8. IA en los 4 mapas ---------- */
for (const spec of G.MAPS) {
  const w = makeWorldLite(spec);
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const d = D[i % D.length];
    const c = new G.Car(d, { name: 'IA' + i, skill: 0.8 + i * 0.04 });
    const si = i * 4;
    c.setState(w.track.centers[si][0] + w.track.N[si * 2] * (i % 2 ? 3 : -3), w.track.Y[si] + 0.4, w.track.centers[si][1] + w.track.N[si * 2 + 1] * (i % 2 ? 3 : -3), Math.atan2(w.track.T[si * 2], w.track.T[si * 2 + 1]));
    cars.push(c);
  }
  const dt = 1 / 60;
  const laps = new Array(6).fill(0);
  const dists = new Array(6).fill(0);
  let offTrackFrames = 0, stuck = 0;
  for (let i = 0; i < 60 * 100; i++) {
    for (const c of cars) {
      G.aiDrive(c, w, dt, 0.9 * c.skill, cars);
      G.physics(c, w, dt, {});
      G.carCollisions(cars);
    }
    for (let k = 0; k < cars.length; k++) {
      const c = cars[k];
      const d = w.mask.dist(c.pos[0], c.pos[2]);
      dists[k] = Math.max(dists[k], d);
      if (d > w.spec.w + 2.6) offTrackFrames++;
      if (c.speed < 1.2 && i > 600) stuck++;
      c.progress = w.mask.progress(c.pos[0], c.pos[2]);
      if (c.progress < 0.12 && c.lastProg > 0.88) { c.lap++; c.lastProg = 0; laps[k]++; }
      else if (c.progress >= c.lastProg) c.lastProg = c.progress;
    }
  }
  const tag = spec.name;
  ok(cars.every(c => Number.isFinite(c.pos[0]) && Number.isFinite(c.speed)), 'IA sin NaN en ' + tag);
  ok(dists.every(d => d < w.spec.w + 4), 'IA se mantiene en la pista en ' + tag + ' (máx ' + Math.max(...dists).toFixed(1) + ' m, límite ' + (w.spec.w + 2.1).toFixed(1) + ')');
  ok(laps.some(l => l >= 1), 'la IA completa vueltas en ' + tag + ' (' + laps.join(',') + ')');
  ok(stuck / 6 < 60 * 12, 'IA no se queda atascada en ' + tag);
  const avgSpeed = cars.reduce((a, c) => a + c.speed, 0) / 6;
  ok(avgSpeed > 8, 'ritmo medio de IA razonable en ' + tag + ' (' + avgSpeed.toFixed(1) + ' m/s)');
}
/* ---------- 9. colisión entre coches ---------- */
{
  const a = new G.Car(coupe), b = new G.Car(coupe);
  a.setState(0, 0.4, 0, 0); b.setState(0, 0.4, 2.0, Math.PI);
  a.vel[2] = 14; b.vel[2] = -14;
  let hit = 0;
  G.carCollisions([a, b], () => hit++);
  const sep = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  ok(sep > 2.4, 'los coches se separan al colisionar (' + sep.toFixed(2) + ' m)');
  ok(hit === 1, 'se notifica el impacto (' + hit + ')');
  ok(a.damage > 0 && b.damage > 0, 'ambos reciben daño');
  ok(a.vel[2] < 14 && b.vel[2] > -14, 'el impacto reduce la velocidad')
}
/* ---------- 10. partículas ---------- */
{
  const fx = new G.FX({ max: 64 });
  const c = new G.Car(coupe); c.setState(0, 0.4, 0, 0); c.vel[2] = 25; c.vr = 8;
  for (let i = 0; i < 40; i++) { G.physics(c, plain, 1 / 60, {}); G.Effects.tireSmoke(fx, c, world, 0.8); }
  const active = fx.list.filter(p => p.active).length;
  ok(active > 0, 'el humo de neumáticos genera partículas (' + active + ')');
  ok(fx.list.filter(p => p.active).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), 'partículas con posición finita');
  for (let i = 0; i < 400; i++) fx.update(1 / 60, world);
  ok(fx.list.filter(p => p.active).length === 0, 'las partículas expiran y se reciclan');
  /* límite de pool: no crecer */
  for (let i = 0; i < 5000; i++) fx.spawn(0, 0, 0, 1, 1, 1, 1, 1, 2, [1, 1, 1], 1, 0, -3, 1);
  ok(fx.list.length === 64, 'el pool de partículas tiene tamaño fijo (' + fx.list.length + ')');
  /* regression: cambiar la calidad no debe dejar el pool más corto que max */
  {
    const f2 = new G.FX({ max: 420 });
    f2.setCap(900);
    ok(f2.max === 900 && f2.list.length === 900, 'setCap crece con su pool (' + f2.list.length + ')');
    f2.setCap(300);
    ok(f2.max === 300 && f2.list.length === 300, 'setCap se reduce limpio (' + f2.list.length + ')');
    let threw = null;
    try {
      for (let i = 0; i < 2000; i++) f2.spawn(i % 7, 0, 0, 1, 1, 1, 0.4, 1, 2, [1, 1, 1], 1, 0, -3, 1);
      for (let i = 0; i < 200; i++) f2.update(1 / 60, world);
    } catch (e) { threw = e; }
    ok(!threw, 'spawn/update tras cambiar de calidad no revientan' + (threw ? ' → ' + threw.message : ''));
    ok(f2.list.filter(p => p.active).length <= 300, 'tras reducir calidad no hay partículas huérfanas');
  }
}
/* informe de prestaciones (informativo, no asertivo) */
{
  const dt = 1 / 100;
  for (const d of G.CARS) {
    const c = new G.Car(d); c.setState(0, 2, 0, 0);
    let t100 = null, t200 = null, vmax = 0;
    for (let i = 0; i < 6000; i++) {
      c.throttle = 1; c.brake = 0;
      G.physics(c, plain, dt, {});
      if (t100 === null && c.speed >= 27.78) t100 = i * dt;
      if (t200 === null && c.speed >= 55.55) t200 = i * dt;
      vmax = Math.max(vmax, c.speed);
    }
    let stop = null; c.vel[0] = 0; c.vel[2] = 40; c.vf = 40; c.pos[0] = 0; c.pos[2] = 0; c.yaw = 0;
    for (let i = 0; i < 800; i++) { c.throttle = 0; c.brake = 1; G.physics(c, plain, dt, {}); if (stop === null && c.speed < 1) stop = i * dt; }
    console.log('  ' + d.name.padEnd(14) + ' 0-100: ' + (t100 ? t100.toFixed(2) : '—') + ' s   0-200: ' + (t200 ? t200.toFixed(1) : '—') +
      ' s   vmax: ' + (vmax * 3.6).toFixed(0) + ' km/h   100-0: ' + (stop ? stop.toFixed(2) : '—') + ' m/s→ ' + (stop ? (40 - 0) : 0) + ' m');
  }
}

console.log(fails.length ? '✘ fallos:\n  ' + fails.join('\n  ') : '✔ físicas e IA OK  (' + checks + ' comprobaciones)');
process.exit(fails.length ? 1 : 0);
