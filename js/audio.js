/* =====================================================================
   audio.js — motor de sonido 100 % procedural (WebAudio).
   Sin ficheros: motor = osciladores + filtros; rodadas/aire = ruido;
   avisos = tonos. Todo se apaga solo si no hay AudioContext.
   ===================================================================== */
(function (G) {
  'use strict';
  const clamp = G.clamp;

  function makeNoise(ctx, secs) {
    const n = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;         /* ruido rosado aproximado */
      d[i] = last * 3.2;
    }
    return b;
  }

  function Sound(opts) {
    opts = opts || {};
    this.ok = false;
    this.muted = !!opts.muted;
    this.vol = opts.volume == null ? 0.9 : opts.volume;
    this.ctx = null;
    this.voices = [];
    this.pending = [];
    this.bpm = 126; this.beat = 0; this.nextNote = 0;
    this.musicOn = opts.music !== false;
  }
  Sound.prototype.tryStart = function () {
    if (this.ok || this.dead) return this.ok;
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { this.dead = true; return false; }
    try {
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      const master = this.master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.vol;
      const comp = this.comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.16;
      master.connect(comp); comp.connect(ctx.destination);
      /* buses */
      this.busEngine = ctx.createGain(); this.busEngine.gain.value = 0.55; this.busEngine.connect(master);
      this.busFx = ctx.createGain(); this.busFx.gain.value = 0.9; this.busFx.connect(master);
      this.busMusic = ctx.createGain(); this.busMusic.gain.value = 0.0; this.busMusic.connect(master);
      this.noise = makeNoise(ctx, 2);
      /* rodadas (ruido filtrado, compartido) */
      const sk = ctx.createBufferSource(); sk.buffer = this.noise; sk.loop = true;
      const skF = ctx.createBiquadFilter(); skF.type = 'bandpass'; skF.frequency.value = 1250; skF.Q.value = 0.7;
      const skG = ctx.createGain(); skG.gain.value = 0;
      sk.connect(skF); skF.connect(skG); skG.connect(this.busFx); sk.start(0);
      this.skid = { g: skG, f: skF };
      /* aire */
      const ai = ctx.createBufferSource(); ai.buffer = this.noise; ai.loop = true;
      const aiF = ctx.createBiquadFilter(); aiF.type = 'highpass'; aiF.frequency.value = 700;
      const aiG = ctx.createGain(); aiG.gain.value = 0;
      ai.connect(aiF); aiF.connect(aiG); aiG.connect(this.busFx); ai.start(0);
      this.wind = { g: aiG, f: aiF };
      this.ok = true;
      /* reintentar voces creadas antes de arrancar */
      for (const p of this.pending) this.addCar(p);
      this.pending.length = 0;
      return true;
    } catch (e) { this.dead = true; return false; }
  };
  Sound.prototype.resume = function () {
    if (!this.tryStart()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { });
  };
  Sound.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.vol;
  };
  Sound.prototype.addCar = function (o) {
    if (!this.ok) { this.pending.push(o); return null; }
    const ctx = this.ctx;
    const v = { name: o.name || 'car', player: !!o.player };
    v.g = ctx.createGain(); v.g.gain.value = 0;
    v.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 1800; v.lp.Q.value = 0.6;
    v.osc1 = ctx.createOscillator(); v.osc1.type = 'sawtooth';
    v.osc2 = ctx.createOscillator(); v.osc2.type = 'square'; v.osc2.detune.value = 8;
    v.osc3 = ctx.createOscillator(); v.osc3.type = 'triangle';
    v.g1 = ctx.createGain(); v.g1.gain.value = 0.55;
    v.g2 = ctx.createGain(); v.g2.gain.value = 0.30;
    v.g3 = ctx.createGain(); v.g3.gain.value = 0.22;
    v.noise = ctx.createBufferSource(); v.noise.buffer = this.noise; v.noise.loop = true;
    v.nf = ctx.createBiquadFilter(); v.nf.type = 'bandpass'; v.nf.frequency.value = 300; v.nf.Q.value = 0.8;
    v.ng = ctx.createGain(); v.ng.gain.value = 0.14;
    v.osc1.connect(v.g1); v.g1.connect(v.lp);
    v.osc2.connect(v.g2); v.g2.connect(v.lp);
    v.osc3.connect(v.g3); v.g3.connect(v.lp);
    v.noise.connect(v.nf); v.nf.connect(v.ng); v.ng.connect(v.lp);
    v.lp.connect(v.g);
    if (v.pan) { v.g.connect(v.pan); v.pan.connect(this.busEngine); } else v.g.connect(this.busEngine);
    const t = ctx.currentTime;
    v.osc1.start(t); v.osc2.start(t); v.osc3.start(t); v.noise.start(t);
    v.charge = o.charge || 1;      /* nº de cilindros relativo */
    this.voices.push(v);
    return v;
  };
  Sound.prototype.update = function (cars, listener, dt, info) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    /* 1) motor de cada coche: el primero es el del jugador */
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const car = cars[i];
      if (!car) { v.g.gain.value = 0; continue; }
      const dx = car.pos[0] - listener.x, dz = car.pos[2] - listener.z;
      const d = Math.hypot(dx, dz);
      const near = clamp(1 - d / (v.player ? 260 : 95), 0, 1);
      const away = v.player ? 1 : near * near;
      const rpm = car.engineRPM / 60;
      const o1 = clamp(rpm * (1.6 + 0.5 * v.charge), 22, 520);
      const load = Math.abs(car.throttle) * 0.6 + clamp(car.speed / 60, 0, 1) * 0.4 + (car.brake > 0.2 ? 0.15 : 0);
      v.osc1.frequency.setTargetAtTime(o1, t, 0.045);
      v.osc2.frequency.setTargetAtTime(o1 * 0.5, t, 0.045);
      v.osc3.frequency.setTargetAtTime(o1 * 1.006, t, 0.05);
      v.lp.frequency.setTargetAtTime(700 + 3400 * near * (0.35 + load) + (car.boost ? 2600 : 0), t, 0.06);
      v.g.gain.setTargetAtTime((v.player ? 0.30 : 0.20) * (0.28 + load * 0.85) * away, t, 0.07);
      if (v.pan) {
        const rx = (dx * Math.cos(-listener.yaw) - dz * Math.sin(-listener.yaw));
        v.pan.pan.setTargetAtTime(clamp(rx / 26, -1, 1) * (v.player ? 0 : 0.85), t, 0.05);
      }
      if (!v.player) {
        v.nf.frequency.setTargetAtTime(240 + 900 * near, t, 0.1);
      }
    }
    /* 2) rodadas + viento */
    const p = cars[0];
    if (p) {
      const sk = p.drifting ? clamp(Math.abs(p.vr) / 9, 0, 1) * (p.onRoad > 0.5 ? 1 : 0.5) : 0;
      this.skid.g.gain.setTargetAtTime(0.0 + sk * (info.skidVol || 0.5) * (this.volOk === false ? 0 : 1), t, 0.05);
      this.skid.f.frequency.setTargetAtTime(900 + 1500 * clamp(Math.abs(p.vr) / 12, 0, 1), t, 0.08);
      const wnd = clamp(Math.pow(p.speed / 70, 1.7), 0, 1) * (p.onRoad > 0.5 ? 0.42 : 0.7);
      this.wind.g.gain.setTargetAtTime(wnd * 0.30, t, 0.08);
      this.wind.f.frequency.setTargetAtTime(500 + p.speed * 22, t, 0.1);
    }
    if (this.musicOn) this.tickMusic(t);
  };
  Sound.prototype.stopVoices = function () {
    for (const v of this.voices) {
      try { v.osc1.stop(); v.osc2.stop(); v.osc3.stop(); v.noise.stop(); } catch (e) { }
    }
    this.voices.length = 0; this.pending.length = 0;
  };
  /* ---- efectos puntuales ---- */
  Sound.prototype.blip = function (freq, dur, type, gain, slide) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    f.type = 'lowpass'; f.frequency.value = 5200;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((gain == null ? 0.22 : gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f); f.connect(g); g.connect(this.busFx);
    o.start(t); o.stop(t + dur + 0.02);
  };
  Sound.prototype.thud = function (power) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime, p = clamp(power, 0.15, 1);
    /* golpe grave */
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120 + 90 * p, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.26);
    g.gain.setValueAtTime(0.5 * p, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g); g.connect(this.busFx); o.start(t); o.stop(t + 0.36);
    /* chapa */
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + 900 * p; bp.Q.value = 1.1;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.42 * p, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(bp); bp.connect(ng); ng.connect(this.busFx); s.start(t, Math.random()); s.stop(t + 0.24);
  };
  Sound.prototype.skitch = function (v) { if (this.ok) this.skid.g.gain.setTargetAtTime(clamp(v, 0, 1) * 0.5, this.ctx.currentTime, 0.02); };
  Sound.prototype.whoosh = function (p) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = false;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(340, t); f.frequency.exponentialRampToValueAtTime(3400, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.34 * clamp(p || 1, 0, 1), t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    s.connect(f); f.connect(g); g.connect(this.busFx); s.start(t); s.stop(t + 0.6);
  };
  Sound.prototype.chord = function (freqs, dur, gain) {
    if (!this.ok) return;
    freqs.forEach((f, i) => setTimeout(() => this.blip(f, dur || 0.5, 'triangle', gain || 0.16), i * 55));
  };
  /* ---- música: pulso sencillo de 4 tiempos, se silencia sola si no se escucha ---- */
  Sound.prototype.tickMusic = function (t) {
    const ctx = this.ctx;
    const spb = 60 / this.bpm / 2;
    if (!this.musicStart) this.musicStart = t;
    while (this.nextNote < t + 0.25) {
      if (this.nextNote === 0) this.nextNote = t + 0.05;
      const b = this.beat % 16;
      const tn = this.nextNote;
      /* bombo */
      if (b % 4 === 0) this.drum(tn, 0.9, 'kick');
      if (b % 8 === 4) this.drum(tn, 0.5, 'snare');
      if (b % 2 === 1) this.drum(tn, 0.16, 'hat');
      /* bajo */
      const root = [55, 55, 73.4, 65.4][((this.beat / 16) | 0) % 4];
      const pat = [0, 0, 7, 0, 5, 0, 3, 0, 0, 0, 7, 10, 5, 0, 3, 0];
      const n = root * Math.pow(2, pat[b] / 12);
      this.bass(tn, n, spb * 0.92);
      this.nextNote += spb; this.beat++;
    }
  };
  Sound.prototype.drum = function (t, g, kind) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(128, t); o.frequency.exponentialRampToValueAtTime(41, t + 0.13);
      gn.gain.setValueAtTime(0.5 * g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      o.connect(gn); gn.connect(this.busMusic); o.start(t); o.stop(t + 0.2);
    } else {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7200 : 1900;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.26 * g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'hat' ? 0.05 : 0.14));
      s.connect(f); f.connect(gn); gn.connect(this.busMusic); s.start(t, Math.random()); s.stop(t + 0.16);
    }
  };
  Sound.prototype.bass = function (t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), gn = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.3, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp); lp.connect(gn); gn.connect(this.busMusic); o.start(t); o.stop(t + dur + 0.02);
  };
  Sound.prototype.setMusic = function (on, amt) {
    this.musicOn = on;
    if (this.ok) this.busMusic.gain.setTargetAtTime(on ? (amt == null ? 0.16 : amt) : 0, this.ctx.currentTime, 0.4);
  };
  Sound.prototype.setEngineMaster = function (v) { if (this.ok) this.busEngine.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); };

  G.Sound = Sound;
  G.makeSound = function (o) { return new Sound(o); };
})(window.CW);
