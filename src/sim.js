// HYPERPONG — simulation core. Pure JS: no DOM, no three.js.
// Space is a straight box tunnel: x in [-hw, hw], y in [-hh, hh],
// z from 0 (your paddle) to -L (the enemy paddle). The visual warping is fake;
// the mechanics below are real physics: black-hole gravity, wormholes,
// quantum ghost balls and rotating gravity.

export const DT = 1 / 120;
export const BALL_R = 0.2;
export const PW = 1.25;
export const PH = 0.9;
export const PORTAL_R = 0.82;
export const BH_R = 0.3;

const SPIN_DECAY = 0.42;
const SPIN_K = 0.3;
const SPIN_MAX = 6;
const DEFLECT = 2.8;
const VLAT_MAX = 14;
const GM = 15;
const BH_EPS2 = 0.15;
const GRAV = 5.2;
const BOLT_SPEED = 9;
const POOL = ['twist', 'bh', 'quantum', 'portals', 'gravity'];

let nextId = 1;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

export function gauss() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makePad() {
  return {
    x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0,
    errX: 0, errY: 0, aimX: 0, aimY: 0, predX: 0, predY: 0, predT: 0, seen: -1,
    stun: 0, immune: 0, boltT: 5, serveX: 0, serveY: 0,
  };
}

function mkBall(o) {
  return Object.assign({
    id: nextId++, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, px: 0, py: 0, pz: 0,
    owner: 'p', held: null, ghost: false, gid: 0, alive: true, passP: false, passA: false,
    flash: 0, rot: 0, tele: 0, inBH: false, sim: false,
  }, o);
}

export function createWorld(dim) {
  const W = {
    t: 0, dim, hw: dim.W / 2, hh: dim.H / 2, L: dim.L,
    balls: [], bolts: [], ai: makePad(), lastP: null,
    mech: { twist: false, bh: false, quantum: false, portals: false, gravity: false, bolts: false, chaos: false },
    bh: { x: 0, y: 0, z: -dim.L / 2 },
    portals: [{ x: 0, y: 0, z: -dim.L * 0.3 }, { x: 0, y: 0, z: -dim.L * 0.7 }],
    grav: { ang: 0, from: 0, to: 0, k: 1, timer: 8, warned: false },
    qgid: 0, rally: 0, hitCount: 0, speedNow: dim.speed,
    live: false, holdNear: false, missZ: 2.0, pSpin: 0,
  };
  setMech(W, dim.mech);
  updateMechanics(W, 0, null);
  return W;
}

export function setMech(W, m) {
  const g = W.mech;
  const wasGrav = g.gravity;
  g.twist = !!m.twist;
  g.bh = !!m.bh;
  g.quantum = !!m.quantum;
  g.portals = !!m.portals;
  g.gravity = !!m.gravity;
  g.bolts = !!m.bolts;
  g.chaos = !!m.chaos;
  const gr = W.grav;
  if (wasGrav && !g.gravity) {
    // roll the world back upright
    gr.from = gr.ang;
    gr.to = Math.round(gr.ang / (Math.PI * 2)) * Math.PI * 2;
    gr.k = 0;
  }
  if (!wasGrav && g.gravity) {
    gr.timer = 7;
    gr.warned = false;
  }
}

// Singularity / endless: pick `count` random rule-breakers for the next point.
export function mutate(W, count) {
  const picks = POOL.slice().sort(() => Math.random() - 0.5).slice(0, count);
  const m = { chaos: true, bolts: W.mech.bolts };
  for (const p of picks) m[p] = true;
  setMech(W, m);
  return picks;
}

