#!/usr/bin/env node
/* check-world.js — ejecuta G.Tex + G.Assets + G.World.build sobre los 4 mapas
   con un contexto 2D y un WebGL2 falsificados. Comprueba que todo el mundo
   se construye sin errores, que las matrices de instancia son finitas,
   que caben materiales/texturas y cuántos triángulos cuesta.
   Uso: node tools/check-world.js [nombreMapa] */
'use strict';
'use strict';
const stub0 = require('./stubdom');
const makeCanvas = stub0.makeCanvas, warns = stub0.warns;

/* capturar avisos: un "sin slots" o "máximo de materiales" es un fallo real */
const stub = require('./stubdom');
const origWarn = console.warn, origErr = console.error;
const restore = stub.mute();
const G = stub.load(['js/core.js', 'js/math3d.js', 'js/primitives.js', 'js/textures.js', 'js/renderer.js',
  'js/meshes.js', 'js/mapdata.js', 'js/entities.js', 'js/world.js']);

let fails = [], checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const only = process.argv[2];

/* ---------------- construir ---------------- */
for (const spec of G.MAPS) {
  if (only && spec.id !== only && spec.name.indexOf(only) < 0) continue;
  const warnsBefore = warns.length;
  const cv = makeCanvas(960, 540);
  let R = null, W = null, err = null;
  const t0 = Date.now();
  try {
    R = new G.Renderer(cv, { dpr: 1 });
    G.Assets.resetMaterials && G.Assets.resetMaterials();
    if (R.resetMaterials) R.resetMaterials();
    W = G.World.build(R, spec, () => { });
  } catch (e) { err = e; }
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  const tag = spec.name;
  if (err) {
    fails.push('· ' + tag + ': EXCEPCIÓN construyendo el mundo → ' + err.message + '\n     ' +
      String(err.stack).split('\n').slice(1, 5).join('\n     '));
    checks++;
    origErr('  ✘ ' + tag + ' (' + dt + ' s)');
    continue;
  }
  ok(true, tag + ' construye sin excepciones');
  origErr('  · ' + tag + ' construido en ' + dt + ' s');

  /* grupos e instancias */
  ok(W.groups && W.groups.length > 25, tag + ': número de grupos (' + (W.groups ? W.groups.length : 0) + ') > 25');
  let inst = 0, tris = 0, badMat = 0, emptyNeeded = [];
  const need = ['road', 'ground', 'shoulder'];
  const seen = new Set();
  for (const g of W.groups) {
    seen.add((g.tag || '').split('.')[0]);
    inst += g.count;
    tris += (g.mesh ? g.mesh.count / 3 : 0) * g.count;
    seen.add(g.tag.split('.')[0]);
    /* todas las matrices de instancia deben ser finitas */
    const n = g.count * 24;
    for (let i = 0; i < n; i++) { const v = g.data[i]; if (!Number.isFinite(v)) { badMat++; break; } }
  }
  for (const g of [].concat(W.dyn || [], W.carGroups ? Object.keys(W.carGroups).map(k => Object.keys(W.carGroups[k]).map(p => W.carGroups[k][p])) : [])) {
    if (g && typeof g.count === 'number') { inst += g.count; }
  }
  ok(badMat === 0, tag + ': todas las matrices de instancia son finitas (' + badMat + ' malas)');
  ok(inst > 250, tag + ': hay instancias colocadas (' + inst + ')');
  for (const n of need) ok([...seen].some(t => t.indexOf(n) >= 0), tag + ': existe el grupo «' + n + '»');
  ok(tris < 4.2e6, tag + ': presupuesto de triángulos (' + (tris / 1e6).toFixed(2) + ' M) < 4.2 M');
  let _hMin = 1e9, _hMax = -1e9;

  /* materiales / texturas */
  const mats = R.materials.filter(Boolean);
  ok(mats.length <= G.MAX_MATS, tag + ': materiales (' + mats.length + ') ≤ ' + G.MAX_MATS);
  ok(mats.length >= 10, tag + ': materiales usados (' + mats.length + ') ≥ 10');
  ok(R.slotIdx.size <= 12, tag + ': texturas en slots (' + R.slotIdx.size + ') ≤ 12');
  const missingTex = mats.filter(m => m.texture && R.slotIdx.get(m.texture) == null);
  ok(missingTex.length === 0, tag + ': todos los materiales con textura tienen slot (' + missingTex.map(m => m.name).join(',') + ')');
  const noName = mats.filter(m => !m.name);
  ok(noName.length === 0, tag + ': todos los materiales tienen nombre');

  /* pista / checkpoints */
  ok(W.checkpoints.length >= 5, tag + ': checkpoints (' + W.checkpoints.length + ') ≥ 5');
  ok(W.checkpoints.every(c => Number.isFinite(c.x) && Number.isFinite(c.z) && c.r > 4), tag + ': checkpoints válidos');
  ok(W.gridSlots.length === 8, tag + ': plazas de parrilla (' + W.gridSlots.length + ') = 8');
  ok(W.gridSlots.every(s => Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw)), tag + ': parrilla finita');
  ok(W.track.total > 700 && W.track.total < 3000, tag + ': longitud de vuelta (' + W.track.total.toFixed(0) + ' m)');

  /* campo de alturas */
  let hBad = 0, hMin = 1e9, hMax = -1e9, nBad = 0;
  const H = W.height, S = spec.world;
  for (let j = 0; j <= 60; j++) for (let i = 0; i <= 60; i++) {
    const x = -S + (2 * S * i) / 60, z = -S + (2 * S * j) / 60;
    const y = H.at(x, z);
    if (!Number.isFinite(y)) hBad++; else { hMin = Math.min(hMin, y); hMax = Math.max(hMax, y); }
    const n = H.normal(x, z, [0, 0, 0]);
    if (!Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2]) || Math.hypot(n[0], n[1], n[2]) < 0.5) nBad++;
  }
  ok(hBad === 0, tag + ': altura finita en toda la rejilla (' + hBad + ' NaN)');
  ok(nBad === 0, tag + ': normales válidas en toda la rejilla (' + nBad + ')');
  ok(hMax - hMin < 90, tag + ': rango de alturas contenido (' + (hMax - hMin).toFixed(1) + ' m)');

  origErr('    ' + inst + ' instancias, ' + (tris / 1e3).toFixed(0) + ' k tris, ' + W.groups.length + ' grupos, ' +
    'decor: ' + Object.entries(W.stats.decor).map(([k, v]) => k + ':' + v).join(' ') + ' | ck=' + W.checkpoints.length +
    ' | faroles=' + W.lamps.length + ' | alt ' + hMin.toFixed(1) + '..' + hMax.toFixed(1) + ' m');

  /* agua */
  if (spec.water) {
    let wet = 0;
    for (let k = 0; k < 400; k++) {
      const a = k * 0.7, r = spec.world * (0.2 + (k % 7) * 0.1);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (H.at(x, z) < spec.water.y - 0.2) wet++;
    }
    ok(wet > 0, tag + ': hay cuencas por debajo del nivel del agua (' + wet + ')');
    ok(!!W.waterGroup, tag + ': grupo de agua presente');
  }

  /* decoración declarada vs construida */
  const decl = (spec.decor || []);
  const got = (W.stats && W.stats.decor) || {};
  let zeroTypes = [];
  for (const d of decl) {
    const c = got[d.type];
    if (c == null) { if (G.World.scenery(d.type)) zeroTypes.push(d.type + ' (sin malla)'); continue; }
    if (c < d.n * 0.35) zeroTypes.push(d.type + ' (' + c + '/' + d.n + ')');
  }
  ok(zeroTypes.length === 0, tag + ': cada tipo de decorado se coloca: ' + zeroTypes.join(', '));
  ok(W.stats.props >= 60, tag + ': decorado instanciado (' + W.stats.props + ')');

  /* kits de coche */
  for (const c of G.CARS) {
    const g = W.carGroups[c.id];
    ok(!!g, tag + ': kit de grupo para ' + c.id);
    if (g) {
      ok(Object.keys(g).length >= 8, tag + ': ' + c.id + ' tiene partes (' + Object.keys(g).length + ')');
      ok(!!g.body && !!g.wheel && !!g.beam, tag + ': ' + c.id + ' incluye body/wheel/beam');
    }
    ok(!!W.cars[c.id] && Object.keys(W.cars[c.id]).length >= 6, tag + ': mallas de ' + c.id + ' presentes');
  }
  /* faroles para las luces dinámicas */
  if (spec.props.lamp) {
    ok(W.lamps.length > 4, tag + ': faroles para luces (' + W.lamps.length + ')');
    ok(W.lamps.every(l => l.length >= 4 && l.every(Number.isFinite)), tag + ': datos de faroles finitos');
  }
  /* minimapa */
  ok(W.minimap && W.minimap.xs.length === W.track.n, tag + ': minimapa con un punto por muestra');
  ok(W.night === ((spec.env.stars || 0) > 0.3), tag + ': bandera de noche coherente (' + W.night + ')');

  /* reconstruir el mismo mapa (cambio de mapa en caliente) no debe dejar residuos */
  {
    const wB2 = warns.length;
    let W2 = null, e2 = null;
    try { W2 = G.World.build(R, spec, () => { }); } catch (e) { e2 = e; }
    ok(!e2, tag + ': se puede reconstruir sobre el mismo renderer' + (e2 ? ' → ' + e2.message : ''));
    if (W2) {
      ok(R.slotIdx.size <= 12, tag + ': las texturas se liberan y vuelven a caber (' + R.slotIdx.size + ')');
      ok(R.materials.filter(Boolean).length <= G.MAX_MATS, tag + ': materiales dentro de límite tras reconstruir (' + R.materials.filter(Boolean).length + ')');
      ok(warns.slice(wB2).length === 0, tag + ': sin avisos al reconstruir (' + warns.slice(wB2, wB2 + 2).join(' | ') + ')');
      let n3 = 0; for (const g of W2.groups) n3 += g.count;
      ok(n3 > 100, tag + ': la segunda construcción coloca instancias (' + n3 + ')');
      W2.dispose();
    }
  }

  /* dispose sin errores */
  let dErr = null;
  try { W.dispose(); } catch (e) { dErr = e; }
  ok(!dErr, tag + ': dispose() limpio' + (dErr ? ' → ' + dErr.message : ''));

  const newWarns = warns.slice(warnsBefore);
  ok(newWarns.length === 0, tag + ': sin avisos del renderer (' + newWarns.slice(0, 3).join(' | ') + ')');
}

console.warn = origWarn; console.error = origErr;
if (fails.length) { console.log('✘ ' + fails.length + ' fallos:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('✔ mundo OK  (' + checks + ' comprobaciones)');
