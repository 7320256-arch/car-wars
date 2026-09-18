#!/usr/bin/env node
/* check-identity.js — que los cinco coches SE NOTEN DISTINTOS al conducirlos,
   y que el audio (motores + música) se mueva de verdad. Sin WebGL, sin red. */
'use strict';
global.window = {};
Object.defineProperty(global, 'navigator', { configurable: true, value: { maxTouchPoints: 0, userAgent: 'node' } });
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core.js', 'js/math3d.js', 'js/primitives.js', 'js/renderer.js', 'js/meshes.js', 'js/mapdata.js', 'js/entities.js', 'js/audio.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
global.performance = global.performance || { now: () => Date.now() };
const G = global.window.CW;

let fails = [], checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, m + ' (' + a.toFixed(2) + ' vs ' + b.toFixed(2) + '±' + tol + ')');
const show = (label, vals) => console.log('  ' + label.padEnd(15) + vals);

/* ---------- mundos ---------- */
const flat = {
  spec: { w: 1e6, world: 1e7, props: {}, ground: { kind: 'sand' }, id: 'asphalt' },
  mask: { dist: () => 0, pull: (x, z, o) => { o[0] = 0; o[1] = -1; return o; }, seg: () => 0, progress: () => 0 },
  height: { at: () => 0, normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } },
  track: null
};
const dirt = Object.assign({}, flat, {
  spec: { w: 8, world: 1e7, props: {}, ground: { kind: 'dirt' }, id: 'dirt' },
  mask: { dist: () => 90, pull: (x, z, o) => { o[0] = 0; o[1] = -1; return o; }, seg: () => 0, progress: () => 0 }
});
const byId = id => G.CARS.find(c => c.id === id);
const ids = G.CARS.map(c => c.id);
ok(ids.length === 5 && ids.every(id => !!byId(id)), 'los 5 ids de G.CARS existen (' + ids.join(',') + ')');

function mk(id, x, z, yaw) {
  const c = new G.Car(byId(id));
  c.setState(x || 0, 0.05, z || 0, yaw || 0);
  return c;
}
function run(id, world, secs, drive, dt) {
  dt = dt || 1 / 100;
  const c = mk(id);
  const n = Math.round(secs / dt);
  const out = { shiftEvents: 0, gears: new Set(), maxSpin: 0, maxSlip: 0, maxRoll: 0, maxRpm: 0, minRpm: 1e9, spinFrames: 0, last: null, samples: [] };
  let prevGear = 0;
  for (let i = 0; i < n; i++) {
    drive(c, i * dt, out);
    G.physics(c, world, dt, { strictWalls: false, driftAuto: false });
    out.gears.add(c.gearN);
    if (c.gearN !== prevGear) { out.shiftEvents++; prevGear = c.gearN; }
    out.maxSpin = Math.max(out.maxSpin, c.wheelspin || 0);
    if ((c.wheelspin || 0) > 0.25) out.spinFrames++;
    out.maxSlip = Math.max(out.maxSlip, Math.abs(c.slipAngle || 0));
    out.maxRoll = Math.max(out.maxRoll, Math.abs(c.roll || 0));
    out.maxRpm = Math.max(out.maxRpm, c.engineRPM || 0);
    out.minRpm = Math.min(out.minRpm, c.engineRPM || 9999);
    out.last = c;
    out.samples.push({ t: i * dt, v: c.speed, rpm: c.engineRPM, g: c.gearN });
  }
  return out;
}

