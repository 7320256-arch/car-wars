/* =====================================================================
   ui.js — entrada (teclado, ratón, táctil, mando), HUD 2D sobre canvas
   y pantallas de menú. Todo DOM/CSS inline-friendly, sin dependencias.
   ===================================================================== */
(function (G) {
  'use strict';
  const clamp = G.clamp, lerp = G.lerp;

  /* ================================================================== *
   *  INPUT
   * ================================================================== */
  const KEYS = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'hand', ShiftLeft: 'hand', ShiftRight: 'hand', KeyE: 'boost',
    ControlLeft: 'boost', ControlRight: 'boost',
    KeyC: 'cam', KeyR: 'reset', KeyH: 'horn', KeyM: 'mute', KeyP: 'pause', Escape: 'pause',
    Tab: 'map', KeyL: 'lights', KeyV: 'look'
  };
  function Input(o) {
    o = o || {};
    this.k = {};
    this.pressed = {};
    this.stick = { steer: 0, thr: 0, brake: 0 };
    this.touch = { steer: 0, thr: 0, brake: 0, hand: false, boost: false, active: false };
    this.pad = -1;
    this.padSeen = false;
    this.mode = o.mode || 'keys';
    this.enabled = true;
    this.touches = new Map();
    if (typeof document !== 'undefined') this.bindDOM(o.root || document.body);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; this.padSeen = true; });
      window.addEventListener('gamepaddisconnected', () => { this.pad = -1; });
    }
  }
  Input.prototype.bindDOM = function (root) {
    const kd = (e) => {
      const a = KEYS[e.code];
      if (a) {
        if (!this.k[a]) this.pressed[a] = true;
        this.k[a] = 1;
        if (e.code === 'Tab' || e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      }
      if (this.onKey) this.onKey(e);
    };
    const ku = (e) => { const a = KEYS[e.code]; if (a) this.k[a] = 0; };
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.k = {}; });
    this._kd = kd; this._ku = ku;
  };
  Input.prototype.pollPad = function () {
    const s = { steer: 0, thr: 0, brake: 0, hand: false, boost: false, cam: false, ok: false };
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return s;
    let gp = null;
    const pads = navigator.getGamepads();
    if (this.pad >= 0 && pads[this.pad]) gp = pads[this.pad];
    else for (const p of pads) if (p) { gp = p; this.pad = p.index; break; }
    if (!gp) return s;
    s.ok = true;
    const ax = gp.axes && gp.axes.length ? gp.axes : [0, 0];
    let steer = (ax[0] || 0);
    if (Math.abs(steer) < 0.16) steer = 0;
    s.steer = clamp(steer, -1, 1);
    const tr = gp.buttons[7] ? gp.buttons[7].value : 0;
    const br = gp.buttons[6] ? gp.buttons[6].value : 0;
    s.thr = tr > 0.06 ? tr : 0;
    s.brake = br > 0.06 ? br : 0;
    if (s.thr === 0 && gp.buttons[3] && gp.buttons[3].pressed) s.thr = 1;   /* Y = gas alternative */
    if (s.brake === 0 && gp.buttons[2] && gp.buttons[2].pressed) s.brake = 1;
    s.hand = !!(gp.buttons[0] && gp.buttons[0].pressed) || !!(gp.buttons[1] && gp.buttons[1].pressed) ||
      !!(gp.buttons[5] && gp.buttons[5].pressed) || !!(gp.buttons[4] && gp.buttons[4].pressed);
    s.boost = !!(gp.buttons[2] && gp.buttons[2].pressed) || !!(gp.buttons[7] && gp.buttons[7].pressed && gp.buttons[6].value > 0.9) || !!(gp.buttons[10] && gp.buttons[10].pressed);
    s.cam = !!(gp.buttons[9] && gp.buttons[9].pressed);
    s.start = !!(gp.buttons[9] && gp.buttons[9].pressed);
    s.back = !!(gp.buttons[8] && gp.buttons[8].pressed);
    return s;
  };
  /* estado combinado -> accionables del coche */
  Input.prototype.state = function () {
    const k = this.k;
    let steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let thr = k.throttle ? 1 : 0, brk = k.brake ? 1 : 0;
    let hand = k.hand ? 1 : 0, boost = k.boost ? 1 : 0;
    if (this.touch.active) {
      steer = this.touch.steer || steer;
      thr = Math.max(thr, this.touch.thr);
      brk = Math.max(brk, this.touch.brake);
      hand = Math.max(hand, this.touch.hand ? 1 : 0);
      boost = Math.max(boost, this.touch.boost ? 1 : 0);
    }
    const p = this.pollPad();
    if (p.ok) {
      if (Math.abs(p.steer) > Math.abs(steer)) steer = p.steer;
      thr = Math.max(thr, p.thr); brk = Math.max(brk, p.brake);
      hand = Math.max(hand, p.hand ? 1 : 0);
      boost = Math.max(boost, p.boost ? 1 : 0);
      if (p.cam) this.pressed.cam = true;
      if (p.start) this.pressed.pause = true;
    }
    if (k.throttle && k.brake) brk = 0;
    return {
      steer: clamp(steer, -1, 1), throttle: thr, brake: brk, hand, boost,
      drift: hand,                /* el canal de derrape (SHIFT o ESPACIO) */
      pressed: this.pressed,
      clear: () => { this.pressed = {}; }
    };
  };

  /* ---------------- controles táctiles ---------------- */
  function TouchControls(root, input) {
    this.root = root; this.input = input;
    this.el = document.createElement('div');
    this.el.className = 'tc';
    this.el.innerHTML =
      '<div class="tc-side tc-left"><div class="tc-pad" data-a="left"><span>◀</span></div>' +
      '<div class="tc-pad" data-a="right"><span>▶</span></div></div>' +
      '<div class="tc-side tc-right"><div class="tc-pad big" data-a="gas"><span>GAS</span></div>' +
      '<div class="tc-row"><div class="tc-pad" data-a="freno"><span>FRENO</span></div>' +
      '<div class="tc-pad" data-a="derrape"><span>DERRAPE</span></div>' +
      '<div class="tc-pad" data-a="nitro"><span>NITRO</span></div></div></div>';
    root.appendChild(this.el);
    const self = this;
    const st = input.touch;
    function bind(el, act) {
      const on = (e) => {
        e.preventDefault();
        st.active = true;
        if (act === 'left') st.steer = -1; else if (act === 'right') st.steer = 1;
        else if (act === 'gas') st.thr = 1; else if (act === 'freno') st.brake = 1;
        else if (act === 'derrape') st.hand = true; else if (act === 'nitro') { st.boost = true; input.pressed.boostHold = true; }
        el.classList.add('on');
      };
      const off = (e) => {
        if (e) e.preventDefault();
        if (act === 'left' || act === 'right') st.steer = 0;
        else if (act === 'gas') st.thr = 0; else if (act === 'freno') st.brake = 0;
        else if (act === 'derrape') st.hand = false; else if (act === 'nitro') st.boost = false;
        el.classList.remove('on');
      };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      window.addEventListener('mouseup', off);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
    Array.prototype.forEach.call(this.el.querySelectorAll('[data-a]'), el => bind(el, el.getAttribute('data-a')));
    this.el.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  }
  TouchControls.prototype.setVisible = function (v) { this.el.style.display = v ? '' : 'none'; };

  /* ================================================================== *
   *  HUD: velocímetro, minimapa, tiempos, barra de derrape
   * ================================================================== */
  function HUD(o) {
    this.c = o.canvas;
    this.ctx = this.c.getContext('2d');
    this.mini = o.minimap;                 /* canvas aparte */
    this.mc = this.mini ? this.mini.getContext('2d') : null;
    this.dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));
    this.shake = 0; this.flash = 0; this.msg = ''; this.msgT = 0;
    this.gauge = 0;
    this.records = {};
    this.ripples = [];
  }
  HUD.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    this.c.width = Math.round(w * this.dpr); this.c.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.mini) {
      const s = 168;
      this.mini.width = Math.round(s * this.dpr); this.mini.height = Math.round(s * this.dpr);
      this.mc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ms = s;
    }
  };
  HUD.prototype.toast = function (txt, t) { this.msg = txt; this.msgT = t || 2.0; };
  HUD.prototype.hit = function (p) { this.shake = Math.min(1.4, this.shake + p); this.flash = Math.min(1, this.flash + p * 0.6); };

  HUD.prototype.update = function (game, dt) {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.msgT > 0) this.msgT -= dt;
    const p = game.player;
    this.gauge = lerp(this.gauge, clamp(p.speed / 78, 0, 1), 1 - Math.exp(-8 * dt));
  };

  HUD.prototype.draw = function (game) {
    const x = this.ctx, w = this.w, h = this.h, p = game.player;
    x.clearRect(0, 0, w, h);
    if (this.flash > 0.01) {
      x.fillStyle = 'rgba(255,90,50,' + (this.flash * 0.22).toFixed(3) + ')';
      x.fillRect(0, 0, w, h);
    }
    /* ---- velocímetro ---- */
    const R = Math.min(96, w * 0.15), cx = w - R - 22, cy = h - R - 20;
    x.save();
    x.translate(cx, cy);
    x.fillStyle = 'rgba(8,10,16,0.55)';
    x.beginPath(); x.arc(0, 0, R + 8, 0, 6.2832); x.fill();
    x.lineWidth = 2; x.strokeStyle = 'rgba(150,190,255,0.25)'; x.stroke();
    const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;
    const kmh = p.speed * 3.6;
    const frac = clamp(kmh / (p.stats.top * 1.05), 0, 1);
    /* marcas */
    for (let i = 0; i <= 10; i++) {
      const a = lerp(a0, a1, i / 10);
      const r0 = R - (i % 2 ? 7 : 12), r1 = R - 1;
      x.beginPath();
      x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      x.strokeStyle = i > 7 ? 'rgba(255,120,90,0.85)' : 'rgba(210,230,255,0.55)';
      x.lineWidth = i % 2 ? 1.4 : 2.6; x.stroke();
    }
    /* arco de velocidad */
    x.beginPath(); x.arc(0, 0, R - 18, a0, lerp(a0, a1, frac));
    x.strokeStyle = p.drifting ? '#ffcc44' : (game.boostFx > 0.2 ? '#57d8ff' : '#7fd6ff');
    x.lineWidth = 5; x.lineCap = 'round'; x.stroke();
    /* aguja */
    const aa = lerp(a0, a1, frac);
    x.beginPath(); x.moveTo(Math.cos(aa + Math.PI) * 9, Math.sin(aa + Math.PI) * 9);
    x.lineTo(Math.cos(aa) * (R - 22), Math.sin(aa) * (R - 22));
    x.strokeStyle = '#fff'; x.lineWidth = 2.2; x.stroke();
    /* cifras */
    x.textAlign = 'center';
    x.fillStyle = '#eaf2ff'; x.font = '600 ' + Math.round(R * 0.44) + 'px ui-monospace,Menlo,Consolas,monospace';
    x.fillText(Math.round(kmh), 0, R * 0.34);
    x.fillStyle = 'rgba(190,210,240,0.7)'; x.font = '600 11px system-ui,sans-serif';
    x.fillText('KM/H', 0, R * 0.52);
    x.fillStyle = 'rgba(190,210,240,0.85)'; x.font = '700 13px ui-monospace,monospace';
    x.fillText('M' + (p.gearN || 1) + '/' + (p.stats.gears || 5), 0, -R * 0.42);
    /* arco de vueltas con el corte de encendido de cada motor (no el mismo
       para todos: 5 000 rpm el 4x4, 11 000 el prototipo) */
    {
      const rl = p.stats.redline || 7000, ur = clamp((p.engineRPM || 800) / rl, 0, 1.05);
      x.beginPath(); x.arc(0, 0, R + 15, a0, lerp(a0, a1, clamp(ur, 0, 1)));
      x.strokeStyle = ur > 0.985 ? '#ff5a4a' : (ur > 0.86 ? '#ffb14a' : '#8fd0ff');
      x.lineWidth = 3.6; x.stroke();
      x.fillStyle = 'rgba(190,210,240,0.55)'; x.font = '600 10px ui-monospace,monospace';
      x.fillText(Math.round(p.engineRPM || 800) + ' rpm', 0, -R * 0.22);
      /* cuando patina (salida, derrape) se ve: el coche no es sólo una barra */
      if ((p.wheelspin || 0) > 0.12) {
        x.fillStyle = 'rgba(255,150,70,' + (0.35 + 0.5 * p.wheelspin).toFixed(2) + ')';
        x.font = '800 10px ui-monospace,monospace';
        x.fillText('PATINA', 0, R * 0.72);
      }
    }
    /* nitro */
    const bf = p.boostFuel / 100;
    x.beginPath(); x.arc(0, 0, R + 3, a1 - 0.1, lerp(a1, a1 - 0.62, 1 - bf) , true);
    x.strokeStyle = '#57d8ff'; x.lineWidth = 3.4; x.stroke();
    x.restore();

    /* ---- minimapa ---- */
    if (this.mc && game.showMap !== false) this.drawMinimap(game);

    /* ---- panel izquierda: vuelta / posición / tiempo ---- */
    const hudLines = game.hudLines ? game.hudLines() : [];
    x.save();
    x.font = '700 13px system-ui,sans-serif';
    /* empieza por debajo de la tira de contexto del DOM (arriba al centro): así
       la esquina superior izquierda la controla sólo este panel y nada se pisa */
    let yy = 72;
    for (const l of hudLines) {
      const big = l.big;
      x.textAlign = 'left';
      x.fillStyle = 'rgba(6,8,14,0.42)';
      const tw = x.measureText(l.v).width + (big ? 30 : 22);
      roundRect(x, 14, yy - 13, tw, big ? 30 : 24, 6); x.fill();
      x.fillStyle = 'rgba(170,195,235,0.8)';
      x.fillText(l.k, 22, yy + 3);
      x.fillStyle = l.col || '#f2f7ff';
      x.font = (big ? '700 19px' : '700 15px') + ' ui-monospace,Menlo,Consolas,monospace';
      x.fillText(l.v, 22 + x.measureText(l.k).width * (big ? 1.16 : 1) + 8, yy + (big ? 5 : 3));
      x.font = '700 13px system-ui,sans-serif';
      yy += big ? 36 : 30;
    }
    /* para qué sirve este modo, siempre visible (no sólo en el menú) */
    const md = game.modeDef;
    if (md && md.win) {
      const maxW = Math.min(246, w * 0.28);
      x.font = '600 11.5px system-ui,sans-serif';
      const words = ('objetivo: ' + md.win).split(' ');
      let l1 = '', l2 = '';
      for (let k = 0; k < words.length; k++) {
        const word = words[k];
        if (!l2 && x.measureText((l1 ? l1 + ' ' : '') + word).width <= maxW) l1 = (l1 ? l1 + ' ' : '') + word;
        else l2 = l2 ? l2 + ' ' + word : word;
      }
      x.fillStyle = 'rgba(6,8,14,0.40)';
      roundRect(x, 14, yy - 10, maxW + 16, l2 ? 36 : 21, 6); x.fill();
      x.fillStyle = 'rgba(178,204,240,0.74)';
      x.fillText(l1, 22, yy + 4);
      if (l2) x.fillText(l2, 22, yy + 18);
    }
    x.restore();

    /* ---- barra de derrape / puntos ---- */
    if (game.driftHud && game.driftHud.cur > 0) {
      const d = game.driftHud;
      x.save();
      x.textAlign = 'center';
      const bw = Math.min(420, w * 0.5);
      x.fillStyle = 'rgba(6,8,14,0.5)';
      roundRect(x, w / 2 - bw / 2, h - 92, bw, 46, 10); x.fill();
      x.fillStyle = '#ffd453'; x.font = '700 26px ui-monospace,monospace';
      x.fillText('+' + Math.round(d.cur), w / 2, h - 60);
      if (d.chain > 1) { x.fillStyle = '#ff8b3d'; x.font = '700 15px ui-monospace,monospace'; x.fillText('x' + d.chain.toFixed(1), w / 2 + bw * 0.32, h - 62); }
      const gw = bw - 24;
      x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(w / 2 - gw / 2, h - 54, gw, 6);
      x.fillStyle = d.tube >= 1 ? '#ff6a3d' : '#ffd453';
      x.fillRect(w / 2 - gw / 2, h - 54, gw * clamp(d.tube, 0, 1), 6);
      x.restore();
    }
    /* ---- mensajes ---- */
    if (this.msgT > 0 && this.msg) {
      x.save();
      x.textAlign = 'center';
      const al = clamp(this.msgT * 2.2, 0, 1);
      x.globalAlpha = al;
      x.fillStyle = 'rgba(6,8,14,0.62)';
      x.font = '800 22px system-ui,sans-serif';
      const tw = x.measureText(this.msg).width;
      roundRect(x, w / 2 - tw / 2 - 20, h * 0.24 - 26, tw + 40, 46, 10); x.fill();
      x.fillStyle = '#eaf3ff';
      x.fillText(this.msg, w / 2, h * 0.24 + 6);
      x.restore();
    }
    /* avisos de modo */
    if (game.warnText) {
      x.save(); x.textAlign = 'center'; x.fillStyle = '#ff6b6b';
      x.font = '800 16px system-ui,sans-serif';
      x.fillText(game.warnText, w / 2, h - 24);
      x.restore();
    }
  };

  HUD.prototype.drawMinimap = function (game) {
    const x = this.mc, S = this.ms || 168;
    const W = game.world, mm = W.minimap, tr = W.track;
    x.clearRect(0, 0, S, S);
    const pad = 10, sc = (S - pad * 2) / (mm.world * 2);
    const px = (wx) => S / 2 + wx * sc, pz = (wz) => S / 2 + wz * sc;
    x.save();
    x.fillStyle = 'rgba(6,10,18,0.45)';
    roundRect(x, 0, 0, S, S, 12); x.fill();
    /* pista */
    x.beginPath();
    for (let i = 0; i <= tr.n; i++) {
      const j = i % tr.n;
      const X = px(mm.xs[j]), Z = pz(mm.zs[j]);
      if (i === 0) x.moveTo(X, Z); else x.lineTo(X, Z);
    }
    x.strokeStyle = 'rgba(226,238,255,0.55)'; x.lineWidth = Math.max(3, W.spec.w * sc * 1.4); x.lineJoin = 'round'; x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.16)'; x.lineWidth = Math.max(6, W.spec.w * sc * 2.2); x.stroke();
    /* meta */
    const g0 = tr.centers[0];
    x.fillStyle = '#eafff0';
    x.fillRect(px(g0[0]) - 3, pz(g0[1]) - 3, 6, 6);
    /* checkpoints pendientes */
    if (game.nextCk) {
      const c = game.nextCk;
      x.beginPath(); x.arc(px(c.x), pz(c.z), 4.5, 0, 6.283);
      x.fillStyle = 'rgba(120,230,255,0.9)'; x.fill();
    }
    /* coches */
    for (const car of game.cars) {
      const isP = car.isPlayer;
      x.beginPath(); x.arc(px(car.pos[0]), pz(car.pos[2]), isP ? 4.2 : 3.2, 0, 6.283);
      x.fillStyle = isP ? '#fff' : (car.isCop ? '#4ea0ff' : car.color);
      x.fill();
      if (isP) { x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.2; x.stroke(); }
    }
    x.restore();
  };
  function roundRect(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
    x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
    x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
    x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b);
    x.closePath();
  }

  /* ================================================================== *
   *  MENÚS / pantallas
   * ================================================================== */
  function Screens(root, cb) {
    this.root = root; this.cb = cb;
    root.innerHTML =
      '<div class="scr scr-menu" data-s="menu">' +
      '  <div class="brand"><span class="b1">CAR</span><span class="b2">WARS</span><i class="tag">3D · sin conexión</i></div>' +
      '  <div class="cols">' +
      '    <div class="col"><h3>Circuito</h3><div class="cards maps"></div></div>' +
      '    <div class="col"><h3>Modo</h3><div class="cards modes"></div></div>' +
      '    <div class="col"><h3>Coche</h3><div class="cards cars"></div><div class="stats"></div></div>' +
      '  </div>' +
      '  <div class="row opts">' +
      '    <label class="chk"><input type="checkbox" data-o="shadows" checked><span>Sombras</span></label>' +
      '    <label class="chk"><input type="checkbox" data-o="particles" checked><span>Humo y chispas</span></label>' +
      '    <label class="chk"><input type="checkbox" data-o="sound" checked><span>Sonido</span></label>' +
      '    <label class="chk"><input type="checkbox" data-o="music" checked><span>Música de fondo</span></label>' +
      '    <label class="sel"><span>Calidad</span><select data-o="quality"><option value="low">baja</option><option value="med" selected>media</option><option value="high">alta</option></select></label>' +
      '    <label class="sel"><span>Vueltas</span><select data-o="laps"><option>2</option><option selected>3</option><option>5</option><option>8</option></select></label>' +
      '    <label class="sel"><span>Derrape</span><select data-o="drift"><option value="manual" selected>manual (SHIFT)</option><option value="auto">automático</option></select></label>' +
      '    <label class="sel"><span>IA</span><select data-o="diff"><option value="0.86">fácil</option><option value="1" selected>normal</option><option value="1.08">difícil</option></select></label>' +
      '  </div>' +
      '  <div class="row foot"><button class="btn primary" data-a="start">SALIR A PISTA</button>' +
      '  <span class="hint">teclado WASD/flechas · SHIFT o Espacio = derrape · E nitro · C cámara · R reponer · P pausa</span></div>' +
      '</div>' +
      '<div class="scr scr-pause" data-s="pause" hidden><div class="panel">' +
      '  <h2>Pausa</h2><div class="pinfo"></div>' +
      '  <button class="btn primary" data-a="resume">Continuar</button>' +
      '  <button class="btn" data-a="cam">Cambiar cámara</button>' +
      '  <button class="btn" data-a="restart">Reiniciar</button>' +
      '  <button class="btn ghost" data-a="menu">Menú principal</button>' +
      '</div></div>' +
      '<div class="scr scr-result" data-s="result" hidden><div class="panel wide">' +
      '  <h2 class="rt">Resultado</h2><div class="rtable"></div>' +
      '  <div class="rbtns"><button class="btn primary" data-a="again">Otra vez</button>' +
      '  <button class="btn" data-a="menu">Menú</button></div>' +
      '</div></div>';
    this.el = {};
    for (const s of root.querySelectorAll('.scr')) this.el[s.getAttribute('data-s')] = s;
    root.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-a]') : null;
      if (b && this.cb[b.getAttribute('data-a')]) this.cb[b.getAttribute('data-a')](b);
      const inp = e.target.closest ? e.target.closest('.cards .card') : null;
      if (inp) this.select(inp);
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-o]')) this.opts()[e.target.getAttribute('data-o')] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    });
  }
  Screens.prototype.select = function (card) {
    const grp = card.parentElement;
    Array.prototype.forEach.call(grp.children, c => c.classList.remove('sel'));
    card.classList.add('sel');
    this.sync();
    if (this.cb.pick) this.cb.pick();
  };
  Screens.prototype.opts = function () {
    const o = {};
    this.root.querySelectorAll('[data-o]').forEach(e => { o[e.getAttribute('data-o')] = e.type === 'checkbox' ? e.checked : e.value; });
    return o;
  };
  Screens.prototype.fill = function (maps, modes, cars, rec) {
    const mk = (list, cls, key, html) => {
      const box = this.root.querySelector('.' + cls);
      box.innerHTML = list.map((m, i) => '<div class="card' + (i === 0 ? ' sel' : '') + '" data-k="' + m.id + '">' + html(m, i) + '</div>').join('');
    };
    mk(maps, 'maps', 'map', m => '<b>' + m.name + '</b><small>' + m.blurb + '</small><em class="mw">' + m.time + '</em>');
    mk(modes, 'modes', 'mode', m => '<b>' + m.name + '</b><small>' + m.blurb + '</small>' +
      (m.info ? '<span class="fine">' + m.info + '</span>' : '') +
      (m.win ? '<span class="win">→ ' + m.win + '</span>' : ''));
    mk(cars, 'cars', 'car', c => '<b>' + c.name + '</b><small>' + c.blurb + '</small>');
    this.maps = maps; this.modes = modes; this.cars = cars;
    this.showStats(cars[0]);
    this.root.querySelectorAll('.maps .card').forEach((el, i) => {
      const m = maps[i], box = el.querySelector('.mw');
      if (!box) return;
      const lapR = rec['lap:' + m.id + ':race'], raceR = rec['race:' + m.id], driftR = rec['drift:' + m.id];
      const parts = [];
      if (lapR && lapR.ms) parts.push('v ' + G.fmtMs(lapR.ms));
      if (raceR && raceR.ms) parts.push('carr ' + G.fmtMs(raceR.ms));
      if (driftR && driftR.p) parts.push(driftR.p + ' pts');
      box.textContent = parts.length ? parts.join(' · ') : (m.time || '');
    });
  };
  Screens.prototype.showStats = function (c) {
    const s = this.root.querySelector('.stats');
    const st = c.stats;
    const bar = (k, v, txt) => '<div class="st"><span>' + k + '</span><i><b style="width:' +
      Math.round(clamp(v, 0, 1) * 100) + '%"></b></i>' + (txt ? '<u>' + txt + '</u>' : '') + '</div>';
    const ch = {
      coupe: 'neutro y predecible: es el listón con el que se comparan los demás',
      muscle: 'V8 de par: te arranca de las manos en recta y patina en 1ª; suelto de culo al entrar y frena tarde',
      hatch: 'delantera nerviosa en curva lenta, subvirador en rápida y sin aire por encima de 200',
      suv: '4x4 alto y blando: sale como un tiro en tierra, baila en asfalto y no frena',
      proto: '7 marchas a 11 000 rpm con carga aerodinámica: letal y frágil, castiga cualquier toque'
    }[c.id] || 'un poco de todo y perfecto en nada';
    const drive = { rwd: 'trasera', fwd: 'delantera', awd: '4x4' }[st.drive] || '—';
    const ride = clamp(st.ride || 1, 0, 1.3);
    s.innerHTML =
      '<div class="shead">' + c.name +
      '<em>' + st.mass + ' kg · tracción ' + drive + ' · ' + (st.gears || 5) +
      ' marchas · corte ' + (Math.round((st.redline || 7000) / 100) / 10) + ' krpm · ' +
      (st.cyl || 6) + ' cilindros</em></div>' +
      bar('empuje', (st.power * (st.torqueK || 1)) / 1.6, 'par ' + Math.round((st.torqueK || 1) * 100) + '%') +
      bar('puntería', st.top / 300, st.top + ' km/h') +
      bar('agarre', st.grip / 1.2, Math.round(st.grip * 100) + '%') +
      bar('frenada', st.brake / 1.15, Math.round(st.brake * 100) + '%') +
      bar('agilidad', (st.agility || 1) / 1.3, (st.agility || 1) < 0.9 ? 'perezoso' : ((st.agility || 1) > 1.1 ? 'cuchillo' : 'normal')) +
      bar('equilibrio', 0.5 + (st.balance || 0) * 0.5, (st.balance || 0) > 0.2 ? 'se suelta detrás' : ((st.balance || 0) < -0.1 ? 'se abre delante' : 'neutro')) +
      bar('tierra', (st.offRoad || 0.75) / 1.05, (st.offRoad || 0.75) > 0.9 ? 'agarra en barro' : 'patina en barro') +
      bar('confort', 1.25 - ride, ride > 1 ? 'blanda, se menea' : (ride < 0.5 ? 'dura, sin mullido' : 'deportiva')) +
      bar('derrape', (st.drift || 1) / 1.4, 'facilidad para cruzarse') +
      bar('chapa', 1.4 - (st.fragility || 1), (st.fragility || 1) > 1.2 ? 'se daña de más' : 'aguanta el golpe') +
      '<div class="sfoot">' + ch + '</div>';
  };
  Screens.prototype.sync = function () {
    const get = cls => { const c = this.root.querySelector('.' + cls + ' .card.sel'); return c ? c.getAttribute('data-k') : null; };
    this.choice = { map: get('maps'), mode: get('modes'), car: get('cars'), opts: this.opts() };
    const car = this.cars.find(c => c.id === this.choice.car) || this.cars[0];
    this.showStats(car);
    return this.choice;
  };
  Screens.prototype.show = function (name) {
    for (const k in this.el) this.el[k].hidden = (k !== name);
    this.root.classList.toggle('hasScreen', !!name);
  };
  Screens.prototype.result = function (title, rows) {
    const box = this.root.querySelector('.rtable');
    this.el.result.querySelector('.rt').textContent = title;
    box.innerHTML = rows.map(r =>
      '<div class="rrow' + (r.hi ? ' hi' : '') + (r.head ? ' head' : '') + '">' +
      r.cells.map((c, i) => '<span class="c' + i + '">' + c + '</span>').join('') + '</div>').join('');
  };
  Screens.prototype.pauseInfo = function (html) {
    const p = this.el.pause.querySelector('.pinfo'); if (p) p.innerHTML = html;
  };

  G.Input = Input;
  G.TouchControls = TouchControls;
  G.HUD = HUD;
  G.Screens = Screens;
  G.roundRect2 = roundRect;
})(window.CW);
