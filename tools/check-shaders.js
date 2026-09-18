/* Valida los GLSL del motor con glslangValidator (ES 3.0 / version 450).
   Uso: node tools/check-shaders.js  */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const GLSLANG = process.env.GLSLANG || '/tmp/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux';
if (!fs.existsSync(GLSLANG)) {
  console.log('○ check-shaders: omitido — falta el validador GLSL.\n' +
    '  Actívalo con:  cd /tmp && npm i glslang-validator-prebuilt-predownloaded && \n' +
    '  chmod +x /tmp/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux\n' +
    '  (o GLSLANG=/ruta/glslangValidator node tools/check-shaders.js)');
  process.exit(0);
}

const src = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8');
/* extraer const XXX = `...`;  (template literals sin backticks internos) */
function grab(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*`([\\s\\S]*?)`;');
  const m = src.match(re);
  if (!m) throw new Error('No se encontró el shader ' + name);
  return m[1];
}
let LIB = grab('LIB'), MATS = grab('MATS_STRUCT');
const NUM = n => { const m = src.match(new RegExp(n + '\\s*=\\s*(\\d+)')); if (!m) throw new Error('No se encontró ' + n); return m[1]; };
const MAX_TEX = NUM('MAX_TEX'), MAX_MATS = NUM('MAX_MATS');
function subst(s) {
  return s.replace(/\$\{LIB\}/g, LIB).replace(/\$\{MATS_STRUCT\}/g, MATS)
          .replace(/\$\{MAX_TEX\}/g, MAX_TEX).replace(/\$\{MAX_MATS\}/g, MAX_MATS);
}
const progs = [
  ['main', 'VS_MAIN', 'FS_MAIN'],
  ['shadow', 'VS_SHADOW', 'FS_SHADOW'],
  ['sky', 'VS_FS', 'FS_SKY'],
  ['cloud', 'VS_FS', 'FS_CLOUD'],
  ['particle', 'VS_PART', 'FS_PART'],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glsl-'));
let fail = 0;
for (const [label, vs, fs_] of progs) {
  const vp = path.join(tmp, label + '.vert'), fp = path.join(tmp, label + '.frag');
  fs.writeFileSync(vp, subst(grab(vs)));
  fs.writeFileSync(fp, subst(grab(fs_)));
  for (const [f, stage] of [[vp, 'vert'], [fp, 'frag']]) {
    const r = cp.spawnSync(GLSLANG, ['-S', stage,  f], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.error) { console.log('✗ no se pudo ejecutar ' + GLSLANG + ': ' + r.error.message); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
    if (r.status !== 0) { fail++; console.log('✗ ' + label + ' ' + stage + '\n' + out.split('\n').slice(0, 24).join('\n')); }
    else console.log('✓ ' + label + ' ' + stage);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.log('\n' + fail + ' shader(s) con error'); process.exit(1); }
console.log('\nTodos los shaders compilan.');