/* ---------- 1. caja de cambios real: marchas, corte de encendido, rpm ---------- */
const wot = (c) => { c.throttle = 1; c.brake = 0; c.steer = 0; c.handbrake = 0; };
console.log('aceleración a tope desde parado (marchas usadas / cambios / 0-100 / 0-200 / punta):');
const acc = {}, t100 = {}, t200 = {};
for (const id of ids) {
  const r = run(id, flat, 16, wot);
  acc[id] = r;
  const s100 = r.samples.find(s => s.v * 3.6 >= 100);
  const s200 = r.samples.find(s => s.v * 3.6 >= 200);
  t100[id] = s100 ? s100.t : 99; t200[id] = s200 ? s200.t : 99;
  const topKmh = Math.max.apply(null, r.samples.map(s => s.v)) * 3.6;
  show(byId(id).name, 'M' + r.gears.size + '/' + byId(id).stats.gears + ' · ' + r.shiftEvents + ' cambios · 0-100 ' +
    t100[id].toFixed(2) + ' s · 0-200 ' + (s200 ? t200[id].toFixed(2) + ' s' : 'no llega') + ' · punta ' + topKmh.toFixed(0) + ' km/h · puntero ' +
    r.maxRpm.toFixed(0) + ' rpm');
  ok(r.gears.size === byId(id).stats.gears, byId(id).name + ' usa todas sus marchas (' + r.gears.size + '/' + byId(id).stats.gears + ')');
  ok(r.maxRpm <= byId(id).stats.redline * 1.16, byId(id).name + ' no pasa del corte (' + r.maxRpm.toFixed(0) + ' ≤ ' + (byId(id).stats.redline * 1.16).toFixed(0) + ')');
  ok(r.minRpm >= 700, byId(id).name + ' no se cala (ralentí ' + r.minRpm.toFixed(0) + ' rpm)');
  ok(Math.abs(topKmh - byId(id).stats.top) <= 9, byId(id).name + ' toca su punta de ficha (' + topKmh.toFixed(0) + ' vs ' + byId(id).stats.top + ')');
}
/* el Hammer (4 marchas) cambia menos veces que el NF-01 (7) y llega antes de 200 */
ok(acc.muscle.shiftEvents < acc.proto.shiftEvents, 'el Hammer cambia menos de marcha que el NF-01 (' + acc.muscle.shiftEvents + ' < ' + acc.proto.shiftEvents + ')');
ok(t200.proto < t200.muscle && t200.muscle < t200.hatch, '0-200: proto < muscle < hatch (' + t200.proto.toFixed(1) + '/' + t200.muscle.toFixed(1) + '/' + t200.hatch.toFixed(1) + ')');
ok(t100.suv - t100.hatch > 0.8, 'el Grizzly se queda atrás en salida (' + t100.suv.toFixed(2) + ' vs ' + t100.hatch.toFixed(2) + ')');
/* a 100 km/h no van todos al mismo número de vueltas */
const rpmAt100 = {};
for (const id of ids) {
  const r = run(id, flat, 22, (c) => { wot(c); if (c.speed * 3.6 > 100) { c.throttle = 0.35; } });
  rpmAt100[id] = r.last.engineRPM;
}
const rr = ids.map(i => rpmAt100[i]);
console.log('  rpm a 100 km/h sostenidos: ' + ids.map(i => byId(i).name + ' ' + Math.round(rpmAt100[i]) + ' (M' + acc[i].gears.size + ')').join(' · '));
ok(Math.max.apply(null, rr) - Math.min.apply(null, rr) > 900, 'a 100 km/h cada motor va a un régimen distinto (' + Math.round(Math.max.apply(null, rr) - Math.min.apply(null, rr)) + ' rpm de margen)');

/* ---------- 2. patinar al salir: tracción trasera vs 4x4 ---------- */
console.log('patinazo en la salida (throttle 1, sin derrape):');
const spin = {};
for (const id of ids) {
  const r = run(id, flat, 3.2, wot);
  spin[id] = r.maxSpin;
  show(byId(id).name, 'patinaje máx ' + r.maxSpin.toFixed(2) + ' · ' + r.spinFrames + ' fotogramas patinando · tierra: ' +
    (byId(id).stats.drive || '?') + ' (' + (byId(id).stats.cyl || 0) + ' cyl)');
  ok(r.maxSpin >= 0 && r.maxSpin <= 1, byId(id).name + ' informa de patinaje (' + r.maxSpin.toFixed(2) + ')');
}
ok(spin.muscle > spin.suv + 0.08, 'el V8 trasero patina más que el 4x4 en seco (' + spin.muscle.toFixed(2) + ' > ' + spin.suv.toFixed(2) + ')');
/* en asfalto agarre y en barro no: el ensayo que separa un eje de dos es con
   poco rozamiento (un 4x4 sale clavado, un V8 sale haciendo humo) */
