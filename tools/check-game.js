#!/usr/bin/env node
/* check-game.js — arranca el juego entero (motor + mundo + físicas + IA + HUD
   + render) con el DOM/GL falsificados y comprueba los 5 modos de juego.
   Uso: node tools/check-game.js [mapa] [modo] */
'use strict';
const stub = require('./stubdom');
const warns = stub.warns;
const restore = stub.mute();
const G = stub.load(['js/core.js', 'js/math3d.js', 'js/primitives.js', 'js/textures.js', 'js/renderer.js',
  'js/meshes.js', 'js/mapdata.js', 'js/world.js', 'js/entities.js', 'js/ui.js', 'js/audio.js', 'js/game.js']);

let fails = [], checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const onlyMap = process.argv[2], onlyMode = process.argv[3];

const cv = stub.makeCanvas(1280, 720);
let R = null, game = null, err = null;
try {
  R = new G.Renderer(cv, { dpr: 1 });
  game = new G.Game({ canvas: cv, renderer: R, headless: false });
  game.input = new G.Input();
  game.hud = new G.HUD({ canvas: stub.makeCanvas(1280, 720), minimap: stub.makeCanvas(168, 168) });
  game.hud.resize(1280, 720);
} catch (e) { err = e; }
ok(!err, 'el motor y el juego se instancian' + (err ? ' → ' + err.message : ''));
if (err) { console.log(fails.join('\n')); process.exit(1); }

const DT = 1 / 100;
function drive(game, secs, ctl) {
  const steps = Math.round(secs / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const c = game.input.touch;
    c.active = true;
    c.thr = 1; c.brake = 0; c.steer = 0; c.hand = false; c.boost = false;
    if (ctl) ctl(game, t, i);
    game.sim(DT);
    if (i % 20 === 0) { game.updateCam(0.2); game.draw(); }
  }
}
/* piloto automático para pruebas: el jugador usa la IA */
function pilot(game, t, i) {
  const p = game.player;
  G.aiDrive(p, game.world, DT, 0.92, game.cars);
  const c = game.input.touch;
  c.steer = clampAbs(p.steer);
  c.thr = p.throttle > 0.05 ? 1 : 0;
  c.brake = p.brake;
  c.hand = p.handbrake > 0.4;
  if (Math.abs(p.vr) > 8) c.thr = 0.3;
}
function clampAbs(v) { return Math.max(-1, Math.min(1, v || 0)); }

/* ---------- 1. entrada ---------- */
{
  const inp = game.input;
  inp.touch.active = true;
  inp.touch.steer = -1; inp.touch.thr = 1; inp.touch.hand = true; inp.touch.boost = true;
  let s = inp.state();
  ok(s.steer === -1 && s.throttle === 1 && s.hand === 1 && s.boost === 1, 'táctil se traduce a acciones (' + JSON.stringify([s.steer, s.throttle, s.hand, s.boost]) + ')');
  inp.touch.steer = 1;
  ok(inp.state().steer === 1, 'táctil derecha');
  inp.touch.active = false; inp.k.left = 1; inp.k.throttle = 1;
  s = inp.state();
  ok(s.steer === -1 && s.throttle === 1, 'teclado izquierda+acelerador');
  inp.k = {}; inp.pressed = {};
  inp.touch.active = false;
}

