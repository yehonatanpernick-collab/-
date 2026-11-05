// ============================================================================
//  Flight dynamics: 6-DOF rigid body, aero coefficients, engines, landing gear,
//  fly-by-wire control laws, autopilot.
//  Body axes: +X right, +Y up, -Z forward. Rates: Q pitch-up = wx, R yaw-right = -wy, P roll-right = -wz
// ============================================================================
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const AC = {
  light: {
    id: 'light', name: 'WREN L-2', role: 'מטוס קל · חד-מנועי', build: () => buildLight(),
    mass: 1050, S: 16.2, b: 11.0, c: 1.5, I: { pitch: 1825, roll: 1285, yaw: 2667 },
    CL0: 0.32, CLa: 5.0, aStall: 15.5 * DEG, CD0: 0.032, k: 0.054, CYb: -0.31, mcrit: 0.7, wave: 0,
    flaps: { label: ['0°', '10°', '20°', '30°'], dCL: [0, 0.25, 0.5, 0.72], dCD: [0, 0.012, 0.03, 0.062], dCm: [0, -0.02, -0.04, -0.055], vmax: [999, 57, 51, 44] },
    CDg: 0, retract: false, spoilCD: 0,
    Cm0: 0.05, Cma: -1.6, Cmq: -12, Cmde: 0.55, Clb: -0.09, Clp: -0.47, Clda: 0.06, Cnb: 0.07, Cnr: -0.11, Cndr: 0.022, Cnda: -0.006, Cldr: 0.004,
    law: 'direct', propwash: 0.6,
    engine: { type: 'prop', P: 134000, eta: 0.8, T0: 3100, spool: 2.6, idle: 0.08, count: 1 },
    gear: [{ p: V3(0, -1.25, -1.6), steer: 22 * DEG, brake: false }, { p: V3(-1.2, -1.25, 0.45), brake: true }, { p: V3(1.2, -1.25, 0.45), brake: true }],
    gearK: 1050 * 9.81 / (3 * 0.12), gearTravel: 0.25,
    vsLimit: 3.8, gCrash: 7.5, vne: 84,
    hard: [V3(0, 0.05, -2.5), V3(-5.5, 1.1, -0.1), V3(5.5, 1.1, -0.1), V3(0, 1.9, 5.2)],
    soft: [V3(0, 0.15, 5.6), V3(0, -0.5, 0), V3(0, -0.45, -1.9)],
    cam: { dist: 13, height: 2.6 }, spec: { vmax: '125 kt', span: '11.0 מ׳', mass: '1,050 ק״ג' }, vRef: 33, vCruise: 55,
  },
  fighter: {
    id: 'fighter', name: 'ARROWHEAD FX', role: 'מטוס קרב · מבער אחורי', build: () => buildFighter(),
    mass: 12000, S: 27.9, b: 9.96, c: 3.45, I: { pitch: 75674, roll: 12875, yaw: 85552 },
    CL0: 0.05, CLa: 3.6, aStall: 30 * DEG, CD0: 0.021, k: 0.12, CYb: -0.6, mcrit: 0.9, wave: 0.035,
    flaps: { label: ['UP', 'T/O'], dCL: [0, 0.22], dCD: [0, 0.02], dCm: [0, -0.01], vmax: [999, 160] },
    CDg: 0.02, retract: true, spoilCD: 0.07,
    Cm0: 0.0, Cma: -0.35, Cmq: -5, Cmde: 0.45, Clb: -0.05, Clp: -0.35, Clda: 0.07, Cnb: 0.12, Cnr: -0.35, Cndr: 0.05, Cnda: -0.002, Cldr: 0.002,
    law: 'gcmd', gMax: 9, gMin: -3, aMax: 25 * DEG, Pmax: 4.0, Qmax: 0.6,
    engine: { type: 'jet', T: 76000, Tab: 127000, spool: 1.0, idle: 0.05, count: 1, ab: true },
    gear: [{ p: V3(0, -2.0, -4.3), steer: 32 * DEG, brake: false }, { p: V3(-1.25, -2.0, 0.65), brake: true }, { p: V3(1.25, -2.0, 0.65), brake: true }],
    gearK: 12000 * 9.81 / (3 * 0.16), gearTravel: 0.35,
    vsLimit: 7.2, gCrash: 13, vne: 900,
    hard: [V3(0, -0.08, -8.2), V3(-5.0, -0.12, 1.3), V3(5.0, -0.12, 1.3), V3(0, 3.5, 6.1)],
    soft: [V3(0, -0.45, 7.2), V3(0, -1.3, -1.0), V3(0, -1.1, 4.8)],
    cam: { dist: 19, height: 4.0 }, spec: { vmax: 'M 1.9', span: '9.96 מ׳', mass: '12,000 ק״ג' }, vRef: 78, vCruise: 230, hook: true,
  },
  airliner: {
    id: 'airliner', name: 'MERIDIAN M-200', role: 'מטוס נוסעים · דו-מנועי', build: () => buildAirliner(),
    mass: 64000, S: 122.6, b: 34.1, c: 4.2, I: { pitch: 4.5e6, roll: 2.6e6, yaw: 6.8e6 },
    CL0: 0.28, CLa: 5.3, aStall: 14.5 * DEG, CD0: 0.0215, k: 0.043, CYb: -0.7, mcrit: 0.76, wave: 0.05,
    flaps: { label: ['0', '1', '2', '3', 'FULL'], dCL: [0, 0.35, 0.6, 0.85, 1.1], dCD: [0, 0.012, 0.025, 0.045, 0.075], dCm: [0, -0.01, -0.02, -0.03, -0.04], vmax: [999, 118, 103, 95, 91] },
    CDg: 0.018, retract: true, spoilCD: 0.08, spoilCL: -0.45,
    Cm0: 0.04, Cma: -1.1, Cmq: -22, Cmde: 0.6, Clb: -0.16, Clp: -0.38, Clda: 0.07, Cnb: 0.16, Cnr: -0.26, Cndr: 0.075, Cnda: -0.003, Cldr: 0.004,
    law: 'normal', Pmax: 0.27, Qmax: 0.14, bankHold: 33 * DEG, bankMax: 67 * DEG, pitchMax: 30 * DEG, pitchMin: -15 * DEG, aMax: 12.5 * DEG,
    engine: { type: 'jet', T: 240000, spool: 0.4, idle: 0.06, count: 2, rev: 0.4 },
    gear: [{ p: V3(0, -4.0, -12.9), steer: 60 * DEG, brake: false }, { p: V3(-3.8, -4.0, 1.2), brake: true }, { p: V3(3.8, -4.0, 1.2), brake: true }],
    gearK: 64000 * 9.81 / (3 * 0.18), gearTravel: 0.45,
    vsLimit: 3.9, gCrash: 4.6, vne: 190,
    hard: [V3(0, -0.45, -18.7), V3(-17.3, 0.2, 2.9), V3(17.3, 0.2, 2.9), V3(0, 7.9, 17)],
    soft: [V3(0, -1.45, 13.2), V3(0, -2.05, -2), V3(-5.9, -3.55, -6.5), V3(5.9, -3.55, -6.5)],
    cam: { dist: 58, height: 11 }, spec: { vmax: 'M 0.82', span: '34.1 מ׳', mass: '64,000 ק״ג' }, vRef: 70, vCruise: 220,
  },
};

