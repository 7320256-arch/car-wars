/* =====================================================================
   textures.js — Texturas 100% procedurales generadas con Canvas2D.
   Nada de archivos externos: el juego funciona desde file:// sin red.
   Cada textura devuelve { src: canvas, name, wrap } listo para R.addTexture()
   ===================================================================== */
(function (G) {
  'use strict';
  const { clamp, lerp, fbm2, vnoise2 } = G;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: false });
    return [c, x];
  }
  function Tex(name, w, h, draw, opts) {
    const [c, x] = canvas(w, h);
    draw(x, w, h, opts || {});
    return { name: name, src: c, wrap: (opts && opts.wrap) || 'repeat' };
  }
  /* ruido por píxel: devuelve ImageData ya coloreado */
  function noiseField(w, h, fn) {
    const [c, x] = canvas(w, h);
    const img = x.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < w; i++) {
        const o = (y * w + i) * 4;
        const col = fn(i / w, y / h, i, y);
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = col[3] === undefined ? 255 : col[3];
      }
    }
    x.putImageData(img, 0, 0);
    return [c, x];
  }

  /* ------------------------------------------------------------------ *
   * ASFALTO / PISTA
   *  - u: largo (repite), v: ancho de pista (0..1)
   *  - canales de "rugosidad" (alfa) para brillo variable
   * ------------------------------------------------------------------ */
  function roadTexture(o) {
    o = o || {};
    const W = o.w || 512, H = o.h || 512;
    const dark = o.base || [46, 47, 51];
    const line = o.line || [232, 232, 226];
    const edgeW = (o.edge || 0.045);
    const centerDash = o.center !== false;
    const rumble = o.rumble || null;          /* [r,g,b] para bordes tipo cordillo */
    const marks = o.marks || 'lane';
    const [c, x] = noiseField(W, H, (u, v, px, py) => {
      /* grano asfáltico: agregados + bacheado suave */
      const grain = vnoise2(px * 0.9, py * 0.9, 11);
      const grain2 = vnoise2(px * 3.7, py * 3.7, 5);
      const blot = fbm2(u * 5, v * 5, 3, 3);
      let r = dark[0] * (0.72 + 0.5 * blot), g = dark[1] * (0.72 + 0.5 * blot), b = dark[2] * (0.72 + 0.5 * blot);
      const agg = grain2 > 0.72 ? (grain2 - 0.72) * 260 : 0;
      r += agg * 0.75; g += agg * 0.75; b += agg * 0.72;
      r += (grain - 0.5) * 16; g += (grain - 0.5) * 16; b += (grain - 0.5) * 16;
      /* grietas oscuras */
      const cr = Math.abs(fbm2(u * 9.3, v * 2.1, 3, 21) - 0.5);
      if (cr < 0.012) { r *= 0.55; g *= 0.55; b *= 0.55; }
      /* marcas viales */
      let rough = 0.55 + 0.35 * grain;
      const vv = v;
      const paint = (a) => {
        r = lerp(r, line[0], a); g = lerp(g, line[1], a); b = lerp(b, line[2], a);
        rough = lerp(rough, 0.9, a);
      };
      if (marks !== 'plain') {
        /* líneas de borde continuas */
        const e1 = Math.min(Math.abs(vv - edgeW), Math.abs(1 - edgeW - vv));
        if (e1 < 0.011) paint(1 - e1 / 0.011);
        if (rumble) {
          const band = Math.min(Math.abs(vv - edgeW * 0.45), Math.abs(1 - edgeW * 0.45 - vv));
          if (band < 0.030) {
            const seg = Math.sin(uvPhase(u, o.rumbleFreq || 26)) > 0 ? 1 : 0;
            const a = (1 - band / 0.030) * seg;
            r = lerp(r, rumble[0], a); g = lerp(g, rumble[1], a); b = lerp(b, rumble[2], a);
            rough = lerp(rough, 0.75, a);
          }
        }
        /* línea central discontinua */
        if (centerDash) {
          const d1 = Math.abs(vv - 0.5);
          const dashOn = uvPhase(u, o.dashFreq || 14) > 0.05;
          if (d1 < 0.008 && dashOn) paint(1 - d1 / 0.008);
        }
        if (marks === 'grid') {
          const sq = (Math.floor(u * 8) + Math.floor(vv * 8)) % 2;
          const a = sq ? 0.35 : 0.0;
          r = lerp(r, 20, a); g = lerp(g, 20, a); b = lerp(b, 24, a);
        }
        if (marks === 'runway') {
          const d1 = Math.abs(vv - 0.5);
          const dashOn = uvPhase(u, 6) > -0.25;
          if (d1 < 0.02 && dashOn) paint(1 - d1 / 0.02);
          const e2 = Math.min(vv, 1 - vv);
          if (e2 < 0.05 && e2 > 0.02) paint(0.55);
        }
      }
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255), clamp(rough * 255, 0, 255)];
    });
    x.globalAlpha = 0.12;
    /* manchas de aceite / reparaciones */
    for (let i = 0; i < 14; i++) {
      const px = (vnoise2(i * 3.3, 1.7, 91)) * W, py = vnoise2(i * 1.1, 9.2, 33) * H;
      x.fillStyle = i % 3 ? '#000' : '#6b6b6b';
      x.beginPath(); x.ellipse(px, py, 10 + vnoise2(px, py, 3) * 40, 5 + vnoise2(py, px, 5) * 18, vnoise2(i, 2, 7) * 3, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    return { name: o.name || 'road', src: c, wrap: 'repeat' };
  }
  function uvPhase(u, freq) { return Math.sin(u * Math.PI * 2 * freq); }

  /* ------------------------------------------------------------------ *
   * SUELO: hierba / arena / nieve / asfalto urbano
   * ------------------------------------------------------------------ */
  function groundTexture(o) {
    o = o || {};
    const S = o.size || 512;
    const a = o.colA || [70, 92, 48], b = o.colB || [96, 112, 62];
    const kind = o.kind || 'grass';
    const [c, x] = noiseField(S, S, (u, v, px, py) => {
      const big = fbm2(u * 3.5, v * 3.5, 4, o.seed || 1);
      const mid = fbm2(u * 14, v * 14, 3, (o.seed || 1) + 7);
      const fine = vnoise2(px * 1.7, py * 1.7, (o.seed || 1) + 13);
      let t = clamp(big * 0.7 + mid * 0.45 - 0.12, 0, 1);
      let r = lerp(a[0], b[0], t), g = lerp(a[1], b[1], t), bl = lerp(a[2], b[2], t);
      let rough = 0.8;
      if (kind === 'grass') {
        const blade = vnoise2(px * 4.1, py * 1.2, 21);
        r += (blade - 0.5) * 22; g += (blade - 0.5) * 34; bl += (blade - 0.5) * 14;
        rough = 0.9 - mid * 0.2;
        /* parches de tierra */
        const dirt = fbm2(u * 5.5, v * 5.5, 3, 55);
        if (dirt > 0.62) { const k = (dirt - 0.62) * 3.2; r = lerp(r, 122, k); g = lerp(g, 96, k); bl = lerp(bl, 66, k); }
      } else if (kind === 'sand') {
        const rip = Math.sin(v * 40 + fbm2(u * 6, v * 6, 2, 3) * 6) * 0.5 + 0.5;
        r += (rip - 0.5) * 16 + (fine - 0.5) * 16; g += (rip - 0.5) * 14 + (fine - 0.5) * 14; bl += (rip - 0.5) * 10 + (fine - 0.5) * 12;
        rough = 0.95;
      } else if (kind === 'snow') {
        r += (fine - 0.5) * 12; g += (fine - 0.5) * 13; bl += (fine - 0.5) * 10;
        const sh = fbm2(u * 8, v * 8, 3, 12);
        if (sh > 0.62) { const k = (sh - 0.62) * 2.2; r = lerp(r, 178, k); g = lerp(g, 190, k); bl = lerp(bl, 210, k); }
        rough = 0.55;
      } else if (kind === 'city') {
        /* losetas de acera */
        const gx = Math.abs((u * 6) % 1 - 0.5) * 2, gy = Math.abs((v * 6) % 1 - 0.5) * 2;
        const seam = Math.max(gx, gy) > 0.94 ? 0.62 : 1;
        r *= seam; g *= seam; bl *= seam;
        r += (fine - 0.5) * 14; g += (fine - 0.5) * 14; bl += (fine - 0.5) * 14;
        rough = 0.8 * (0.7 + mid * 0.5);
      } else if (kind === 'salt') {
        /* lago seco del aeródromo */
        const crack = Math.abs(fbm2(u * 12, v * 12, 3, 41) - 0.5);
        const k = clamp(1 - crack * 18, 0, 1);
        r = lerp(r, 120, k); g = lerp(g, 108, k); bl = lerp(bl, 92, k);
        rough = 0.85;
      }
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(bl, 0, 255), clamp(rough * 255, 0, 255)];
    });
    return { name: o.name || ('ground_' + kind), src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * FACHADAS DE EDIFICIO  (color + emisiva de ventanas)
   * ------------------------------------------------------------------ */
  function facadeTextures(o) {
    o = o || {};
    const S = 512, cols = o.cols || 8, rows = o.rows || 12;
    const night = !!o.night;
    const wall = o.wall || [148, 142, 132];
    const glassDay = o.glass || [82, 96, 112];
    const litCol = o.lit || [255, 214, 150];
    const litRatio = o.litRatio == null ? (night ? 0.55 : 0.12) : o.litRatio;
    const seed = o.seed || 5;

    const [cc, cx] = canvas(S, S);
    const [ec, ex] = canvas(S, S);
    /* fondo */
    const img = cx.createImageData(S, S), ed = ex.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x2 = 0; x2 < S; x2++) {
      const o2 = (y * S + x2) * 4;
      const n = vnoise2(x2 * 0.06, y * 0.06, seed), n2 = vnoise2(x2 * 0.7, y * 0.7, seed + 2);
      let r = wall[0] * (0.78 + 0.4 * n), g = wall[1] * (0.78 + 0.4 * n), b = wall[2] * (0.78 + 0.4 * n);
      r += (n2 - 0.5) * 18; g += (n2 - 0.5) * 18; b += (n2 - 0.5) * 16;
      const rough = 0.62 + n2 * 0.3;
      img.data[o2] = clamp(r, 0, 255); img.data[o2 + 1] = clamp(g, 0, 255); img.data[o2 + 2] = clamp(b, 0, 255); img.data[o2 + 3] = clamp(rough * 255, 0, 255);
      ed.data[o2] = 0; ed.data[o2 + 1] = 0; ed.data[o2 + 2] = 0; ed.data[o2 + 3] = 255;
    }
    cx.putImageData(img, 0, 0); ex.putImageData(ed, 0, 0);

    const cw = S / cols, ch = S / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const h = vnoise2(i * 3.1, j * 7.7, seed + 40);
        const wx = i * cw + cw * 0.20, wy = j * ch + ch * 0.22;
        const ww = cw * 0.60, wh = ch * 0.50;
        /* marco / relieve */
        cx.fillStyle = 'rgba(0,0,0,0.20)';
        cx.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
        const lit = h < litRatio;
        const gr = glassDay[0] / 255, gg = glassDay[1] / 255, gb = glassDay[2] / 255;
        const shade = 0.6 + h * 0.7;
        const grad = cx.createLinearGradient(wx, wy, wx + ww, wy + wh);
        grad.addColorStop(0, `rgb(${clamp(gr * 255 * shade * 1.5, 0, 255) | 0},${clamp(gg * 255 * shade * 1.5, 0, 255) | 0},${clamp(gb * 255 * shade * 1.6, 0, 255) | 0})`);
        grad.addColorStop(0.5, `rgb(${clamp(gr * 255 * shade * 0.5, 0, 255) | 0},${clamp(gg * 255 * shade * 0.5, 0, 255) | 0},${clamp(gb * 255 * shade * 0.55, 0, 255) | 0})`);
        grad.addColorStop(1, `rgb(${clamp(gr * 255 * shade * 0.9, 0, 255) | 0},${clamp(gg * 255 * shade * 0.9, 0, 255) | 0},${clamp(gb * 255 * shade, 0, 255) | 0})`);
        cx.fillStyle = grad;
        cx.fillRect(wx, wy, ww, wh);
        /* reflejo diagonal */
        cx.fillStyle = 'rgba(255,255,255,0.10)';
        cx.beginPath(); cx.moveTo(wx, wy + wh); cx.lineTo(wx + ww * 0.55, wy); cx.lineTo(wx + ww * 0.95, wy); cx.lineTo(wx + ww * 0.4, wy + wh); cx.fill();
        /* rugosidad baja en el cristal */
        cx.fillStyle = 'rgba(0,0,0,0.85)';
        cx.globalCompositeOperation = 'destination-over';
        cx.globalCompositeOperation = 'source-over';
        if (lit) {
          const warm = 0.6 + vnoise2(i, j * 2, 7) * 0.4;
          const r2 = litCol[0] * warm, g2 = litCol[1] * warm, b2 = litCol[2] * warm;
          ex.fillStyle = `rgb(${r2 | 0},${g2 | 0},${b2 | 0})`;
          ex.fillRect(wx, wy, ww, wh);
          if (vnoise2(i * 9, j * 4, 3) > 0.6) { /* media ventana oscura (persiana) */
            ex.fillStyle = 'rgba(0,0,0,0.75)';
            ex.fillRect(wx, wy, ww, wh * 0.45);
          }
        }
      }
    }
    /* líneas de piso / suciedad */
    cx.globalAlpha = 0.16; cx.fillStyle = '#000';
    for (let j = 0; j <= rows; j++) cx.fillRect(0, j * ch - 1, S, 2);
    cx.globalAlpha = 1;
    return {
      color: { name: o.name || 'facade', src: cc, wrap: 'repeat' },
      emissive: { name: (o.name || 'facade') + '_em', src: ec, wrap: 'repeat' }
    };
  }

  /* ------------------------------------------------------------------ *
   * HORMIGÓN / MUROS / BARRERAS
   * ------------------------------------------------------------------ */
  function concreteTexture(o) {
    o = o || {};
    const S = o.size || 256;
    const base = o.base || [168, 166, 160];
    const stripes = o.stripes || null;   /* [colA, colB, freq] */
    const [c, x] = noiseField(S, S, (u, v, px, py) => {
      const n = fbm2(u * 6, v * 6, 4, o.seed || 3);
      const f = vnoise2(px * 2.3, py * 2.3, 17);
      let r = base[0] * (0.80 + 0.36 * n), g = base[1] * (0.80 + 0.36 * n), b = base[2] * (0.80 + 0.36 * n);
      r += (f - 0.5) * 14; g += (f - 0.5) * 14; b += (f - 0.5) * 13;
      const stain = fbm2(u * 2.2, v * 1.1, 3, 91);
      if (stain > 0.6) { const k = (stain - 0.6) * 1.6; r = lerp(r, r * 0.6, k); g = lerp(g, g * 0.6, k); b = lerp(b, b * 0.62, k); }
      if (stripes) {
        const band = Math.floor(v * (stripes.freq || 6)) % 2;
        const col = band ? stripes.a : stripes.b;
        r = lerp(r, col[0], 0.85); g = lerp(g, col[1], 0.85); b = lerp(b, col[2], 0.85);
      }
      const rough = 0.7 + f * 0.25;
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255), clamp(rough * 255, 0, 255)];
    });
    return { name: o.name || 'concrete', src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * METAL CEPILLADO (coches, guardarraíles)
   * ------------------------------------------------------------------ */
  function metalTexture(o) {
    o = o || {};
    const S = o.size || 256;
    const [c, x] = noiseField(S, S, (u, v, px, py) => {
      const streak = vnoise2(px * 0.35, py * 24, 3);
      const n = vnoise2(px * 3, py * 3, 9);
      const val = 0.86 + streak * 0.16 + (n - 0.5) * 0.08;
      const rough = clamp(0.18 + streak * 0.3 + n * 0.14, 0.05, 0.9);
      return [clamp(255 * val, 0, 255), clamp(255 * val, 0, 255), clamp(255 * val, 0, 255), rough * 255];
    });
    return { name: o.name || 'metal', src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * ARENA / PIEDRA DE CAÑÓN + ROCAS
   * ------------------------------------------------------------------ */
  function rockTexture(o) {
    o = o || {};
    const S = o.size || 256;
    const a = o.colA || [152, 108, 74], b = o.colB || [196, 152, 108];
    const [c, x] = noiseField(S, S, (u, v, px, py) => {
      const strata = Math.sin(v * 14 + fbm2(u * 4, v * 4, 3, 5) * 4.5) * 0.5 + 0.5;
      const n = fbm2(u * 8, v * 8, 4, o.seed || 2);
      const t = clamp(strata * 0.55 + n * 0.6, 0, 1);
      let r = lerp(a[0], b[0], t), g = lerp(a[1], b[1], t), bl = lerp(a[2], b[2], t);
      const crack = Math.abs(fbm2(u * 13, v * 7, 3, 77) - 0.5);
      if (crack < 0.025) { r *= 0.55; g *= 0.55; bl *= 0.56; }
      const f = vnoise2(px * 2.6, py * 2.6, 4);
      r += (f - 0.5) * 16; g += (f - 0.5) * 15; bl += (f - 0.5) * 14;
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(bl, 0, 255), clamp((0.72 + f * 0.25) * 255, 0, 255)];
    });
    return { name: o.name || 'rock', src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * CÉSPED DE CIRCUITO con rayas de siega (para anillo del speedway)
   * ------------------------------------------------------------------ */
  function lawnTexture(o) {
    o = o || {};
    const S = 256;
    const [c, x] = noiseField(S, S, (u, v, px, py) => {
      const band = Math.floor(u * 6) % 2 ? 1.12 : 0.9;
      const n = fbm2(u * 10, v * 10, 3, 3);
      const f = vnoise2(px * 2.2, py * 5.5, 6);
      let r = (58 + n * 34) * band, g = (92 + n * 46) * band, b = (42 + n * 24) * band;
      r += (f - 0.5) * 14; g += (f - 0.5) * 20; b += (f - 0.5) * 10;
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255), 245];
    });
    return { name: 'lawn', src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * VALLA / RED publicitaria con mensajes
   * ------------------------------------------------------------------ */
  function bannerTexture(o) {
    const S = 512, H = 128;
    const [c, x] = canvas(S, H);
    x.fillStyle = o.bg || '#0e1418';
    x.fillRect(0, 0, S, H);
    const words = o.words || ['CAR WARS 3D', 'NITRO', 'TURBO', 'APEX', 'DRIFT', 'PIT 22'];
    const n = o.count || 4;
    for (let i = 0; i < n; i++) {
      const w = words[(i + (o.seed || 0)) % words.length];
      const pal = o.palette || ['#ff5a2b', '#26d0ff', '#ffe14d', '#8dff5a'];
      x.fillStyle = pal[i % pal.length];
      x.globalAlpha = 0.9;
      x.fillRect(i * (S / n) + 8, 14, S / n - 16, H - 28);
      x.globalAlpha = 1;
      x.fillStyle = '#0b0d10';
      x.font = 'bold ' + Math.floor(H * 0.36) + 'px system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(w, i * (S / n) + S / n / 2, H / 2 + 2);
    }
    return { name: 'banner', src: c, wrap: 'repeat' };
  }

  /* ------------------------------------------------------------------ *
   * TRAMAS DE ADVERTENCIA / PINTURAS variadas
   * ------------------------------------------------------------------ */
  function hazardTexture(o) {
    const S = 128;
    const [c, x] = canvas(S, S);
    x.fillStyle = o.a || '#f0c419'; x.fillRect(0, 0, S, S);
    x.fillStyle = o.b || '#15161a';
    for (let i = -2; i < 6; i++) {
      x.save(); x.translate(i * S / 4, 0); x.transform(1, 0, -0.55, 1, 0, 0);
      x.fillRect(0, 0, S / 8, S); x.restore();
    }
    return { name: 'hazard', src: c, wrap: 'repeat' };
  }

  function checkerTexture(o) {
    o = o || {};
    const S = o.size || 128, n = o.cells || 8;
    const a = o.a || [236, 236, 232], b = o.b || [22, 22, 26];
    const [c, x] = canvas(S, S);
    x.fillStyle = 'rgb(' + a.join(',') + ')'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgb(' + b.join(',') + ')';
    const cw = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i + j) % 2) x.fillRect(i * cw, j * cw, cw, cw);
    /* ruido de desgaste */
    const img = x.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const w = vnoise2(i * 0.03, (i >> 2) * 0.017, 5);
      const k = 0.72 + w * 0.5;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
      d[i + 3] = clamp((0.5 + w * 0.5) * 255, 0, 255);
    }
    x.putImageData(img, 0, 0);
    return { name: 'checker', src: c, wrap: 'repeat' };
  }

  G.Tex = { checkerTexture,
    road: o => Tex('road', 512, 512, () => { }, o),
    roadTexture, groundTexture, facadeTextures, concreteTexture,
    metalTexture, rockTexture, lawnTexture, bannerTexture, hazardTexture,
    canvas, noiseField
  };
})(window.CW);