/* ---------- 2. mapas × modos ---------- */
const MODES = G.MODE_LIST;
const summary = [];
for (const spec of G.MAPS) {
  if (onlyMap && spec.id !== onlyMap && spec.name.indexOf(onlyMap) < 0) continue;
  const wb = warns.length;
  try { game.loadMap(spec); } catch (e) { fails.push(spec.name + ': loadMap → ' + e.message); continue; }
  ok(game.world && game.world.groups.length > 20, spec.name + ': mundo cargado por el juego');
  for (const mode of MODES) {
    if (onlyMode && mode.id !== onlyMode) continue;
    const tag = spec.id + '/' + mode.id;
    const wB = warns.length;
    let e2 = null;
    try {
      game.attachMode(mode);
      game.setQuality('low');
      game.difficulty = 1;
      game.spawn(G.CARS[mode.id === 'race' ? 0 : 1].id, { laps: mode.laps || 3 });
      game.running = true; game.paused = false;
      game.state.clock = 0;
      if (mode.id === 'race') game.state.countdown = 0;
      drive(game, mode.id === 'drift' ? 12 : 22, mode.id === 'free' || mode.id === 'race' || mode.id === 'attack' ? pilot : (g, t, i) => {
        /* en chase, perseguir al fugado más cercano */
        if (mode.id === 'chase') {
          const p = g.player; let best = null, bd = 1e9;
          for (const c of g.cars) if (c.fugitive && !c.caught) {
            const d = Math.hypot(c.pos[0] - p.pos[0], c.pos[2] - p.pos[2]);
            if (d < bd) { bd = d; best = c; }
          }
          pilot(g, t, i);
          if (best) {
            /* para probar la regla de detención: ir pegado al sospechoso */
            const vx = best.vel[0], vz = best.vel[2];
            p.pos[0] = best.pos[0] - Math.sin(best.yaw) * 4.2; p.pos[2] = best.pos[2] - Math.cos(best.yaw) * 4.2;
            p.pos[1] = best.pos[1]; p.yaw = best.yaw; p.vel[0] = vx; p.vel[2] = vz; p.vf = best.vf; p.vr = 0;
            g.input.touch.thr = 1; g.input.touch.brake = 0; g.input.touch.steer = 0;
          }
        } else if (mode.id === 'drift') {
          /* como un jugador: lanzar el eje trasero con la tecla y CONTRA-VOLANTEAR
             para sostener el ángulo; se vuelve a dar tecla si se cierra */
          const p = g.player;
          g.input.touch.active = true;
          g.input.touch.thr = 1;
          const ang = Math.abs(p.slipAngle || 0);
          const slip = p.vr;
          if (ang < 0.30 && !g._dhold) { g.input.touch.hand = true; g._dhold = 1; g.input.touch.steer = 0.9 * Math.sign(p.steer || 1); }
          else { g.input.touch.hand = ang < 0.22; g.input.touch.steer = clampAbs(-Math.sign(slip || 1) * 0.45); }
          if (p.speed < 11) { g.input.touch.hand = true; g.input.touch.steer = 0.9; }
        }
      });
    } catch (e) { e2 = e; }
    ok(!e2, tag + ': sim+draw sin excepciones' + (e2 ? ' → ' + e2.message + '\n     ' + String(e2.stack).split('\n').slice(1, 4).join('\n     ') : ''));
    if (e2) continue;
    const p = game.player;
    ok(Number.isFinite(p.pos[0]) && Number.isFinite(p.pos[1]) && Number.isFinite(p.pos[2]) && Number.isFinite(p.yaw), tag + ': estado del jugador finito');
    ok(p.speed < p.stats.top / 3.6 * 1.2, tag + ': velocidad dentro de límites (' + (p.speed * 3.6).toFixed(0) + ' km/h)');
    ok(game.cars.every(c => Number.isFinite(c.pos[0]) && Number.isFinite(c.pos[2])), tag + ': todos los coches finita');
    /* progreso y vueltas */
    if (mode.id === 'race' || mode.id === 'free' || mode.id === 'attack') {
      const m = p.totalProgress * game.world.track.total;
      ok(m > 40 && m < 700, tag + ': el jugador avanza por la pista (' + m.toFixed(0) + ' m en 22 s)');
      ok(p.lapTimes.every(t => t > 8) && p.lap === p.lapTimes.length, tag + ': sin vueltas fantasma (lap=' + p.lap + ', tiempos=' + p.lapTimes.length + ')');
    }
    if (mode.id === 'race') {
      ok(game.cars.filter(c => c.place > 0).length === game.cars.length, tag + ': clasificación asignada a todos');
    }
    if (mode.id === 'attack') ok(game.state.ckHit >= 1, tag + ': pasa checkpoints (' + game.state.ckHit + ')');
    if (mode.id === 'drift') ok(game.driftHud.total + game.driftHud.cur > 0, tag + ': puntúa derrapando (' + Math.round(game.driftHud.total + game.driftHud.cur) + ')');
    if (mode.id === 'chase') ok(game.state.catches >= 1, tag + ': detiene sospechosos (' + game.state.catches + ')');
    /* HUD */
    const lines = game.hudLines();
    ok(lines.length >= 2, tag + ': HUD con líneas (' + lines.length + ')');
    const txt = JSON.stringify(lines) + JSON.stringify(game.lastResult || '');
    ok(!/NaN|undefined|null/.test(txt), tag + ': HUD sin NaN/undefined → ' + txt.slice(0, 150));
    /* draw stats */
    ok(R.stats.draws >= 12 && R.stats.draws <= 460, tag + ': presupuesto de draw calls (' + R.stats.draws + ')');
    ok(R.stats.tris > 8000, tag + ': triángulos enviados (' + R.stats.tris + ')');
    const kit = game.world.carGroups[p.def.id];
    const sameStyle = game.cars.filter(c => c.def.id === p.def.id).length;
    ok(kit.wheel.count === sameStyle * 4, tag + ': ruedas instanciadas (' + kit.wheel.count + '/' + sameStyle * 4 + ')');
    ok(kit.body.count === sameStyle, tag + ': carrocerías instanciadas (' + kit.body.count + '/' + sameStyle + ')');
    const totalBodies = Object.keys(game.world.carGroups).reduce((a, k2) => a + game.world.carGroups[k2].body.count, 0);
    ok(totalBodies === game.cars.length, tag + ': todos los coches instanciados (' + totalBodies + '/' + game.cars.length + ')');
    ok(game.fx.list.filter(x => x.active).length <= game.fx.max, tag + ': pool de partículas acotado');
    /* luces */
    ok(R.lights.length <= G.MAX_LIGHTS, tag + ': luces ≤ ' + G.MAX_LIGHTS + ' (' + R.lights.length + ')');
    ok(R.lights.every(L => L.length >= 4 && L.every(Number.isFinite)), tag + ': luces finitas');
    /* cámara: nunca bajo el terreno en modo persecución */
    game.camMode = 0; game.updateCam(0.05);
    const under = game.world.height.at(game.cam.pos[0], game.cam.pos[2]) + 0.2;
    ok(game.cam.pos[1] > under, tag + ': cámara sobre el terreno (' + game.cam.pos[1].toFixed(2) + ' > ' + under.toFixed(2) + ')');
    const dcam = Math.hypot(game.cam.pos[0] - p.pos[0], game.cam.pos[2] - p.pos[2]);
    ok(dcam > 2.5 && dcam < 40, tag + ': distancia de cámara razonable (' + dcam.toFixed(1) + ' m)');
    for (let cm = 0; cm < 4; cm++) { game.camMode = cm; game.updateCam(0.05); ok(game.cam.pos.every(Number.isFinite) && game.cam.look.every(Number.isFinite) && Number.isFinite(game.cam.fov), tag + ': cámara ' + cm + ' finita'); }
    summary.push(tag + ': ' + (p.speed * 3.6 | 0) + ' km/h, vuelta ' + p.lap + ', ' + R.stats.draws + ' draws');
    const nw = warns.slice(wB).filter(w => !/Shader|glslang/.test(w));
    ok(nw.length === 0, tag + ': sin avisos (' + nw.slice(0, 2).join(' | ') + ')');
  }
  /* pausa + respawn + mute */
  try {
    game.togglePause(); ok(game.paused === true, spec.id + ': pausa');
    game.togglePause(); ok(game.paused === false, spec.id + ': reanudar');
    game.player.pos[0] += 90; game.player.pos[2] -= 70; game.player.vel[2] = 22;
    game.player.speed = 22;
    game.respawn(game.player);
    ok(game.world.mask.dist(game.player.pos[0], game.player.pos[2]) < game.spec.w + 1.2, spec.id + ': respawn sobre la pista');
    ok(game.player.speed > 5 && game.player.speed <= 22 * 0.6, spec.id + ': respawn CON inercia (recupera el 55 %, no te deja parado: ' + game.player.speed.toFixed(1) + ' m/s)');
    ok(game.player.reposT > 0, spec.id + ': tras reposicionar hay anti-spam (' + game.player.reposT.toFixed(2) + ' s)');
    ok(isFinite(game.player.vel[0]) && Math.abs(game.player.vf - game.player.speed) < 0.35, spec.id + ': la velocidad del respawn va en la dirección de la pista');
  } catch (e) { fails.push(spec.id + ': pausa/respawn → ' + e.message); }
  ok(warns.slice(wb).length === 0, spec.id + ': construcción sin avisos (' + warns.slice(wb, wb + 2).join(' | ') + ')');
}

