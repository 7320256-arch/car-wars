/* =====================================================================
   CAR WARS 3D - core.js
   Namespace, detecciones, utilidades matemáticas y de colores.
   Todo funciona offline (sin CDNs, sin fetch): sólo scripts clásicos en orden.
   ===================================================================== */
(function (root) {
  'use strict';

  const G = root.CW = root.CW || {};
  G.version = '1.0.0';

  /* ------------------------------------------------------------------ *
   * Detecciones de entorno
   * ------------------------------------------------------------------ */
  try {
    G.IS_FILE = (root.location && root.location.protocol === 'file:');
  } catch (e) { G.IS_FILE = false; }

  G.touch = ('ontouchstart' in root) || (navigator.maxTouchPoints > 0);
  G.isMobileish = G.touch && Math.min(root.innerWidth || 1200, root.innerHeight || 800) < 900;
  G.isChromeOS = /CrOS/i.test(navigator.userAgent || '');

  /* localStorage seguro (en file:// algunos navegadores lo bloquean) */
  G.store = {
    get: function (k, def) {
      try { const v = root.localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
      catch (e) { return (G._mem || (G._mem = {}))[k] !== undefined ? (G._mem || (G._mem = {}))[k] : def; }
    },
    set: function (k, v) {
      try { root.localStorage.setItem(k, JSON.stringify(v)); }
      catch (e) { (G._mem || (G._mem = {}))[k] = v; }
    }
  };

  /* ------------------------------------------------------------------ *
   * Utilidades numéricas
   * ------------------------------------------------------------------ */
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
  function wrapPi(a) { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; }
  function angleLerp(a, b, t) { return a + wrapPi(b - a) * t; }
  function hash1(n) { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); }
  function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  /* ruido de valor 2D determinista (para texturas procedurales) */
  function vnoise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => {
      let n = (a * 374761393 + b * 668265263 + (seed || 0) * 1442695041) | 0;
      n = (n ^ (n >> 13)) * 1274126177 | 0;
      return ((n ^ (n >> 16)) >>> 0) / 4294967295;
    };
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm2(x, y, oct, seed) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += vnoise2(x * f, y * f, (seed || 0) + i * 37) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  }

  /* ------------------------------------------------------------------ *
   * Color: parsing y conversión a lineal
   * ------------------------------------------------------------------ */
  function hexToRgb01(hex) {
    if (Array.isArray(hex)) return [hex[0], hex[1], hex[2]];
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lin2srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  function toLinear(rgb) { return [srgb2lin(rgb[0]), srgb2lin(rgb[1]), srgb2lin(rgb[2])]; }
  function scaleLin(rgb, k) { return [rgb[0] * k, rgb[1] * k, rgb[2] * k]; }
  function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  /* brillo percibido (para elegir texto sobre color) */
  function luminance(rgb) { return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; }

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec) || sec <= 0) return '--:--.---';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec * 1000) % 1000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }
  /* fmtTime(segundos). Para milisegundos (récords persistidos) usar fmtMs. */
  function fmtMs(ms) { return fmtTime(ms == null ? null : ms / 1000); }
  function fmtShort(sec) {
    if (sec == null || !isFinite(sec)) return '--.-';
    return sec.toFixed(1);
  }

  G.clamp = clamp; G.lerp = lerp; G.smooth = smooth; G.damp = damp;
  G.wrapPi = wrapPi; G.angleLerp = angleLerp; G.hash1 = hash1;
  G.rngFrom = rngFrom; G.vnoise2 = vnoise2; G.fbm2 = fbm2;
  G.hexToRgb01 = hexToRgb01; G.srgb2lin = srgb2lin; G.lin2srgb = lin2srgb;
  /* color [r,g,b] (0..1 o 0..255) o '#rrggbb' -> 'css' */
  function rgbCss(c) {
    if (c == null) return '#cccccc';
    if (typeof c === 'string') return c;
    const f = v => { v = v <= 1 ? v * 255 : v; v = clamp(Math.round(v), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); };
    return '#' + f(c[0]) + f(c[1]) + f(c[2]);
  }
  G.rgbCss = rgbCss;
  G.toLinear = toLinear; G.scaleLin = scaleLin; G.mixRgb = mixRgb;
  G.luminance = luminance; G.fmtTime = fmtTime; G.fmtMs = fmtMs; G.fmtShort = fmtShort;

  /* ------------------------------------------------------------------ *
   * Guardas de errores: si algo peta, se ve en pantalla y en consola
   * ------------------------------------------------------------------ */
  G.errors = [];
  if (typeof root.addEventListener === 'function')
  root.addEventListener('error', function (e) {
    G.errors.push(String(e.message || e.error));
    if (root.__cwOnError) root.__cwOnError(String(e.message || e.error));
  });

})(typeof window !== 'undefined' ? window : globalThis);