function ease(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function updateMechanics(W, dt, ev) {
  const t = W.t;
  W.bh.x = Math.sin(t * 0.31) * W.hw * 0.42;
  W.bh.y = Math.cos(t * 0.23 + 0.7) * W.hh * 0.42;
  W.bh.z = -W.L * 0.5 + Math.sin(t * 0.17) * W.L * 0.14;

  const pxr = Math.max(0, W.hw - PORTAL_R - 0.12);
  const pyr = Math.max(0, W.hh - PORTAL_R - 0.12);
  const A = W.portals[0];
  const B = W.portals[1];
  A.x = Math.sin(t * 0.37) * pxr;
  A.y = Math.sin(t * 0.29 + 1.3) * pyr;
  A.z = -W.L * 0.3;
  B.x = Math.sin(t * 0.33 + 2.1) * pxr;
  B.y = Math.cos(t * 0.41) * pyr;
  B.z = -W.L * 0.7;

  const gr = W.grav;
  if (gr.k < 1) {
    gr.k = Math.min(1, gr.k + dt / 1.1);
    gr.ang = gr.from + (gr.to - gr.from) * ease(gr.k);
  }
  if (W.mech.gravity && W.live) {
    gr.timer -= dt;
    if (!gr.warned && gr.timer < 1.6) {
      gr.warned = true;
      if (ev) ev.push({ type: 'shiftWarn' });
    }
    if (gr.timer <= 0) {
      gr.from = gr.ang;
      gr.to = gr.ang + (Math.random() < 0.5 ? -1 : 1) * Math.PI / 2;
      gr.k = 0;
      gr.timer = rand(8, 11);
      gr.warned = false;
      if (ev) ev.push({ type: 'shift' });
    }
  }
}

export function step(W, dt, P, ev, auto) {
  W.t += dt;
  W.lastP = P;
  updateMechanics(W, dt, ev);
  if (auto) controlPad(W, P, 'p', auto, dt);
  controlPad(W, W.ai, 'a', W.dim.ai, dt);
  const balls = W.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b.alive) continue;
    if (b.held) {
      const pad = b.held === 'p' ? P : W.ai;
      b.x = pad.x;
      b.y = pad.y;
      b.z = b.held === 'p' ? -BALL_R - 0.06 : -W.L + BALL_R + 0.06;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      continue;
    }
    stepBall(W, b, dt, ev, P);
  }
  if (W.mech.bolts || W.bolts.length) updateBolts(W, dt, ev, P);
  if (W.balls.some((b) => !b.alive)) W.balls = W.balls.filter((b) => b.alive);
}

function stepBall(W, b, dt, ev, P) {
  b.px = b.x; b.py = b.y; b.pz = b.z;
  integrate(W, b, dt, ev);
  if (!b.alive) return;

  // quantum membrane: superposition collapses here
  if (b.ghost) {
    const mz = -W.L / 2;
    if ((b.pz - mz) * (b.z - mz) <= 0 && b.pz !== b.z) {
      const pick = collapse(W, b.gid, null, ev);
      if (pick !== b) return;
    }
  }

  // your paddle (z = 0)
  if (b.vz > 0 && !b.passP && b.pz < -BALL_R && b.z >= -BALL_R) {
    if (b.ghost) {
      const pick = collapse(W, b.gid, null, ev);
      if (pick !== b) return;
    }
    const f = (-BALL_R - b.pz) / (b.z - b.pz);
    const cx = b.px + (b.x - b.px) * f;
    const cy = b.py + (b.y - b.py) * f;
    if (Math.abs(cx - P.x) <= PW / 2 + BALL_R * 0.75 && Math.abs(cy - P.y) <= PH / 2 + BALL_R * 0.75) {
      hitPaddle(W, b, 'p', cx, cy, P, ev);
    } else {
      b.passP = true;
      ev.push({ type: 'passP', b });
    }
  }

  // enemy paddle (z = -L)
  const za = -W.L + BALL_R;
  if (b.vz < 0 && !b.passA && b.pz > za && b.z <= za) {
    if (b.ghost) {
      const pick = collapse(W, b.gid, null, ev);
      if (pick !== b) return;
    }
    const f = (za - b.pz) / (b.z - b.pz);
    const cx = b.px + (b.x - b.px) * f;
    const cy = b.py + (b.y - b.py) * f;
    const ai = W.ai;
    if (Math.abs(cx - ai.x) <= PW / 2 + BALL_R * 0.75 && Math.abs(cy - ai.y) <= PH / 2 + BALL_R * 0.75) {
      hitPaddle(W, b, 'a', cx, cy, ai, ev);
    } else {
      b.passA = true;
      ev.push({ type: 'passA', b });
    }
  }

  if (b.passP) {
    if (W.holdNear && b.z > W.missZ - 0.45) b.z = W.missZ - 0.45; // hovers in your face during the rewind window
    else if (b.z > W.missZ) {
      b.alive = false;
      ev.push({ type: 'missP', b });
    }
  }
  if (b.passA && b.z < -W.L - 3) {
    b.alive = false;
    ev.push({ type: 'missA', b });
  }
}

