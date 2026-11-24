// Headless physics check (npm run check): autopilot vs the enemy AI in every dimension.
// Checks for NaNs, stuck rallies and how often each side wins a point.
import * as Sim from '../src/sim.js';
import { DIMS, ENDLESS } from '../src/dims.js';

const AUTO = { speed: 6.6, err: 0.2, react: 0.1, predict: 0.72, spin: 1.3, aim: 0.45 };
const RALLIES = 80;
for (const [i, d0] of [...DIMS, ENDLESS].entries()) {
  const d = JSON.parse(JSON.stringify(d0));
  const W = Sim.createWorld(d);
  W.pSpin = AUTO.spin;
  const P = Sim.makePad();
  const pts = { you: 0, ai: 0 };
  let hits = 0, nan = 0, timeouts = 0, teleports = 0, collapses = 0, bh = 0, bolts = 0, walls = 0, shifts = 0, maxTime = 0;
  let server = 'p';
  for (let r = 0; r < RALLIES; r++) {
    if (d.mech.chaos) Sim.mutate(W, 2);
    Sim.prepareServe(W, server, P);
    for (let k = 0; k < 120; k++) Sim.step(W, Sim.DT, P, [], AUTO);
    const ev0 = [];
    Sim.launch(W, server, server === 'p' ? P : W.ai, ev0);
    let done = false;
    let k = 0;
    for (; k < 120 * 90 && !done; k++) {
      const evs = [];
      Sim.step(W, Sim.DT, P, evs, AUTO);
      for (const e of evs) {
        if (e.type === 'hitP' || e.type === 'hitA') hits++;
        else if (e.type === 'teleport') teleports++;
        else if (e.type === 'collapse') collapses++;
        else if (e.type === 'bhCore') bh++;
        else if (e.type === 'boltFire') bolts++;
        else if (e.type === 'wall') walls++;
        else if (e.type === 'shift') shifts++;
        else if (e.type === 'missP') { pts.ai++; server = 'p'; done = true; }
        else if (e.type === 'missA') { pts.you++; server = 'a'; done = true; }
      }
      for (const b of W.balls) if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz)) nan++;
      if (!Number.isFinite(W.ai.x + W.ai.y + P.x + P.y)) nan++;
    }
    maxTime = Math.max(maxTime, k / 120);
    if (!done) timeouts++;
    W.live = false;
    W.balls = [];
  }
  console.log(
    `${d.name.padEnd(14)} autopilot ${String(pts.you).padStart(2)} : ${String(pts.ai).padStart(2)} AI | hits/rally ${(hits / RALLIES).toFixed(1).padStart(4)} | longest ${maxTime.toFixed(0)}s | timeouts ${timeouts} | NaN ${nan} | tele ${teleports} coll ${collapses} bh ${bh} bolts ${bolts} shifts ${shifts} walls/rally ${(walls / RALLIES).toFixed(1)}`,
  );
}
