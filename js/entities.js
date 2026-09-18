/* =====================================================================
   entities.js — Física del coche (arcade con derrape realista), IA,
   colisiones con pista/coches, partículas y efectos.
   convención: +Z adelante, +Y arriba, yaw medido desde +Z hacia +X.
   ===================================================================== */
(function (G) {
  'use strict';
  const M = G.M, clamp = G.clamp, lerp = G.lerp, G98 = 9.81;

  let uid = 0;
  function Car(def, o) {
    o = o || {};
    this.uid = uid++;
    this.def = def;
    this.stats = def.stats;
    this.color = o.color || def.color;
    this.colorLin = G.toLinear(G.hexToRgb01(this.color));
    this.name = o.name || def.name;
    this.isPlayer = !!o.isPlayer;
    this.isCop = !!o.isCop;
    this.skill = o.skill == null ? 1 : o.skill;
    /* estado */
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.vel = [0, 0, 0];        /* m/s, mundo */
    this.vf = 0; this.vr = 0;    /* velocidades locales */
    this.yawRate = 0;
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.boost = 0; this.boostFuel = 100;
    this.wheelSpin = 0; this.steerVis = 0; this.wheelLift = 0;
    this.pitch = 0; this.roll = 0; this.bounce = 0;
    this.damage = 0; this.speed = 0; this.slip = 0; this.drifting = false;
    this.onRoad = 1; this.offRoadT = 0; this.lap = 0; this.prog = 0; this.lastProg = 0;
    this.progress = 0; this.totalProgress = 0;
    this.finished = false; this.finishTime = 0; this.lapStart = 0; this.bestLap = 0;
    this.lapTimes = [];
    this.air = 0;
    this.ai = { target: 0, offset: 0, speed: 0, steer: 0, jitter: Math.random() * 10, think: 0, line: 0 };
    this.segIdx = 0; this.slipAngle = 0; this.driftHold = 0; this.driftKey = 0;
    this.gearIdx = 0; this.gearN = 1; this.shiftT = 0; this.wheelspin = 0;
    this.limitD = 0; this.limitD_lat = 0;
    this.hitTimer = 0; this.hitDir = [0, 0];
    this.engineRPM = 900;
    this.contact = [0, 0, 0];
    this.surfaceY = 0;
  }
  Car.prototype.setState = function (x, y, z, yaw) {
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    this.yaw = yaw;
    this.vel[0] = this.vel[1] = this.vel[2] = 0;
    this.vf = this.vr = this.yawRate = 0;
    this.steer = this.throttle = this.brake = this.handbrake = 0;
    this.speed = 0; this.slip = 0; this.slipAngle = 0; this.aLong = 0; this.aLat = 0; this.drifting = false;
    this.gearIdx = 0; this.gearN = 1; this.shiftT = 0; this.wheelspin = 0;
    this.driftHold = 0; this.bounce = 0;
    this.air = 0; this.boost = 0; this.hitTimer = 0;
  };

  const WHEELBASE = 2.6;

  /* ------------------------------------------------------------------ *
   *  Límite lateral LOCAL.
   *  mask.dist() mide al punto más cercano de TODA la pista: en los
   *  "cuellos" (dos tramos a ~15 m) el coche está más cerca del otro
   *  tramo que del suyo, el test del muro se apagaba y te salías del
   *  mapa. Aquí se busca el segmento más cercano DENTRO de una ventana
   *  de índices alrededor de la última posición conocida del coche, así
   *  que la distancia lateral es siempre la de su propio carril.
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   *  Caja de cambios y curva de par: cada coche tiene marcha real,
   *  límite de vueltas, nº de cilindros y tracción (rwd/fwd/awd).
   *  Sin esto, las fichas de los coches eran decorativas.
   * ------------------------------------------------------------------ */
  const GBS = new Map();
  function gearbox(s) {
    let g = GBS.get(s);
    if (g) return g;
    const n = Math.max(3, (s.gears | 0) || 5);
    const spread = 2.05 + n * 0.13;
    const ratios = [];
    for (let i = 0; i < n; i++) ratios.push(Math.pow(spread, (n - 1 - i) / (n - 1)));
    g = { n, ratios, redline: s.redline || 7000, idle: 780, topMs: (s.top || 220) / 3.6 };
    GBS.set(s, g);
    return g;
  }
  /* forma del par: un V8 llena abajo, un 3 cilindros es pico-alto y un turbo-
     híbrido estira hasta 11 000 rpm */
  function torqueK(s, u) {
    const cyl = s.cyl || 6;
    const peak = cyl >= 8 ? 0.46 : (cyl <= 4 ? 0.54 : 0.62);
    const wide = cyl >= 8 ? 0.80 : (cyl <= 4 ? 0.60 : 0.70);
    const lo = cyl >= 8 ? 0.92 : (cyl <= 4 ? 0.70 : 0.80);
    const t = lo + (1.06 - lo) * Math.max(0, 1 - Math.pow(Math.abs(u - peak) / wide, 1.7));
    return clamp(t * (s.torqueK || 1), 0.34, 1.24);
  }
  G.gearbox = gearbox; G.torqueK = torqueK;

  const L0BUF = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 };
  const L1BUF = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 };
  const L2BUF = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 };
  function limitAt(world, x, z, idx, out) {
    const o0 = out || (out = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
    const t = world.track;
    if (!t || !t.centers) { o0.d = 0; o0.i = 0; o0.nx = 0; o0.nz = 1; o0.cx = x; o0.cz = z; return o0; }
    const n = t.n, C = t.centers;
    const o = out || (out = { i: 0, d: 0, cx: 0, cz: 0, nx: 0, nz: 0, halfW: 8 });
    const sp = t.total / n;
    let bi = 0, bd = Infinity, bcx = 0, bcz = 0;
    const refine = (i0, i1, step) => {
      for (let k = i0; k <= i1; k += step) {
        const i = ((k % n) + n) % n, j = (i + 1) % n;
        const ax = C[i][0], az = C[i][1];
        const ex = C[j][0] - ax, ez = C[j][1] - az;
        const L2 = ex * ex + ez * ez || 1;
        let u = ((x - ax) * ex + (z - az) * ez) / L2;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        const px = ax + ex * u, pz = az + ez * u;
        const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = i; bcx = px; bcz = pz; }
      }
    };
    if (idx == null || !isFinite(idx)) idx = Math.round(world.mask.seg(x, z));
    refine(idx - 18, idx + 18, 1);
    /* si el resultado es dudoso (teletransporte, respawn), búsqueda global */
    if (Math.sqrt(bd) > sp * 22) { bd = Infinity; refine(0, n - 1, 2); refine(Math.max(0, bi - 3), bi + 3, 1); }
    const d = Math.sqrt(bd);
    const j = (bi + 1) % n;
    let nx = x - bcx, nz = z - bcz;
    const l = Math.hypot(nx, nz);
    if (l > 1e-5) { nx /= l; nz /= l; }
    else { nx = -(t.centers[j][1] - t.centers[bi][1]); nz = (t.centers[j][0] - t.centers[bi][0]);
      const l2 = Math.hypot(nx, nz) || 1; nx /= l2; nz /= l2; }
    o.i = bi; o.d = d; o.cx = bcx; o.cz = bcz; o.nx = nx; o.nz = nz;
    o.halfW = typeof t.halfW === 'number' ? t.halfW : world.spec.w;
    return o;
  }
  G.limitAt = limitAt;
  /* grosor de la banda de contención: hasta la cara interior de la valla */
  function wallLimit(world, opts, carHalf) {
    if (!world.track) return Infinity;
    const pr = world.spec.props || {};
    const hard = pr.rail || pr.barrierWall || pr.wallRing || pr.tunnel || opts.strictWalls;
    const half = (typeof world.track.halfW === 'number' ? world.track.halfW : world.spec.w);
    if (!hard) return half + 14;
    /* la valla está en half+1.15 y tiene ~0.3 de grosor: el LIMITE es su cara
       interior menos el semiancho del coche, para que la carrocería no la cruce
       (antes el collider era el centro del coche y el coche «atropellaba» la valla) */
    return Math.max(half * 0.55, half + 0.70 - (carHalf || 0.95));
  }

  function physics(car, world, dt, opts) {
    opts = opts || {};
    const s = car.stats, def = car.def;
    const mass = s.mass;
    const wb = def.wb || WHEELBASE;
    const top = s.top / 3.6;
    const fwd = [Math.sin(car.yaw), 0, Math.cos(car.yaw)];
    const right = [Math.cos(car.yaw), 0, -Math.sin(car.yaw)];
    /* velocidades locales (marco del coche) */
    let vf = car.vel[0] * fwd[0] + car.vel[2] * fwd[2];
    let vr = car.vel[0] * right[0] + car.vel[2] * right[2];
    const absV = Math.hypot(car.vel[0], car.vel[2]);
    /* --- superficie / agarre --- *
     * el ancho "local" del paso anterior (limitAt) es el que corresponde a su
     * propio carril; mask.dist() es la referencia global (sirve de respaldo) */
    const halfW = world.spec.w;
    const dLoc = car.limitD_lat != null && world.track ? car.limitD_lat : null;
    const dRoad = dLoc != null ? Math.min(dLoc, world.mask.dist(car.pos[0], car.pos[2]) + 40) : world.mask.dist(car.pos[0], car.pos[2]);
    const onRoad = clamp(1 - (dRoad - halfW) / 4.2, 0, 1);
    car.onRoad = onRoad;
    car.offRoadT = onRoad > 0.98 ? 0 : Math.min(2.4, car.offRoadT + dt);
    /* el barro/arena no castiga igual a un 4x4 que a un prototipo bajo */
    const muRoad = 1.66 * s.grip, muOff = 0.98 * s.grip * ((s.offRoad || 0.75) / 0.75);
    let mu = lerp(muOff, muRoad, onRoad);
    if (opts.ice) mu *= 0.45;
    const downf = 1 + s.downforce * clamp(absV / 62, 0, 1.5) * 0.5;
    const latMax = mu * G98 * downf;              /* m/s² máximo de neumático */
    /* --- ¿se rompe la tracción?  (manual: solo con la tecla) --- */
    const driftIn = Math.max(car.handbrake, car.driftKey || 0);
    const autoBreak = opts.driftAuto !== false;   /* por defecto: MANUAL */
    const slipAng = Math.abs(Math.atan2(vr, Math.max(2.5, Math.abs(vf))));
    let breaking = driftIn > 0.30;
    if (autoBreak && !breaking && car.speed > 17) {
      const latNeed = Math.abs(vf) * Math.abs((vf / Math.max(2.4, wb)) * Math.tan(car.steer * lerp(0.62, 0.20, 0.5)));
      breaking = slipAng > 0.40 || (latNeed > latMax * 1.45 && Math.abs(car.steer) > 0.62);
    }
    /* un derrape iniciado se mantiene mientras haya ángulo (transición limpia) */
    car.driftHold = breaking ? 1 : Math.max(0, (car.driftHold || 0) - dt * 2.6);
    const holdK = clamp(breaking ? 1 : (car.driftHold > 0 && slipAng > 0.22 ? 0.72 : 0), 0, 1);
    /* --- dirección --- */
    const thr = car.throttle, brk = car.brake;
    const speedK = clamp(absV / top, 0, 1);
    const agi = s.agility || 1;
    const steerMax = lerp(0.62, 0.20, Math.pow(speedK, 0.8)) * agi;
    let targetYawRate = (vf / Math.max(2.4, wb)) * Math.tan(clamp(car.steer, -1, 1) * steerMax);
    /* Límite físico de giro (círculo de fricción): yawRate máx = a_lat / v.
       Con agarre normal el coche NUNCA se pasa de ahí -> subviraje limpio. */
    const bal = s.balance || 0;
    let capK = breaking ? (1.26 + 0.36 * (s.drift || 1)) : 1.02;
    /* el reparto de par cambia cómo gira el coche:
       trasera acelera y suelta el culo, delantera acelera y se abre, 4xd plano */
    if (thr > 0.1) capK *= 1 + bal * 0.34 * thr;
    if (brk > 0.15) capK *= (s.drive === 'fwd' ? 1.12 : 0.95);
    const yawCap = (latMax * capK) / Math.max(6, Math.abs(vf));
    /* con el pie a fondo el morro/cola pesan según el reparto: un V8 trasero
       gira DE MÁS (el par vence al neumático trasero), un delantera se abre */
    const powAuth = 1 + bal * Math.max(thr, 0) * 0.62 + (s.drive === 'fwd' ? 0.10 * Math.max(thr, 0) : 0);
    targetYawRate = clamp(targetYawRate * powAuth, -yawCap, yawCap);
    /* respuesta de dirección algo más lenta: el coche no se "carga" de ángulo
       en 2 fotogramas (antes de esto, un volantazo ya era derrape) */
    const resp = clamp(5.2 - speedK * 1.4, 3.0, 5.8) * (0.80 + 0.22 * agi);
    car.yawRate = G.damp(car.yawRate, targetYawRate, resp, dt);
    /* --- caja de cambios, par motor y vueltas --- */
    const gb = gearbox(s);
    let gi = clamp(car.gearIdx | 0, 0, gb.n - 1);
    let gearTop = gb.topMs / gb.ratios[gi];
    let rpm = clamp(Math.abs(vf) / Math.max(2, gearTop) * gb.redline, gb.idle, gb.redline * 1.10);
    car.shiftT = Math.max(0, (car.shiftT || 0) - dt);
    car.shiftFx = Math.max(0, (car.shiftFx || 0) - dt * 5);   /* la ventanilla de aviso del cambio */
    if (car.shiftT <= 0) {
      const u = rpm / gb.redline;
      if (u > 0.985 && gi < gb.n - 1) { car.gearIdx = gi + 1; car.shiftT = 0.075; car.shiftFx = 1; }
      else if (u < 0.44 && gi > 0) { car.gearIdx = gi - 1; car.shiftT = 0.062; }
      gi = clamp(car.gearIdx | 0, 0, gb.n - 1);
      gearTop = gb.topMs / gb.ratios[gi];
      rpm = clamp(Math.abs(vf) / Math.max(2, gearTop) * gb.redline, gb.idle, gb.redline * 1.10);
    }
    car.gearN = gi + 1; car.engineRPM = rpm;
    const tq = torqueK(s, clamp(rpm / gb.redline, 0, 1.1));
    /* --- fuerzas longitudinales --- */
    let Fi = 0;
    const boostK = 1 + car.boost * (0.30 + 0.10 * (s.boost || 1));
    if (thr > 0) {
      /* el corte de encendido es POR MARCHA: en 1ª se acaba el empuje pronto y
         hay que cambiar (eso es lo que hace que 4, 5, 6 y 7 marchas se noten) */
      const f = 1 - Math.pow(clamp(Math.abs(vf) / Math.max(2, gearTop), 0, 1), 2) * 0.45;
      Fi += s.power * 12400 * thr * Math.pow(clamp(f, 0, 1), 0.7) * boostK * tq * (1 - clamp(car.shiftT * 6.0, 0, 0.52));
    } else if (thr < 0) {
      Fi -= s.power * 5600 * (vf > 0.6 ? 1 : clamp(1 - Math.abs(vf) / (top * 0.42), 0, 1.5)) * Math.abs(thr);
    }
    /* freno */
    if (brk > 0) {
      const bf = s.brake * 26500 * brk * (car.handbrake > 0.3 ? 0.55 : 1);
      Fi -= Math.sign(vf) * Math.min(Math.abs(vf) * mass * 2.4 + 400, bf);
    } else if (Math.abs(thr) < 0.02) {
      Fi -= Math.sign(vf) * (170 + 0.9 * mass * 0.06) * Math.min(Math.abs(vf), 3);
    }
    /* freno de mano: frena el eje trasero SÓLO si no estás acelerando (si no,
       en un arcade el truco es mano + gas para sostener el derrape) */
    if (car.handbrake > 0.3 && thr < 0.35) Fi -= Math.sign(vf) * 3400 * car.handbrake;
    /* arrastre */
    const cdA = def.style === 'proto' ? 0.42 : (def.style === 'suv' ? 1.05 : 0.62);
    Fi -= 0.5 * 1.2 * cdA * 2.1 * vf * Math.abs(vf) * 0.42;
    Fi -= 26 * vf;
    /* fuera de pista: más resistencia */
    Fi -= (1 - onRoad) * (900 + 120 * Math.abs(vf)) * Math.sign(vf);
    /* --- fuerzas laterales (los neumáticos intentan anular vr) --- */
    /* fricción lateral de las ruedas traseras: muy alta en conducciín normal
       (anula el deslizamiento en ~0.05 s) y se suelta sólo con la tecla */
    const release = clamp(0.58 + 0.24 * (s.drift || 1), 0.48, 0.92);
    /* y el eje trasero aguanta menos cuanto más par le metes (si es motriz):
       por eso el Hammer se cruza solo al acelerar y el Grizzly no */
    const rearGrip = clamp(1 - Math.max(bal, 0) * Math.max(thr, 0) * 0.40 * (s.drive === 'fwd' ? 0.35 : 1)
      + (s.drive === 'awd' ? 0.10 * Math.max(thr, 0) : 0), 0.55, 1.18);
    const gripLat = lerp(27, 18, speedK) * (1 - release * Math.max(driftIn, holdK)) * rearGrip;
    let latAcc = -vr * gripLat * (mu / 1.25);
    /* tope de fuerza lateral: muy alto en conducciín normal (la rueda trasera
       AGUANTA el régimen y no desliza) y más bajo al derrapar */
    const latCap = latMax * (breaking || holdK > 0 ? 1.18 : 2.75);
    latAcc = clamp(latAcc, -latCap, latCap);
    /* con el derrape mantenido y gas, el trompo no frena el coche: las ruedas
       deslizando "empujan" hacia delante (arcade, evita derrapes a 30 km/h) */
    if (breaking && vf > 5 && thr > 0.15) Fi += Math.min(s.power * 9600, Math.abs(latAcc) * mass * 0.40);
    /* --- tracción disponible: el círculo de fricción y el eje motriz --- *
     * si el motor pide más fuerza de la que el neumático puede meter en el
     * suelo, patina: se pierde empuje, sale humo y el coche cambia de
     * carácter (el V8 trasero no es lo mismo que el 4x4 de 2150 kg). */
    {
      const loadLat = clamp(Math.abs(latAcc) / (latMax * 1.02), 0, 1);
      let share = s.drive === 'awd' ? 0.92 : (s.drive === 'fwd' ? 0.56 - 0.08 * Math.max(thr, 0) : 0.46 + 0.12 * Math.max(thr, 0));
      /* en un derrape sostenido el par es lo que mantiene el ángulo: ahí el eje
         motriz manda aunque el neumático esté cruzado (si no, nadie derrapa) */
      if (breaking) share = Math.max(share, 0.72 + 0.06 * (s.drift || 1));
      share *= 1 + s.downforce * clamp(Math.abs(vf) / 62, 0, 1.5) * 0.20;
      /* el patinaje come agarre, pero en un arcade el freno de mano suelta el
         eje trasero sin matar el empuje (mano + gas = derrape sostenido) */
      const maxDrive = Math.max(900, mu * G98 * mass * share * (1 - 0.40 * loadLat * (breaking ? 0.45 : 1)));
      if (Fi > maxDrive) {
        const over = (Fi - maxDrive) / maxDrive;
        Fi = maxDrive * (1 - clamp(over * 0.26, 0, 0.34));
        /* por encima de un 6 % de exceso empieza a cantear; hace falta un buen
           excedente (salida en 1ª con un V8) para que patine DE VERDAD */
        car.wheelspin = G.damp(car.wheelspin || 0, clamp((over - 0.03) * 2.2, 0, 1), 15, dt);
      } else {
        car.wheelspin = G.damp(car.wheelspin || 0, 0, 7, dt);
      }
    }
    /* --- integración en marco rotatorio --- */
    const acc = Fi / mass;
    let nvf = vf + (acc + vr * car.yawRate) * dt;
    let nvr = vr + (latAcc - vf * car.yawRate) * dt;
    /* techo de velocidad: corte de encendido (más margen con nitro) */
    nvf = clamp(nvf, -top * 0.32, top * (car.boost > 0.05 ? 1.12 : 1.008));
    car.vel[0] = fwd[0] * nvf + right[0] * nvr;
    car.vel[2] = fwd[2] * nvf + right[2] * nvr;
    car.vf = nvf; car.vr = nvr;
    /* aceleraciones para la cámara (inclinación / retroceso / FOV) */
    car.aLong = G.damp(car.aLong || 0, (nvf - vf) / Math.max(1e-4, dt), 12, dt);
    car.aLat = G.damp(car.aLat || 0, latAcc, 12, dt);
    car.speed = Math.hypot(car.vel[0], car.vel[2]);
    car.slip = Math.abs(nvr) / Math.max(3, car.speed);
    car.slipAngle = Math.atan2(Math.abs(nvr), Math.max(2.5, Math.abs(nvf)));
    /* derrape "de verdad": más velocidad y más ángulo que antes (17° -> ~19°) y con input */
    car.drifting = car.speed > 9 && Math.abs(nvr) > 3.2 && car.slipAngle > 0.24 &&
      (driftIn > 0.25 || holdK > 0 || (autoBreak && car.slipAngle > 0.45));
    /* --- posición (con barrido CCD contra los límites) --- */
    const p0x = car.pos[0], p0z = car.pos[2];
    car.pos[0] += car.vel[0] * dt;
    car.pos[2] += car.vel[2] * dt;
    car.yaw += car.yawRate * dt;
    if (car.yaw > Math.PI) car.yaw -= Math.PI * 2; else if (car.yaw < -Math.PI) car.yaw += Math.PI * 2;
    /* --- altura del terreno + orientación sobre la superficie --- */
    let gy = world.height.at(car.pos[0], car.pos[2]);
    /* El relieve fuera del asfalto sube (taludes, dunas): si el coche lo sigue,
       la valla se convierte en rampa y vuelca. Se limita cuánto puede subir o
       bajar el suelo respecto a la cota de la pista en su propio segmento. */
    if (world.track) {
      const t = world.track, iA = car.segIdx | 0;
      const roadY = t.Y[iA] || 0;
      const dOff = Math.max(0, (car.limitD_lat || 0) - halfW);
      const allowUp = 0.30 + dOff * 0.55;
      if (gy > roadY + allowUp) gy = roadY + allowUp;
      else if (gy < roadY - 2.4) gy = roadY - 2.4;
    }
    /* el techo de una roca/edificio también es suelo (nunca quedar dentro) */
    if (world.solidTopAt) {
      const st = world.solidTopAt(car.pos[0], car.pos[2]);
      if (st > gy) gy = st;
    }
    const nrm = world.height.normal(car.pos[0], car.pos[2], [0, 0, 0]);
    car.surfaceY = gy;
    const targetY = gy + 0.02;
    if (car.pos[1] < targetY) {
      const pen = targetY - car.pos[1];
      car.pos[1] = lerp(car.pos[1], targetY, clamp(dt * 26, 0, 1));
      if (car.vel[1] < 0) car.vel[1] *= -0.22;
      car.air = 0;
      if (pen > 0.35) { car.bounce = clamp(pen * 1.6, 0, 1); }
    } else {
      car.pos[1] += car.vel[1] * dt;
      car.vel[1] -= 24 * dt;
      car.air = Math.min(1.6, car.air + dt);
      if (car.pos[1] > targetY + 0.001) { }
      else { car.air = 0; }
    }
    /* suelo duro: el coche no se hunde en el terreno (evita "ver el vacío") */
    if (car.pos[1] < targetY) { car.pos[1] = targetY; if (car.vel[1] < 0) car.vel[1] = 0; }
    if (car.air <= 0.01 && car.vel[1] < 0) car.vel[1] = 0;
    /* alabeo/cabeceo siguiendo la normal de la superficie + transferencia */
    const fwdSlope = (world.height.at(car.pos[0] + fwd[0] * 2.2, car.pos[2] + fwd[2] * 2.2) - world.height.at(car.pos[0] - fwd[0] * 2.2, car.pos[2] - fwd[2] * 2.2)) / 4.4;
    const rightSlope = (world.height.at(car.pos[0] + right[0] * 1.7, car.pos[2] + right[2] * 1.7) - world.height.at(car.pos[0] - right[0] * 1.7, car.pos[2] - right[2] * 1.7)) / 3.4;
    const accLat = -latAcc;
    const rideK = clamp(s.ride || 1, 0.25, 1.3);
    const transfer = clamp(-accLat * 0.011 * (0.45 + 0.75 * rideK), -0.14, 0.14);
    const transferL = clamp(-acc * 0.006, -0.07, 0.07);
    car.pitch = G.damp(car.pitch, Math.atan(fwdSlope) * 0.85 + transferL * (0.5 + 0.7 * rideK), 9, dt);
    car.roll = G.damp(car.roll, Math.atan(rightSlope) * 0.85 + transfer * rideK, 11 - 3 * rideK, dt);
    car.bounce = G.damp(car.bounce, 0, 8, dt);
    /* --- límites de pista (quitamiedos / muros), con CCD --- *
     * 1) se mide la lateral LOCAL (ventana de índices) en el punto de
     *    partida y en el de llegada del paso;
     * 2) si el segmento barrido cruza la banda, se resuelve en el punto
     *    de contacto (t por interpolación) -> no se atraviesa a ninguna
     *    velocidad ni con pasos largos;
     * 3) se refleja la componente saliente y se aplica daño/rebote.
     */
    const limitD = wallLimit(world, opts, (def.W || 1.9) * 0.47);
    const L0 = limitAt(world, p0x, p0z, car.segIdx, L0BUF);
    const L1 = limitAt(world, car.pos[0], car.pos[2], L0.i, L1BUF);
    car.segIdx = L1.i;
    car.limitD = limitD; car.limitD_lat = L1.d;
    if (L1.d > limitD) {
      let px = car.pos[0], pz = car.pos[2], nx = L1.nx, nz = L1.nz, cx = L1.cx, cz = L1.cz;
      if (L0.d > limitD) {
        /* ya estaba fuera: simplemente pegar al borde */
      } else if (L1.d > L0.d) {
        /* cruce durante el paso -> retroceder al instante de contacto */
        const u = clamp((limitD - L0.d) / (L1.d - L0.d), 0, 1);
        const s2 = limitAt(world, lerp(p0x, car.pos[0], u), lerp(p0z, car.pos[2], u), L0.i, L2BUF);
        cx = s2.cx; cz = s2.cz; nx = s2.nx; nz = s2.nz;
        px = lerp(p0x, car.pos[0], u); pz = lerp(p0z, car.pos[2], u);
      }
      /* recolocar en la cara interior del muro (banda gruesa, sin jitter) */
      const setD = limitD - 0.02;
      car.pos[0] = cx + nx * setD; car.pos[2] = cz + nz * setD;
      /* velocidad saliente a lo largo de la normal del muro */
      const vOut = car.vel[0] * nx + car.vel[2] * nz;
      if (vOut > 0) {
        const rest = 0.34;
        car.vel[0] -= nx * vOut * (1 + rest);
        car.vel[2] -= nz * vOut * (1 + rest);
        /* el roce con el muro frena y quita giro */
        car.vel[0] *= 0.93; car.vel[2] *= 0.93;
        car.yawRate *= 0.42;
        car.hitDir[0] = -nx; car.hitDir[1] = -nz;
        if (vOut > 2.5) {
          car.damage = clamp(car.damage + vOut * 0.017 * (def.stats.fragility || 1), 0, 1);
          car.hitTimer = 0.35;
          if (world.onHit) world.onHit(car, vOut, car.pos[0], car.pos[1], car.pos[2]);
        }
        car.vf = car.vel[0] * fwd[0] + car.vel[2] * fwd[2];
        car.vr = car.vel[0] * right[0] + car.vel[2] * right[2];
      }
    }
    /* --- sólidos del escenario (rocas, mesas, naves, torres, muros) --- *
     * el radio viene del bounding box del mesh visual: el collider COINCIDE
     * con lo que se ve. El barrido del segmento evita atravesarlos a 240 km/h. */
    if (world.solids && world.solids.length) {
      const near = world.solidsNear(car.pos[0], car.pos[2]);
      const carR = (def.W || 1.9) * 0.47;
      for (let si = 0; si < near.length; si++) {
        const so = near[si];
        if (car.pos[1] > so.y + so.h + 0.2) continue;
        const rr = so.r + carR;
        let sx = car.pos[0], sz = car.pos[2];
        const ex = car.pos[0] - p0x, ez = car.pos[2] - p0z;
        const L2 = ex * ex + ez * ez;
        if (L2 > 1e-6) {
          let u = ((so.x - p0x) * ex + (so.z - p0z) * ez) / L2;
          u = u < 0 ? 0 : (u > 1 ? 1 : u);
          sx = p0x + ex * u; sz = p0z + ez * u;
        }
        let dx = sx - so.x, dz = sz - so.z;
        let dd = Math.hypot(dx, dz);
        if (dd >= rr) continue;
        if (dd < 1e-4) { dx = 1; dz = 0; dd = 1; }
        const nx = dx / dd, nz = dz / dd;
        car.pos[0] += nx * (rr - dd); car.pos[2] += nz * (rr - dd);
        const vOut = car.vel[0] * nx + car.vel[2] * nz;
        if (vOut < 0) {
          car.vel[0] -= nx * vOut * 1.24; car.vel[2] -= nz * vOut * 1.24;
          car.vel[0] *= 0.82; car.vel[2] *= 0.82;
          car.yawRate *= 0.36;
          car.hitDir[0] = -nx; car.hitDir[1] = -nz;
          if (-vOut > 2.2) {
            car.damage = clamp(car.damage + (-vOut) * 0.020 * (def.stats.fragility || 1), 0, 1);
            car.hitTimer = 0.34;
            if (world.onHit) world.onHit(car, -vOut, car.pos[0], car.pos[1], car.pos[2]);
          }
        }
      }
    }
    /* caja absoluta: imposible salir del mundo (y por tanto del mapa visible) */
    {
      const B = (world.spec.world || 400) - 4;
      if (car.pos[0] > B) { car.pos[0] = B; if (car.vel[0] > 0) car.vel[0] = -car.vel[0] * 0.2; }
      else if (car.pos[0] < -B) { car.pos[0] = -B; if (car.vel[0] < 0) car.vel[0] = -car.vel[0] * 0.2; }
      if (car.pos[2] > B) { car.pos[2] = B; if (car.vel[2] > 0) car.vel[2] = -car.vel[2] * 0.2; }
      else if (car.pos[2] < -B) { car.pos[2] = -B; if (car.vel[2] < 0) car.vel[2] = -car.vel[2] * 0.2; }
    }
    car.hitTimer = Math.max(0, car.hitTimer - dt);
    /* --- ruedas / rpm --- */
    car.wheelSpin += (nvf / Math.max(0.2, def.wheelR)) * dt;
    car.steerVis = G.damp(car.steerVis, car.steer * steerMax, 13, dt);
    /* (rpm ya viene de la caja de cambios arriba; aquí sólo el ralentí) */
    if (car.throttle === 0 && car.speed < 1) car.engineRPM = gb.idle + Math.sin((car.speed + rpm) * 0.012) * 40;
    if (car.throttle === 0 && car.speed < 1) car.engineRPM = 820 + Math.sin(performance.now() * 0.012) * 40;
    /* combustible de nitro */
    if (car.boost > 0.05) car.boostFuel = Math.max(0, car.boostFuel - dt * 26);
    else car.boostFuel = Math.min(100, car.boostFuel + dt * (car.speed > 3 ? 5.2 : 2.4));
    return car;
  }

  /* ---------------- colisión entre coches ---------------- */
  function carCollisions(cars, onHit) {
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2];
        const d2 = dx * dx + dz * dz;
        const rr = 1.34 + 1.34;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const ma = a.stats.mass, mb = b.stats.mass;
        const ia = 1 / ma, ib = 1 / mb, iSum = ia + ib;
        /* separación ponderada por masa: el pesado no sale disparado igual que el ligero */
        const pen = rr - d;
        a.pos[0] -= nx * pen * (ia / iSum) * 0.92; a.pos[2] -= nz * pen * (ia / iSum) * 0.92;
        b.pos[0] += nx * pen * (ib / iSum) * 0.92; b.pos[2] += nz * pen * (ib / iSum) * 0.92;
        const rvx = b.vel[0] - a.vel[0], rvz = b.vel[2] - a.vel[2];
        const vn = rvx * nx + rvz * nz;
        const tvx = rvx - nx * vn, tvz = rvz - nz * vn;
        const tl = Math.hypot(tvx, tvz);
        if (vn < 0) {
          /* e = 0.22: rebote corto. ANTES era 1.28, o sea CADA choque añadía
             energía -> los dos coches salían despedidos y girando sin parar */
          const e = 0.22;
          const imp = -(1 + e) * vn / iSum;
          a.vel[0] -= nx * imp * ia; a.vel[2] -= nz * imp * ia;
          b.vel[0] += nx * imp * ib; b.vel[2] += nz * imp * ib;
          /* roce entre carrocerías (Coulomb, con tope): no puede invertir el
             deslizamiento relativo, así que no añade energía como añadía antes */
          if (tl > 1e-4) {
            const fr = 0.45;
            const jt = clamp((tl / iSum) * fr * 2, -fr * Math.abs(imp), fr * Math.abs(imp));
            const tx = tvx / tl, tz = tvz / tl;
            a.vel[0] += tx * jt * ia; a.vel[2] += tz * jt * ia;
            b.vel[0] -= tx * jt * ib; b.vel[2] -= tz * jt * ib;
          }
          /* par de giro: brazo × impulso / inercia (yac), acotado y amortiguado */
          const armA = (nx * Math.cos(a.yaw) - nz * Math.sin(a.yaw)) * 1.15;
          const armB = (nx * Math.cos(b.yaw) - nz * Math.sin(b.yaw)) * 1.15;
          a.yawRate = clamp(a.yawRate - armA * imp / (ma * 3.1), -1.9, 1.9) * 0.88;
          b.yawRate = clamp(b.yawRate + armB * imp / (mb * 3.1), -1.9, 1.9) * 0.88;
          /* el centro de gravedad bajo: un choque no lanza el coche hacia arriba */
          const lift = Math.min(0.35, Math.abs(vn) * 0.012);
          a.vel[1] = Math.max(a.vel[1], -lift); b.vel[1] = Math.max(b.vel[1], -lift);
          const spd = -vn;
          if (spd > 1.6) {
            a.damage = clamp(a.damage + spd * 0.010, 0, 1);
            b.damage = clamp(b.damage + spd * 0.010, 0, 1);
            a.hitTimer = b.hitTimer = 0.3;
            a.hitDir[0] = -nx; a.hitDir[1] = -nz;
            b.hitDir[0] = nx; b.hitDir[1] = nz;
            if (onHit) onHit(a, spd, (a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2, b);
          }
        } else if (tl > 0.5) {
          /* yendo pegados de lado: fricción de chasis limitada por el propio tl,
             repartida por masas (antes se aplicaba igual a ambos -> el ligero
             se disparaba) */
          const tx = tvx / tl, tz = tvz / tl;
          const jt = Math.min(tl / iSum, (tl / iSum) * 0.55);
          a.vel[0] += tx * jt * ia; a.vel[2] += tz * jt * ia;
          b.vel[0] -= tx * jt * ib; b.vel[2] -= tz * jt * ib;
          a.yawRate *= 0.94; b.yawRate *= 0.94;
        }
      }
    }
  }

  /* ================================================================== *
   *  IA: sigue la línea de carrera con lookahead y límite por curvatura
   * ================================================================== */
  function aiDrive(car, world, dt, targetSpeedK, avoidList) {
    const t = world.track, n = t.n;
    const mask = world.mask;
    const ai = car.ai;
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = 0.1 + Math.random() * 0.1;
      /* índice de camino por delante según velocidad */
      const myIdx = Math.round(mask.seg(car.pos[0], car.pos[2]));
      const look = clamp(Math.round(6 + car.speed * 0.55), 5, 34);
      ai.line = clamp(ai.line + (Math.random() - 0.5) * 0.35, -0.62, 0.62);
      ai.target = ((myIdx + look) % n + n) % n;
      ai.myIdx = myIdx;
    }
    const i = ai.target;
    /* objetivo = centro + desplazamiento hacia el interior de la curva */
    const halfW = t.spec.w * 0.62;
    const r = t.radius[i % n];
    const curb = clamp((30 - Math.min(r, 30)) / 24, 0, 1) * halfW * 0.85;
    /* hacia el interior de la curva: usamos el cambio de tangente */
    const t0 = [t.T[i * 2], t.T[i * 2 + 1]];
    const t1 = [t.T[((i + 6) % n) * 2], t.T[((i + 6) % n) * 2 + 1]];
    const cross = t0[0] * t1[1] - t0[1] * t1[0];
    const inward = Math.sign(cross) || 1;
    const off = inward * (curb + ai.line * halfW * 0.4);
    const tx = t.centers[i][0] + t.N[i * 2] * off;
    const tz = t.centers[i][1] + t.N[i * 2 + 1] * off;
    /* steering hacia el objetivo */
    const dx = tx - car.pos[0], dz = tz - car.pos[2];
    const desired = Math.atan2(dx, dz);
    let err = G.wrapPi(desired - car.yaw);
    /* esquivar al de delante */
    if (avoidList) {
      for (const o of avoidList) {
        if (o === car) continue;
        const ox = o.pos[0] - car.pos[0], oz = o.pos[2] - car.pos[2];
        const front = ox * Math.sin(car.yaw) + oz * Math.cos(car.yaw);
        const lat = ox * Math.cos(car.yaw) - oz * Math.sin(car.yaw);
        if (front > 1 && front < 13 && Math.abs(lat) < 3.4) {
          err += -Math.sign(lat || 1) * clamp((3.4 - Math.abs(lat)) / 3.4, 0, 1) * 0.42 * (1 - front / 13);
        }
      }
    }
    /* velocidad objetivo: límite por radio + pendiente */
    const rmin = Math.max(14, Math.min(r, 260));
    const cst = car.stats;
    /* cada IA conduce CON su coche: el 4x4 no le teme a la tierra, el nervioso
       de tracción trasera levanta el pie a media curva, el ágil traza más tarde */
    const mu = 1.16 * cst.grip * (car.onRoad > 0.5 ? 1 : 0.45 + 0.30 * clamp(cst.offRoad || 0.75, 0.5, 1.05));
    let vMax = Math.sqrt(Math.max(6, rmin * G98 * mu * (targetSpeedK || 0.94)));
    vMax = Math.min(vMax, cst.top / 3.6 * (targetSpeedK || 0.94));
    if (Math.abs(err) > 1.0) vMax *= 0.5;
    if (car.speed > vMax * 1.06) { car.throttle = 0; car.brake = clamp((car.speed - vMax) * (0.22 / clamp(cst.brake || 1, 0.75, 1.15)), 0, 1); car.handbrake = car.speed > vMax * 1.5 && Math.abs(err) > 0.8 && (cst.drift || 1) > 1.05 ? 0.8 : 0; }
    else { car.throttle = clamp((vMax - car.speed) * 0.5 + 0.35, 0, 1); car.brake = 0; car.handbrake = 0; }
    /* el que se suelta detrás (balance > 0.2) cuida el gas en apoyo: si no,
       los rivales irían de lado por todas partes y no se entendería nada */
    if ((cst.balance || 0) > 0.2 && Math.abs(err) > 0.30 && car.speed > vMax * 0.92) car.throttle = Math.min(car.throttle, 0.58);
    car.steer = clamp(err * 2.35 * (0.88 + 0.14 * clamp(cst.agility || 1, 0.7, 1.3)) - car.yawRate * 0.30, -1, 1);
    /* salida de derrape */
    if (Math.abs(car.vr) > 7.5) { car.throttle *= 0.45; car.brake = Math.max(car.brake, 0.15); }
    car.boost = (vMax > car.speed * 1.4 && car.boostFuel > 40 && (targetSpeedK || 1) > 0.95) ? 0.8 : 0;
  }

  /* ================================================================== *
   *  Partículas / efectos
   * ================================================================== */
  function FX(o) {
    o = o || {};
    this.max = o.max || 900;
    this.list = [];
    for (let i = 0; i < this.max; i++) this.list.push(newParticle());
    this.head = 0;
    this.rings = [];
  }
  function newParticle() {
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 2, r: 1, g: 1, b: 1, a: 1, kind: 0, roll: 0, rotV: 0, grav: -3, drag: 1.6, active: false };
  }
  FX.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, col, alpha, kind, grav, drag) {
    let p = null;
    for (let k = 0; k < this.max; k++) {
      const c = this.list[(this.head + k) % this.max];
      if (!c.active) { p = c; this.head = (this.head + k + 1) % this.max; break; }
    }
    if (!p) { p = this.list[this.head]; this.head = (this.head + 1) % this.max; }
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.max = life; p.s0 = s0; p.s1 = s1;
    p.r = col[0]; p.g = col[1]; p.b = col[2]; p.a = alpha == null ? 1 : alpha;
    p.kind = kind || 0; p.grav = grav == null ? -3 : grav; p.drag = drag == null ? 1.6 : drag;
    p.roll = Math.random() * 6.28; p.rotV = (Math.random() - 0.5) * 3.4;
    p.active = true;
    return p;
  };
  /* cambiar la calidad no debe dejar el pool más corto que this.max */
  FX.prototype.setCap = function (n) {
    n = Math.max(64, n | 0);
    this.max = n;
    const list = this.list;
    while (list.length < n) list.push(newParticle());
    if (list.length > n) {
      for (let i = n; i < list.length; i++) list[i].active = false;
      list.length = n;
    }
    this.head = this.head % n;
    return this;
  };
  FX.prototype.update = function (dt, world) {
    const n2 = Math.min(this.max, this.list.length);
    for (let i = 0; i < n2; i++) {
      const p = this.list[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy *= (p.kind === 1 ? 1.0 : d);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.roll += p.rotV * dt;
      if (p.ground && world) {
        const gy = world.height.at(p.x, p.z) + 0.03;
        if (p.y < gy) { p.y = gy; p.vy = Math.abs(p.vy) * 0.24; p.vx *= 0.72; p.vz *= 0.72; }
      }
    }
  };
  FX.prototype.emitToRenderer = function (R) {
    const n2 = Math.min(this.max, this.list.length);
    for (let i = 0; i < n2; i++) {
      const p = this.list[i];
      if (!p.active) continue;
      const t = 1 - p.life / p.max;
      const size = lerp(p.s0, p.s1, t);
      let a = p.a * (t < 0.14 ? t / 0.14 : (1 - Math.pow((t - 0.14) / 0.86, 1.6)));
      if (a <= 0.004) continue;
      R.pushParticle(p.x, p.y, p.z, size, p.r, p.g, p.b, clamp(a, 0, 1), p.roll, p.kind);
    }
  };
  FX.prototype.clear = function () { for (const p of this.list) p.active = false; };

  /* ---------- emisores ---------- */
  function tireSmoke(fx, car, world, intensity, axle) {
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
    const def = car.def;
    const lz = axle === 'f' ? def.wb / 2 : -def.wb / 2;   /* humo en el eje que patina */
    for (const side of [-1, 1]) {
      const lx = side * def.track / 2;
      const wx = car.pos[0] + lx * c + lz * s, wz = car.pos[2] - lx * s + lz * c;
      const gy = world.height.at(wx, wz) + 0.1;
      const n = intensity > 0.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const grey = car.onRoad > 0.6 ? 0.86 : 0.62;
        const col = car.onRoad > 0.6 ? [grey, grey, grey * 0.98] : [0.66, 0.58, 0.46];
        fx.spawn(
          wx + (Math.random() - 0.5) * 0.3, gy + Math.random() * 0.16, wz + (Math.random() - 0.5) * 0.3,
          -car.vel[0] * 0.12 + (Math.random() - 0.5) * 2.2,
          1.3 + Math.random() * 2.2 * intensity,
          -car.vel[2] * 0.12 + (Math.random() - 0.5) * 2.2,
          0.7 + Math.random() * 0.9, 0.5 + Math.random() * 0.5, 3.2 + Math.random() * 2.6,
          col, 0.30 + 0.4 * intensity, 0, 0.55, 1.25);
      }
    }
  }
  function sparks(fx, x, y, z, nx, nz, power) {
    const n = clamp(Math.round(power * 2.4), 3, 16);
    for (let i = 0; i < n; i++) {
      fx.spawn(x, y + 0.4 + Math.random() * 0.5, z,
        nx * (2 + Math.random() * 7) + (Math.random() - 0.5) * 4, 2 + Math.random() * 6,
        nz * (2 + Math.random() * 7) + (Math.random() - 0.5) * 4,
        0.28 + Math.random() * 0.42, 0.16, 0.02,
        [1, 0.72 + Math.random() * 0.28, 0.24], 1, 2, -16, 0.8);
    }
  }
  function debris(fx, x, y, z, power, col) {
    for (let i = 0; i < clamp(Math.round(power), 2, 10); i++) {
      const p = fx.spawn(x, y + 0.5, z, (Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8,
        0.6 + Math.random() * 0.7, 0.22, 0.05, col || [0.5, 0.5, 0.52], 1, 0, -19, 0.6);
      p.ground = true;
    }
  }
  function nitroFlame(fx, car, world) {
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
    for (const side of [-1, 1]) {
      const lx = side * 0.42, lz = -car.def.L / 2 - 0.12;
      const wx = car.pos[0] + lx * c + lz * s, wz = car.pos[2] - lx * s + lz * c;
      fx.spawn(wx, car.pos[1] + 0.3, wz,
        -s * 0 + -c * 0 + (Math.random() - 0.5) * 1.2 - car.vel[0] * 0.2,
        0.4 + Math.random() * 0.8,
        (Math.random() - 0.5) * 1.2 - car.vel[2] * 0.2,
        0.14 + Math.random() * 0.12, 0.42, 0.05,
        [1, 0.55 + Math.random() * 0.4, 0.12], 1, 2, 0.5, 3.2);
    }
  }
  function dustTrail(fx, car, world) {
    if (car.onRoad > 0.75) return;
    if (Math.random() > 0.55) return;
    const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
    const lx = (Math.random() - 0.5) * car.def.W, lz = (Math.random() - 0.5) * car.def.L * 0.4;
    const wx = car.pos[0] + lx * c + lz * s, wz = car.pos[2] - lx * s + lz * c;
    const gy = world.height.at(wx, wz);
    const dry = world.spec.ground.kind === 'sand';
    fx.spawn(wx, gy + 0.12, wz,
      (Math.random() - 0.5) * 1.8, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8,
      0.5 + Math.random() * 0.6, 0.4, 2.2,
      dry ? [0.72, 0.62, 0.46] : [0.55, 0.55, 0.5], 0.24, 0, 0.4, 1.8);
  }

  G.Car = Car;
  G.physics = physics;
  G.carCollisions = carCollisions;
  G.aiDrive = aiDrive;
  G.FX = FX;
  G.Effects = { tireSmoke, sparks, debris, nitroFlame, dustTrail };
})(window.CW);