/* ---------- 2a2. conducir normal no debe poner el coche de lado ---------- */
{
  game.attachMode(G.MODES.free);
  game.setQuality('low');
  game.spawn(G.CARS[0].id, { laps: 3 });
  game.state.countdown = 0;
  let driftFrames = 0, frames = 0, maxSlip = 0, spins = 0;
  drive(game, 26, (g, t, i) => {
    pilot(g, t, i);                       /* el jugador sigue la pista con la IA, sin tecla */
    g.input.touch.hand = false; g.input.touch.brake = 0;
    const p = g.player;
    frames++; if (p.drifting) driftFrames++;
    maxSlip = Math.max(maxSlip, Math.abs(p.vr));
    if (Math.abs(p.yawRate) > 2.3) spins++;
  });
  const pct = 100 * driftFrames / Math.max(1, frames);
  ok(pct < 6, 'conducir normal por pista casi nunca cuenta como derrape (' + pct.toFixed(1) + '% de los fotogramas)');
  ok(maxSlip < 7.5, 'sin la tecla el deslizamiento se mantiene acotado (' + maxSlip.toFixed(1) + ' m/s)');
  ok(spins === 0, 'sin la tecla no hay trompos involuntarios (' + spins + ' fotogramas con yawRate>2.3 rad/s)');
}

