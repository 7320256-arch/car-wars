/* Test geométrico real de las primitivas (winding + normales + radios + uv).
   Ejecuta el mismo código que el juego: node tools/check-geo.js          */
const fs = require('fs'), vm = require('vm');
const root = fs.realpathSync(__dirname + '/..');

const win = {
  location: { protocol: 'file:' }, innerWidth: 1280, innerHeight: 720,
  navigator: { userAgent: 'node', maxTouchPoints: 0 },
  addEventListener() { }, localStorage: null
};
win.window = win; win.globalThis = win;
vm.createContext(win);
for (const f of ['js/core.js', 'js/math3d.js', 'js/primitives.js']) {
  vm.runInContext(fs.readFileSync(root + '/' + f, 'utf8'), win, { filename: f });
}
const G = win.CW;

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('  ✗ ' + msg); } }

/* Verifica un Builder:
   - todo triángulo no degenerado tiene su normal geométrica (winding)
     del lado de la normal de sombreado
   - todas las normales unitarias
   - (opc) las normales apuntan fuera de un centro
   - (opc) si se exige "up", las normales tienen ny > umbral */
function verify(name, b, o) {
  o = o || {};
  const p = b.p, n = b.n;
  const nt = p.length / 9;
  ok(p.length === b.n.length && b.u.length === p.length * 2 / 3, name + ': longitudes pos/nor/uv coherentes');
  ok(Number.isInteger(nt), name + ': triángulos completos');
  let badWinding = 0, badLen = 0, badOut = 0, badUp = 0, degenerate = 0;
  for (let t = 0; t < nt; t++) {
    const q = t * 9;
    const a = [p[q], p[q + 1], p[q + 2]], bb = [p[q + 3], p[q + 4], p[q + 5]], c = [p[q + 6], p[q + 7], p[q + 8]];
    const e1 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const gl = Math.hypot(g[0], g[1], g[2]);
    if (gl < 1e-9) { degenerate++; continue; }
    for (let k = 0; k < 3; k++) {
      const l = Math.hypot(n[q + k * 3], n[q + k * 3 + 1], n[q + k * 3 + 2]);
      if (Math.abs(l - 1) > 1e-3) badLen++;
    }
    const dot = (g[0] * n[q] + g[1] * n[q + 1] + g[2] * n[q + 2]) / gl;
    if (dot <= 1e-4) badWinding++;
    if (o.up) { for (let k = 0; k < 3; k++) if (n[q + k * 3 + 1] < (o.threshold || 0.99)) badUp++; }
    if (o.center) {
      for (let k = 0; k < 3; k++) {
        const d = [p[q + k * 3] - o.center[0], p[q + k * 3 + 1] - o.center[1], p[q + k * 3 + 2] - o.center[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        if ((d[0] * n[q + k * 3] + d[1] * n[q + k * 3 + 1] + d[2] * n[q + k * 3 + 2]) / l < -0.08) badOut++;
      }
    }
  }
  ok(badWinding === 0, name + ': winding coherente con la normal (' + badWinding + '/' + nt + ')');
  ok(badLen === 0, name + ': normales unitarias (' + badLen + ')');
  ok(badUp === 0, name + ': normales hacia arriba (' + badUp + ')');
  if (o.center) ok(badOut === 0, name + ': normales hacia fuera (' + badOut + ')');
  ok(degenerate === 0, name + ': sin triángulos degenerados (' + degenerate + ')');
  console.log('  · ' + name + ': ' + nt + ' tris');
  return nt;
}

/* ---------------- caja ---------------- */
{
  const b = new G.Builder(); b.box(0, 0, 0, 2, 1, 4);
  const t = verify('box', b, { center: [0, 0, 0] });
  ok(t === 12, 'box: 12 triángulos (6 caras × 2) → ' + t);
}
{
  const b = new G.Builder(); b.box(1, 2, -3, 3, 2, 5, { taperTop: [0.7, 0.8], topOffset: [0.2, 0.1] });
  verify('box taper', b, { center: [1, 2, -3] });
}
/* ---------------- loft (carrocería) ---------------- */
{
  const prof = G.roundedRect(0.95, 2.2, 0.35, 3);
  const b = new G.Builder();
  b.loft([
    { y: 0.25, pts: prof },
    { y: 0.6, pts: prof, scale: [1.02, 1.0] },
    { y: 0.95, pts: prof, scale: [0.9, 0.86], off: [-0.02, -0.1] },
    { y: 1.2, pts: prof, scale: [0.7, 0.5], off: [0, -0.5] }
  ], { base: 0 });
  verify('loft', b, { center: [0, 0.7, 0] });
  const bb = b.p;
  let yMin = 1e9, yMax = -1e9;
  for (let i = 1; i < bb.length; i += 3) { yMin = Math.min(yMin, bb[i]); yMax = Math.max(yMax, bb[i]); }
  ok(Math.abs(yMin - 0.25) < 1e-6 && Math.abs(yMax - 1.2) < 1e-6, 'loft: alturas de nivel exactas (' + yMin + '..' + yMax + ')');
}
/* ---------------- cilindro / cono ---------------- */
{
  const S = 14;
  const b = new G.Builder(); b.cyl(0, 0, 0, 1, 1, 2, S, {});
  const t = verify('cyl', b, { center: [0, 0, 0] });
  ok(t === 2 * S + 2 * (S - 2), 'cyl: laterales+tapas = ' + (2 * S + 2 * (S - 2)) + ' (obtenidos ' + t + ')');
  const b2 = new G.Builder(); b2.cyl(0, 0, 0, 1, 0, 2, 12, {});
  verify('cono', b2);
}
/* ---------------- rueda ---------------- */
{
  const b = new G.Builder(); b.wheel(0.34, 0.24, 16, { rimRatio: 0.62 });
  const t = verify('wheel', b);
  ok(t > 150, 'wheel: geometría suficiente (' + t + ')');
  /* el radio máximo debe ser ~0.34 y el grosor ~0.24 */
  let r = 0, zw = 0;
  for (let i = 0; i < b.p.length; i += 3) { r = Math.max(r, Math.hypot(b.p[i], b.p[i + 1])); zw = Math.max(zw, Math.abs(b.p[i + 2])); }
  ok(Math.abs(r - 0.34) < 0.02, 'wheel: radio correcto (' + r.toFixed(3) + ')');
  ok(Math.abs(zw - 0.12) < 0.06, 'wheel: ancho correcto (' + zw.toFixed(3) + ')');
}
/* ---------------- esfera / roca ---------------- */
{
  const b = new G.Builder(); b.sphere(0, 0, 0, 1, 12, 8, 1);
  verify('sphere', b, { center: [0, 0, 0] });
  const b2 = new G.Builder(); b2.rock(0, 0, 0, 1, 0.8, 1.2, 7);
  verify('rock', b2);
}
/* ---------------- tubo ---------------- */
{
  const path = [];
  for (let i = 0; i < 12; i++) path.push([Math.cos(i / 11 * 3) * 4, i * 0.2, Math.sin(i / 11 * 3) * 4]);
  const b = new G.Builder(); b.tube(path, 0.08, 6, {});
  verify('tube', b);
  const b2 = new G.Builder(); b2.tube(path, 0.5, 8, { inside: true });
  verify('tube inside (túnel)', b2);
}
/* ---------------- carretera (curvatura realista) ---------------- */
{
  const cs = [], L = [];
  let acc = 0;
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 1.7;
    cs.push([Math.sin(a) * 60, Math.cos(a) * 42 + i * 1.2]);
    if (i) acc += Math.hypot(cs[i][0] - cs[i - 1][0], cs[i][1] - cs[i - 1][1]);
    L.push(acc);
  }
  const b = new G.Builder();
  b.ribbon(cs, 6, () => 0, { lengths: L, uvU: 0.2 });
  verify('ribbon plano', b, { up: true, threshold: 0.999 });
  const us = b.u.filter((_, i) => i % 2 === 0);
  const vs = b.u.filter((_, i) => i % 2 === 1);
  ok(Math.abs(Math.max(...us) - L[L.length - 1] * 0.2) < 1e-3, 'ribbon: U = longitud acumulada × escala');
  ok(us.every(v => v >= -1e-6), 'ribbon: U no negativa');
  ok(vs.every(v => v >= -1e-6 && v <= 1 + 1e-6), 'ribbon: V en [0,1]');
  /* u monótona por fila */
  let mono = true;
  for (let i = 6; i < us.length; i += 4) if (us[i] <= us[i - 6] + 1e-9) mono = false;
  ok(mono, 'ribbon: U creciente a lo largo de la pista');

  const bc = new G.Builder();
  bc.ribbon(cs, 6, () => 0, { lengths: L, uvU: 0.2, curbs: true });
  verify('ribbon con cordillos', bc);
  ok(bc.p.length / 9 > b.p.length / 9, 'ribbon: los cordillos añaden geometría (' + (b.p.length / 9) + '→' + (bc.p.length / 9) + ')');

  const b2 = new G.Builder();
  const cs2 = [];
  for (let i = 0; i <= 20; i++) cs2.push([Math.sin(i * 0.4) * 10, i * 2 - 20]);
  b2.ribbon(cs2, 5, (i) => Math.sin(i * 0.3) * 0.4, { uvU: 0.2, curbs: true });
  verify('ribbon cerrado (curva extrema)', b2);
}
/* ---------------- roundedRect ---------------- */
{
  const pr = G.roundedRect(2, 3, 0.5, 2);
  ok(pr.length > 8, 'roundedRect: perfil cerrado (' + pr.length + ' pts)');
  let dup = 0;
  for (let i = 0; i < pr.length; i++) {
    const a = pr[i], b = pr[(i + 1) % pr.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5) dup++;
  }
  ok(dup === 0, 'roundedRect: sin vértices duplicados (' + dup + ')');
  ok(pr.every(p => Math.abs(p[0]) <= 2 + 1e-6 && Math.abs(p[1]) <= 3 + 1e-6), 'roundedRect: dentro de límites');
  const area = (() => { let A = 0; for (let i = 0; i < pr.length; i++) { const a = pr[i], b = pr[(i + 1) % pr.length]; A += a[0] * b[1] - b[0] * a[1]; } return Math.abs(A / 2); })();
  ok(area > 2 * 3 * 0.7 && area <= 4 * 6, 'roundedRect: área coherente (' + area.toFixed(2) + ')');
}
/* ---------------- bounds/radio ---------------- */
{
  const b = new G.Builder(); b.box(0, 0, 0, 2, 4, 6);
  let maxR = 0;
  for (let i = 0; i < b.p.length; i += 3) maxR = Math.max(maxR, Math.hypot(b.p[i], b.p[i + 1], b.p[i + 2]));
  ok(Math.abs(maxR - Math.hypot(1, 2, 3)) < 1e-6, 'bounds: radio = diagonal de semitamaño');
}

console.log('\n' + (fails ? 'FALLOS: ' + fails : '✔ primitivas OK') + '  (' + checks + ' comprobaciones)');
process.exit(fails ? 1 : 0);
