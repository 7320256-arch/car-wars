#!/usr/bin/env node
/* build-single.js — genera car_wars_standalone.html: un ÚNICO archivo con el
   CSS y los 12 .js incrustados. Sirve para descargar/compartir sin carpetas.
   Uso: node tools/build-single.js  */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let html = read('car_wars.html');
const problems = [];

/* ---- CSS ---- */
const css = read('css/style.css');
if (/<\/style/i.test(css)) problems.push('el CSS contiene </style>');
html = html.replace('<link rel="stylesheet" href="css/style.css">',
  '<style>\n' + css.replace(/\s*\/\*\s*([\s\S]*?)\s*\*\/\s*/g, (m, c) => (c.length < 70 ? '/*' + c + '*/' : '')) + '\n</style>');

/* ---- JS en el orden del HTML ---- */
const order = [...html.matchAll(/<script src="(js\/[a-z0-9_]+\.js)"><\/script>/g)].map(m => m[1]);
if (order.length !== 12) problems.push('se esperaban 12 scripts, hallados ' + order.length);
let inlined = 0, bytes = 0;
for (const src of order) {
  let js = read(src);
  if (/<\/script/i.test(js)) problems.push(src + ' contiene </script>');
  /* quitar el envoltorio IIFE no hace falta; sólo recortar comentarios largos */
  js = js.replace(/\/\* =+\s*\n[\s\S]*?\n\s*=+ \*\/\n/g, m => (m.length > 420 ? '/* ' + m.split('\n')[1].replace(/\s*=\s*/, '').trim() + ' */\n' : m));
  bytes += js.length;
  html = html.replace('<script src="' + src + '"></script>',
    '<script>/* ' + src + ' */\n' + js + '\n</script>');
  inlined++;
}
if (inlined !== order.length) problems.push('no se sustituyeron todos los scripts');

/* marcar el archivo único y quitar el aviso de css ausente */
html = html.replace('<body>', '<body>').replace('(function () {\n  \'use strict\';\n  if (window.__cwNoGL) return;',
  "(function(){window.__cwStandalone=true;})();\n(function () {\n  'use strict';\n  if (window.__cwNoGL) return;");
html = html.replace(/<!--[\s\S]*?-->/g, m => (/TODO|FIXME/.test(m) ? m : ''));
html = html.replace('<title>', '<title>[archivo único] ');

const out = path.join(ROOT, 'car_wars_standalone.html');
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(problems.length ? '✘ ' + problems.join('; ') :
  `✔ car_wars_standalone.html  (${kb} kB, ${inlined} scripts incrustados, ${(bytes / 1024).toFixed(0)} kB de JS, 0 peticiones externas)`);
/* cordura: que no quede ni un src/href relativo ni http(s) */
const leftovers = [...html.matchAll(/(?:src|href)="(?!data:)([^"]+)"/g)].map(m => m[1]);
if (leftovers.length) console.log('✘ todavía referencia:', leftovers.join(', '));
else console.log('✔ sin referencias externas (ni http, ni rutas relativas)');
process.exit(problems.length || leftovers.length ? 1 : 0);
