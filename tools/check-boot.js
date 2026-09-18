#!/usr/bin/env node
/* check-boot.js — abre car_wars.html y car_wars_standalone.html como los abriría
   el usuario (file://, DOM real de jsdom, canvas 2D y WebGL2 falsificados) y
   comprueba que el menú se pinta, que el mundo se construye, que START lanza la
   carrera y que los fotogramas avanzan sin errores.
   Requiere jsdom:  npm i jsdom   (o JSDOM=/ruta/jsdom node tools/check-boot.js)
   Si no hay jsdom, la suite se omite. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

let jsdomMod = null;
for (const id of [process.env.JSDOM, 'jsdom', '/tmp/node_modules/jsdom']) {
  if (!id) continue;
  try { jsdomMod = require(id); break; } catch (e) { }
}
if (!jsdomMod) { console.log('○ check-boot: omitido (falta jsdom;  npm i jsdom  para activarlo)'); process.exit(0); }
const { JSDOM, VirtualConsole } = jsdomMod;
const stub = require('./stubdom');

let fails = [], checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const q = (sel, doc) => doc.querySelector(sel);
const all = (sel, doc) => Array.from((doc || document).querySelectorAll ? (doc).querySelectorAll(sel) : []);

function boot(file, cb) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const virtualConsole = new VirtualConsole();
  const consoleErrs = [];
  virtualConsole.on('jsdomError', e => consoleErrs.push('jsdomError: ' + (e.message || e)));
  virtualConsole.on('error', (...a) => consoleErrs.push('console.error: ' + a.join(' ')));
  virtualConsole.on('warn', (...a) => consoleErrs.push('console.warn: ' + a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(file), {
    url: 'file://' + file,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      /* lienzos falsos: 2D para el HUD/menú, WebGL2 de mentirillas para el motor */
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        const self = this;
        if (type === '2d') {
          if (!this.__c2) {
            const c = stub.makeCanvas(this.width || 300, this.height || 150);
            this.__c2 = c.getContext('2d');
            Object.defineProperty(this.__c2, 'canvas', { value: self, configurable: true, writable: true });
          }
          return this.__c2;
        }
        if (type === 'webgl2' || type === 'experimental-webgl2') {
          if (!this.__gl) this.__gl = stub.makeCanvas(2, 2).getContext('webgl2');
          return this.__gl;
        }
        return null;
      };
      /* tamaños de layout: jsdom no los calcula, el motor los necesita */
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 1024; }, configurable: true });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 640; }, configurable: true });
      window.devicePixelRatio = 1;
      window.__cwConsoleErrs = consoleErrs;
    }
  });
  const w = dom.window;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    let err = null;
    const isOrphan = /cw-orphan/.test(file);
    try {
      /* con resources:'usable' los <script src> de file:// se cargan en asincrónico: hay que esperar */
      for (let i = 0; i < 80 && !w.CW; i++) await wait(50);
      if (isOrphan) {
        /* el HTML sólo, sin sus carpetas: debe avisar en pantalla en vez de quedarse en blanco */
        await wait(250);
        const msg = (w.document.getElementById('bootmsg') || {}).textContent || '';
        const cls = (w.document.getElementById('boot') || {}).className || '';
        ok(/Falta el c/.test(msg), rel + ': sin js/ avisa en pantalla en vez de quedar en blanco (' + JSON.stringify(msg.slice(0, 44)) + ')');
        ok(/err/.test(cls), rel + ': el aviso pinta la carga en estado de error');
        const det = w.document.querySelector('.errdet');
        ok(!!det && /standalone/.test(det.textContent), rel + ': el aviso sugiere el archivo único');
        cb(rel, w, consoleErrs, wait); return;
      }
      ok(!!w.CW, rel + ': window.CW definido (los .js se cargaron)');
      if (!w.CW) { cb(rel, w, consoleErrs, wait); return; }
      ok(!!w.CW.World && !!w.CW.Game && !!w.CW.MODES, rel + ': módulos registrados');
      /* el arranque precarga el primer mundo dentro de un setTimeout */
      for (let i = 0; i < 120 && !(w.__cwGame && w.__cwGame.world); i++) await wait(50);
      const g = w.__cwGame;

      ok(!!g, rel + ': el bootstrap creó el juego (window.__cwGame)');
      if (!g) { cb(rel, w, consoleErrs, wait); return; }
      ok(!!g.world, rel + ': mundo 3D construido al arrancar');
      ok(g.world && g.world.groups.length > 25, rel + ': grupos en escena (' + (g.world ? g.world.groups.length : 0) + ')');
      ok(g.player && g.cars.length === 6, rel + ': parrilla con 6 coches (' + g.cars.length + ')');
      ok(w.document.getElementById('boot').style.opacity === '0', rel + ': la pantalla de carga se oculta');
      /* menú poblada */
      const cards = { maps: all('.cards.maps .card', w.document).length, modes: all('.cards.modes .card', w.document).length, cars: all('.cards.cars .card', w.document).length };
      ok(cards.maps === 4 && cards.modes === 5 && cards.cars === 5,
        rel + ': menú con 4 mapas / 5 modos / 5 coches (' + JSON.stringify(cards) + ')');
      ok(all('.stats .st', w.document).length >= 5, rel + ': barras de estadísticas del coche');
      const cssLoaded = all('style', w.document).length >= 1;
      ok(cssLoaded, rel + ': CSS presente (' + all('style', w.document).length + ' hoja(s) inline)');
      /* elegir modo y arrancar */
      const modeCard = all('.cards.modes .card', w.document)[1] || all('.cards.modes .card', w.document)[0];
      if (modeCard) modeCard.click();
      const start = q('[data-a="start"]', w.document);
      ok(!!start, rel + ': botón de arranque en el DOM');
      const t0 = g.state ? g.state.clock : 0;
      if (start) start.click();
      await wait(500);
      ok(g.running === true, rel + ': SALIR A PISTA arranca la partida');
      ok(q('#ui .scr-menu', w.document).hidden === true, rel + ': el menú se cierra al jugar');
      ok(w.document.body.classList.contains('playing'), rel + ': clase playing activa el HUD');
      /* fotogramas: el bucle de rAF de jsdom avanza el reloj */
      const before = g.state.clock;
      await wait(900);
      ok(g.state.clock > before, rel + ': los fotogramas avanzan (' + before.toFixed(2) + ' → ' + g.state.clock.toFixed(2) + ' s)');
      ok(g.R.stats.draws > 5, rel + ': draw calls por frame (' + g.R.stats.draws + ')');
      ok(g.R.stats.tris > 20000, rel + ': triángulos por frame (' + g.R.stats.tris + ')');
      ok(Number.isFinite(g.player.pos[0]) && Number.isFinite(g.cam.pos[1]), rel + ': estado finito tras jugar');
      /* teclas: cámara y pausa */
      const cam0 = g.camMode;
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }));
      w.document.dispatchEvent(new w.KeyboardEvent('keyup', { code: 'KeyC', bubbles: true }));
      await wait(120);
      ok(g.camMode === (cam0 + 1) % 4, rel + ': la tecla C cambia de cámara');
      ok(g.errors === undefined || g.errors.length === 0, rel + ': sin errores capturados');
      ok((w.CW.errors || []).length === 0, rel + ': sin errores de window (' + (w.CW.errors || []).join(' | ') + ')');
      const real = consoleErrs.filter(l => !/deprecat|Not implemented: window\.scroll|Could not parse CSS/i.test(l));
      ok(real.length === 0, rel + ': consola limpia (' + real.slice(0, 3).join(' | ') + ')');
    } catch (e) {
      err = e;
      fails.push(rel + ': EXCEPCIÓN → ' + e.message + '\n     ' + String(e.stack).split('\n').slice(1, 5).join('\n     '));
    }
    try { w.close(); } catch (e) { }
    cb(rel, w, consoleErrs, wait, err);
  })();
}