const spinDirt = {};
for (const id of ids) {
  let f = 0, mx = 0;
  const c = mk(id);
  for (let i = 0; i < 250; i++) { c.throttle = 1; c.brake = 0; c.steer = 0; G.physics(c, dirt, 1 / 100, {}); if ((c.wheelspin || 0) > 0.25) f++; mx = Math.max(mx, c.wheelspin || 0); }
  spinDirt[id] = { f, mx };
  show(('barro · ' + byId(id).name).padEnd(22), 'patina ' + f + ' f (' + (100 * f / 250).toFixed(0) + '%) · máx ' + mx.toFixed(2) + ' · ' + (byId(id).stats.drive || '?'));
}
ok(spinDirt.muscle.f > spinDirt.suv.f + 30, 'en barro el V8 trasero pasa más tiempo patinando que el 4x4 (' + spinDirt.muscle.f + ' vs ' + spinDirt.suv.f + ' fotogramas)');
ok(spinDirt.hatch.f > spinDirt.suv.f, 'el Pixel (delantera) patina más que el Grizzly (4x4) en tierra (' + spinDirt.hatch.f + ' vs ' + spinDirt.suv.f + ')');
ok(spinDirt.suv.f < 40, 'el 4x4 sale clavado hasta en barro (' + spinDirt.suv.f + ' fotogramas)');
/* ---------- 3. carácter en curva: sobrevirage / subvirage ---------- */
console.log('curva sostenida a 22 m/s con todo dentro (ángulo de deriva, sin freno de mano):');
const char = {};
for (const id of ids) {
  const r = run(id, flat, 5, (c, t) => {
    c.throttle = 1; c.brake = 0; c.handbrake = 0;
    c.steer = t > 0.6 ? 0.55 : 0;
  });
  char[id] = { slip: r.maxSlip * 57.3, yaw: Math.abs(r.last.yawRate), roll: r.maxRoll * 57.3 };
  show(byId(id).name, 'deriva ' + char[id].slip.toFixed(1) + '° · guiñada ' + char[id].yaw.toFixed(2) + ' rad/s · alabeo ' + char[id].roll.toFixed(1) + '°');
}
ok(char.muscle.slip > char.hatch.slip + 1.2, 'el Hammer se suelta más que el Pixel en apoyo (' + char.muscle.slip.toFixed(1) + '° > ' + char.hatch.slip.toFixed(1) + '°)');
ok(char.suv.roll > char.proto.roll * 1.6, 'el Grizzly se balancea mucho más que el NF-01 (' + char.suv.roll.toFixed(1) + '° vs ' + char.proto.roll.toFixed(1) + '°)');
const slipRange = Math.max.apply(null, ids.map(i => char[i].slip)) - Math.min.apply(null, ids.map(i => char[i].slip));
ok(slipRange > 2.0, 'el abanico de ángulos de deriva entre coches es notable (' + slipRange.toFixed(1) + '°)');

/* ---------- 4. fuera de pista: barro para unos, drama para otros ---------- */
console.log('4 s a tope en tierra desde 20 m/s (velocidad final / deriva):');
const off = {};
for (const id of ids) {
  const r = run(id, dirt, 4, (c) => { c.throttle = 1; c.steer = 0.25; c.brake = 0; });
  const ra = run(id, flat, 4, (c) => { c.throttle = 1; c.steer = 0.25; c.brake = 0; });
  off[id] = { v: r.last.speed, loss: ra.last.speed - r.last.speed, slip: r.maxSlip * 57.3, road: r.last.onRoad };
  show(byId(id).name, off[id].v.toFixed(1) + ' m/s en barro · ' + ra.last.speed.toFixed(1) + ' en asfalto · pérdida ' +
    off[id].loss.toFixed(1) + ' m/s · ' + (off[id].loss > 0 ? 'sufre' : 'ni se entera') + ' · agarre tierra ' + (byId(id).stats.offRoad || 0));
  ok(off[id].road < 0.2, byId(id).name + ' está realmente fuera de pista (' + off[id].road.toFixed(2) + ')');
}
const best = ids.slice().sort((a, b) => off[b].v - off[a].v)[0];
ok(best === 'suv' || best === 'proto', 'en barro los que mejor mantienen la velocidad son 4x4/prototipo (' + byId(best).name + ')');
/* y el dato de ficha manda: la tracción y el recorrido de suspensión son lo que
   decide quién puede acelerar fuera del asfalto (medido arriba con la velocidad) */
const offBest = ids.slice().sort((x, y) => (byId(y).stats.offRoad || 0) - (byId(x).stats.offRoad || 0));
ok(offBest[0] === 'suv', 'el 4x4 es el coche con más agarre fuera de pista de la lista (' + byId(offBest[0]).name + ')');
ok(offBest[offBest.length - 1] === 'muscle', 'el V8 trasero es el que peor lo pasa en barro (' + byId(offBest[offBest.length - 1]).name + ')');
const awdTop = ['suv', 'proto'].every(i => off[i].v >= Math.max(off.coupe.v, off.hatch.v, off.muscle.v) - 0.2);
ok(awdTop, 'los dos 4x4 mantienen la velocidad en tierra mejor que los de un eje (' +
  ids.map(i => byId(i).name + ' ' + off[i].v.toFixed(1)).join(', ') + ')');