function integrate(W, b, dt, ev) {
  let ax = b.sx;
  let ay = b.sy;
  let az = 0;
  if (W.mech.gravity) {
    ax += Math.sin(W.grav.ang) * GRAV;
    ay += -Math.cos(W.grav.ang) * GRAV;
  }
  if (W.mech.bh) {
    const dx = W.bh.x - b.x;
    const dy = W.bh.y - b.y;
    const dz = W.bh.z - b.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const s = d2 + BH_EPS2;
    const inv = GM / (s * Math.sqrt(s));
    ax += dx * inv;
    ay += dy * inv;
    az += dz * inv;
    if (!b.sim) {
      if (d2 < BH_R * BH_R * 1.6) {
        if (!b.inBH) {
          b.inBH = true;
          b.vz *= 1.12;
          if (ev) ev.push({ type: 'bhCore', b });
        }
      } else b.inBH = false;
    }
  }
  b.vx += ax * dt;
  b.vy += ay * dt;
  b.vz += az * dt;

  const dir = b.owner === 'p' ? -1 : 1;
  const minVz = W.speedNow * 0.55;
  const maxVz = W.dim.speedMax * 1.35;
  if (b.vz * dir < minVz) b.vz = dir * minVz;
  else if (b.vz * dir > maxVz) b.vz = dir * maxVz;
  const lat = Math.hypot(b.vx, b.vy);
  if (lat > VLAT_MAX) {
    b.vx *= VLAT_MAX / lat;
    b.vy *= VLAT_MAX / lat;
  }
  const k = Math.exp(-SPIN_DECAY * dt);
  b.sx *= k;
  b.sy *= k;

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.rot += (2 + Math.hypot(b.sx, b.sy) * 2.5) * dt;

  const hx = W.hw - BALL_R;
  const hy = W.hh - BALL_R;
  if (b.x > hx) {
    const vn = Math.abs(b.vx);
    b.x = 2 * hx - b.x;
    b.vx = -vn;
    if (b.sx > 0) b.sx *= -0.6;
    if (ev && vn > 0.5) ev.push({ type: 'wall', b, x: W.hw, y: b.y, z: b.z });
  } else if (b.x < -hx) {
    const vn = Math.abs(b.vx);
    b.x = -2 * hx - b.x;
    b.vx = vn;
    if (b.sx < 0) b.sx *= -0.6;
    if (ev && vn > 0.5) ev.push({ type: 'wall', b, x: -W.hw, y: b.y, z: b.z });
  }
  if (b.y > hy) {
    const vn = Math.abs(b.vy);
    b.y = 2 * hy - b.y;
    b.vy = -vn;
    if (b.sy > 0) b.sy *= -0.6;
    if (ev && vn > 0.5) ev.push({ type: 'wall', b, x: b.x, y: W.hh, z: b.z });
  } else if (b.y < -hy) {
    const vn = Math.abs(b.vy);
    b.y = -2 * hy - b.y;
    b.vy = vn;
    if (b.sy < 0) b.sy *= -0.6;
    if (ev && vn > 0.5) ev.push({ type: 'wall', b, x: b.x, y: -W.hh, z: b.z });
  }
  b.x = clamp(b.x, -hx, hx);
  b.y = clamp(b.y, -hy, hy);

  if (W.mech.portals) portalCheck(W, b, ev);
}

// Orange (A) only swallows balls flying away from you; blue (B) only balls flying at you.
function portalCheck(W, b, ev) {
  const A = W.portals[0];
  const B = W.portals[1];
  if (b.vz < 0 && b.pz > A.z && b.z <= A.z) tryPortal(W, b, A, B, 0, ev);
  else if (b.vz > 0 && b.pz < B.z && b.z >= B.z) tryPortal(W, b, B, A, 1, ev);
}