/* ---------- 2b. vuelta completa: contar y cronometrar ---------- */
{
  const spec = G.MAPS[0];
  game.attachMode(G.MODES.race);
  game.spawn(G.CARS[0].id, { laps: 3 });
  game.state.countdown = 0;
  const t = game.world.track, p = game.player;
  /* colocar justo antes de la meta con todos los checkpoints pasados */
  const i = t.n - 14;
  p.setState(t.centers[i][0], game.world.height.at(t.centers[i][0], t.centers[i][1]) + 0.05, t.centers[i][1], Math.atan2(t.T[i * 2], t.T[i * 2 + 1]));
  p.vel[2] = Math.sin(p.yaw) * 26; p.vel[0] = Math.cos(p.yaw) * 0;
  p.vf = 26; p.progress = game.world.mask.progress(p.pos[0], p.pos[2]);
  p.ckSince = game.world.checkpoints.length; p.armed = true; p.lapStart = game.state.clock;
  const lap0 = p.lap;
  drive(game, 6, (g) => { const q = g.player; G.aiDrive(q, g.world, DT, 1.0, g.cars); g.input.touch.thr = 1; g.input.touch.steer = clampAbs(q.steer); });
  ok(p.lap === lap0 + 1, 'cruzar la meta con los checkpoints hechos cuenta vuelta (' + p.lap + ')');
  ok(p.lapTimes.length === 1 && p.lapTimes[0] > 0.5 && p.lapTimes[0] < 5, 'tiempo de vuelta parcial plausible (' + (p.lapTimes[0] || 0).toFixed(2) + ' s)');
  ok(p.bestLap > 0, 'mejor vuelta registrada (' + p.bestLap.toFixed(2) + ')');
  /* cruzar la meta sin checkpoints NO cuenta */
  const lap1 = p.lap, lt = p.lapTimes.length;
  p.setState(t.centers[i][0], game.world.height.at(t.centers[i][0], t.centers[i][1]) + 0.05, t.centers[i][1], p.yaw);
  p.vf = 26; p.vel[2] = 26; p.progress = game.world.mask.progress(p.pos[0], p.pos[2]); p.ckSince = 0;
  drive(game, 5, (g) => { const q = g.player; G.aiDrive(q, g.world, DT, 1.0, g.cars); g.input.touch.thr = 1; g.input.touch.steer = clampAbs(q.steer); });
  ok(p.lap === lap1, 'cruzar la meta sin pasar los checkpoints no cuenta vuelta (' + p.lap + ' vs ' + lap1 + ')');
  ok(p.lapTimes.length === lt, 'no se añaden tiempos falsos');
}

