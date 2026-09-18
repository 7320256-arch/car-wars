#!/usr/bin/env node
/* all.js — ejecuta todas las suites de verificación y resume.
   Uso: node tools/all.js   (o npm-less: desde la carpeta del proyecto) */
'use strict';
const cp = require('child_process'), path = require('path');
const suites = ['check-shaders', 'check-geo', 'check-maps', 'check-physics', 'check-identity', 'check-world', 'check-game', 'check-boot'];
let bad = 0;
for (const s of suites) {
  const t0 = Date.now();
  const r = cp.spawnSync('node', [path.join(__dirname, s + '.js')], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.trim().split('\n').filter(l => l.trim());
  const verdict = lines.filter(l => /✔|✘/.test(l)).pop();
  const last = verdict || lines[lines.length - 1] || '(sin salida)';
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) bad++;
  console.log((r.status === 0 ? '✔ ' : '✘ ') + s.padEnd(15) + sec.padStart(6) + ' s   ' + last.trim());
  if (r.status !== 0) console.log(out.split('\n').slice(0, 24).map(l => '        ' + l).join('\n'));
}
console.log(bad ? '\n' + bad + ' suite(s) con fallos' : '\ntodas las suites en verde');
process.exit(bad ? 1 : 0);