class FlightModel {
  constructor(def) {
    this.d = def;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3();
    this.in = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
    this.flap = 0; this.flapPos = 0; this.gearDown = true; this.gearPos = 1; this.parking = false; this.spoilers = 0; this.spoilerPos = 0;
    this.reverse = false; this.hook = false; this.hookPos = 0; this.trim = 0; this.n = def.engine.idle; this.ab = 0;
    this.ap = null; this.surf = { e: 0, a: 0, r: 0 };
    this.wow = false; this.contacts = def.gear.map(() => ({ pen: 0, on: false, spin: 0, load: 0 }));
    this.tele = {}; this.events = []; this.crashed = null; this.caught = false; this.cat = null;
    this.gmax = 1; this.nz = 1; this.lastTouch = null; this.airTime = 0;
  }
  place(pos, hdgDeg, speed, pitchDeg = 0) {
    this.pos.copy(pos); this.q.setFromEuler(new THREE.Euler(pitchDeg * DEG, -hdgDeg * DEG, 0, 'YXZ'));
    this.vel.set(0, 0, -speed).applyQuaternion(this.q); this.w.set(0, 0, 0); this.crashed = null; this.caught = false; this.cat = null; this.gmax = 1;
    this.n = speed > 30 ? 0.75 : this.d.engine.idle;
  }
  // Euler angles for HUD/AP
  attitude() {
    const f = V3(0, 0, -1).applyQuaternion(this.q), r = V3(1, 0, 0).applyQuaternion(this.q), u = V3(0, 1, 0).applyQuaternion(this.q);
    const pitch = Math.asin(clamp(f.y, -1, 1)); const hdg = Math.atan2(f.x, -f.z); const roll = Math.atan2(-r.y, u.y);
    return { pitch, hdg: (hdg * RAD + 360) % 360, roll, f, r, u };
  }
  step(dt, W) {
    if (this.crashed) return;
    const d = this.d, m = d.mass;
    const alt = this.pos.y; const rho = 1.225 * Math.exp(-alt / 8500); const sigma = rho / 1.225;
    const qInv = this.q.clone().invert();
    const air = this.vel.clone().sub(W.wind);
    const vb = air.clone().applyQuaternion(qInv);
    const V = Math.max(vb.length(), 0.01);
    const u = -vb.z;
    const alpha = Math.atan2(-vb.y, Math.max(u, 0.1));
    const beta = Math.asin(clamp(vb.x / V, -1, 1));
    const Vd = Math.max(V, 8);
    const Q = this.w.x, R = -this.w.y, P = -this.w.z;
    const qbar = 0.5 * rho * V * V;
    const sos = 340 - Math.min(alt, 11000) * 0.004; const mach = V / sos;
    // ---- flaps, gear, spoilers actuation
    this.flapPos = damp(this.flapPos, this.flap, 0.9, dt);
    if (d.retract) this.gearPos = clamp(this.gearPos + (this.gearDown ? 1 : -1) * dt / 5, 0, 1);
    this.spoilerPos = damp(this.spoilerPos, this.spoilers, 4, dt);
    this.hookPos = damp(this.hookPos, this.hook ? 1 : 0, 3, dt);
    const fi = Math.floor(this.flapPos), ff = this.flapPos - fi, fi2 = Math.min(fi + 1, d.flaps.dCL.length - 1);
    const fl = (arr) => lerp(arr[fi], arr[fi2], ff);
    const dCLf = fl(d.flaps.dCL), dCDf = fl(d.flaps.dCD), dCmf = fl(d.flaps.dCm);
    // ---- engine
    const E = d.engine; let thrust = 0; const thr = this.in.throttle;
    let target = thr, abT = 0;
    if (E.ab) { target = Math.min(thr / 0.9, 1); abT = thr > 0.9 ? (thr - 0.9) / 0.1 : 0; }
    target = Math.max(target, E.idle);
    const rate = E.spool * (target > this.n ? (0.4 + this.n) : 1.2);
    this.n += clamp(target - this.n, -rate * dt, rate * dt);
    this.ab = damp(this.ab, this.n > 0.95 ? abT : 0, 3, dt);
    if (E.type === 'prop') {
      const Pw = E.P * (0.04 + 0.96 * this.n) * sigma; const V0 = (E.P * E.eta) / E.T0;
      thrust = (Pw * E.eta) / Math.sqrt(u * u + V0 * V0) * Math.sign(this.n);
      this.rpm = 650 + 2050 * this.n + Math.max(0, u - 30) * 6;
    } else {
      thrust = E.T * (E.idle * 0.6 + (1 - E.idle * 0.6) * Math.pow(this.n, 1.7)) * Math.pow(sigma, 0.75) * (1 + 0.15 * Math.min(mach, 1.2));
      if (E.ab) thrust += this.ab * (E.Tab - E.T) * Math.pow(sigma, 0.7) * (1 + 0.3 * Math.min(mach, 1.5));
      if (this.reverse && E.rev && this.wow) thrust = -thrust * E.rev * (this.n > 0.3 ? 1 : 0.3);
    }
    // ---- ground effect
    const hAGL = Math.max(0.5, alt - W.groundH - 2);
    const geX = 16 * hAGL / d.b; const ge = (geX * geX) / (1 + geX * geX);
    const geCL = 1 + 0.12 * (1 - ge);
    // ---- lift
    const aS = d.aStall - this.flapPos * 0.6 * DEG;
    const clLin = (a) => d.CL0 + d.CLa * a + dCLf;
    let CL, stall = 0;
    const aNeg = -d.aStall * 0.8;
    if (alpha > aS) { const over = alpha - aS; stall = smoothstep(0, 4 * DEG, over); CL = lerp(clLin(aS) * (1 - 0.3 * smoothstep(0, 8 * DEG, over)), 1.15 * Math.sin(2 * alpha), smoothstep(8 * DEG, 28 * DEG, over)); }
    else if (alpha < aNeg) { const over = aNeg - alpha; stall = smoothstep(0, 4 * DEG, over); CL = lerp(clLin(aNeg) * (1 - 0.3 * smoothstep(0, 8 * DEG, over)), 1.15 * Math.sin(2 * alpha), smoothstep(8 * DEG, 28 * DEG, over)); }
    else CL = clLin(alpha);
    if (u < 0) CL = 1.1 * Math.sin(2 * alpha) * 0.5; // tail-first
    CL *= geCL;
    CL += (d.spoilCL || 0) * this.spoilerPos;
    // buffet/wing drop near stall
    this.stallLevel = stall; this.stallWarn = alpha > aS - 2.5 * DEG && !this.wow;
    // ---- drag
    let CD = d.CD0 + d.k * ge * Math.min(CL * CL, 4) + dCDf + d.CDg * this.gearPos + d.spoilCD * this.spoilerPos + 1.2 * Math.pow(Math.sin(Math.abs(alpha)), 2) * (Math.abs(alpha) > aS ? 1 : 0.15);
    CD += d.wave * smoothstep(d.mcrit, d.mcrit + 0.2, mach) + d.wave * 0.6 * smoothstep(1.0, 1.6, mach) * 0;
    CD += Math.abs(beta) * 0.15;
    const CY = d.CYb * beta;
    // ---- forces in body frame
    const velDir = vb.clone().divideScalar(V);
    const yb = V3(0, 1, 0), xb = V3(1, 0, 0);
    const liftDir = yb.clone().addScaledVector(velDir, -yb.dot(velDir)).normalize();
    const sideDir = xb.clone().addScaledVector(velDir, -xb.dot(velDir)).normalize();
    const qS = qbar * d.S;
    const Fb = new THREE.Vector3();
    if (V > 0.5) { Fb.addScaledVector(liftDir, qS * CL); Fb.addScaledVector(velDir, -qS * CD); Fb.addScaledVector(sideDir, qS * CY); }
    Fb.z -= thrust;
    // ---- control laws
    const att = this.attitude();
    const c = this.controlLaw(dt, { V: Vd, qbar, alpha, beta, P, Q, R, att, mach });
    this.surf.e = damp(this.surf.e, c.e, 18, dt); this.surf.a = damp(this.surf.a, c.a, 18, dt); this.surf.r = damp(this.surf.r, c.r, 14, dt);
    const de = this.surf.e, da = this.surf.a, dr = this.surf.r;
    // ---- moments (as angular accelerations)
    const qwash = qbar + (d.propwash || 0) * Math.max(thrust, 0) / d.S;
    const qSc = qbar * d.S * d.c, qSb = qbar * d.S * d.b;
    const qSc_e = qwash * d.S * d.c, qSb_r = qwash * d.S * d.b;
    let Cm = d.Cm0 + this.trim + d.Cma * clamp(alpha, -0.6, 0.6) + d.Cmq * Q * d.c / (2 * Vd) + dCmf - 0.06 * stall;
    let Qdot = (qSc * Cm + qSc_e * d.Cmde * de) / d.I.pitch;
    let Pdot = (qSb * (d.Clb * beta + d.Clp * P * d.b / (2 * Vd) + d.Clda * da + d.Cldr * dr)) / d.I.roll;
    let Rdot = (qSb * (d.Cnb * beta + d.Cnr * R * d.b / (2 * Vd) + d.Cnda * da) + qSb_r * d.Cndr * dr) / d.I.yaw;
    // stall wing drop & buffet
    if (stall > 0 && !this.wow) { const t = W.time; Pdot += stall * (Math.sin(t * 1.7) * 0.8 + Math.sin(t * 5.3) * 0.4) * qSb * 0.02 / d.I.roll; Qdot += Math.sin(t * 31) * stall * 0.6; }
    // prop torque / p-factor (left-turning tendency)
    if (E.type === 'prop') Rdot -= thrust * 0.025 / d.I.yaw * (1 - smoothstep(20, 60, u)) * 1.0;
    // aerodynamic damping when very slow (prevents spin-up on the ground)
    const angAcc = V3(Qdot, -Rdot, -Pdot);
    // ---- ground contacts
    const Fw = Fb.clone().applyQuaternion(this.q);
    const tauB = new THREE.Vector3();
    this.wow = false; let touchVs = 0, newTouch = false;
    const wWorld = this.w.clone().applyQuaternion(this.q);
    const gearOK = this.gearPos > 0.98;
    const share = m / d.gear.length;
    const kG = d.gearK, cG = 1.6 * Math.sqrt(kG * share);
    d.gear.forEach((g, i) => {
      const C = this.contacts[i]; C.on = false; C.load = 0;
      if (!gearOK) { C.pen = 0; return; }
      const r = g.p.clone().applyQuaternion(this.q); const pW = r.clone().add(this.pos);
      const gr = groundAt(pW.x, pW.z); const pen = gr.h - pW.y;
      if (pen <= 0) { C.pen = 0; C.wasOn = false; return; }
      if (gr.water) { this.crash('נגיעה במים', 'water'); return; }
      const vP = this.vel.clone().add(wWorld.clone().cross(r));
      if (!C.wasOn) { newTouch = true; touchVs = Math.min(touchVs, vP.y); }
      C.wasOn = true; C.on = true; C.pen = pen; this.wow = true;
      let N = kG * Math.min(pen, d.gearTravel * 1.4) - cG * vP.y; if (pen > d.gearTravel * 1.4) N += kG * 6 * (pen - d.gearTravel * 1.4);
      N = Math.max(N, 0); C.load = N;
      let steer = 0;
      if (g.steer) { const sf = lerp(1, 0.12, smoothstep(5, 35, Math.abs(u))); steer = this.in.yaw * g.steer * sf; }
      const fB = V3(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.q); fB.y = 0; fB.normalize();
      const lat = V3(fB.z, 0, -fB.x);
      const vLong = vP.dot(fB), vLat = vP.dot(lat);
      const brake = g.brake ? Math.max(this.in.brake, this.parking ? 1 : 0) : 0;
      const mu = 0.018 + brake * 0.62 * (gr.deck ? 1.1 : 1);
      const Flong = -clamp(vLong * share * 6, -mu * N, mu * N);
      const Flat = -clamp(vLat * share * 14, -0.75 * N, 0.75 * N);
      const F = V3(0, N, 0).addScaledVector(fB, Flong).addScaledVector(lat, Flat);
      Fw.add(F);
      tauB.add(r.clone().cross(F).applyQuaternion(qInv));
      C.spin = vLong;
    });
    // soft contacts (tail, belly, pods): skid with friction; hard contacts: crash
    const cpoint = (p, soft) => {
      const r = p.clone().applyQuaternion(this.q); const pW = r.clone().add(this.pos);
      const gr = groundAt(pW.x, pW.z); const pen = gr.h - pW.y; if (pen <= 0) return;
      const vP = this.vel.clone().add(wWorld.clone().cross(r));
      if (gr.water) { if (this.vel.length() > 3) this.crash('נגיעה במים', 'water'); return; }
      if (!soft) { if (this.vel.length() > 9 || pen > 0.5) this.crash('פגיעה בקרקע', 'ground'); return; }
      if (vP.y < -3.2) { this.crash('פגיעה קשה בגוף המטוס', 'ground'); return; }
      const N = Math.max(0, kG * 2 * pen - cG * 2 * vP.y);
      const vh = V3(vP.x, 0, vP.z); const sp = vh.length();
      const F = V3(0, N, 0); if (sp > 0.01) F.addScaledVector(vh, -Math.min(0.45 * N, sp * share * 6) / sp);
      Fw.add(F); tauB.add(r.clone().cross(F).applyQuaternion(qInv)); this.scrape = Math.max(this.scrape || 0, Math.min(1, sp / 30)); this.wow = true;
      if (!this.wasScrape) this.events.push({ t: 'scrape' }); this.wasScrape = 2;
    };
    this.scrape = 0;
    for (const p of d.hard) cpoint(p, false);
    for (const p of d.soft) cpoint(p, true);
    if (!gearOK) for (const g of d.gear) cpoint(g.p.clone().multiply(V3(1, 0.3, 1)), true);
    if (this.wasScrape > 0) this.wasScrape--;
    if (this.crashed) return;
    // obstacles
    const ob = hitObstacle(this.pos.x, this.pos.y - 1, this.pos.z);
    if (ob) { this.crash('התנגשות במבנה', 'ground'); return; }
    // ---- carrier: arrestor wire and catapult
    if (this.d.hook && this.hookPos > 0.8 && !this.caught && this.wow && onCarrierDeck(this.pos.x, this.pos.z)) {
      const { lz } = carrierLocal(this.pos.x, this.pos.z);
      if (lz > 55 && lz < 130 && this.vel.length() > 12) { this.caught = true; this.events.push({ t: 'trap', wire: lz > 104 ? 1 : lz > 92 ? 2 : lz > 80 ? 3 : 4 }); }
    }
    if (this.caught) {
      const sp = this.vel.length();
      if (sp > 0.5) Fw.addScaledVector(this.vel.clone().normalize(), -Math.min(m * 32, m * sp * 6));
      if (sp < 0.4) { this.caught = sp < 0.4 && this.hook ? 'stopped' : this.caught; }
    }
    if (this.cat) {
      this.cat.t += dt;
      if (this.cat.state === 'hold') { Fw.x = 0; Fw.z = 0; this.vel.x = 0; this.vel.z = 0; }
      if (this.cat.state === 'fire') {
        const fwd = V3(0, 0, -1).applyQuaternion(this.q); fwd.y = 0; fwd.normalize();
        Fw.addScaledVector(fwd, m * (this.cat.accel || 30));
        const { lz } = carrierLocal(this.pos.x, this.pos.z);
        if (lz < -WORLD.carrier.len / 2 + 4 || this.cat.t > 4) { this.cat = null; this.events.push({ t: 'catend' }); }
      }
    }
    // ---- integrate
    const acc = Fw.divideScalar(m); acc.y -= G0;
    // specific force for g-meter (exclude gravity)
    const fs = acc.clone(); fs.y += G0; this.nz = fs.clone().applyQuaternion(qInv).y / G0;
    this.vel.addScaledVector(acc, dt); this.pos.addScaledVector(this.vel, dt);
    angAcc.x += tauB.x / d.I.pitch; angAcc.y += tauB.y / d.I.yaw; angAcc.z += tauB.z / d.I.roll;
    // extra rotational damping on ground (tyre scrub)
    if (this.wow) { angAcc.y -= this.w.y * 2.5; angAcc.z -= this.w.z * 1.5; }
    this.w.addScaledVector(angAcc, dt);
    const wl = this.w.length();
    if (wl > 1e-6) { const dq = new THREE.Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt); this.q.multiply(dq).normalize(); }
    if (this.cat && this.cat.state === 'hold') this.w.set(0, 0, 0);
    // ---- events, limits
    if (newTouch && this.airTime > 1.5) {
      const vs = -touchVs; this.lastTouch = { vs, t: W.time };
      this.events.push({ t: 'touch', vs, g: this.nz });
      if (vs > d.vsLimit) this.crash(`נחיתה קשה מדי — קצב שקיעה ${Math.round(vs * FPM)} רגל/דקה`, 'ground');
    }
    this.airTime = this.wow ? 0 : this.airTime + dt;
    if (Math.abs(this.nz) > this.gmax) this.gmax = Math.abs(this.nz);
    if (!this.wow && Math.abs(this.nz) > d.gCrash) this.crash(`כשל מבני — עומס של ${this.nz.toFixed(1)}G`, 'air');
    if (V > d.vne * 1.25) this.crash('כשל מבני — מהירות מעל המותר', 'air');
    // telemetry
    Object.assign(this.tele, { V, ias: V * Math.sqrt(sigma), alpha, beta, mach, thrust, rho, qbar, CL, alt, P, Q, R, att, de, da, dr, gs: Math.hypot(this.vel.x, this.vel.z), vs: this.vel.y });
  }
  crash(why, kind) { if (this.crashed) return; this.crashed = { why, kind }; this.events.push({ t: 'crash', why, kind }); }

  controlLaw(dt, s) {
    const d = this.d, I = this.in; const { V, qbar, alpha, beta, P, Q, R, att } = s;
    let pitch = I.pitch, roll = I.roll, yaw = I.yaw;
    if (this.ap) { const o = this.autopilot(dt, s); pitch = o.pitch; roll = o.roll; if (o.yaw !== undefined) yaw += o.yaw; }
    if (d.law === 'direct' || this.wow || V < 25) {
      return { e: clamp(pitch, -1, 1), a: clamp(roll, -1, 1), r: clamp(yaw, -1, 1) };
    }
    // dynamic inversion helpers
    const qSc = qbar * d.S * d.c, qSb = qbar * d.S * d.b;
    const fi = Math.floor(this.flapPos), dCmf = d.flaps.dCm[fi] || 0;
    const QdotRest = qSc * (d.Cm0 + this.trim + d.Cma * alpha + d.Cmq * Q * d.c / (2 * V) + dCmf) / d.I.pitch;
    const QdotPer = (qSc * d.Cmde) / d.I.pitch;
    const PdotRest = qSb * (d.Clb * beta + d.Clp * P * d.b / (2 * V)) / d.I.roll;
    const PdotPer = (qSb * d.Clda) / d.I.roll;
    const phi = att.roll, th = att.pitch;
    let Qcmd, Pcmd;
    const turnComp = clamp(R * Math.tan(clamp(phi, -1.2, 1.2)), -0.5, 0.5) * Math.cos(phi) + G0 / V * (1 - Math.cos(phi)) * 0.0;
    if (d.law === 'gcmd') {
      const nzCmd = pitch >= 0 ? 1 + pitch * (d.gMax - 1) : 1 + pitch * (1 - d.gMin);
      // pitch-rate needed for load factor (in the body frame), plus attitude-hold term when hands off
      const QforG = (nzCmd - Math.cos(th) * Math.cos(phi)) * G0 / V;
      const handsOff = Math.abs(pitch) < 0.02 && Math.abs(phi) < 35 * DEG;
      if (!handsOff) this._holdTh = undefined; else if (this._holdTh === undefined) this._holdTh = th;
      Qcmd = handsOff ? turnComp + (this._holdTh - th) * 1.2 : QforG + 0.06 * (nzCmd - this.nz);
      Qcmd = clamp(Qcmd, -d.Qmax, d.Qmax);
      if (this.nz > d.gMax && Qcmd > 0) Qcmd = Math.min(Qcmd, Q - (this.nz - d.gMax) * 0.2);
      if (alpha > d.aMax) Qcmd = Math.min(Qcmd, -(alpha - d.aMax) * 3);
      Pcmd = roll * d.Pmax * clamp(qbar / 6000, 0.3, 1);
    } else { // airliner normal law
      Qcmd = pitch * d.Qmax;
      if (Math.abs(pitch) < 0.02) { if (this._holdTh === undefined) this._holdTh = th; Qcmd = turnComp + (this._holdTh - th) * 0.8; } else this._holdTh = undefined;
      if (th > d.pitchMax) Qcmd = Math.min(Qcmd, -(th - d.pitchMax) * 1.5);
      if (th < d.pitchMin) Qcmd = Math.max(Qcmd, (d.pitchMin - th) * 1.5);
      if (alpha > d.aMax) { Qcmd = Math.min(Qcmd, -(alpha - d.aMax) * 2.5); this._holdTh = undefined; }
      Qcmd = clamp(Qcmd, -d.Qmax * 1.2, d.Qmax * 1.2);
      Pcmd = roll * d.Pmax;
      if (Math.abs(roll) < 0.02) { if (Math.abs(phi) > d.bankHold) Pcmd = -(phi - Math.sign(phi) * d.bankHold) * 0.6; else Pcmd = -P * 0; }
      if (Math.abs(phi) > d.bankMax && Math.sign(Pcmd) === Math.sign(phi)) Pcmd = -(phi - Math.sign(phi) * d.bankMax) * 2;
    }
    const e = (6 * (Qcmd - Q) - QdotRest) / QdotPer;
    const a = (7 * (Pcmd - P) - PdotRest) / PdotPer;
    const r = clamp(yaw + beta * 3.5, -1, 1);
    return { e: clamp(e, -1, 1), a: clamp(a, -1, 1), r };
  }

  engageAP() {
    const t = this.tele; if (!t.att) return;
    this.ap = { alt: this.pos.y, hdg: t.att.hdg, spd: t.ias, ei: 0 };
  }
  autopilot(dt, s) {
    const ap = this.ap, att = s.att, d = this.d;
    // heading -> bank
    const herr = wrapPi((ap.hdg - att.hdg) * DEG);
    const bankT = clamp(herr * 1.6, -25 * DEG, 25 * DEG);
    // altitude -> vertical speed -> pitch
    const vsT = clamp((ap.alt - this.pos.y) * 0.12, -9, 9);
    const gamma = Math.asin(clamp(this.vel.y / Math.max(this.vel.length(), 1), -1, 1));
    const gammaT = Math.asin(clamp(vsT / Math.max(this.vel.length(), 30), -0.25, 0.25));
    const thT = att.pitch + (gammaT - gamma);
    let pitch, roll;
    if (d.law === 'direct') {
      ap.ei = clamp(ap.ei + (gammaT - gamma) * dt * 0.8, -0.4, 0.4);
      pitch = clamp((gammaT - gamma) * 6 + ap.ei - s.Q * 1.5, -0.5, 0.5);
      roll = clamp((bankT - att.roll) * 2.2 - s.P * 0.6, -0.5, 0.5);
    } else {
      pitch = clamp(((thT - att.pitch) * 1.6) / (d.Qmax || 0.3) * 0.5 - (d.law === 'gcmd' ? 0 : 0), -0.6, 0.6);
      if (d.law === 'gcmd') pitch = clamp((gammaT - gamma) * 1.6, -0.25, 0.25);
      roll = clamp(((bankT - att.roll) * 1.2) / (d.Pmax || 1), -0.8, 0.8);
    }
    // autothrottle
    const spdErr = ap.spd - s.V * Math.sqrt(this.tele.rho ? this.tele.rho / 1.225 : 1);
    this.in.throttle = clamp(this.in.throttle + spdErr * dt * 0.05, d.engine.ab ? 0 : 0, d.engine.ab ? 0.9 : 1);
    return { pitch, roll };
  }
}
