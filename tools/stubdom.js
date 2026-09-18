#!/usr/bin/env node
/* stubdom.js — entorno de navegador falsificado (canvas 2D + WebGL2 no-op)
   para poder ejercitar el motor completo en Node, sin GPU ni pantalla. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const warns = [];   /* avisos del motor: cualquier warning se considera fallo */
const ROOT = path.resolve(__dirname, '..');
/* ---------------- falsificación de DOM / GL ---------------- */
let glCalls = 0;
const constNums = new Map();
function makeGL() {
  return new Proxy({}, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) {                 /* constante GL */
        if (!constNums.has(k)) constNums.set(k, constNums.size + 1);
        return constNums.get(k);
      }
      if (t[k]) return t[k];
      const f = function () {
        glCalls++;
        const cst = (name) => { if (!constNums.has(name)) constNums.set(name, constNums.size + 1); return constNums.get(name); };
        if (k === 'getShaderParameter') return arguments[1] === cst('COMPILE_STATUS');
        if (k === 'getProgramParameter') {
          if (arguments[1] === cst('LINK_STATUS') || arguments[1] === cst('VALIDATE_STATUS')) return true;
          return 0;   /* ACTIVE_UNIFORMS / ATTRIBUTES -> bucles vacíos */
        }
        if (k === 'isContextLost') return false;
        switch (k) {
          case 'getProgramInfoLog': case 'getShaderInfoLog': case 'getShaderSource': return '';
          case 'getExtension': return null;
          case 'getUniformLocation': return { loc: Math.random() };
          case 'getActiveUniform': case 'getActiveAttrib': return null;
          case 'getAttribLocation': return 0;
          case 'getParameter': return 4096;
          case 'checkFramebufferStatus': return cst('FRAMEBUFFER_COMPLETE');
          case 'createTexture': case 'createBuffer': case 'createFramebuffer':
          case 'createRenderbuffer': case 'createProgram': case 'createShader':
          case 'createVertexArray': case 'createQuery': return { id: 'gl' + (++glCalls) };
          default: return undefined;
        }
      };
      t[k] = f;
      return f;
    }
  });
}
function makeCtx2D(w, h) {
  const store = {};
  const gradient = () => ({ addColorStop() { } });
  const ctx = {
    canvas: null,
    get imageData() { return store; },
    fillRect() { }, clearRect() { }, strokeRect() { },
    fillText() { }, strokeText() { }, measureText: () => ({ width: 10 }),
    beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, arcTo() { },
    quadraticCurveTo() { }, bezierCurveTo() { }, rect() { }, ellipse() { },
    fill() { }, stroke() { }, clip() { }, save() { }, restore() { },
    translate() { }, rotate() { }, scale() { }, transform() { }, setTransform() { }, resetTransform() { },
    drawImage() { }, setLineDash() { }, putImageData() { },
    createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
    createPattern: () => ({ setTransform() { } }),
    createImageData: (a, b) => ({ width: a | 0, height: b | 0, data: new Uint8ClampedArray(Math.max(1, (a | 0) * (b | 0)) * 4) }),
    getImageData: (x, y, w2, h2) => {
      const n = Math.max(1, (w2 | 0) * (h2 | 0));
      if (!ctx._buf || ctx._buf.length !== n * 4) {
        const d = new Uint8ClampedArray(n * 4);
        /* relleno determinista: gradiente + ruido, para que el código que
           lea píxeles obtenga valores variados y nunca NaN */
        for (let i = 0; i < n; i++) {
          const px = i % (w2 | 0), py = (i / (w2 | 0)) | 0;
          const v = 128 + 90 * Math.sin(px * 0.11 + py * 0.07) + ((px * 7 + py * 13) % 29) - 14;
          d[i * 4] = v & 255; d[i * 4 + 1] = (v * 0.85) & 255; d[i * 4 + 2] = (v * 0.7) & 255; d[i * 4 + 3] = 255;
        }
        ctx._buf = d; ctx._bw = w2 | 0;
      }
      return { width: w2 | 0, height: h2 | 0, data: ctx._buf };
    }
  };
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation',
    'font', 'textAlign', 'textBaseline', 'filter', 'shadowBlur', 'shadowColor', 'shadowOffsetX',
    'shadowOffsetY', 'lineCap', 'lineJoin', 'imageSmoothingEnabled', 'miterLimit']) ctx[p] = 0;
  return ctx;
}
function makeCanvas(w, h) {
  const c = {
    width: w || 300, height: h || 150, clientWidth: w || 300, clientHeight: h || 150,
    style: {}, dataset: {},
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height }),
    setAttribute() { }, focus() { },
    getContext(type) {
      if (type === '2d') { if (!c._c2) { c._c2 = makeCtx2D(c.width, c.height); c._c2.canvas = c; } return c._c2; }
      if (type === 'webgl2' || type === 'experimental-webgl2') { if (!c._gl) c._gl = makeGL(); return c._gl; }
      return null;
    },
    toDataURL: () => 'data:,'
  };
  return c;
}
global.window = global;
Object.defineProperty(global, 'navigator', { configurable: true, value: { maxTouchPoints: 0, userAgent: 'node', hardwareConcurrency: 4 } });
global.devicePixelRatio = 1;
global.innerWidth = 1280; global.innerHeight = 720;
global.document = {
  createElement: (t) => (t === 'canvas' ? makeCanvas(1, 1) : { style: {}, appendChild() { }, addEventListener() { } }),
  createElementNS: (ns, t) => global.document.createElement(t),
  getElementById: () => null, querySelector: () => null, addEventListener() { },
  body: { appendChild() { }, style: {} }, documentElement: { style: {} },
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }
};
global.self = global;
global.addEventListener = function () { };
global.removeEventListener = function () { };
global.matchMedia = () => ({ matches: false, addEventListener() { }, addListener() { } });
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.alert = () => { };
global.innerWidth = 1280; global.innerHeight = 720;
global.HTMLCanvasElement = function () { };
global.OffscreenCanvas = function (w, h) { return makeCanvas(w, h); };
global.Image = function () { };
global.requestAnimationFrame = () => 0;
global.localStorage = { _m: {}, getItem(k) { return this._m[k] === undefined ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.performance = global.performance || { now: () => Date.now() };
if (!global.AudioContext) global.AudioContext = function () { throw new Error('sin audio en test'); };


module.exports = {
  makeCanvas,
  install: function () {
    return { makeCanvas, makeGL, warns };
  },
  load: function (files) {
    for (const f of files) {
      try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
      catch (e) { console.error('✘ al cargar ' + f + ':\n' + String(e.stack).split('\n').slice(0, 5).join('\n   ')); process.exit(1); }
    }
    return global.CW || global.window.CW;
  },
  ROOT, warns, mute: () => { const w = console.warn, e = console.error; console.warn = (...x) => warns.push(x.join(' ')); console.error = (...x) => warns.push('error: ' + x.join(' ')); return () => { console.warn = w; console.error = e; }; }
};