ok(off.muscle.v < off.suv.v * 0.7, 'en tierra el Hammer pierde el doble de velocidad que el Grizzly (' +
  off.muscle.v.toFixed(1) + ' vs ' + off.suv.v.toFixed(1) + ' m/s)');
/* ---------- 5. frenada y fragilidad ---------- */
console.log('frenada de 100 a 0 km/h y daño de un mismo choque a 30 m/s:');
const brk = {}, dmg = {};
for (const id of ids) {
  const c = mk(id); c.vel[2] = 100 / 3.6; c.vf = 100 / 3.6; c.speed = 100 / 3.6;
  let d = 0;
  for (let i = 0; i < 500 && (i < 3 || c.speed > 0.6); i++) { c.brake = 1; c.throttle = 0; G.physics(c, flat, 1 / 100, {}); d += c.speed / 100; }
  brk[id] = d;
  /* choque idéntico contra el muro del mundo (mismo ángulo, misma velocidad) */
  const w = mk(id);
  w.setState(0, 0.05, 0, Math.PI / 2); w.vel[0] = 30; w.vf = 30; w.speed = 30;
  const solidWorld = {
    spec: { w: 8, world: 1e7, props: {}, ground: {}, id: 'sw' },
    solids: [{ x: 14, y: -1, z: 0, r: 4, h: 9, type: 'rock1' }],
    solidsNear(x, z) { return Math.abs(x - 14) < 30 ? this.solids : []; },
    mask: { dist: () => 0, pull: (x, z, o) => { o[0] = 0; o[1] = -1; return o; }, seg: () => 0, progress: () => 0 },
    height: { at: () => 0, normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } },
    track: null
  };
  for (let i = 0; i < 320; i++) { w.throttle = 1; G.physics(w, solidWorld, 1 / 240, { strictWalls: true }); if (w.damage > 0.02) break; }
  dmg[id] = w.damage;
  show(byId(id).name, 'frena en ' + (d * 3.6).toFixed(0) + ' m (ficha ' + Math.round((byId(id).stats.brake || 1) * 100) +
    '%) · daño tras el impacto ' + Math.round(w.damage * 100) + '% (fragilidad ' + (byId(id).stats.fragility || 1) + ')');
  ok(isFinite(d) && d > 3 && d < 90, byId(id).name + ' frena en una distancia razonable (' + d.toFixed(1) + ' m)');
}
ok(brk.suv > brk.proto * 1.25, 'el Grizzly frena mucho peor que el NF-01 (' + (brk.suv * 3.6).toFixed(0) + ' vs ' + (brk.proto * 3.6).toFixed(0) + ' m)');
ok(dmg.proto > dmg.coupe * 1.10, 'el prototipo se daña más que el Coupé con el mismo golpe (' + Math.round(dmg.proto * 100) + '% vs ' + Math.round(dmg.coupe * 100) + '%)');