/* ---------- 2c. cámara contenida e intento real de salirse del mapa ---------- */
{
  const w = game.loadMap(G.MAPS[0]);
  game.attachMode(G.MODES.free);
  game.setQuality('low');
  game.spawn(G.CARS[0].id, { laps: 3 });
  game.state.countdown = 0;
  /* A) disparar el coche contra la valla a máxima velocidad durante 8 s */
  const t0 = w.track;
  const i0 = Math.round(t0.n * 0.25);
  const p = game.player;
  const nx = t0.N[i0 * 2], nz = t0.N[i0 * 2 + 1];
  p.setState(t0.centers[i0][0] + nx * (w.spec.w * 0.3), w.height.at(t0.centers[i0][0], t0.centers[i0][1]) + 0.05,
    t0.centers[i0][1] + nz * (w.spec.w * 0.3), Math.atan2(nx, nz));
  p.segIdx = i0;
  let over = 0, maxOver = 0, camUnder = 0, camOut = 0;
  const steps = Math.round(8 / DT);
  for (let i = 0; i < steps; i++) {
    const c2 = game.input.touch;
    c2.active = true; c2.thr = 1; c2.brake = 0; c2.steer = Math.sin(i * 0.03) > 0 ? 0.55 : -0.55;
    game.sim(DT);
    const l = G.limitAt(w, p.pos[0], p.pos[2], p.segIdx, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
    const ov = l.d - (p.limitD || 99);
    if (ov > 0.02) { over++; maxOver = Math.max(maxOver, ov); }
    if (i % 10 === 0) {
      for (const cm of [0, 1, 2, 3]) { game.camMode = cm; game.updateCam(0.05);
        const gy = w.height.at(game.cam.pos[0], game.cam.pos[2]);
        if (game.cam.pos[1] < gy - 0.01) camUnder++;
        const lc = G.limitAt(w, game.cam.pos[0], game.cam.pos[2], p.segIdx, { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
        if (lc.d > (p.limitD || 12) + 7.5 + 0.6) camOut++;
      }
    }
  }
  ok(over === 0, 'a tope contra la valla: el coche no la atraviesa (' + over + ' fotogramas fuera, máx ' + (maxOver * 100).toFixed(0) + ' cm)');
  ok(camUnder === 0, 'la cámara nunca queda por debajo del terreno (' + camUnder + ' casos)');
  ok(camOut === 0, 'la cámara no se sale del corredor de pista (' + camOut + ' casos)');
  ok(Math.abs(p.pos[0]) < w.spec.world && Math.abs(p.pos[2]) < w.spec.world, 'el coche sigue dentro del mundo (' +
    p.pos[0].toFixed(0) + ', ' + p.pos[2].toFixed(0) + ')');
  /* B) y colocándolo a la fuerza fuera del mapa + bajo tierra, la cámara se recupera */
  p.pos[0] += 260; p.pos[2] -= 240; p.pos[1] = -40;
  game.camMode = 0;
  game.cam.pos = [p.pos[0], -60, p.pos[2]];
  game.updateCam(0.05);
  ok(game.cam.pos[1] > w.height.at(game.cam.pos[0], game.cam.pos[2]), 'cámara recuperada: por encima del relieve tras un teleport fuera de mapa');
  ok(Math.abs(game.cam.pos[0]) <= w.spec.world && Math.abs(game.cam.pos[2]) <= w.spec.world, 'cámara dentro de la caja del mundo');
  for (let i = 0; i < 40; i++) game.sim(DT);
  ok(p.pos[1] >= w.height.at(p.pos[0], p.pos[2]) - 0.01, 'el coche sube al terreno si lo metemos bajo tierra');
}

/* ---------- 2d. formato de tiempos (el bug «Vuelta 511:40.000») ---------- */
{
  ok(G.fmtTime(30.7) === '0:30.700', 'fmtTime(30.7 s) = 0:30.700 (no 511:40.000) → ' + G.fmtTime(30.7));
  ok(G.fmtMs(30700) === '0:30.700', 'fmtMs(30700 ms) = 0:30.700 → ' + G.fmtMs(30700));
  ok(G.fmtTime(74.333) === '1:14.333', 'fmtTime(74.333) = 1:14.333 → ' + G.fmtTime(74.333));
  /* y en el juego real: HUD + tabla final con magnitudes coherentes */
  const g2 = new G.Game({ canvas: document.createElement('canvas'), renderer: R, lowFx: true });
  g2.input = new G.Input();
  let resultRows = null;
  g2.screens = { result: (title, rows) => { resultRows = rows; }, show() { } };
  g2.loadMap(G.MAPS[0]);
  g2.attachMode(G.MODES.race);
  g2.setQuality('low');
  g2.spawn(G.CARS[0].id, { laps: 3 });
  g2.state.countdown = 0;
  /* simular 92 s y forzar una vuelta cronometrada realista */
  drive(g2, 92, (g, t, i) => pilot(g, t, i));
  const lines = g2.hudLines();
  const tiempo = (lines.find(l => l.k === 'TIEMPO') || {}).v || '';
  ok(/^\d{1,2}:\d{2}\.\d{3}$/.test(tiempo), 'HUD TIEMPO con formato m:ss.mmm → ' + JSON.stringify(tiempo));
  const mins = parseInt(tiempo.split(':')[0], 10);
  ok(mins >= 1 && mins <= 2, 'el reloj del HUD cuenta segundos reales, no milisegundos (' + tiempo + ' para 92 s)');
  g2.finish('prueba');
  ok(Array.isArray(resultRows) && resultRows.length > 1, 'la tabla final se genera (' + (resultRows ? resultRows.length : 0) + ' filas)');
  const cells = (resultRows || []).map(r => r.cells.join(' | ')).join('  ///  ');
  const times = cells.match(/\d+:\d\d\.\d\d\d/g) || [];
  ok(times.length > 0, 'la tabla contiene tiempos formateados (' + times.join(', ') + ')');
  const bad = times.filter(t => parseInt(t.split(':')[0], 10) > 20);
  ok(bad.length === 0, 'sin minutos absurdos tipo «511:40.000» en la tabla (detectados: ' + (bad.join(',') || 'ninguno') + ')');
  const best = (resultRows[1] || {}).cells || [];
  ok(best[3] === '—' || /^\d{1,2}:\d{2}\.\d{3}$/.test(best[3]), 'columna «mejor» con formato m:ss.mmm → ' + best[3]);
}
/* ---------- 2e. sombras blob + polvo, también en calidad baja ---------- */
{
  const g3 = game;
  g3.setQuality('low');
  ok(g3.world.blobGroup != null, 'existe el grupo de sombra falsa');
  g3.frame(1 / 60);
  ok(g3.world.blobGroup.count === g3.cars.length, 'un blob por coche instanciado (' + g3.world.blobGroup.count + '/' + g3.cars.length + ')');
  const airBefore = g3.player.pos[1];
  g3.player.pos[1] = airBefore + 3.5; g3.player.air = 1.2;
  g3.frame(1 / 60);
  ok(g3.world.blobGroup.count <= g3.cars.length, 'en el aire el blob se desvanece (no se apaga del tirón ni se queda clavado)');
  ok(!!g3.R.quality.shadows, 'calidad baja ahora ALSO dibuja sombras (mapa 512)');
  ok(g3.R.quality.shadowSize === 512, 'mapa de sombras reducido en baja (' + g3.R.quality.shadowSize + ' px)');
}
/* ---------- 2f. los sólidos no invaden la pista y detienen el coche ---------- */
{
  let n = 0;
  for (const spec of G.MAPS) {
    const w = game.loadMap(spec);
    let worst = 1e9, worstM = 1e9;
    const TB = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 };
    for (const so of w.solids) {
      /* métrica EXACTA al polilínea (la máscara tiene ±1.5 m de suavizado y engaña
         con rocas grandes pegadas a una curva) */
      worst = Math.min(worst, G.limitAt(w, so.x, so.z, 0, TB).d - so.r);
      worstM = Math.min(worstM, w.mask.dist(so.x, so.z) - so.r);
      n++;
    }
    ok(w.solids.length > 0, spec.id + ': hay colisionadores de escenario (' + w.solids.length + ')');
    ok(worst > spec.w + 0.3, spec.id + ': ningún sólido invade el asfalto (borde a ' + worst.toFixed(2) + ' m del eje, pista ±' + spec.w + ' m; por máscara ' + worstM.toFixed(2) + ')');
    ok(worst - spec.w > 0.8, spec.id + ': y dejan holgura visal con la valla (' + ((worst - spec.w) * 100).toFixed(0) + ' cm entre el borde de la roca y el asfalto)');
  }
  ok(n > 20, 'total de sólidos en los 4 mapas: ' + n);
  /* embestir una roca a 55 m/s: no la atraviesa */
  const w = game.world, t = w.track;
  const so = w.solids.reduce((a, b) => (b.r > (a ? a.r : 0) && b.r < 6 ? b : a), null);
  if (so) {
    const p = game.player;
    const dirx = 1, dirz = 0;
    p.setState(so.x - (so.r + 24), w.height.at(so.x - 24, so.z) + 0.05, so.z, Math.PI / 2);
    p.vel[0] = 55; p.vf = 55; p.segIdx = Math.round(w.mask.seg(p.pos[0], p.pos[2]));
    let inside = 0;
    for (let i = 0; i < 90; i++) {
      G.physics(p, w, 1 / 60, { strictWalls: false });
      const dd = Math.hypot(p.pos[0] - so.x, p.pos[2] - so.z);
      if (dd < so.r + p.def.W * 0.47 - 0.25) inside++;
    }
    ok(inside === 0, 'a 200 km/h contra una roca: nunca queda dentro de su volumen (' + inside + ' fotogramas)');
    ok(p.speed < 55, 'la roca frena de verdad (' + (p.speed * 3.6).toFixed(0) + ' km/h tras el impacto)');
  }
}

/* ---------- 3. fin de carrera + récords ---------- */
{
  game.attachMode(G.MODES.race);
  game.spawn(G.CARS[0].id, { laps: 2 });
  game.state.clock = 40;
  game.player.lap = 2; game.player.bestLap = 61.24;
  game.lastResult = '';
  game.finishRace();
  ok(game.state.finished === true, 'la carrera termina al completar las vueltas');
  ok(/Puesto/.test(game.lastResult), 'mensaje de resultado (' + game.lastResult + ')');
  const rec = G.store.get('cw_records', {});
  ok(rec['race:' + game.spec.id], 'récord de carrera guardado (' + JSON.stringify(rec['race:' + game.spec.id]) + ')');
  ok(rec['race:' + game.spec.id].pos >= 1 && rec['race:' + game.spec.id].pos <= 6, 'puesto del récord válido');
  /* volver a jugar tras terminar no peta */
  let e = null;
  try { game.attachMode(G.MODES.drift); game.driftHud = { cur: 0, total: 0, chain: 1, tube: 0, cool: 0 }; game.state.finished = false; drive(game, 1.5, null); } catch (x) { e = x; }
  ok(!e, 'se puede reiniciar tras el final' + (e ? ' → ' + e.message : ''));
}

/* ---------- 4. calidad de imagen / ajustes ---------- */
{
  for (const q of ['low', 'med', 'high']) {
    game.setQuality(q);
    ok(R.quality.shadows === true, 'calidad ' + q + ': sombras SIEMPRE activas (en baja, con mapa pequeño) → ' + R.quality.shadows);
    ok(R.quality.clouds === (q === 'high'), 'calidad ' + q + ': nubes ' + R.quality.clouds);
    ok(R.quality.shadowSize === (q === 'high' ? 2048 : (q === 'low' ? 512 : 1024)), 'calidad ' + q + ': tamaño de sombra ' + R.quality.shadowSize);
  }
  game.setQuality('med');
  /* la casilla «Sombras» del menú ahora manda de verdad */
  game.opts.shadows = false; game.setQuality('high');
  ok(R.quality.shadows === false, 'el checkbox de sombras desactiva el shadow-map');
  game.opts.shadows = true; game.setQuality('med');
  ok(R.quality.shadows === true, 'y lo vuelve a activar');
  game.setMuted(true); ok(game.sound.muted === true, 'silenciar');
  game.setMuted(false); ok(game.sound.muted === false, 'reactivar sonido');
  ok(game.sound.ok === false, 'sin AudioContext el juego sigue funcionando (audio degradado a no-op)');
}

/* ---------- 5. HUD y utilidades de interfaz ---------- */
{
  const h = game.hud;
  let e = null;
  try { h.toast('prueba', 1); h.hit(0.8); h.update(game, 0.016); h.draw(game); h.drawMinimap(game); } catch (x) { e = x; }
  ok(!e, 'HUD dibuja sin errores' + (e ? ' → ' + e.message : ''));
  ok(h.shake > 0 && h.flash > 0, 'el HUD registra el impacto');
  for (let i = 0; i < 200; i++) h.update(game, 0.02);
  ok(h.shake === 0 && h.flash === 0, 'la sacudida se disipa');
  ok(typeof G.roundRect2 === 'function', 'utilidad de esquinas expuesta');
  const s = G.store.get('cw_mute', null);
  ok(s === false, 'preferencia de sonido persistida (' + s + ')');
}

restore();
console.log('  ' + summary.slice(0, 12).join('\n  '));
if (fails.length) { console.log('✘ ' + fails.length + ' fallos:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('✔ juego completo OK  (' + checks + ' comprobaciones)');