function tryPortal(W, b, src, dst, si, ev) {
  const f = (src.z - b.pz) / (b.z - b.pz);
  const cx = b.px + (b.x - b.px) * f;
  const cy = b.py + (b.y - b.py) * f;
  const dx = cx - src.x;
  const dy = cy - src.y;
  const rr = PORTAL_R - BALL_R * 0.4;
  if (dx * dx + dy * dy > rr * rr) return;
  if (b.ghost && !b.sim) {
    const pick = collapse(W, b.gid, null, ev);
    if (pick !== b) return;
  }
  const rem = b.z - src.z;
  b.x = clamp(dst.x + dx, -W.hw + BALL_R, W.hw - BALL_R);
  b.y = clamp(dst.y + dy, -W.hh + BALL_R, W.hh - BALL_R);
  b.z = dst.z + rem;
  b.px = b.x; b.py = b.y; b.pz = b.z;
  b.tele = (b.tele || 0) + 1;
  if (ev) ev.push({ type: 'teleport', b, sx: cx, sy: cy, sz: src.z, src: si });
}

function hitPaddle(W, b, side, cx, cy, pad, ev) {
  const ox = clamp((cx - pad.x) / (PW / 2), -1.15, 1.15);
  const oy = clamp((cy - pad.y) / (PH / 2), -1.15, 1.15);
  W.rally++;
  W.hitCount++;
  W.speedNow = Math.min(W.dim.speedMax, W.speedNow * 1.032);
  const sgn = side === 'p' ? -1 : 1;
  b.z = side === 'p' ? -BALL_R - 0.002 : -W.L + BALL_R + 0.002;
  b.x = cx;
  b.y = cy;
  b.px = cx; b.py = cy; b.pz = b.z;
  b.vz = sgn * W.speedNow;
  b.vx = ox * DEFLECT + b.vx * 0.2;
  b.vy = oy * DEFLECT * 0.85 + b.vy * 0.2;
  b.sx = clamp(pad.vx * SPIN_K, -SPIN_MAX, SPIN_MAX);
  b.sy = clamp(pad.vy * SPIN_K, -SPIN_MAX, SPIN_MAX);
  const extra = side === 'a' ? W.dim.ai.spin : W.pSpin;
  if (extra > 0) {
    b.sx = clamp(b.sx + gauss() * extra, -SPIN_MAX, SPIN_MAX);
    b.sy = clamp(b.sy + gauss() * extra * 0.7, -SPIN_MAX, SPIN_MAX);
  }
  b.owner = side;
  b.passP = false;
  b.passA = false;
  b.flash = 1;
  b.inBH = false;
  ev.push({ type: side === 'p' ? 'hitP' : 'hitA', b, x: cx, y: cy, z: b.z, ox, oy, spin: Math.hypot(b.sx, b.sy) });
  if (W.mech.quantum) split(W, b, ev);
}

function split(W, b, ev) {
  const n = 3;
  const gid = ++W.qgid;
  const base = Math.random() * Math.PI * 2;
  const mag = 2.3;
  const list = [b];
  for (let i = 1; i < n; i++) {
    const g = Object.assign({}, b);
    g.id = nextId++;
    list.push(g);
    W.balls.push(g);
  }
  list.forEach((g, i) => {
    const a = base + (i * Math.PI * 2) / n;
    g.vx += Math.cos(a) * mag;
    g.vy += Math.sin(a) * mag * 0.8;
    g.ghost = true;
    g.gid = gid;
  });
  ev.push({ type: 'split', gid, b, x: b.x, y: b.y, z: b.z });
}

export function collapse(W, gid, chosen, ev) {
  const g = W.balls.filter((x) => x.alive && x.ghost && x.gid === gid);
  if (!g.length) return null;
  const pick = chosen && g.includes(chosen) ? chosen : g[(Math.random() * g.length) | 0];
  for (const x of g) {
    if (x === pick) {
      x.ghost = false;
      x.flash = 1;
    } else {
      x.alive = false;
      if (ev) ev.push({ type: 'vanish', b: x, x: x.x, y: x.y, z: x.z });
    }
  }
  if (ev) ev.push({ type: 'collapse', b: pick, x: pick.x, y: pick.y, z: pick.z, forced: !!chosen });
  return pick;
}