/* ---------- 6. IA: cada rival usa SU coche ---------- */
console.log('IA 20 s en el circuito bay (velocidad media / fotogramas de mano aplicada):');
{
  const track = G.makeTrack(G.MAPS.find(m => m.id === 'bay') || G.MAPS[0]);
  const W = {
    spec: { w: track.spec.w, world: 1e7, props: {}, ground: {}, id: 'bay' },
    track, mask: track.mask,
    height: { at: (x, z) => track.Y[Math.round(track.mask.seg(x, z))] + (track.mask.dist(x, z) > track.spec.w ? -0.6 : 0), normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } }
  };
  const res = {};
  /* Math.random estable: misma "suerte" de trazada para los 5 coches y
     comparación justa (si no, el número de fotogramas cruzados baila) */
  const rnd0 = Math.random;
  let sd = 12345;
  Math.random = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (const id of ids) {
    const c = mk(id, track.centers[0][0], track.centers[0][1], Math.atan2(track.T[0], track.T[1]));
    c.vel[2] = 12; c.vf = 12;
    let vsum = 0, hand = 0, slides = 0, n = 0;
    for (let i = 0; i < 2000; i++) {
      G.aiDrive(c, W, 1 / 100, 1.0, null);
      G.physics(c, W, 1 / 100, { strictWalls: true });
      if (i > 100) { vsum += c.speed; n++; hand += c.handbrake > 0.2 ? 1 : 0; slides += Math.abs(c.vr) > 3 ? 1 : 0; }
      if (Math.abs(c.pos[0]) > 900 || Math.abs(c.pos[2]) > 900) break;
    }
    res[id] = { v: vsum / Math.max(1, n), hand, slides };
    show(byId(id).name, Math.round(res[id].v * 3.6) + ' km/h de media · mano ' + res[id].hand + ' f · cruzado ' + res[id].slides + ' f');
    ok(res[id].v > 6, byId(id).name + ' (IA) avanza (' + Math.round(res[id].v * 3.6) + ' km/h)');
  }
  Math.random = rnd0;
  const vs = ids.map(i => res[i].v);
  ok(Math.max.apply(null, vs) - Math.min.apply(null, vs) > 1.4, 'los rivales de IA no van todos igual (' +
    Math.round((Math.max.apply(null, vs) - Math.min.apply(null, vs)) * 3.6) + ' km/h de margen)');
  const sl = ids.map(i => res[i].slides);
  ok(Math.max.apply(null, sl) - Math.min.apply(null, sl) > 5, 'los rivales no se cruzan igual en el mismo circuito (' + sl.join('/') + ' fotogramas)');
}

