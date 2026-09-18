/* Test de trazados + máscara de colisión/progreso (lógica real del juego).
   Uso: node tools/check-maps.js                                          */
const fs = require('fs'), vm = require('vm');
const root = fs.realpathSync(__dirname + '/..');
const win = {
  location: { protocol: 'file:' }, innerWidth: 1280, innerHeight: 720,
  navigator: { userAgent: 'node', maxTouchPoints: 0 }, addEventListener() { }
};
win.window = win; win.globalThis = win;
vm.createContext(win);
for (const f of ['js/core.js', 'js/math3d.js', 'js/mapdata.js'])
  vm.runInContext(fs.readFileSync(root + '/' + f, 'utf8'), win, { filename: f });
const G = win.CW;

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const clamp = (v,a,b)=>v<a?a:v>b?b:v;

for (const map of G.MAPS) {
  console.log('\n— ' + map.name + ' (' + map.id + ')');
  const t = G.makeTrack(map);
  const centers = t.centers, meta = t.meta, mask = t.mask, rad = t.radius;
  ok(meta.total > 800 && meta.total < 4200, map.id + ': longitud del circuito razonable (' + meta.total.toFixed(0) + ' m)');
  ok(centers.length > 150, map.id + ': densidad de puntos (' + centers.length + ')');
  let mn = 1e9, mx = 0;
  for (let i = 0; i < centers.length; i++) {
    const a = centers[i], b2 = centers[(i + 1) % centers.length];
    const d = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
    mn = Math.min(mn, d); mx = Math.max(mx, d);
  }
  ok(mn > 2.15 && mx < 3.05, map.id + ': espaciado ~2.6 m (' + mn.toFixed(2) + '…' + mx.toFixed(2) + ')');
  let maxAbs = 0;
  for (const c of centers) maxAbs = Math.max(maxAbs, Math.abs(c[0]), Math.abs(c[1]));
  ok(maxAbs < map.world - map.w - 3, map.id + ': la pista cabe en el mundo (' + maxAbs.toFixed(0) + ' < ' + (map.world - map.w) + ')');
  const v = G.validateTrack(centers, map.w);
  ok(v.bad === 0, map.id + ': sin auto-cruces (sep. mín. ' + v.worst.toFixed(1) + ' m, umbral ' + v.minSep.toFixed(1) + ')');
  let rmin = 1e9;
  for (let i = 0; i < rad.length; i++) rmin = Math.min(rmin, rad[i]);
  ok(rmin > 16, map.id + ': radio de curva mínimo > 16 m (' + rmin.toFixed(1) + ' m)');
  ok(rad.every(x => x > 0 && isFinite(x)), map.id + ': radios válidos');
  ok(t.bank.length === centers.length && t.bank.every(x => x >= -1e-6 && x <= map.bank + 1e-6), map.id + ': peralte en rango');
  let bankJump = 0;
  for (let i = 0; i < t.bank.length; i++) if (Math.abs(t.bank[(i + 1) % t.bank.length] - t.bank[i]) > 0.05) bankJump++;
  ok(bankJump === 0, map.id + ': peralte suave (' + bankJump + ' saltos)');
  let eMax = 0, eBad = 0;
  for (let i = 0; i < t.Y.length; i++) {
    eMax = Math.max(eMax, Math.abs(t.Y[i]));
    if (Math.abs(t.Y[(i + 1) % t.Y.length] - t.Y[i]) > 0.42) eBad++;
  }
  ok(eMax < 9, map.id + ': elevación máxima (' + eMax.toFixed(1) + ' m)');
  ok(eBad === 0, map.id + ': pendiente suave (' + eBad + ' saltos)');
  /* máscara */
  ok(mask.dist(centers[0][0], centers[0][1]) < 1.4, map.id + ': dist≈0 sobre el eje de pista (' + mask.dist(centers[0][0], centers[0][1]).toFixed(2) + ')');
  {
    let worst = 0;
    const rng = G.rngFrom(1234);
    for (let s2 = 0; s2 < 30; s2++) {
      const px = (rng() * 2 - 1) * (map.world - 2), pz = (rng() * 2 - 1) * (map.world - 2);
      let exact = 1e9;
      for (let i = 0; i < centers.length; i++) {
        const a = centers[i], b3 = centers[(i + 1) % centers.length];
        const ex = b3[0] - a[0], ez = b3[1] - a[1];
        const el2 = ex * ex + ez * ez || 1e-6;
        const tt = Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / el2));
        exact = Math.min(exact, Math.hypot(px - (a[0] + ex * tt), pz - (a[1] + ez * tt)));
      }
      worst = Math.max(worst, Math.abs(mask.dist(px, pz) - exact));
    }
    ok(worst < mask.cell * 1.7, map.id + ': máscara ≈ distancia exacta (error ' + worst.toFixed(2) + ' m / celda ' + mask.cell.toFixed(2) + ')');
  }
  /* progreso envoltorio de vuelta (lo que usa el juego) */
  {
    let prev = mask.progress(centers[0][0], centers[0][1]), sum = 0, back = 0, maxStep = 0;
    for (let i = 1; i <= centers.length; i++) {
      const c = centers[i % centers.length];
      const p = mask.progress(c[0], c[1]);
      let d = p - prev;
      if (d < -0.5) d += 1; else if (d > 0.5) d -= 1;
      if (d < -0.02) back++;
      maxStep = Math.max(maxStep, Math.abs(d));
      sum += d; prev = p;
    }
    ok(Math.abs(sum - 1) < 0.06, map.id + ': una vuelta = progreso 1.0 (' + sum.toFixed(3) + ')');
    ok(back === 0, map.id + ': progreso sin retrocesos (' + back + ')');
    ok(maxStep < 0.02, map.id + ': paso de progreso uniforme (' + maxStep.toFixed(4) + ')');
  }
  /* pull hacia el eje */
  {
    const i5 = Math.floor(centers.length * 0.31);
    const c5 = centers[i5];
    const nx = t.N[i5 * 2], nz = t.N[i5 * 2 + 1];
    const px = c5[0] + nx * map.w * 1.2, pz = c5[1] + nz * map.w * 1.2;
    const g = [0, 0];
    mask.pull(px, pz, g);
    const want = [c5[0] - px, c5[1] - pz], wl = Math.hypot(want[0], want[1]) || 1;
    ok((g[0] * want[0] + g[1] * want[1]) / wl > 0.9, map.id + ': pull() apunta al eje (' + ((g[0] * want[0] + g[1] * want[1]) / wl).toFixed(2) + ')');
    /* el valor debe coincidir con la distancia EXACTA a la pista (que en el interior
       de una curva puede ser menor que el desplazamiento lateral) */
    let ex2 = 1e9;
    for (let i = 0; i < centers.length; i++) {
      const a = centers[i], b3 = centers[(i + 1) % centers.length];
      const ddx = b3[0] - a[0], ddz = b3[1] - a[1], el2 = ddx * ddx + ddz * ddz || 1e-6;
      const tt = Math.max(0, Math.min(1, ((px - a[0]) * ddx + (pz - a[1]) * ddz) / el2));
      ex2 = Math.min(ex2, Math.hypot(px - (a[0] + ddx * tt), pz - (a[1] + ddz * tt)));
    }
    ok(Math.abs(mask.dist(px, pz) - ex2) < mask.cell * 1.6, map.id + ': dist lateral ≈ exacta (' + mask.dist(px, pz).toFixed(2) + ' vs ' + ex2.toFixed(2) + ')');
  }
  /* at() coherente con los centros */
  {
    const a = t.at(7), b = centers[7];
    ok(Math.hypot(a.x - b[0], a.z - b[1]) < 1e-6, map.id + ': at() devuelve el centro correcto');
    const fwd = [Math.sin(a.yaw), Math.cos(a.yaw)];
    ok(fwd[0] * t.T[14] + fwd[1] * t.T[15] > 0.999, map.id + ': yaw alineado con la tangente');
  }
  console.log('  · ' + map.id + ': ' + meta.total.toFixed(0) + ' m, ' + centers.length + ' pts, rmin ' + rmin.toFixed(0) + ' m, elev ' + eMax.toFixed(1) + ' m');
}
console.log('\n' + (fails ? 'FALLOS: ' + fails : '✔ mapas OK') + '  (' + checks + ' comprobaciones)');
process.exit(fails ? 1 : 0);