const PB = mkBall({ sim: true });
function predict(W, b, side) {
  const g = PB;
  g.x = b.x; g.y = b.y; g.z = b.z;
  g.vx = b.vx; g.vy = b.vy; g.vz = b.vz;
  g.sx = b.sx; g.sy = b.sy;
  g.owner = b.owner;
  const plane = side === 'a' ? -W.L + BALL_R : -BALL_R;
  const dt = 1 / 60;
  for (let i = 0; i < 240; i++) {
    g.px = g.x; g.py = g.y; g.pz = g.z;
    integrate(W, g, dt, null);
    if (side === 'a' ? g.z <= plane : g.z >= plane) break;
  }
  return g;
}

// Shared paddle brain: drives the enemy, and your paddle in demo / autopilot mode.
function controlPad(W, pad, side, prm, dt) {
  if (pad.stun > 0) {
    pad.stun -= dt;
    pad.vx = 0;
    pad.vy = 0;
    if (pad.stun < 0) pad.stun = 0;
    return;
  }
  if (pad.immune > 0) pad.immune = Math.max(0, pad.immune - dt);
  const toMe = side === 'a' ? -1 : 1;
  let tx = 0;
  let ty = 0;
  let held = false;
  let n = 0;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (const b of W.balls) {
    if (!b.alive) continue;
    if (b.held === side) held = true;
    if (b.held || Math.sign(b.vz) !== toMe || (side === 'a' ? b.passA : b.passP)) continue;
    n++;
    bx += b.x; by += b.y; bz += b.z;
  }
  if (held) {
    tx = pad.serveX;
    ty = pad.serveY;
  } else if (n) {
    bx /= n; by /= n; bz /= n;
    if (pad.seen !== W.hitCount) {
      pad.seen = W.hitCount;
      // the better the incoming shot (spin, angle, pace), the shakier the read on it
      let sp = 0;
      let lat = 0;
      let spd = 0;
      for (const b of W.balls) {
        if (!b.alive || b.held || Math.sign(b.vz) !== toMe) continue;
        sp += Math.hypot(b.sx, b.sy);
        lat += Math.hypot(b.vx, b.vy);
        spd += Math.abs(b.vz);
      }
      const e = prm.err * (1 + (0.16 * sp + 0.05 * lat + 0.04 * Math.max(0, spd / n - 10) * n) / n);
      pad.errX = gauss() * e;
      pad.errY = gauss() * e * 0.75;
      const opp = side === 'a' ? (W.lastP || W.ai) : W.ai;
      const m = PW * 0.5 * 0.6 * prm.aim;
      pad.aimX = Math.sign(opp.x || Math.random() - 0.5) * m;
      pad.aimY = Math.sign(opp.y || Math.random() - 0.5) * m * 0.6;
      pad.predT = 0;
    }
    pad.predT -= dt;
    if (pad.predT <= 0) {
      pad.predT = 0.05;
      let sx = 0;
      let sy = 0;
      for (const b of W.balls) {
        if (!b.alive || b.held || Math.sign(b.vz) !== toMe || (side === 'a' ? b.passA : b.passP)) continue;
        const p = predict(W, b, side);
        sx += p.x;
        sy += p.y;
      }
      pad.predX = sx / n;
      pad.predY = sy / n;
    }
    const prog = side === 'a' ? clamp(-bz / W.L, 0, 1) : clamp(1 + bz / W.L, 0, 1);
    const alpha = clamp(prm.predict + prog * 1.15 - 0.12, 0, 1);
    tx = bx + (pad.predX - bx) * alpha + pad.errX * (0.4 + 0.6 * prog) + pad.aimX * prog;
    ty = by + (pad.predY - by) * alpha + pad.errY * (0.4 + 0.6 * prog) + pad.aimY * prog;
  } else {
    const b = W.balls.find((x) => x.alive);
    if (b) {
      tx = b.x * 0.3;
      ty = b.y * 0.3;
    }
  }
  const k = 1 - Math.exp(-dt / prm.react);
  pad.tx += (tx - pad.tx) * k;
  pad.ty += (ty - pad.ty) * k;
  const mx = W.hw - PW / 2;
  const my = W.hh - PH / 2;
  const dvx = clamp((pad.tx - pad.x) * 9, -prm.speed, prm.speed);
  const dvy = clamp((pad.ty - pad.y) * 9, -prm.speed, prm.speed);
  const a = 1 - Math.exp(-dt * 16);
  pad.vx += (dvx - pad.vx) * a;
  pad.vy += (dvy - pad.vy) * a;
  pad.x = clamp(pad.x + pad.vx * dt, -mx, mx);
  pad.y = clamp(pad.y + pad.vy * dt, -my, my);
}