/* 3er caso: el HTML sólo, sin sus carpetas (lo que pasa al descargar un único archivo)
   → debe mostrar el aviso claro en vez de una pantalla en blanco */
const orphan = path.join(require('os').tmpdir(), 'cw-orphan-' + Date.now());
fs.mkdirSync(orphan, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'car_wars.html'), path.join(orphan, 'car_wars.html'));
const targets = [path.join(ROOT, 'car_wars.html'), path.join(ROOT, 'car_wars_standalone.html'), path.join(orphan, 'car_wars.html')];
if (!targets.some(t => /standalone/.test(t)) && fs.existsSync(path.join(ROOT, 'car_wars_standalone.html')))
  targets.push(path.join(ROOT, 'car_wars_standalone.html'));
let pending = targets.length;
const cleanup = () => { try { fs.rmSync(orphan, { recursive: true, force: true }); } catch (e) { } };
for (const t of targets) boot(t, (rel, w, errs) => {
  if (--pending) return;
  if (typeof global.__bootEarlyFails === 'number') checks += global.__bootEarlyFails;
  cleanup();
  if (fails.length) { console.log('✘ ' + fails.length + ' fallos:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('✔ arranque real OK  (' + checks + ' comprobaciones en ' + targets.length + ' archivo(s))');
  process.exit(0);
});
