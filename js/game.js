/* =====================================================================
   game.js — bucle principal, modos de juego, cámara, luces, récords y
   arranque (bootstrap) con la interfaz.  Sin módulos ni red.
   ===================================================================== */
(function (G) {
  'use strict';
  const M = G.M, clamp = G.clamp, lerp = G.lerp, MAXL = G.MAX_LIGHTS || 16;

  /* ------------------------------------------------------------------ *
   *  Modos
   * ------------------------------------------------------------------ */
  const MODES = {
    free: {
      id: 'free', name: 'V libre', blurb: 'Sin cronómetro: rodadura libre con tráfico IA',
      info: 'sin cronómetro · 4 coches de tráfico · fuera de pista permitido',
      win: 'sin metas: rodar, aprender los pianos o probar el coche',
      laps: 0, rivals: 4, aiSpeed: 0.78, strictWalls: false, live: false,
      hud(g) {
        return [
          { k: 'MODO', v: 'V LIBRE', big: false },
          { k: 'VUELTA', v: (g.player.lap + 1) + '', big: false },
          { k: 'LONGITUD', v: (g.world.track.total | 0) + ' m', big: false },
          { k: 'MEJOR', v: g.player.bestLap ? G.fmtTime(g.player.bestLap) : '—', big: false }
        ];
      },
      lapDone(g, car) { if (car.isPlayer && car.lastLap) g.notify('vuelta ' + G.fmtTime(car.lastLap)); }
    },
    race: {
      id: 'race', name: 'Carrera', blurb: 'Vueltas contra 5 rivales de IA, posición en vivo',
      info: '3 vueltas (2-8 en el menú) · 5 rivales · cuenta atrás de 3 s',
      win: 'cruzar 1º; el puesto se calcula con el progreso de vuelta',
      laps: 3, rivals: 5, aiSpeed: 1.0, strictWalls: true, live: true,
      setup(g) { g.state.countdown = 3.4; g.state.go = false; },
      update(g, dt) {
        const st = g.state;
        if (st.countdown > 0) {
          st.countdown -= dt;
          for (const c of g.cars) { c.throttle = 0; c.brake = 1; c.steer = 0; }
          if (st.countdown <= 0) { st.go = true; g.hud.toast('¡ADELANTE!', 1.1); g.sound.ok && g.sound.whoosh(1); }
          else {
            const s = Math.ceil(st.countdown);
            if (s !== st.lastCount) { st.lastCount = s; g.hud.toast(s + '', 0.7); g.sound.ok && g.sound.blip(520 - s * 60, 0.16, 'square', 0.2); }
          }
          return false;           /* no se simula la clasificación */
        }
        return true;
      },
      hud(g) {
        return [
          { k: 'VUELTA', v: (Math.min(g.player.lap + 1, g.laps)) + '/' + g.laps, big: true },
          { k: 'PUESTO', v: (g.player.place || 1) + 'º/' + g.cars.length, big: false, col: g.player.place === 1 ? '#8effc1' : '#f2f7ff' },
          { k: 'TIEMPO', v: G.fmtTime(g.state.clock), big: false },
          { k: 'MEJOR V.', v: g.player.bestLap ? G.fmtTime(g.player.bestLap) : '—', big: false }
        ];
      }
    },
    drift: {
      id: 'drift', name: 'Drift Attack', blurb: '90 segundos sumando ángulo y velocidad',
      info: '90 s · 0 rivales · cadena si no tocas nada',
      win: 'ángulo × velocidad encadenado: suelta el derrape antes de que baje a 0',
      laps: 0, rivals: 0, aiSpeed: 0, strictWalls: true, live: true, timed: 90,
      setup(g) { g.driftHud = { cur: 0, total: 0, chain: 1, tube: 0, cool: 0 }; },
      update(g, dt) {
        const d = g.driftHud, p = g.player;
        const ang = p.slipAngle || Math.abs(Math.atan2(p.vr, Math.max(2.5, Math.abs(p.vf))));
        if (p.drifting && ang > 0.30 && p.speed > 9 && p.onRoad > 0.35) {
          d.cool = 0;
          const q = ang * 1.9 * (0.5 + clamp(p.speed / 34, 0, 1.4));
          d.cur += q * dt * 60 * d.chain;
          d.tube = clamp(d.tube + dt * (ang > 0.5 ? 0.75 : 0.34), 0, 1.35);
          d.chain = clamp(1 + d.tube * 2.2 + ang, 1, 9.9);
          g.state.score = d.total + d.cur;
        } else {
          d.cool += dt;
          d.chain = Math.max(1, d.chain - dt * 2.6);
          d.tube = Math.max(0, d.tube - dt * 0.75);
          if (d.cool > 1.15 && d.cur > 0) { d.total += d.cur; d.cur = 0; }
        }
        if (g.state.clock > g.state.timeLimit) {
          const key = 'drift:' + g.spec.id, rec = g.records[key];
          const sc = Math.round(d.total);
          if (!rec || sc > rec.p) { g.records[key] = { p: sc, car: g.player.def.id }; G.store.set('cw_records', g.records); }
          g.finish('Tiempo agotado — ' + sc + ' puntos');
        }
        return true;
      },
      hud(g) {
        const d = g.driftHud;
        return [
          { k: 'TIEMPO', v: Math.max(0, g.state.timeLimit - g.state.clock).toFixed(1), big: true },
          { k: 'PUNTOS', v: Math.round(d.total + d.cur) + '', big: false, col: '#ffd453' },
          { k: 'CADENA', v: 'x' + d.chain.toFixed(1), big: false }
        ];
      }
    },
    attack: {
      id: 'attack', name: 'Crono CPA', blurb: 'cada checkpoint suma tiempo; no te pares',
      info: 'reloj 32 s · +12 s por checkpoint · 0 rivales · muros duros',
      win: 'sumar checkpoints sin parar; con el reloj a 0 se acabó',
      laps: 0, rivals: 0, aiSpeed: 0, strictWalls: true, live: true, startClock: 32, perCk: 12,
      setup(g) { g.state.clock = g.state.timeLeft = 32; g.state.ckHit = 0; },
      update(g, dt) {
        g.state.timeLeft -= dt;
        if (g.state.timeLeft <= 5.5 && Math.floor(g.state.timeLeft * 2) % 2 === 0 && Math.floor(g.state.timeLeft * 2) !== g.state.lastBeep) {
          g.state.lastBeep = Math.floor(g.state.timeLeft * 2);
          g.sound.ok && g.sound.blip(880, 0.07, 'square', 0.16);
        }
        if (g.state.timeLeft <= 0) { g.finish('Sin tiempo — ' + g.state.ckHit + ' checkpoints · ' + (g.player.totalProgress * g.world.track.total | 0) + ' m'); return false; }
        return true;
      },
      checkpoint(g, car) {
        if (!car.isPlayer) return;
        g.state.timeLeft += g.modeDef.perCk;
        g.state.ckHit = (g.state.ckHit || 0) + 1;
        g.hud.toast('+' + g.modeDef.perCk + ' s', 0.9);
        g.sound.ok && g.sound.chord([660, 880, 1320], 0.24, 0.14);
      },
      hud(g) {
        return [
          { k: 'TIEMPO', v: Math.max(0, g.state.timeLeft).toFixed(1), big: true, col: g.state.timeLeft < 6 ? '#ff7a6b' : '#f2f7ff' },
          { k: 'CHECKPOINTS', v: (g.state.ckHit || 0) + '', big: false },
          { k: 'DISTANCIA', v: ((g.player.totalProgress * g.world.track.total) | 0) + ' m', big: false }
        ];
      }
    },
    chase: {
      id: 'chase', name: 'Persecución', blurb: 'Eres la patrulla: intercepta a los 4 fugados',
      info: '130 s · 4 fugados · eres la patrulla · detención por contacto',
      win: 'pegarte menos de 7 m durante 1,5 s a cada fugado',
      laps: 0, rivals: 4, aiSpeed: 0.97, strictWalls: true, live: true, timed: 130, police: true,
      setup(g) {
        g.state.catches = 0; g.state.target = 4; g.state.clock = 0;
        for (const c of g.cars) if (c.isPlayer) { c.color = '#1c2b46'; c.colorLin = G.toLinear(G.hexToRgb01('#1c2b46')); c.siren = true; }
        g.cars.forEach((c, i) => { if (!c.isPlayer) { c.siren = false; c.fugitive = true; c.caught = 0; c.color = ['#c9c9cf', '#3f7f2f', '#8c2a2a', '#d9a021'][i % 4]; c.colorLin = G.toLinear(G.hexToRgb01(c.color)); } });
      },
      update(g, dt) {
        const st = g.state;
        st.clock += dt;
        const left = st.timeLimit - st.clock;
        if (left <= 0) { g.finish(st.catches >= st.target ? '¡Todos detenidos!' : 'Escaparon: ' + st.catches + '/' + st.target); return false; }
        for (const c of g.cars) {
          if (!c.fugitive || c.caught > 0) continue;
          const p = g.player;
          const d = Math.hypot(c.pos[0] - p.pos[0], c.pos[2] - p.pos[2]);
          c.near = d < 7.5 && p.speed > 6 ? (c.near || 0) + dt : 0;
          if (c.near > 1.05) {
            c.caught = 0.001; st.catches++; st.timeLimit += 10;
            g.hud.toast('¡SOSPECHOSO DETENIDO! ' + st.catches + '/' + st.target, 2.2);
            g.sound.ok && g.sound.chord([520, 660, 784, 1046], 0.3, 0.18);
            G.Effects.sparks(g.fx, c.pos[0], c.pos[1] + 0.6, c.pos[2], 0, 0, 9);
            if (st.catches >= st.target) g.finish('¡Circuito despejado en ' + G.fmtTime(st.clock) + '!');
          }
        }
        /* los fugados detenidos se aparcan */
        for (const c of g.cars) if (c.caught > 0 && c.caught < 6) { c.caught += dt; c.throttle = 0; c.brake = 1; }
        return true;
      },
      hud(g) {
        return [
          { k: 'DETENIDOS', v: g.state.catches + '/' + g.state.target, big: true, col: '#8effc1' },
          { k: 'TIEMPO', v: Math.max(0, g.state.timeLimit - g.state.clock).toFixed(0) + ' s', big: false, col: g.state.timeLimit - g.state.clock < 15 ? '#ff7a6b' : '#f2f7ff' },
          { k: 'OBJETIVO', v: 'pegarse < 7 m', big: false }
        ];
      }
    }
  };
  G.MODES = MODES;
  G.MODE_LIST = ['race', 'attack', 'drift', 'chase', 'free'].map(k => MODES[k]);

  /* ------------------------------------------------------------------ *
   *  Game
   * ------------------------------------------------------------------ */
  function Game(o) {
    o = o || {};
    this.opts = o;
    this.headless = !!o.headless;
    this.R = o.renderer;
    this.canvas = o.canvas;
    this.sound = G.makeSound({ muted: G.store.get('cw_mute', false) });
    this.fx = new G.FX({ max: o.lowFx ? 420 : 900 }).setCap(o.lowFx ? 420 : 900);
    this.world = null; this.spec = null; this.mode = null; this.modeDef = null;
    this.cars = []; this.player = null;
    this.laps = 3; this.difficulty = 1;
    this.camMode = 0; this.camNames = ['persecución', 'capó', 'cinemática', 'ala'];
    this.state = {}; this.running = false; this.paused = false;
    this.showMap = true; this.lightsOn = true; this.driftMode = o.driftMode || 'manual';
    this.clock = 0; this.dt = 0; this.boostFx = 0; this.warnText = '';
    this.musicOn = G.store.get('cw_music', true) !== false;
    this.musicI = 0.42; this._mAmt = -1;
    this.acc = 0; this.frames = 0; this.fpsT = 0; this.fps = 60;
    this.cam = { pos: [0, 4, -10], look: [0, 1, 10], fov: 62, shake: 0, orbit: 0, roll: 0, shakeOff: [0, 0, 0], up: [0, 1, 0] };
    this.matCache = [];
    this._lp = [];
    this._m = M.m4(); this._m2 = M.m4(); this._m3 = M.m4();
    this.records = G.store.get('cw_records', {});
  }

  /* ---------------- construcción del mundo ---------------- */
  Game.prototype.loadMap = function (spec, onProgress) {
    if (this.world) { try { this.world.dispose(); } catch (e) { } this.world = null; }
    this.R.resetMaterials();
    this.R.beginParticles && this.R.beginParticles();
    this.spec = spec;
    this.world = G.World.build(this.R, spec, onProgress);
    this.world.onHit = (car, v, x, y, z) => this.onImpact(car, v, x, y, z);
    this.hud && this.hud.toast(spec.name, 1.8);
    return this.world;
  };

  /* ---------------- parrilla + coches ---------------- */
  Game.prototype.spawn = function (carDefId, opts) {
    opts = opts || {};
    const W = this.world, t = W.track;
    this.cars.length = 0;
    const defs = G.CARS;
    const nRace = this.modeDef.rivals;
    const pal = ['#d8203a', '#1f6fe0', '#f2a10c', '#25a35a', '#c9c9cf', '#8c2a2a', '#0fbfc4', '#d16ac9'];
    /* jugador */
    const pd = defs.find(d => d.id === carDefId) || defs[0];
    const grid = W.gridSlots;
    const pSlot = grid[Math.min(1, grid.length - 1)];
    const player = new G.Car(pd, { isPlayer: true, color: opts.color || pal[0], name: 'TÚ' });
    player.setState(pSlot.x, W.height.at(pSlot.x, pSlot.z) + 0.05, pSlot.z, pSlot.yaw);
    player.segIdx = pSlot.i || 0;
    this.cars.push(player); this.player = player;
    /* rivales */
    for (let i = 0; i < nRace; i++) {
      const d = defs[(i + 1 + (defs.indexOf(pd) + 1)) % defs.length];
      const slot = grid[(i + 2) % grid.length];
      const c = new G.Car(d, { color: pal[(i + 1) % pal.length], name: 'RIVAL ' + (i + 1), skill: (0.88 + i * 0.035) * this.difficulty });
      c.setState(slot.x, W.height.at(slot.x, slot.z) + 0.05, slot.z, slot.yaw);
      c.ai.skill = c.skill;
      this.cars.push(c);
    }
    if (this.modeDef.police) {
      this.cars.forEach((c, i) => { if (i > 0) c.isCop = false; });
      player.isCop = true;
    }
    /* voces de audio por coche (máx 6): una por motor. addCar encola si el
       AudioContext aún no ha arrancado (lo hace el primer gesto del usuario). */
    this.sound.stopVoices();
    this.sndCars = this.cars.slice(0, 6);
    this.sndCars.forEach((c, i) => this.sound.addCar({
      name: c.name, player: i === 0,
      cyl: c.stats.cyl || 6, redline: c.stats.redline || 7000, drive: c.stats.drive || 'rwd',
      turbo: (c.stats.boost || 1) > 1.02
    }));
    /* estado de carrera */
    this.state = { clock: 0, timeLimit: this.modeDef.timed ? this.modeDef.timed : 1e9, ckNext: 1, lapDone: 0, finished: false, score: 0, catches: 0, target: 0 };
    this.laps = opts.laps || this.modeDef.laps || 3;
    for (const c of this.cars) {
      c.lap = 0; c.progress = 0; c.lastProg = 0; c.totalProgress = 0;
      c.finished = false; c.lapTimes = []; c.bestLap = 0; c.damage = 0;
      c.ckIdx = 0; c.ckSince = 0; c.armed = false; c.driftScore = 0; c.place = 0; c.offT = 0; c.near = 0;
      /* índice local del límite de pista: se siembra con la máscara y se refina
         en cada paso (ventana de índices) para que el muro no se "apague" */
      c.segIdx = clamp(Math.round(W.mask.seg(c.pos[0], c.pos[2])), 0, W.track.n - 1);
    }
    if (this.modeDef.setup) this.modeDef.setup(this);
    this.buildLightTable();
    return this.cars;
  };

  /* ---------------- luces dinámicas ---------------- */
  Game.prototype.buildLightTable = function () {
    const W = this.world;
    this.lampPool = (W.lamps || []).slice();
    this.nearLamps = new Array(Math.max(0, MAXL - 6)).fill(null);
  };
  Game.prototype.updateLights = function () {
    const R = this.R, W = this.world, p = this.player;
    const lights = R.lights; lights.length = 0;
    const night = W.night;
    const budget = MAXL - (night ? 0 : 2);
    /* faroles cercanos (de menos a más distancia) */
    if (this.lampPool.length) {
      const scored = this._lscore || (this._lscore = []);
      scored.length = 0;
      for (let i = 0; i < this.lampPool.length; i++) {
        const L = this.lampPool[i];
        const d = (L[0] - p.pos[0]) * (L[0] - p.pos[0]) + (L[2] - p.pos[2]) * (L[2] - p.pos[2]);
        if (d < 140 * 140) scored.push([d, i]);
      }
      scored.sort((a, b) => a[0] - b[0]);
      const maxL = night ? Math.min(8, budget) : 0;
      for (let k = 0; k < maxL; k++) {
        const L = this.lampPool[scored[k][1]];
        lights.push([L[0], L[1] - 7.4, L[2], 1.0, 0.82, 0.55, 26, 0.85]);
      }
    }
    /* faros delanteros / luces traseras de los coches cercanos */
    const near = this.cars.slice(0).sort((a, b) =>
      ((a.pos[0] - p.pos[0]) ** 2 + (a.pos[2] - p.pos[2]) ** 2) - ((b.pos[0] - p.pos[0]) ** 2 + (b.pos[2] - p.pos[2]) ** 2)).slice(0, 4);
    for (const c of near) {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const on = this.lightsOn || night;
      if (on) lights.push([c.pos[0] + fx * 2.3, c.pos[1] + 0.62, c.pos[2] + fz * 2.3, 1, 0.93, 0.8, c.isPlayer ? 34 : 22, night ? 1.5 : 0.35]);
      lights.push([c.pos[0] - fx * 2.2, c.pos[1] + 0.55, c.pos[2] - fz * 2.2, 1, 0.14, 0.1, 11, (c.brake > 0.05 || c.handbrake > 0.3) ? 2.2 : (night ? 0.8 : 0.35)]);
      if (c.boost > 0.1) lights.push([c.pos[0] - fx * 2.6, c.pos[1] + 0.45, c.pos[2] - fz * 2.6, 0.4, 0.75, 1, 14, 2.4]);
    }
    if (lights.length > MAXL) lights.length = MAXL;
  };

  /* ---------------- impacto ---------------- */
  Game.prototype.onImpact = function (car, v, x, y, z) {
    const p = clamp(v / 12, 0.08, 1);
    G.Effects.sparks(this.fx, x, y + 0.5, z, -car.hitDir[0], -car.hitDir[1], p * 8);
    G.Effects.debris(this.fx, x, y, z, p * 5, car.isPlayer ? [0.6, 0.62, 0.66] : null);
    if (car.isPlayer) { this.hud && this.hud.hit(p); this.cam.shake = Math.min(1.3, this.cam.shake + p * 1.1); }
    if (this.sound.ok && v > 3) this.sound.thud(clamp(v / 14, 0.1, 1));
  };

  /* ---------------- paso de simulación ---------------- */
  Game.prototype.sim = function (dt) {
    const W = this.world, st = this.state;
    if (st.finished) return;
    const input = this.headless ? { steer: 0, throttle: 0, brake: 0, hand: 0, boost: 0, pressed: {}, clear() { } } : this.input.state();
    /* acciones globales */
    const pr = input.pressed || {};
    if (pr.cam) this.cycleCam();
    if (pr.pause) this.togglePause();
    if (pr.mute) { this.setMuted(!this.sound.muted); }
    if (pr.lights) this.lightsOn = !this.lightsOn;
    if (pr.map) this.showMap = !this.showMap;
    if (pr.reset) this.respawn(this.player);
    /* entrada del jugador */
    const p = this.player;
    const allowDrive = this.modeDef.update ? this.modeDef.update(this, dt) !== false : true;
    if (allowDrive) {
      p.steer = input.steer;
      p.throttle = input.throttle;
      p.brake = input.brake;
      p.handbrake = input.hand;
      p.driftKey = input.drift || 0;
      if (input.boost && p.boostFuel > 4) { p.boost = 1; this.boostFx = Math.min(1, this.boostFx + dt * 5); }
      else { p.boost = 0; this.boostFx = Math.max(0, this.boostFx - dt * 3); }
      if (this.opts.assist && p.speed > 40 && Math.abs(input.steer) < 0.15) p.steer = -p.vr * 0.02;
      const physOpts = { strictWalls: this.modeDef.strictWalls, ice: false, driftAuto: this.driftMode === 'auto' };
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        if (!c.isPlayer) {
          if (c.caught > 0) { c.throttle = 0; c.brake = 1; c.steer = 0; }
          else G.aiDrive(c, W, dt, (this.modeDef.aiSpeed || 0.9) * (c.skill || 1) * (st.countdown > 0 ? 0 : 1), this.cars);
        }
        G.physics(c, W, dt, physOpts);
      }
      G.carCollisions(this.cars, (a, v, x, y, z) => this.onImpact(a, v, x, y, z));
      this.progress(dt);
    }
    if (st.countdown > 0) st.countdown -= dt;
    /* reloj */
    if (this.modeDef.timed) st.clock += dt; else st.clock += dt;
    /* efectos */
    if (this.opts.particles !== false) {
      const drifting = p.drifting;
      if (drifting) G.Effects.tireSmoke(this.fx, p, W, clamp(Math.abs(p.vr) / 9, 0.25, 1));
      else if ((p.wheelspin || 0) > 0.22) {
        /* salida en pazos: humo en el eje motriz (no es lo mismo un V8 trasero
           que un 4x4: además de oírse se ve) */
        G.Effects.tireSmoke(this.fx, p, W, clamp((p.wheelspin || 0) * 0.85, 0.22, 0.9), p.stats.drive === 'fwd' ? 'f' : 'r');
      }
      /* los rivales fuera del asfalto también levantan polvo (antes sólo el jugador) */
      for (let oi = 1; oi < this.cars.length && oi < 7; oi++) {
        const o = this.cars[oi];
        if (o.onRoad < 0.86 && o.speed > 9) G.Effects.dustTrail(this.fx, o, W);
      }
      /* chispas JUSTO en el contacto contra el muro (el resto lo hace onImpact) */
      if (p.hitTimer > 0.33 && p.speed > 8) {
        G.Effects.sparks(this.fx, p.pos[0], p.pos[1] + 0.5, p.pos[2], p.hitDir[0], p.hitDir[1], 6);
      }
      if (p.boost > 0.1 && p.speed > 2) G.Effects.nitroFlame(this.fx, p, W);
      G.Effects.dustTrail(this.fx, p, W);
      for (let i = 1; i < Math.min(this.cars.length, 6); i++) {
        const c = this.cars[i];
        if (c.drifting && Math.abs(c.vr) > 4) G.Effects.tireSmoke(this.fx, c, W, 0.45);
        else if ((c.wheelspin || 0) > 0.55) G.Effects.tireSmoke(this.fx, c, W, 0.4, c.stats.drive === 'fwd' ? 'f' : 'r');
        else G.Effects.dustTrail(this.fx, c, W);
      }
      this.fx.update(dt, W);
    }
    this.cam.shake = Math.max(0, this.cam.shake - dt * 2.2);
    if (this.hud) this.hud.update(this, dt);
    this.clock += dt;
  };

  /* ---------------- progreso, vueltas, clasificación ---------------- */
  Game.prototype.progress = function (dt) {
    const W = this.world, cps = W.checkpoints, n = cps.length, total = W.track.total;
    for (const c of this.cars) {
      const d = W.mask.dist(c.pos[0], c.pos[2]);
      c.offBy = d > W.spec.w + 5.5;
      const prog = W.mask.progress(c.pos[0], c.pos[2]);
      const prev = c.progress;
      c.progress = prog;
      let delta = prog - prev;
      if (delta < -0.5) { /* cruce la meta en sentido correcto */
        delta += 1;
        const need = Math.max(2, cps.length - 2);
        if ((c.ckSince || 0) >= need && !this.modeDef.police) this.onLap(c);
        else if (!c.armed) { c.armed = true; c.lapStart = this.state.clock; c.ckSince = 0; }
        else if ((c.ckSince || 0) < need) { c.lapStart = this.state.clock; } /* vuelta incompleta: rearmar reloj */
      } else if (delta > 0.5) { delta -= 1; c.ckSince = 0; }
      if (delta > 0 && delta < 0.25) {
        c.totalProgress += delta;
      }
      c.lastProg = prog;
      /* checkpoints en orden (anti-atajos) */
      const want = (c.ckIdx + 1) % n;
      const ck = cps[want];
      const dck = Math.hypot(c.pos[0] - ck.x, c.pos[2] - ck.z);
      const myIdx = Math.round(W.mask.seg(c.pos[0], c.pos[2]));
      const di = ((myIdx - ck.i) % n + n) % n;
      const near = Math.min(di, n - di) < Math.max(5, n * 0.022);
      if (dck < ck.r + 4.2 && near) {
        c.ckIdx = want;
        c.ckSince = (c.ckSince || 0) + 1;
        if (c.isPlayer && this.modeDef.checkpoint) this.modeDef.checkpoint(this, c);
        else if (c.isPlayer) { this.sound.ok && this.sound.blip(760, 0.09, 'triangle', 0.14); }
      }
            if (this.nextCk === undefined && c.isPlayer) this.nextCk = cps[(c.ckIdx + 1) % n];
      if (c.isPlayer) this.nextCk = cps[(c.ckIdx + 1) % n];
      /* aviso de fuera de pista */
      if (c.isPlayer) {
        c.offT = (c.offT || 0) + (c.offBy ? dt : -dt * 2.2);
        c.offT = clamp(c.offT, 0, 5.4);
        c.reposT = Math.max(0, (c.reposT || 0) - dt);
        this.warnText = c.offT > 0.85 ? (this.modeDef.strictWalls ? 'VUELVE A LA PISTA' : '') : '';
        /* sólo si además va lento (atasco real) o lleva mucho rato fuera,
           y nunca a menos de 1.2 s del anterior */
        const stuckSlow = c.speed < 13;
        if (c.reposT <= 0 && ((c.offT > 2.8 && stuckSlow) || c.offT > 4.9)) {
          this.respawn(c);
        }
      }
    }
    if (this.lapTimer !== undefined) this.lapTimer += dt;
    /* clasificación */
    if (this.cars.length > 1) {
      const arr = this.cars.slice().sort((a, b) => (b.lap + b.progress) - (a.lap + a.progress) || b.totalProgress - a.totalProgress);
      arr.forEach((c, i) => c.place = i + 1);
      if (this.modeDef.live && !this.state.finished && this.laps && this.player.lap >= this.laps) this.finishRace();
    }
  };
  Game.prototype.onLap = function (c) {
    const t = this.state.clock - c.lapStart;
    c.ckSince = 0;
    c.lapStart = this.state.clock;
    c.lap++;
    if (t > 4) {
      c.lapTimes.push(t);
      if (!c.bestLap || t < c.bestLap) c.bestLap = t;
      if (c.isPlayer) {
        this.hud && this.hud.toast('Vuelta ' + G.fmtTime(t) + (c.bestLap === t ? '  ¡rápida!' : ''), 2.2);
        this.sound.ok && this.sound.chord([620, 830], 0.2, 0.12);
        const key = 'lap:' + this.spec.id + ':' + this.mode.id;
        if (!this.records[key] || t * 1000 < this.records[key].ms) {
          this.records[key] = { ms: Math.round(t * 1000), car: c.def.id };
          G.store.set('cw_records', this.records);
          this.hud && this.hud.toast('¡NUEVO RÉCORD DE VUELTA!', 2.6);
        }
      }
    }
    if (this.modeDef.lapDone) this.modeDef.lapDone(this, c);
  };
  Game.prototype.finishRace = function () {
    const arr = this.cars.slice().sort((a, b) => (b.lap + b.progress) - (a.lap + b.progress));
    const me = arr.indexOf(this.player) + 1;
    this.finish('Puesto ' + me + 'º de ' + arr.length + ' · mejor vuelta ' + (this.player.bestLap ? G.fmtTime(this.player.bestLap) : '—'));
    const key = 'race:' + this.spec.id;
    if (!this.records[key] || this.state.clock < this.records[key].s) {
      this.records[key] = { s: Math.round(this.state.clock), ms: Math.round(this.state.clock * 1000), pos: me, car: this.player.def.id };
      G.store.set('cw_records', this.records);
    }
  };
  Game.prototype.finish = function (msg) {
    if (this.state.finished) return;
    this.state.finished = true;
    this.running = false;
    if (this.sound.ok) this.sound.whoosh(1);
    const rows = [{ head: 1, cells: ['#', 'coche', 'vuelta', 'mejor', 'tiempo/pts'] }];
    const sorted = this.cars.slice().sort((a, b) => b.totalProgress - a.totalProgress || b.lap - a.lap);
    sorted.forEach((c, i) => rows.push({
      hi: c.isPlayer, cells: [
        (i + 1) + 'º', c.name, (c.lap) + '',
        c.bestLap ? G.fmtTime(c.bestLap) : '—',
        this.mode.id === 'drift' ? Math.round(this.driftHud.total + this.driftHud.cur) + ' pts' : G.fmtTime(this.state.clock)
      ]
    }));
    if (this.screens) { this.screens.result((this.mode.name + ' — ' + msg), rows); this.screens.show('result'); }
    this.lastResult = msg;
  };
  Game.prototype.respawn = function (c, keepSpeed) {
    const W = this.world, m = W.mask;
    const i = clamp(Math.round(m.seg(c.pos[0], c.pos[2])), 0, W.track.n - 1);
    const t = W.track;
    const spd = keepSpeed === false ? 0 : Math.max(c.speed * 0.55, 7);
    const yaw = Math.atan2(t.T[i * 2], t.T[i * 2 + 1]);
    c.setState(t.centers[i][0], W.height.at(t.centers[i][0], t.centers[i][1]) + 0.06, t.centers[i][1], yaw);
    /* NO te deja parado: recupera el 55 % de la velocidad que llevabas, en la
       dirección de la pista. Antes el chute a 0 km/h mataba el ritmo. */
    c.vel[0] = Math.sin(yaw) * spd; c.vel[2] = Math.cos(yaw) * spd;
    c.vf = spd; c.speed = spd;
    c.throttle = c.brake = 0;
    c.segIdx = i; c.driftHold = 0; c.offT = 0;
    c.reposT = 1.1;                       /* inmunidad breve del test de "atascado" */
    c.hitTimer = Math.max(c.hitTimer, 0.25);
    if (c.isPlayer && this.hud) this.hud.toast('de vuelta a la pista', 0.9);
  };

  /* ---------------- cámara ---------------- */
  Game.prototype.cycleCam = function () { this.camMode = (this.camMode + 1) % this.camNames.length; this.hud && this.hud.toast('cámara: ' + this.camNames[this.camMode], 1.1); };
  const CAM_TMP = [0, 0, 0], CAM_LOOK = [0, 0, 0];
  Game.prototype.updateCam = function (dt) {
    const c = this.player, cam = this.cam, W = this.world;
    const top = Math.max(22, (c.def && c.def.stats ? c.def.stats.top : 210) / 3.6);
    const sp = clamp(c.speed / top, 0, 1);           /* 0..1 según SU velocidad máx */
    const spA = clamp(c.speed / 30, 0, 1.6);
    /* Damping real: constante de tiempo 0.16 s -> 0.24 s según velocidad.
       Antes k era fijo y muy rápido: la cámara venía pegada al chasis y no se
       notaba ni el empuje, ni el freno, ni el sliding. */
    const tau = 0.16 + 0.085 * sp;
    const k = 1 - Math.exp(-dt / tau);
    const aL = clamp((c.aLong || 0) / 11, -1, 1);     /* aceleración / frenada */
    const aR = clamp((c.aLat || 0) / 20, -1, 1);      /* apoyo en curva */
    const driftK = c.drifting ? 1 : 0;
    let ex, ey, ez, lx, ly, lz;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    /* mirar hacia donde VA el coche (velocidad), no sólo hacia donde apunta */
    const vlen = Math.hypot(c.vel[0], c.vel[2]);
    const vdx = vlen > 3 ? c.vel[0] / vlen : s, vdz = vlen > 3 ? c.vel[2] / vlen : co;
    if (this.camMode === 1) {                /* capó: rígido en posición, suave en mirada */
      ex = c.pos[0] + s * 0.15 - c.vr * 0.012; ey = c.pos[1] + 1.16 - aL * 0.020; ez = c.pos[2] + co * 0.15;
      cam.pos[0] = ex; cam.pos[1] = ey; cam.pos[2] = ez;
      const la = 15 + sp * 5;
      lx = c.pos[0] + vdx * la; ly = c.pos[1] + 1.1 + c.pitch * 7 - aL * 0.5; lz = c.pos[2] + vdz * la;
      cam.look[0] = lerp(cam.look[0], lx, clamp(dt * 14, 0, 1));
      cam.look[1] = lerp(cam.look[1], ly, clamp(dt * 9, 0, 1));
      cam.look[2] = lerp(cam.look[2], lz, clamp(dt * 14, 0, 1));
    } else if (this.camMode === 2) {          /* cinemática: órbita baja */
      cam.orbit += dt * (0.34 + sp * 0.3);
      const r = 8.5 + spA * 3;
      const a = c.yaw + Math.PI + Math.sin(cam.orbit) * 1.5;
      ex = c.pos[0] + Math.sin(a) * r; ez = c.pos[2] + Math.cos(a) * r;
      ey = c.pos[1] + 1.5 + Math.abs(Math.sin(cam.orbit * 0.7)) * 2.4;
      cam.pos[0] = lerp(cam.pos[0], ex, k * 0.7); cam.pos[1] = lerp(cam.pos[1], ey, k * 0.8); cam.pos[2] = lerp(cam.pos[2], ez, k * 0.7);
      cam.look[0] = lerp(cam.look[0], c.pos[0], k); cam.look[1] = lerp(cam.look[1], c.pos[1] + 1.1, k); cam.look[2] = lerp(cam.look[2], c.pos[2], k);
    } else if (this.camMode === 3) {          /* ala: lateral a la altura del alerón */
      const side = Math.cos(c.yaw), sz = -Math.sin(c.yaw);
      ex = c.pos[0] + side * 7.4 + s * 1.6 - aR * 1.1; ez = c.pos[2] + sz * 7.4 + co * 1.6;
      ey = c.pos[1] + 1.35 - aL * 0.16;
      cam.pos[0] = lerp(cam.pos[0], ex, k); cam.pos[1] = lerp(cam.pos[1], ey, k); cam.pos[2] = lerp(cam.pos[2], ez, k);
      cam.look[0] = lerp(cam.look[0], c.pos[0] + vdx * 3, k * 1.2);
      cam.look[1] = lerp(cam.look[1], c.pos[1] + 0.9, k * 1.2);
      cam.look[2] = lerp(cam.look[2], c.pos[2] + vdz * 3, k * 1.2);
    } else {                                  /* persecución */
      /* se abre al acelerar, se pega al frenar, sube en recta y baja al acelerar */
      const dist = (7.1 + sp * 2.8 + driftK * 1.15) * (1 + aL * 0.085);
      const hi = 2.55 + sp * 0.62 - aL * 0.30 + driftK * 0.10;
      const lat = -c.vr * 0.16 - aR * 0.42;    /* se queda fuera en el deslizamiento */
      ex = c.pos[0] - s * dist + co * lat; ez = c.pos[2] - co * dist - s * lat;
      ey = c.pos[1] + hi;
      const gy = W.height.at(ex, ez) + 1.1;
      if (ey < gy) ey = gy;
      cam.pos[0] = lerp(cam.pos[0], ex, k); cam.pos[1] = lerp(cam.pos[1], ey, k * 0.82); cam.pos[2] = lerp(cam.pos[2], ez, k);
      const la = 9.5 + sp * 9;
      lx = c.pos[0] + vdx * la - c.vr * 0.34; lz = c.pos[2] + vdz * la + c.vr * 0.34 * -1;
      cam.look[0] = lerp(cam.look[0], lx, k * 1.25);
      cam.look[1] = lerp(cam.look[1], c.pos[1] + 1.05 + aL * 0.10, k * 1.25);
      cam.look[2] = lerp(cam.look[2], lz, k * 1.25);
    }
    /* --- contención: nunca bajo el terreno, nunca dentro de una roca, nunca fuera del mapa --- */
    {
      const W2 = this.world, sp2 = W2.spec;
      let gy = W2.height.at(cam.pos[0], cam.pos[2]) + 1.35;
      if (W2.solidTopAt) {
        const st = W2.solidTopAt(cam.pos[0], cam.pos[2]);
        if (st > -1e8) gy = Math.max(gy, st + 1.1);   /* no meterse dentro de una roca/edificio */
      }
      if (cam.pos[1] < gy) cam.pos[1] = gy;
      const lim = this.player.limitD || (W2.spec.w + 2);
      const Lm = G.limitAt(W2, cam.pos[0], cam.pos[2], this.player.segIdx, this._lbuf || (this._lbuf = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 }));
      const cap = lim + 7.5;
      if (Lm.d > cap) {
        cam.pos[0] = Lm.cx + Lm.nx * cap;
        cam.pos[2] = Lm.cz + Lm.nz * cap;
        const gy2 = W2.height.at(cam.pos[0], cam.pos[2]) + 1.35;
        if (cam.pos[1] < gy2) cam.pos[1] = gy2;
      }
      const B = (sp2.world || 400) - 3;
      cam.pos[0] = clamp(cam.pos[0], -B, B); cam.pos[2] = clamp(cam.pos[2], -B, B);
      cam.pos[1] = clamp(cam.pos[1], W2.height.at(cam.pos[0], cam.pos[2]) + 0.8, (W2.height.maxY || 60) + 60);
      const ly2 = W2.height.at(cam.look[0], cam.look[2]) - 0.5;
      if (cam.look[1] < ly2) cam.look[1] = ly2;
    }
    /* alabeo de cámara: se inclina con el apoyo y en el derrape (refuerza la
       sensación de fuerza lateral sin tocar los controles) */
    cam.roll = G.damp(cam.roll || 0, -aR * 0.052 - (c.roll || 0) * 0.30 - (c.drifting ? Math.sign(c.vr || 1) * 0.028 : 0), 5.5, dt);
    cam.up[0] = Math.sin(cam.roll) * co; cam.up[1] = Math.cos(cam.roll); cam.up[2] = -Math.sin(cam.roll) * s;
    /* sacudidas + FOV (sube hacia la velocidad punta de ESTE coche) */
    cam.fov = 58 + sp * 15 + (c.boost > 0.1 ? 6 : 0) + (c.drifting ? 2.5 : 0);
    const sh = cam.shake * (0.22 + spA * 0.1) + (c.damage > 0.5 ? 0.05 : 0) + sp * sp * 0.022;
    cam.shakeOff = [
      (G.hash1(this.clock * 61, 1) - 0.5) * sh,
      (G.hash1(this.clock * 61, 2) - 0.5) * sh,
      (G.hash1(this.clock * 61, 3) - 0.5) * sh * 0.5
    ];
  }

  /* ---------------- instanciar coches + efectos en el renderizador ---------------- */
  const P_M = M.m4(), P_C = M.m4(), P_R = M.m4(), P_W = M.m4(), P_T = M.m4(), P_B = M.m4();
  Game.prototype.instanceCars = function () {
    const W = this.world;
    for (const k in W.carGroups) for (const pn in W.carGroups[k]) W.carGroups[k][pn].clear();
        if (W.blobGroup) W.blobGroup.clear();
    for (let ci = 0; ci < this.cars.length; ci++) {
      const c = this.cars[ci];
      const g = W.carGroups[c.def.id];
      if (!g) continue;
      /* sombra falsa: siempre (en calidad baja no hay shadow-map y sin esto
         el coche parece flotar). Se desvanece al saltar y se apoya en el suelo. */
      if (W.blobGroup) {
        const gy = c.surfaceY != null ? c.surfaceY : W.height.at(c.pos[0], c.pos[2]);
        const air = clamp(1 - (c.pos[1] - gy) / 1.5, 0, 1);
        if (air > 0.03) {
          const wide = (c.def.W || 1.9), long = (c.def.L || 4.2);
          M.fromTRS(P_B, [c.pos[0], gy + 0.055, c.pos[2]], c.yaw, [wide * 0.62, 1, long * 0.58]);
          M.setColor(P_B, [0.02, 0.02, 0.03]);
          const shOn = this.R.quality && this.R.quality.shadows;
          W.blobGroup.add(P_B, { alpha: (0.34 + 0.16 * air) * (shOn ? 0.42 : 1) });
        }
      }
      /* matriz del coche: traslación + cabeceo + alabeo + rebote */
      M.identity(P_C);
      const cp = Math.cos(c.pitch), sp2 = Math.sin(c.pitch), cr = Math.cos(c.roll), sr = Math.sin(c.roll);
      /* R = Ry(yaw) * Rx(pitch) * Rz(roll) */
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const m = P_C;
      m[0] = cy * cr + sy * sp2 * sr; m[1] = cp * sr; m[2] = -sy * cr + cy * sp2 * sr; m[3] = 0;
      m[4] = -cy * sr + sy * sp2 * cr; m[5] = cp * cr; m[6] = sy * sr + cy * sp2 * cr; m[7] = 0;
      m[8] = sy * cp; m[9] = -sp2; m[10] = cy * cp; m[11] = 0;
      const bounce = -Math.abs(c.bounce) * 0.10;
      m[12] = c.pos[0]; m[13] = c.pos[1] + bounce; m[14] = c.pos[2]; m[15] = 1;
      /* daño: ligera deformación */
      if (c.damage > 0.25) { m[1] += c.damage * 0.02; m[9] += c.damage * 0.03; }
      const tint = c.colorLin;
      /* partes rígidas del kit (la malla ya está en espacio del coche) */
      for (const pn of ['body', 'trim', 'wing', 'glass']) {
        const meshName = pn;
        const dst = g[meshName];
        if (!dst) continue;
        M.multiply(P_M, m, ID);
        M.setColor(P_M, tint);
        dst.add(P_M, { alpha: 1 });
      }
      /* faros: intensidad variable */
      const night = W.night;
      const headOn = this.lightsOn || night;
      M.multiply(P_M, m, ID);
      M.setColor(P_M, headOn ? [1, 0.95, 0.85] : [0.18, 0.18, 0.2]);
      g.lightsF.add(P_M, { emis: headOn ? 1.6 : 0.12 });
      const braking = c.brake > 0.04 || c.handbrake > 0.3 || (this.modeDef.police && c.fugitive);
      M.setColor(P_M, braking ? [1, 0.2, 0.15] : [0.5, 0.06, 0.05]);
      g.lightsR.add(P_M, { emis: braking ? 3.2 : 0.7 });
      /* ruedas */
      const d = c.def;
      for (let w = 0; w < 4; w++) {
        const front = w < 2;
        const sx = (w % 2 ? 1 : -1) * d.track / 2;
        const sz = (front ? 1 : -1) * d.wb / 2;
        M.identity(P_W);
        M.fromTRS(P_W, [sx, d.clr + d.wheelR, sz], 0, [d.wheelR, d.wheelR, d.wheelR]);
        /* giro de rueda + dirección */
        const spin = c.wheelSpin * (front ? 1 : 1);
        M.identity(P_R);
        M.fromRotX(P_R, spin);
        M.multiply(P_W, P_W, P_R);
        if (front) { M.fromRotYPivot(P_R, c.steerVis, ZER, null); M.multiply(P_W, P_R, P_W); }
        M.multiply(P_M, m, P_W);
        M.setColor(P_M, null);
        g.wheel.add(P_M);
        M.multiply(P_M, m, P_W);
        M.setColor(P_M, [0.85, 0.86, 0.9]);
        g.rim.add(P_M);
      }
      /* haces de luz (cono) + luz inferior de neón */
      if (night && headOn) {
        M.fromTRS(P_T, [0, d.clr + 0.5, d.L * 0.42], 0, [1, 1, 1]);
        M.multiply(P_M, m, P_T);
        M.setColor(P_M, [1, 0.92, 0.76]);
        g.beam.add(P_M, { alpha: 0.5 });
      }
      if (c.isPlayer || this.mode.id === 'neon') {
        M.fromTRS(P_T, [0, 0.06, 0], 0, [d.W * 1.15, 1, d.L * 1.1]);
        M.multiply(P_M, m, P_T);
        M.setColor(P_M, c.isPlayer ? [0.35, 0.9, 1] : [1, 0.4, 0.2]);
        g.under.add(P_M, { alpha: night ? 0.5 : 0.16 });
      }
      /* sirena de policía: parpadeo por fase */
      if (c.siren) {
        M.fromTRS(P_T, [0, d.clr + 1.0, 0.1], 0, [1, 1, 1]);
        M.multiply(P_M, m, P_T);
        const ph = Math.floor(this.clock * 6) % 2;
        M.setColor(P_M, ph ? [1, 0.1, 0.1] : [0.15, 0.4, 1]);
        g.lightsF.add(P_M, { emis: 4, phase: ph });
      }
    }
  };
  const ID = M.m4();   /* la kit mesh ya viene en espacio del coche: identidad */
  const ZER = [0, 0, 0];

  /* ---------------- dibujo ---------------- */
  Game.prototype.draw = function () {
    const R = this.R, W = this.world;
    this.instanceCars();
    /* checkpoints: anillo del siguiente + pilones */
    W.ckRing.clear(); W.ckPillar.clear(); W.marker.clear();
    for (const c of this.cars) {
      if (!c.isPlayer) continue;
      const ck = W.checkpoints[(c.ckIdx + 1) % W.checkpoints.length];
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 3);
      M.fromTRS(P_M, [ck.x, ck.y + 0.1, ck.z], Math.atan2(ck.yaw ? Math.sin(ck.yaw) : 0, 1), [ck.r, 1, ck.r]);
      /* anillo achatado: escalar en Y para que sea un disco vertical */
      M.fromTRS(P_M, [ck.x, ck.y + 2.4, ck.z], ck.yaw, [ck.r, ck.r, ck.r]);
      M.setColor(P_M, [1, 0.75 + pulse * 0.25, 0.3]);
      W.ckRing.add(P_M, { alpha: 0.55 + pulse * 0.3, emis: 1 + pulse });
      for (const side of [-1, 1]) {
        const px = ck.x + Math.cos(ck.yaw) * side * (ck.r + 0.6);
        const pz = ck.z - Math.sin(ck.yaw) * side * (ck.r + 0.6);
        M.fromTRS(P_M, [px, ck.y, pz], ck.yaw, [1, 1, 1]);
        M.setColor(P_M, null);
        W.ckPillar.add(P_M);
      }
      break;
    }
    /* centro de sombras sobre el jugador */
    const p = this.player;
    R.shadowCenter = [p.pos[0], p.pos[1] - 0.4, p.pos[2]];
    this.updateLights();
    /* cámara */
    const cam = this.cam;
    const ex = cam.pos[0] + cam.shakeOff[0], ey = cam.pos[1] + cam.shakeOff[1], ez = cam.pos[2] + cam.shakeOff[2];
    M.lookAt(this._view || (this._view = M.m4()), [ex, ey, ez], cam.look,
      [cam.up[0] + cam.shakeOff[0] * 0.6, cam.up[1], cam.up[2] + cam.shakeOff[2] * 0.6]);
    const asp = (this.canvas.clientWidth || 16) / (this.canvas.clientHeight || 9);
    M.persp(this._proj || (this._proj = M.m4()), cam.fov * Math.PI / 180, asp, 0.28, W.spec.world * 4.2);
    R.setView(this._view, this._proj, [ex, ey, ez]);
    R.beginParticles();
    this.fx.emitToRenderer(R);
    R.render(this.dt);
    if (this.hud) {
      const sh = cam.shake * 6;
      const ctx = this.hud.ctx;
      ctx.save();
      ctx.translate((G.hash1(this.clock * 33, 9) - 0.5) * sh, (G.hash1(this.clock * 33, 10) - 0.5) * sh);
      this.hud.draw(this);
      ctx.restore();
    }
  };

  /* ---------------- bucle ---------------- */
  Game.prototype.frame = function (ts) {
    const now = ts || (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!this._last) this._last = now;
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25;
    if (!(dt > 0)) dt = 0;                 /* ts repetido o fuera de orden: no integrar hacia atrás */
    this.dt = dt;
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; if (this.autoQual) this.adapt(); }
    if (!this.paused) {
      /* paso fijo fino (120 Hz) y hasta 12 subpasos: a 20 fps no se pierde
         simulación y el CCD de los muros sigue siendo exacto */
      const h = this.hStep || 1 / 120;
      this.acc += dt;
      let guard = 0;
      let first = true;
      const maxSteps = 12;
      while (this.acc >= h && guard < maxSteps) {
        this.sim(h);
        if (first) { this.input.pressed = {}; first = false; }   /* los pulsos sólo valen un substep */
        this.acc -= h; guard++;
      }
      if (guard >= maxSteps) this.acc = 0;
      this.updateCam(dt);
    }
    if (!this.paused) this.updateSound(dt);
    else if (this.sound.ok && this.sndCars) this.sound.update(this.sndCars,
      { x: this.cam.pos[0], z: this.cam.pos[2], yaw: this.player ? this.player.yaw : 0 }, 0, { skidVol: 0, intensity: 0.05 });
    if (this.world) this.draw();
    if (!this.headless) this._raf = requestAnimationFrame(t => this.frame(t));
  };
  Game.prototype.adapt = function () {
    const R = this.R;
    if (this.fps < 42 && R.dprCap > 0.78) { R.dprCap = Math.max(0.75, R.dprCap - 0.08); if (this.qualityNow !== 'low') { R.quality.clouds = false; } }
    else if (this.fps > 57 && R.dprCap < this.maxDpr) R.dprCap = Math.min(this.maxDpr, R.dprCap + 0.04);
  };
  Game.prototype.setQuality = function (q) {
    const R = this.R;
    this.qualityNow = q;
    /* el checkbox «Sombras» del menú ahora SÍ manda (antes se ignoraba por
       completo) y en calidad baja se pasa a un mapa pequeño en vez de apagarlo:
       sin sombras los coches parecían flotar */
    const want = !(this.opts && this.opts.shadows === false);
    R.quality.shadows = want;
    R.quality.clouds = q === 'high';
    R.quality.shadowSize = q === 'high' ? 2048 : (q === 'low' ? 512 : 1024);
    R.setShadowSize && R.setShadowSize(R.quality.shadowSize);
    R.dprCap = q === 'low' ? 0.85 : (q === 'med' ? 1.05 : 1.3);
    this.maxDpr = R.dprCap;
    this.fx.setCap(q === 'low' ? 320 : (q === 'med' ? 640 : 900));
    this.hStep = q === 'low' ? 1 / 100 : 1 / 120;
  };
  /* ------------------------------------------------------------------ *
   *  Audio por fotograma: tu motor, el de los rivales (distancia +
   *  panorámica) y la música, que sube cuando la carrera aprieta.
   * ------------------------------------------------------------------ */
  Game.prototype.updateSound = function (dt) {
    const S = this.sound;
    if (!S.ok || !this.cars.length || !this.player) return;
    const p = this.player, st = this.state || {};
    let near = 1e9;
    for (let i = 1; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.caught > 0) continue;
      const d = Math.hypot(c.pos[0] - p.pos[0], c.pos[2] - p.pos[2]);
      if (d < near) near = d;
    }
    const press = clamp(1 - near / 55, 0, 1);                 /* un rival pegado */
    const spdK = clamp(p.speed / Math.max(12, p.stats.top / 3.6), 0, 1);
    const lastLap = (st.lapDone || 0) >= this.laps - 1 ? 0.20 : 0;
    let inten = 0.16 + press * 0.44 + spdK * 0.28 + lastLap + clamp(p.damage, 0, 1) * 0.10;
    if (st.countdown > 0) inten = 0.10;
    if (st.finished) inten = 0.12;
    this.musicI = G.damp(this.musicI, clamp(inten, 0, 1), 1.1, dt);
    S.update(this.sndCars || (this.sndCars = this.cars.slice(0, 6)), { x: this.cam.pos[0], z: this.cam.pos[2], yaw: p.yaw }, dt,
      { skidVol: 0.5, intensity: this.musicI });
    /* la música: nivel ligado a la acción, sólo cuando cambia de verdad */
    const amt = 0.050 + 0.070 * this.musicI;
    if (Math.abs(amt - this._mAmt) > 0.006) {
      this._mAmt = amt;
      if (this.musicOn && !this.paused) S.setMusic(true, amt);
    }
  };
  Game.prototype.setMusic = function (on, quiet) {
    this.musicOn = !!on;
    G.store.set('cw_music', this.musicOn);
    this._mAmt = -1;
    this.sound.setMusic(this.musicOn && !this.paused, this.musicOn ? 0.068 : 0);
    if (!quiet) this.hud && this.hud.toast(this.musicOn ? 'música: sí' : 'música: no', 1.0);
  };
  Game.prototype.setMuted = function (m) {
    this.sound.setMuted(m);
    G.store.set('cw_mute', m);
    this.hud && this.hud.toast(m ? 'sonido: no' : 'sonido: sí', 1.0);
  };
  Game.prototype.togglePause = function () {
    if (!this.running) return;
    this.paused = !this.paused;
    if (this.screens) {
      if (this.paused) {
        this.screens.pauseInfo(this.hudLinesHtml());
        this.screens.show('pause');
      } else this.screens.show('');
    }
    this.sound.ok && this.sound.setMusic(!this.paused && this.musicOn, 0.055 + 0.070 * (this.musicI || 0.4));
  };
  Game.prototype.hudLinesHtml = function () {
    const p = this.player, s = p.stats, st = this.state || {};
    const gap = this.rivalGap ? this.rivalGap() : null;
    return '<div>velocidad <b>' + Math.round(p.speed * 3.6) + ' km/h</b></div>' +
      '<div>Marcha <b>' + (p.gearN || 1) + '/' + (s.gears || 5) + '</b> · ' +
      '<b>' + Math.round(p.engineRPM || 800) + '</b> rpm (' + (s.cyl || 6) + ' cil · ' + ((s.redline || 7000) / 1000) + 'k)</div>' +
      '<div>motor <b>' + ({ rwd: 'tracción trasera', fwd: 'delantera', awd: '4x4' }[s.drive] || '—') +
      '</b> · <b>' + (s.mass || 0) + ' kg</b> · frenos <b>' + Math.round((s.brake || 1) * 100) + '%</b></div>' +
      '<div>daño <b>' + Math.round(p.damage * 100) + '%</b> · derrape <b>' + Math.round(Math.abs(p.slipAngle) * 57.3) + '°</b></div>' +
      '<div>vuelta <b>' + (p.lap + 1) + '</b> · puesto <b>' + (p.place || 1) + '</b>' + (gap ? ' · ' + gap : '') + '</div>' +
      (this.modeDef.timed ? '<div>restante <b>' + G.fmtTime(Math.max(0, st.timeLimit - st.clock)) + '</b></div>' : '');
  };
  /* «a qué distancia vas del de delante/detrás», para el panel de pausa */
  Game.prototype.rivalGap = function () {
    const p = this.player;
    if (!p || p.totalProgress == null) return null;
    let ahead = null, behind = null;
    for (const c of this.cars) {
      if (c === p) continue;
      const d = (c.totalProgress || 0) - (p.totalProgress || 0);
      if (d > 0 && (ahead === null || d < ahead)) ahead = d;
      if (d < 0 && (behind === null || d > behind)) behind = d;
    }
    const f = (m) => Math.abs(m) < 1 ? Math.round(m * 1000) / 1000 + ' km' : Math.round(m) + ' m';
    return (ahead !== null ? '+' + f(ahead) : 'líder') + ' / ' + (behind !== null ? '−' + f(-behind) : 'sin perseguidor');
  };
  Game.prototype.hudLines = function () { return this.modeDef.hud ? this.modeDef.hud(this) : []; };

  G.Game = Game;

  /* ================================================================== *
   *  Arranque con interfaz
   * ================================================================== */
  G.MAP_MENU = function () {
    return G.MAPS.map(m => ({
      id: m.id, name: m.name, blurb: m.subtitle,
      time: m.props && m.props.tunnel ? 'túnel' : (m.city ? 'urbano' : (m.water ? 'mar' : 'abierto'))
    }));
  };
  G.boot = function (els) {
    const game = els.game;
    const screens = new G.Screens(els.ui, {
      start() { start(); },
      resume() { game.togglePause(); },
      restart() { game.spawn(game.lastCar, game.lastOpts); game.running = true; game.paused = false; screens.show(''); },
      cam() { game.cycleCam(); },
      menu() { game.running = false; screens.show('menu'); },
      again() { game.spawn(game.lastCar, game.lastOpts); game.running = true; screens.show(''); },
      pick() { }
    });
    screens.fill(G.MAP_MENU(), G.MODE_LIST.map(m => ({ id: m.id, name: m.name, blurb: m.blurb, info: m.info, win: m.win })),
      G.CARS.map(c => ({ id: c.id, name: c.name, blurb: c.desc, stats: c.stats })), game.records);
    screens.show('menu');
    let touch = null;
    if (G.touch) { touch = new G.TouchControls(els.hud.parentNode || document.body, game.input); touch.setVisible(true); }
    function start() {
      const ch = screens.sync() || {};
      const opts = ch.opts || {};
      const spec = G.MAPS.find(m => m.id === ch.map) || G.MAPS[0];
      const mode = MODES[ch.mode] || MODES.race;
      game.lastCar = ch.car; game.lastOpts = { laps: +opts.laps || mode.laps, color: null };
      game.setQuality(opts.quality || 'med');
      game.difficulty = parseFloat(opts.diff || '1');
      game.driftMode = opts.drift === 'auto' ? 'auto' : 'manual';
      game.opts.particles = opts.particles !== false;
      game.opts.shadows = opts.shadows !== false;
      game.setQuality(opts.quality || 'med');   /* reaplicar con las casillas ya leídas */
      game.attachMode(mode);
      game.loadMap(spec, (p, label) => { els.progress && els.progress(p, label); });
      game.spawn(ch.car, game.lastOpts);
      game.sound.resume();
      game.sound.setMuted(opts.sound === false);
      game.setMusic(opts.sound !== false && opts.music !== false, true);
      game.running = true; game.paused = false;
      screens.show('');
      els.canvas && els.canvas.focus && els.canvas.focus();
      game.hud.toast(mode.name + ' · ' + spec.name, 2.4);
    }
    game.screens = screens;
    game.startFromMenu = start;
    return { screens, touch };
  };
  /* utilidades usadas por el bootstrap */
  Game.prototype.attachMode = function (mode) {
    this.mode = mode; this.modeDef = mode;
    if (mode.id === 'drift') this.driftHud = { cur: 0, total: 0, chain: 1, tube: 0, cool: 0 };
  };
})(window.CW);