function updateBolts(W, dt, ev, P) {
  const ai = W.ai;
  if (W.live && W.mech.bolts) {
    ai.boltT -= dt;
    let incoming = false;
    for (const b of W.balls) if (b.alive && !b.held && b.vz > 0) incoming = true;
    if (ai.boltT <= 0 && ai.stun <= 0 && incoming) {
      ai.boltT = rand(4.5, 7.5);
      const tt = W.L / BOLT_SPEED;
      W.bolts.push({ id: nextId++, x: ai.x, y: ai.y, z: -W.L + 0.3, vx: (P.x - ai.x) / tt, vy: (P.y - ai.y) / tt, vz: BOLT_SPEED, alive: true, pz: -W.L });
      if (ev) ev.push({ type: 'boltFire' });
    }
  }
  for (const o of W.bolts) {
    if (!o.alive) continue;
    o.pz = o.z;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.z += o.vz * dt;
    if (o.pz < 0 && o.z >= 0) {
      if (Math.abs(o.x - P.x) < PW / 2 + 0.12 && Math.abs(o.y - P.y) < PH / 2 + 0.12) {
        o.alive = false;
        if (ev) ev.push({ type: 'boltHit', x: o.x, y: o.y, z: 0 });
      }
    }
    if (o.z > 3) o.alive = false;
  }
  if (W.bolts.some((o) => !o.alive)) W.bolts = W.bolts.filter((o) => o.alive);
}

export function prepareServe(W, side, P) {
  W.balls = [mkBall({ held: side, owner: side })];
  W.bolts = [];
  W.speedNow = W.dim.speed;
  W.rally = 0;
  W.live = false;
  W.holdNear = false;
  const mx = W.hw - PW / 2;
  const my = W.hh - PH / 2;
  const pad = side === 'a' ? W.ai : P;
  if (pad) {
    pad.serveX = rand(-mx, mx) * 0.7;
    pad.serveY = rand(-my, my) * 0.7;
  }
}

export function launch(W, side, pad, ev) {
  const b = W.balls.find((x) => x.held);
  if (!b) return;
  b.held = null;
  b.owner = side;
  b.passP = false;
  b.passA = false;
  W.hitCount++;
  const s = W.speedNow;
  if (side === 'p') {
    b.vz = -s;
    b.vx = clamp(pad.vx * 0.1, -1.5, 1.5);
    b.vy = clamp(pad.vy * 0.1, -1.2, 1.2);
    b.sx = clamp(pad.vx * SPIN_K, -SPIN_MAX, SPIN_MAX);
    b.sy = clamp(pad.vy * SPIN_K, -SPIN_MAX, SPIN_MAX);
  } else {
    b.vz = s;
    b.vx = rand(-1.5, 1.5);
    b.vy = rand(-1.0, 1.0);
    b.sx = gauss() * W.dim.ai.spin * 0.8;
    b.sy = gauss() * W.dim.ai.spin * 0.5;
  }
  b.px = b.x; b.py = b.y; b.pz = b.z;
  W.live = true;
  ev.push({ type: 'launch', b, side, x: b.x, y: b.y, z: b.z });
  if (W.mech.quantum) split(W, b, ev);
}

export function snapshot(W) {
  return {
    t: W.t,
    balls: W.balls.map((b) => Object.assign({}, b)),
    bolts: W.bolts.map((o) => Object.assign({}, o)),
    ai: Object.assign({}, W.ai),
    grav: Object.assign({}, W.grav),
    qgid: W.qgid, rally: W.rally, speedNow: W.speedNow, hitCount: W.hitCount,
  };
}

export function restore(W, s) {
  W.t = s.t;
  W.balls = s.balls.map((b) => Object.assign({}, b));
  W.bolts = s.bolts.map((o) => Object.assign({}, o));
  Object.assign(W.ai, s.ai);
  Object.assign(W.grav, s.grav);
  W.qgid = s.qgid;
  W.rally = s.rally;
  W.speedNow = s.speedNow;
  W.hitCount = s.hitCount;
  updateMechanics(W, 0, null);
}