/* ================== AUDIO (AudioContext de mentira) ================== */
function fakeCtx() {
  const log = { nodes: 0, params: [] };
  const P = (v) => {
    const p = { value: v, _last: v };
    p.setValueAtTime = (x, t) => { p.value = x; log.params.push(x); return p; };
    p.linearRampToValueAtTime = (x) => { p.value = x; log.params.push(x); return p; };
    p.exponentialRampToValueAtTime = (x) => { p.value = x; log.params.push(x); return p; };
    p.setTargetAtTime = (x, t, k) => { p.value = x; log.params.push(x); return p; };
    p.cancelScheduledValues = () => p;
    return p;
  };
  const node = (extra) => Object.assign({ connect() { return this; }, disconnect() { }, _conn: [] }, extra || {});
  const ctx = {
    sampleRate: 48000, state: 'running', currentTime: 0, log,
    destination: node(),
    createGain: () => { log.nodes++; return node({ gain: P(1) }); },
    createOscillator: () => { log.nodes++; return node({ type: 'sine', frequency: P(440), detune: P(0), start() { this.started = true; }, stop() { this.stopped = true; } }); },
    createBiquadFilter: () => { log.nodes++; return node({ type: 'lowpass', frequency: P(1000), Q: P(1), gain: P(0) }); },
    createBufferSource: () => { log.nodes++; return node({ buffer: null, loop: false, playbackRate: P(1), start() { this.started = true; }, stop() { } }); },
    createStereoPanner: () => { log.nodes++; return node({ pan: P(0) }); },
    createDynamicsCompressor: () => { log.nodes++; return node({ threshold: P(0), knee: P(0), ratio: P(1), attack: P(0), release: P(0) }); },
    createBuffer: (ch, len, sr) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve()
  };
  return ctx;
}
global.window.AudioContext = function () { return fakeCtx(); };
console.log('audio:');
{
  const S = G.makeSound({ muted: false });
  ok(S.tryStart() === true, 'AudioContext de prueba arranca el motor de sonido');
  const cars = ids.map((id, i) => {
    const def = byId(id);
    const c = mk(id);
    c.setState(i * 4, 0.05, 0, 0);
    c.name = def.name; c.engineRPM = 3200; c.throttle = 0.8; c.speed = 22; c.vf = 22;
    return c;
  });
  const voices = cars.map((c, i) => S.addCar({
    name: c.name, player: i === 0, cyl: c.stats.cyl, redline: c.stats.redline, drive: c.stats.drive,
    turbo: (c.stats.boost || 1) > 1.02
  }));
  ok(voices.every(v => !!v), 'una voz por coche (5)');
  ok(voices[0].player === true && voices[1].player === false, 'la voz 0 es la del jugador');
  const freqs = {};
  for (let f = 0; f < 40; f++) {
    cars.forEach((c, i) => { c.engineRPM = (c.stats.redline || 7000) * 0.7; c.pos[0] = i * 4; c.wheelspin = i === 1 ? 0.7 : 0; c.drifting = i === 2; c.vr = i === 2 ? 6 : 0; });
    if (f === 30) cars[0].shiftFx = 1;                    /* golpe de cambio */
    S.update(cars, { x: 0, z: -6, yaw: 0 }, 1 / 60, { skidVol: 0.5, intensity: 0.9 });
  }
  ids.forEach((id, i) => { freqs[id] = voices[i].osc1.frequency.value; });
  const fl = ids.map(i => freqs[i]);
  console.log('  nota base por motor (Hz): ' + ids.map(i => byId(i).name + ' ' + freqs[i].toFixed(0)).join(' · '));
  ok(Math.max.apply(null, fl) - Math.min.apply(null, fl) > 20, 'cada motor suena a un registro distinto (' + Math.round(Math.max.apply(null, fl) - Math.min.apply(null, fl)) + ' Hz de margen)');
  ok(freqs.muscle < freqs.hatch, 'el V8 va más grave que el tricilíndrico (' + freqs.muscle.toFixed(0) + ' < ' + freqs.hatch.toFixed(0) + ' Hz)');
  ok(voices.every(v => v.g.gain.value > 0), 'las 5 voces tienen volumen (>0)');
  ok(voices[0].g.gain.value > 0, 'el motor del jugador se oye');
  ok(voices[1].pan.pan.value !== 0, 'los rivales se panorama según dónde están (' + voices[1].pan.pan.value.toFixed(2) + ')');
  ok(voices.every(v => isFinite(v.osc1.frequency.value) && isFinite(v.lp.frequency.value) && isFinite(v.g.gain.value)), 'sin NaN en los parámetros del motor');
  ok(voices[1].g.gain.value < voices[0].g.gain.value, 'el rival se escucha menos que tu propio motor');
  ok(voices[1].gs.gain.value > voices[0].gs.gain.value, 'el V8 (Hammer) lleva más sub-grave que un 6 en línea');
  cars[0].shiftFx = 1;
  const t0 = S.ctx.log.nodes;
  S.update(cars, { x: 0, z: -6, yaw: 0 }, 1 / 60, { skidVol: 0.5, intensity: 0.9 });
  ok(S.ctx.log.nodes > t0, 'el golpe de cambio crea su nodo de ruido (pop: ' + (S.ctx.log.nodes - t0) + ' nodos)');
  ok(cars[0].shiftFx === 0, 'el efecto se consume (no se dispara cada fotograma)');
  /* música */
  S.setMusic(true, 0.08);
  const b0 = S.beat;
  for (let i = 0; i < 24; i++) { S.ctx.currentTime += 1 / 60; S.update(cars, { x: 0, z: -6, yaw: 0 }, 1 / 60, { skidVol: 0.5, intensity: 1 }); }
  ok(S.beat > b0, 'la música avanza por compases (' + (S.beat - b0) + ' golpes en 0,4 s)');
  ok(S.busMusic.gain.value > 0, 'el bus de música está abierto cuando música = sí');
  const bpmLo = S.bpm;
  for (let i = 0; i < 60; i++) { S.ctx.currentTime += 1 / 60; S.update(cars, { x: 0, z: -6, yaw: 0 }, 1 / 60, { skidVol: 0.5, intensity: 0 }); }
  ok(S.bpm < bpmLo, 'con la carrera tranquila la música baja de tempo (' + bpmLo.toFixed(0) + ' → ' + S.bpm.toFixed(0) + ' bpm)');
  S.setMusic(false, 0);
  const nodesBefore = S.ctx.log.nodes;
  for (let i = 0; i < 30; i++) { S.ctx.currentTime += 1 / 60; S.update(cars, { x: 0, z: -6, yaw: 0 }, 1 / 60, { skidVol: 0.5, intensity: 1 }); }
  ok(S.busMusic.gain.value === 0, 'música OFF silencia el bus');
  ok(S.beat === S.beat, 'nada revienta con la música apagada');
  S.stopVoices();
  ok(S.voices.length === 0, 'stopVoices limpia las voces (nada de acumular osciladores)');
  const S2 = G.makeSound({});
  ok(S2.addCar({ name: 'pend', cyl: 8 }) === null && S2.pending.length === 1, 'si aún no hay AudioContext, addCar encola la voz');
}

/* ---------- resumen ---------- */
if (fails.length) {
  console.log('✘ fallos:');
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
console.log('✔ identidad de coches + audio OK  (' + checks + ' comprobaciones)');
