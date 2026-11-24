// HYPERPONG — game flow, input, abilities, scoring.
import { DIMS, ENDLESS, MECH_DIM, MECH_NAMES } from './dims.js';
import * as Sim from './sim.js';
import { Gfx } from './gfx.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { WU, warpP, warpInv } from './warp.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('hyperpong.' + k);
      return v === null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('hyperpong.' + k, JSON.stringify(v));
    } catch (e) {
      /* storage unavailable */
    }
  },
};
const qs = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
const canvas = $('c');

const hud = new Hud();
let gfx;
try {
  gfx = new Gfx(canvas, store.get('quality', 2));
} catch (err) {
  $('menu').classList.add('hidden');
  $('err').classList.remove('hidden');
  throw err;
}
const snd = new Sound();
snd.musicOn = store.get('music', true);

const AUTO = { speed: 6.6, err: 0.2, react: 0.1, predict: 0.72, spin: 1.3, aim: 0.45 };
const G = {
  mode: 'demo', state: 'serve', stateT: 0, paused: false,
  dimIndex: 0, dim: DIMS[0], W: null, P: Sim.makePad(),
  lives: 5, maxLives: 5, aiLives: 3, score: 0, combo: 0,
  best: store.get('best', 0), bestEndless: store.get('bestEndless', 0),
  chrono: 1, chronoOn: false, charges: 3, chargeT: 0, rewinds: 1,
  timeScale: 1, hitstop: 0, acc: 0, history: [], histTick: 0,
  invertT: 0, roll: 0, server: 'p', autopilot: qs.has('auto'), flags: {},
  mwT: 0, rwIdx: 0, rwTarget: 0, rwAcc: 0, shots: [], sens: store.get('sens', 1),
  demoN: 0, endlessN: 0,
};
let shotId = 1;
const T = { x: 0, y: 0, z: 0 };
const T2 = { x: 0, y: 0, z: 0 };

// ================================================================ input
const input = { cx: 0, cy: 0, slowKey: false, slowMouse: false, slowTouch: false, rewindQ: false, locked: false, lockFails: 0, touchId: null, tx: 0, ty: 0, tStart: 0, tMoved: 0 };
const inGame = () => G.mode !== 'demo' && G.state !== 'over' && G.state !== 'victory';

addEventListener('mousemove', (e) => {
  if (input.locked) {
    input.cx = clamp(input.cx + (e.movementX / (innerWidth * 0.5)) * G.sens, -1.1, 1.1);
    input.cy = clamp(input.cy - (e.movementY / (innerHeight * 0.5)) * G.sens, -1.1, 1.1);
  } else {
    input.cx = (e.clientX / innerWidth) * 2 - 1;
    input.cy = 1 - (e.clientY / innerHeight) * 2;
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) primary();
  else if (e.button === 2) input.slowMouse = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) input.slowMouse = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => {
  input.slowKey = false;
  input.slowMouse = false;
  if (inGame()) pause();
});
addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'Space') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); input.slowKey = true; break;
    case 'ShiftLeft': case 'ShiftRight': input.slowKey = true; break;
    case 'KeyR': input.rewindQ = true; break;
    case 'Escape': pause(); break;
    case 'KeyP': if (G.paused) resume(); else pause(); break;
    case 'KeyM': toggleMusic(); break;
    case 'KeyQ': cycleQuality(); break;
    case 'Enter': if (G.state === 'intro' && G.mode !== 'demo') skipIntro(); break;
    default: break;
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.slowKey = false;
});
document.addEventListener('pointerlockchange', () => {
  const was = input.locked;
  input.locked = document.pointerLockElement === canvas;
  if (was && !input.locked && inGame()) pause();
});
document.addEventListener('pointerlockerror', () => {
  input.lockFails++;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && inGame()) pause();
});
function tryLock() {
  if (input.locked || input.lockFails > 2 || isTouch || !canvas.requestPointerLock) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { input.lockFails++; });
  } catch (err) {
    input.lockFails++;
  }
}
function exitLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

if (isTouch) {
  $('touch').classList.remove('hidden');
  $('keys').classList.add('hidden');
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    snd.init();
    for (const t of e.changedTouches) {
      if (input.touchId === null) {
        input.touchId = t.identifier;
        input.tx = t.clientX;
        input.ty = t.clientY;
        input.tStart = performance.now();
        input.tMoved = 0;
      } else primary();
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== input.touchId) continue;
      const dx = t.clientX - input.tx;
      const dy = t.clientY - input.ty;
      input.cx = clamp(input.cx + (dx / (innerWidth * 0.5)) * 1.7, -1.1, 1.1);
      input.cy = clamp(input.cy - (dy / (innerHeight * 0.5)) * 1.7, -1.1, 1.1);
      input.tx = t.clientX;
      input.ty = t.clientY;
      input.tMoved += Math.abs(dx) + Math.abs(dy);
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== input.touchId) continue;
      input.touchId = null;
      if (input.tMoved < 12 && performance.now() - input.tStart < 300) primary();
    }
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  const tSlow = $('tSlow');
  tSlow.addEventListener('touchstart', (e) => { e.preventDefault(); input.slowTouch = true; }, { passive: false });
  tSlow.addEventListener('touchend', (e) => { e.preventDefault(); input.slowTouch = false; });
  $('tRew').addEventListener('touchstart', (e) => { e.preventDefault(); input.rewindQ = true; }, { passive: false });
  $('tFire').addEventListener('touchstart', (e) => { e.preventDefault(); primary(); }, { passive: false });
}

function primary() {
  snd.init();
  if (G.mode === 'demo') return;
  if (G.paused) {
    resume();
    return;
  }
  tryLock();
  if (G.state === 'intro') skipIntro();
  else if (G.state === 'serve' && G.server === 'p') launch('p');
  else if (G.state === 'play' || G.state === 'missWindow') fire();
}

// ================================================================ menus & flow
function buildMenu() {
  const grid = $('dimGrid');
  const cleared = store.get('cleared', []);
  grid.innerHTML = '';
  DIMS.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.style.setProperty('--ca', d.pal.a);
    b.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><span class="nm">${d.name}</span><span class="bd">${d.blurb}</span>${cleared.includes(i) ? '<span class="ok">cleared</span>' : ''}`;
    b.onclick = () => { snd.init(); snd.click(); startCampaign(i); };
    grid.appendChild(b);
  });
  const e = document.createElement('button');
  e.className = 'card';
  e.style.setProperty('--ca', '#ffffff');
  e.innerHTML = `<span class="no">∞</span><span class="nm">ENDLESS</span><span class="bd">${ENDLESS.blurb}</span>`;
  e.onclick = () => { snd.init(); snd.click(); startEndless(); };
  grid.appendChild(e);
  $('best').textContent = `Best campaign ${G.best} · best endless ${G.bestEndless}`;
}

function enterGameUI() {
  G.paused = false;
  hud.show('menu', false);
  hud.show('pause', false);
  hud.endScreens();
  hud.show('hud', true);
}
function startCampaign(i) {
  G.mode = 'campaign';
  G.lives = 5;
  G.maxLives = 5;
  G.score = 0;
  G.combo = 0;
  enterGameUI();
  loadDim(i, !qs.has('nointro'));
  tryLock();
}
function startEndless() {
  G.mode = 'endless';
  G.lives = 3;
  G.maxLives = 3;
  G.score = 0;
  G.combo = 0;
  G.endlessN = 0;
  enterGameUI();
  loadDim(-1, !qs.has('nointro'));
  tryLock();
}
function startDemo() {
  G.mode = 'demo';
  G.paused = false;
  let i = Math.floor(Math.random() * DIMS.length);
  if (i === G.dimIndex) i = (i + 1) % DIMS.length;
  G.demoN = 0;
  loadDim(i, false);
}
function toMenu() {
  exitLock();
  G.paused = false;
  snd.setPaused(false);
  hud.show('pause', false);
  hud.endScreens();
  hud.show('hud', false);
  hud.hideIntro(true);
  hud.show('menu', true);
  buildMenu();
  startDemo();
}
function loadDim(i, intro) {
  G.dimIndex = i;
  G.dim = i < 0 ? JSON.parse(JSON.stringify(ENDLESS)) : DIMS[i];
  G.W = Sim.createWorld(G.dim);
  G.W.pSpin = G.autopilot || G.mode === 'demo' ? AUTO.spin : 0;
  G.aiLives = i < 0 ? Infinity : G.dim.aiLives;
  G.rewinds = G.dim.rewinds;
  G.charges = 3;
  G.chargeT = 0;
  G.chrono = 1;
  G.chronoOn = false;
  G.invertT = 0;
  G.history = [];
  G.shots = [];
  G.acc = 0;
  G.P.x = G.P.y = G.P.vx = G.P.vy = 0;
  gfx.setDim(G.dim);
  snd.setDim(G.dim, i < 0 ? 7 : i);
  snd.setIntensity(G.mode === 'demo' ? 0.55 : 1);
  if (G.mode !== 'demo') hud.setDim(G.dim, i, DIMS.length);
  else hud.setTheme(G.dim.pal);
  if (intro && G.mode !== 'demo') {
    G.state = 'intro';
    G.stateT = 0;
    hud.showIntro(G.dim, i, DIMS.length);
  } else toServe('p');
}
function skipIntro() {
  if (G.state !== 'intro') return;
  hud.hideIntro();
  toServe('p');
}
function toServe(side) {
  const W = G.W;
  G.state = 'serve';
  G.stateT = 0;
  G.server = side;
  G.history = [];
  G.flags = {};
  if (G.dim.mech.chaos) {
    const n = G.mode === 'endless' ? Math.min(3, 1 + Math.floor(G.endlessN / 3)) : 2;
    const picks = Sim.mutate(W, n);
    if (G.mode === 'endless') {
      const pal = DIMS[MECH_DIM[picks[0]]].pal;
      gfx.setPalette(pal);
      hud.setTheme(pal);
    }
    if (G.mode !== 'demo') {
      hud.mutation(picks.map((p) => MECH_NAMES[p]));
      snd.warn();
    }
  }
  Sim.prepareServe(W, side, G.P);
}
function updateServe() {
  if (G.server === 'p') {
    if (G.autopilot || G.mode === 'demo' ? G.stateT > 1.0 : G.stateT > 8) launch('p');
  } else if (G.stateT > 1.3) launch('a');
}
function launch(side) {
  const W = G.W;
  const ev = [];
  Sim.launch(W, side, side === 'p' ? G.P : W.ai, ev);
  G.state = 'play';
  G.stateT = 0;
  G.history = [];
  G.histTick = 0;
  handleEvents(ev);
  snd.serve();
}
function afterPoint() {
  if (G.mode === 'demo') {
    G.demoN++;
    if (G.demoN >= 3) startDemo();
    else toServe(G.server);
    return;
  }
  if (G.lives <= 0) {
    gameOver();
    return;
  }
  toServe(G.server);
}
function levelClear() {
  G.state = 'clear';
  G.stateT = 0;
  G.lives = Math.min(7, G.lives + 1);
  const cl = store.get('cleared', []);
  if (!cl.includes(G.dimIndex)) {
    cl.push(G.dimIndex);
    store.set('cleared', cl);
  }
  const next = DIMS[G.dimIndex + 1];
  hud.big('DIMENSION CLEARED', next ? `+1 integrity · next: ${next.name}` : 'reality is holding…', 3000, '');
  snd.clear();
  gfx.flash('#ffffff', 0.45);
  gfx.vertigoPulse();
}
function nextDim() {
  if (G.dimIndex + 1 >= DIMS.length) victory();
  else loadDim(G.dimIndex + 1, true);
}
function saveBest() {
  if (G.mode === 'endless') {
    if (G.score > G.bestEndless) {
      G.bestEndless = G.score;
      store.set('bestEndless', G.score);
    }
  } else if (G.score > G.best) {
    G.best = G.score;
    store.set('best', G.score);
  }
}
function gameOver() {
  G.state = 'over';
  G.chronoOn = false;
  saveBest();
  exitLock();
  hud.showOver(G, G.dimIndex < 0 ? `endless · ${G.endlessN} points` : `dimension ${String(G.dimIndex + 1).padStart(2, '0')} · ${G.dim.name}`);
  snd.setIntensity(0.55);
}
function victory() {
  G.state = 'victory';
  saveBest();
  exitLock();
  hud.showVictory(G);
  snd.clear();
}
function retry() {
  if (G.mode === 'endless') {
    startEndless();
    return;
  }
  G.lives = 5;
  G.score = 0;
  G.combo = 0;
  enterGameUI();
  loadDim(G.dimIndex, true);
  tryLock();
}
function pause() {
  if (G.mode === 'demo' || G.paused || G.state === 'over' || G.state === 'victory') return;
  G.paused = true;
  input.slowKey = false;
  input.slowMouse = false;
  exitLock(); // free the cursor so the pause panel is clickable
  hud.show('pause', true);
  snd.setPaused(true);
}
function resume() {
  if (!G.paused) return;
  G.paused = false;
  hud.show('pause', false);
  snd.setPaused(false);
  tryLock();
}
function toggleMusic() {
  snd.init();
  snd.setMusic(!snd.musicOn);
  store.set('music', snd.musicOn);
  $('mus').checked = snd.musicOn;
  if (G.mode !== 'demo') hud.toast(snd.musicOn ? 'music on' : 'music off', 'c');
}
function cycleQuality() {
  const q = (gfx.quality + 2) % 3;
  setQuality(q);
  store.set('qualityManual', true);
  if (G.mode !== 'demo') hud.toast(['quality: low', 'quality: medium', 'quality: high'][q], 'c');
}
function setQuality(q) {
  gfx.setQuality(q);
  store.set('quality', q);
  $('qual').value = String(q);
}

// ================================================================ scoring & events
function addScore(n) {
  if (G.mode !== 'demo') G.score += Math.round(n);
}
function handleEvents(evs) {
  const W = G.W;
  const demo = G.mode === 'demo';
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    switch (e.type) {
      case 'hitP': {
        gfx.paddleHit('p', e.x - G.P.x, e.y - G.P.y);
        gfx.wave(0, 'a');
        gfx.burst(e.x, e.y, e.z, 28, 'a', 5.5, 0.6, 0.09);
        gfx.shakeIt(0.14);
        gfx.caKick(0.006);
        gfx.kick();
        snd.hitP(Math.min(1, W.speedNow / 18), e.spin);
        G.hitstop = 0.045;
        if (!demo) {
          G.combo++;
          G.flags = {};
          addScore(10 * (1 + Math.floor(G.combo / 4)));
          G.chrono = Math.min(1, G.chrono + 0.06);
          if (e.spin > 2.4) {
            G.flags.curve = true;
            addScore(25);
            hud.toast(e.spin > 4.5 ? 'MEGA CURVE' : 'CURVEBALL', 'a');
          }
        }
        break;
      }
      case 'hitA':
        gfx.paddleHit('a', e.x - W.ai.x, e.y - W.ai.y);
        gfx.wave(-W.L, 'b');
        gfx.burst(e.x, e.y, e.z, 22, 'b', 5, 0.55, 0.12);
        gfx.kick();
        snd.hitA();
        break;
      case 'launch':
        gfx.wave(e.z, e.side === 'p' ? 'a' : 'b');
        gfx.burst(e.x, e.y, e.z, 18, e.side === 'p' ? 'a' : 'b', 4, 0.5, 0.08);
        break;
      case 'wall': {
        const k = e.b.owner === 'p' ? 'a' : 'b';
        gfx.impact(e.x, e.y, e.z, k);
        gfx.burst(e.x, e.y, e.z, 6, k, 2.5, 0.35, 0.06);
        snd.wall(e.x / W.hw, -e.z / W.L);
        break;
      }
      case 'passP':
        if (!demo && G.state === 'play' && G.rewinds > 0 && G.history.length > 30) enterMissWindow();
        break;
      case 'missP':
        if (G.state === 'play' || G.state === 'missWindow') resolveMissP();
        break;
      case 'missA':
        if (G.state === 'play') resolveMissA(e.b);
        break;
      case 'teleport': {
        const src = W.portals[e.src];
        const dst = W.portals[1 - e.src];
        gfx.burst(e.sx, e.sy, src.z, 30, e.src === 0 ? '#ffa31a' : '#1ab8ff', 4, 0.6, 0.1);
        gfx.burst(e.b.x, e.b.y, e.b.z, 40, e.src === 0 ? '#1ab8ff' : '#ffa31a', 5, 0.7, 0.1);
        gfx.portalFlash(0);
        gfx.portalFlash(1);
        gfx.wave(dst.z, e.src === 0 ? '#1ab8ff' : '#ffa31a');
        snd.teleport();
        if (!demo) {
          if (e.b.owner === 'p') {
            G.flags.worm = true;
            hud.toast('WORMHOLE', 'a');
          } else hud.warn('INCOMING THROUGH THE WORMHOLE', 0.9);
        }
        break;
      }
      case 'split':
        gfx.burst(e.x, e.y, e.z, 26, 'c', 3.5, 0.6, 0.09);
        snd.split();
        break;
      case 'collapse':
        gfx.membraneFlash();
        gfx.burst(e.x, e.y, e.z, 40, '#ffffff', 4.5, 0.6, 0.09);
        gfx.wave(e.z, 'c');
        snd.collapse();
        break;
      case 'vanish':
        gfx.burst(e.x, e.y, e.z, 22, 'c', 3, 0.5, 0.08);
        break;
      case 'bhCore':
        gfx.burst(e.b.x, e.b.y, e.b.z, 40, 'a', 6, 0.7, 0.1);
        gfx.caKick(0.012);
        snd.bh();
        if (!demo && e.b.owner === 'p') {
          G.flags.sling = true;
          hud.toast('SLINGSHOT', 'a');
        }
        break;
      case 'boltFire':
        snd.boltFire();
        break;
      case 'boltHit':
        if (!demo) {
          G.invertT = 2.6;
          hud.toast('SIGNAL INVERTED', 'b');
          gfx.glitchIt(1);
          gfx.shakeIt(0.3);
          gfx.burst(e.x, e.y, e.z, 40, '#ff2244', 5, 0.6, 0.1);
          snd.boltHit();
        }
        break;
      case 'shiftWarn':
        if (!demo) hud.warn('GRAVITY SHIFT', 1.6);
        snd.warn();
        break;
      case 'shift':
        gfx.vertigoPulse();
        gfx.shakeIt(0.18);
        snd.shift();
        break;
      default:
        break;
    }
  }
}
function enterMissWindow() {
  G.state = 'missWindow';
  G.mwT = 1.35;
  G.W.holdNear = true;
  if (G.chronoOn) {
    G.chronoOn = false;
    snd.slowOff();
  }
  snd.missWindow();
}
function resolveMissP() {
  const W = G.W;
  W.holdNear = false;
  W.live = false;
  W.balls = [];
  W.bolts = [];
  G.history = [];
  G.shots = [];
  G.state = 'point';
  G.stateT = 0;
  G.server = 'p';
  if (G.mode === 'demo') return;
  gfx.flash('#ff1a3c', 0.9);
  gfx.shakeIt(0.55);
  gfx.glitchIt(0.9);
  snd.miss();
  G.lives--;
  G.combo = 0;
  hud.big('BREACH', G.lives > 0 ? `${G.lives} integrity left` : 'integrity lost', 1300, 'b');
}
function resolveMissA(b) {
  const W = G.W;
  gfx.burst(b.x, b.y, b.z, 120, 'a', 9, 1.3, 0.18);
  gfx.burst(b.x, b.y, b.z, 60, '#ffffff', 5, 0.9, 0.12);
  gfx.shockAt(b.x, b.y, b.z);
  gfx.flash(G.mode === 'demo' ? 'a' : G.dim.pal.a, 0.3);
  gfx.shakeIt(0.25);
  gfx.paddleHit('a', 0, 0);
  W.live = false;
  W.balls = [];
  W.bolts = [];
  G.history = [];
  G.shots = [];
  G.state = 'point';
  G.stateT = 0;
  G.server = 'a';
  if (G.mode === 'demo') return;
  snd.score();
  let pts = 100 * (G.dimIndex < 0 ? 3 + Math.floor(G.endlessN / 4) : G.dimIndex + 1);
  const tags = [];
  const f = G.flags;
  if (f.curve) { pts += 50; tags.push('curve'); }
  if (f.deflect) { pts += 80; tags.push('redirect'); }
  if (f.stun) { pts += 150; tags.push('stun kill'); }
  if (f.worm) { pts += 200; tags.push('wormhole shot'); }
  if (f.sling) { pts += 150; tags.push('slingshot'); }
  if (f.observe) { pts += 120; tags.push('observer effect'); }
  const chain = tags.length > 1 ? tags.length : 1;
  addScore(pts * chain * (1 + Math.min(G.combo, 20) * 0.05));
  if (G.aiLives !== Infinity) G.aiLives--;
  if (G.mode === 'endless') {
    G.endlessN++;
    ramp();
  }
  const sub = tags.length ? tags.join(' → ') + (chain > 1 ? `  ×${chain} chain` : '') : 'the void flinches';
  hud.big('POINT', sub, 1400, '');
  if (G.mode === 'campaign' && G.aiLives <= 0) levelClear();
}
function ramp() {
  const d = G.dim;
  d.ai.speed = Math.min(7.6, d.ai.speed + 0.14);
  d.ai.err = Math.max(0.3, d.ai.err * 0.975);
  d.ai.react = Math.max(0.13, d.ai.react * 0.98);
  d.ai.predict = Math.min(0.75, d.ai.predict + 0.02);
  d.ai.spin = Math.min(2.4, d.ai.spin + 0.05);
  d.speed = Math.min(16, d.speed + 0.18);
  d.speedMax = Math.min(21, d.speedMax + 0.15);
}

// ================================================================ rewind
function startRewind() {
  if (G.rewinds <= 0) {
    hud.toast('NO REWINDS LEFT', 'b');
    return;
  }
  if (G.history.length < 24) return;
  G.rewinds--;
  G.state = 'rewind';
  G.rwIdx = G.history.length - 1;
  G.rwTarget = Math.max(0, G.history.length - 1 - 150);
  G.rwAcc = 0;
  G.W.holdNear = false;
  G.shots = [];
  if (G.chronoOn) {
    G.chronoOn = false;
    snd.slowOff();
  }
  snd.rewind();
}
function updateRewind(rdt) {
  G.rwAcc += rdt * 170;
  const k = Math.floor(G.rwAcc);
  G.rwAcc -= k;
  G.rwIdx = Math.max(G.rwTarget, G.rwIdx - k);
  Sim.restore(G.W, G.history[G.rwIdx]);
  if (G.rwIdx <= G.rwTarget) {
    G.history.length = G.rwIdx + 1;
    G.state = 'play';
    G.stateT = 0;
    G.timeScale = 0.15;
    G.W.live = true;
    gfx.clearTrails();
    snd.rewindEnd();
    hud.toast('TIMELINE RESTORED', 'a');
  }
}

// ================================================================ pulse gun
function fire() {
  if (G.charges < 1) {
    snd.empty();
    hud.flashCharges();
    return;
  }
  G.charges--;
  const cam = gfx.camera.position;
  let dx = G.P.x - cam.x;
  let dy = G.P.y - cam.y;
  let dz = -cam.z;
  const len = Math.hypot(dx, dy, dz);
  dx /= len;
  dy /= len;
  dz /= len;
  const s0 = len * 0.92;
  G.shots.push({ id: shotId++, ox: cam.x, oy: cam.y, oz: cam.z, dx, dy, dz, s0, s: s0, ps: s0, alive: true });
  snd.shoot();
  gfx.recoilIt();
}
function segHit(ax, ay, az, bx, by, bz, cx, cy, cz, R) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const L2 = ux * ux + uy * uy + uz * uz || 1e-9;
  let t = ((cx - ax) * ux + (cy - ay) * uy + (cz - az) * uz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + ux * t - cx;
  const dy = ay + uy * t - cy;
  const dz = az + uz * t - cz;
  return dx * dx + dy * dy + dz * dz <= R * R ? t : -1;
}
// Shots travel through *visual* space: what you aim at on screen is what you hit.
function updateShots(dt) {
  const W = G.W;
  for (const sh of G.shots) {
    if (!sh.alive) continue;
    sh.ps = sh.s;
    sh.s += 100 * dt;
    const ax = sh.ox + sh.dx * sh.ps;
    const ay = sh.oy + sh.dy * sh.ps;
    const az = sh.oz + sh.dz * sh.ps;
    const bx = sh.ox + sh.dx * sh.s;
    const by = sh.oy + sh.dy * sh.s;
    const bz = sh.oz + sh.dz * sh.s;
    let hit = false;
    for (const b of W.balls) {
      if (!b.alive || b.held) continue;
      warpP(b.x, b.y, b.z, T);
      const t = segHit(ax, ay, az, bx, by, bz, T.x, T.y, T.z, Sim.BALL_R + 0.22);
      if (t >= 0) {
        shotBall(b, ax + (bx - ax) * t, ay + (by - ay) * t);
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const o of W.bolts) {
        if (!o.alive) continue;
        warpP(o.x, o.y, o.z, T);
        if (segHit(ax, ay, az, bx, by, bz, T.x, T.y, T.z, 0.42) >= 0) {
          o.alive = false;
          gfx.burst(o.x, o.y, o.z, 50, '#ff2244', 6, 0.8, 0.12);
          snd.boltKill();
          hud.toast('BOLT DOWN', 'a');
          addScore(20);
          hit = true;
          break;
        }
      }
    }
    if (!hit) {
      const zA = -W.L * (1 + WU.uStretch.value);
      if (az > zA && bz <= zA) {
        const f = (zA - az) / (bz - az);
        warpInv(ax + (bx - ax) * f, ay + (by - ay) * f, zA, T2);
        if (Math.abs(T2.x - W.ai.x) < Sim.PW / 2 + 0.1 && Math.abs(T2.y - W.ai.y) < Sim.PH / 2 + 0.1) {
          shotAI();
          hit = true;
        }
      }
    }
    if (!hit) {
      warpInv(bx, by, bz, T2);
      if (T2.z < 0 && (Math.abs(T2.x) > W.hw || Math.abs(T2.y) > W.hh)) {
        const cx = clamp(T2.x, -W.hw, W.hw);
        const cy = clamp(T2.y, -W.hh, W.hh);
        gfx.burst(cx, cy, T2.z, 10, '#ffffff', 2.5, 0.35, 0.07);
        gfx.impact(cx, cy, T2.z, 'c');
        hit = true;
      }
    }
    if (hit || sh.s > 90) sh.alive = false;
  }
  G.shots = G.shots.filter((s) => s.alive);
}
function shotBall(b, hx, hy) {
  const W = G.W;
  warpP(b.x, b.y, b.z, T);
  const ox = T.x - hx;
  const oy = T.y - hy;
  const s = clamp(-b.z / W.L, 0, 1.25);
  const a = -WU.uTwist.value * s * s;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  let ux = c * ox - sn * oy;
  let uy = sn * ox + c * oy;
  const m = Math.hypot(ux, uy);
  if (m < 1e-4) {
    const r = Math.random() * Math.PI * 2;
    ux = Math.cos(r);
    uy = Math.sin(r);
  } else {
    ux /= m;
    uy /= m;
  }
  const wasGhost = b.ghost;
  if (wasGhost) {
    const ev = [];
    Sim.collapse(W, b.gid, b, ev);
    handleEvents(ev);
    G.flags.observe = true;
    addScore(40);
  }
  b.vx += ux * 3.4;
  b.vy += uy * 3.4;
  b.sx = clamp(b.sx + ux * 1.4, -6, 6);
  b.sy = clamp(b.sy + uy * 1.4, -6, 6);
  if (b.owner === 'p') {
    b.vz *= 1.07;
    G.flags.deflect = true;
  }
  b.flash = 1;
  gfx.burst(b.x, b.y, b.z, 36, '#ffffff', 6, 0.5, 0.08);
  gfx.burst(b.x, b.y, b.z, 20, 'c', 4, 0.6, 0.1);
  gfx.caKick(0.008);
  snd.deflect();
  hud.toast(wasGhost ? 'OBSERVED' : 'DEFLECT', 'a');
  addScore(15);
}
function shotAI() {
  const ai = G.W.ai;
  if (ai.stun > 0 || ai.immune > 0) {
    snd.shield();
    gfx.aiShield();
    hud.toast('SHIELDED', 'b');
    return;
  }
  ai.stun = 0.55;
  ai.immune = 3.2;
  gfx.burst(ai.x, ai.y, -G.W.L, 60, 'b', 6, 0.7, 0.1);
  gfx.glitchIt(0.25);
  snd.stun();
  hud.toast('STUNNED', 'a');
  G.flags.stun = true;
  addScore(30);
}

// ================================================================ main loop
function updatePlayer(rdt) {
  if (G.autopilot || G.mode === 'demo') return; // the sim steers your paddle
  const W = G.W;
  const P = G.P;
  let cx = input.cx;
  let cy = input.cy;
  if (G.invertT > 0) {
    cx = -cx;
    cy = -cy;
  }
  const mx = W.hw - Sim.PW / 2;
  const my = W.hh - Sim.PH / 2;
  const c = Math.cos(G.roll);
  const s = Math.sin(G.roll);
  const A = Math.abs(c) * mx + Math.abs(s) * my;
  const B = Math.abs(s) * mx + Math.abs(c) * my;
  const sx = clamp(cx * 1.12, -1, 1) * A;
  const sy = clamp(cy * 1.12, -1, 1) * B;
  const tx = clamp(sx * c - sy * s, -mx, mx);
  const ty = clamp(sx * s + sy * c, -my, my);
  const k = 1 - Math.exp(-rdt * 55);
  const nx = P.x + (tx - P.x) * k;
  const ny = P.y + (ty - P.y) * k;
  const sdt = Math.max(rdt * G.timeScale, 1e-4);
  const kv = 1 - Math.exp(-rdt * 30);
  P.vx += (clamp((nx - P.x) / sdt, -40, 40) - P.vx) * kv;
  P.vy += (clamp((ny - P.y) / sdt, -40, 40) - P.vy) * kv;
  P.x = nx;
  P.y = ny;
}
function runSim(dt) {
  const W = G.W;
  G.acc += dt;
  let n = 0;
  const ev = [];
  while (G.acc >= Sim.DT && n < 24) {
    G.acc -= Sim.DT;
    n++;
    ev.length = 0;
    Sim.step(W, Sim.DT, G.P, ev, G.autopilot || G.mode === 'demo' ? AUTO : null);
    if (G.state === 'play' && (++G.histTick & 1) === 0) {
      G.history.push(Sim.snapshot(W));
      if (G.history.length > 220) G.history.shift();
    }
    if (ev.length) handleEvents(ev);
  }
  if (n >= 24) G.acc = 0;
}
function update(rdt) {
  if (G.paused) return;
  const W = G.W;
  G.stateT += rdt;
  updatePlayer(rdt);
  const want = G.state === 'play' && G.mode !== 'demo' && (input.slowKey || input.slowMouse || input.slowTouch) && G.chrono > 0.015;
  if (want !== G.chronoOn) {
    G.chronoOn = want;
    if (want) snd.slowOn();
    else snd.slowOff();
  }
  G.chrono = G.chronoOn ? Math.max(0, G.chrono - rdt * 0.33) : Math.min(1, G.chrono + rdt * 0.055);
  if (G.charges < 3) {
    G.chargeT += rdt;
    if (G.chargeT >= 2.2) {
      G.chargeT = 0;
      G.charges++;
    }
  }
  if (G.invertT > 0) G.invertT = Math.max(0, G.invertT - rdt);
  let ts = G.chronoOn ? 0.33 : 1;
  if (G.state === 'missWindow') ts = 0.09;
  if (G.hitstop > 0) {
    G.hitstop -= rdt;
    ts = Math.min(ts, 0.16);
  }
  G.timeScale += (ts - G.timeScale) * (1 - Math.exp(-rdt * 16));
  snd.setTimeScale(G.timeScale);
  G.roll = W.grav.ang;

  switch (G.state) {
    case 'intro':
      runSim(rdt);
      if (G.stateT > (G.autopilot ? 1.5 : 7)) skipIntro();
      break;
    case 'serve':
      runSim(rdt * G.timeScale);
      updateServe();
      break;
    case 'play':
      runSim(rdt * G.timeScale);
      break;
    case 'missWindow':
      runSim(rdt * G.timeScale);
      G.mwT -= rdt;
      if (input.rewindQ) startRewind();
      else if (G.mwT <= 0 && G.state === 'missWindow') resolveMissP();
      break;
    case 'rewind':
      updateRewind(rdt);
      break;
    case 'point':
      runSim(rdt);
      if (G.stateT > 1.5) afterPoint();
      break;
    case 'clear':
      runSim(rdt);
      if (G.stateT > 3.4) nextDim();
      break;
    default:
      runSim(rdt);
      break;
  }
  if (input.rewindQ && G.state === 'play' && G.mode !== 'demo') startRewind();
  input.rewindQ = false;
  if (G.shots.length) updateShots(rdt * Math.max(0.5, G.timeScale));
}

let last = performance.now();
const bootT = last;
const perf = { n: 0, acc: 0, downs: 0 };
function watchPerf(dt, now) {
  if (G.paused || document.hidden || dt > 0.25 || now - bootT < 4000 || perf.downs >= 2 || gfx.quality === 0) return;
  perf.acc += dt;
  if (++perf.n < 120) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0;
  perf.n = 0;
  if (avg > 1 / 42 && !store.get('qualityManual', false)) {
    perf.downs++;
    setQuality(gfx.quality - 1);
    if (G.mode !== 'demo') hud.toast('quality lowered to keep it smooth · Q to change', 'c');
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  let rdt = (now - last) / 1000;
  last = now;
  watchPerf(rdt, now);
  if (!(rdt > 0)) rdt = 1 / 60;
  else if (rdt > 0.1) rdt = 0.1;
  WU.uTime.value = (now / 1000) % 3600;
  update(rdt);
  gfx.sync(G, G.paused ? 0 : rdt, snd.beat());
  gfx.render();
  if (G.mode !== 'demo') hud.update(G);
}

// ================================================================ wiring & boot
$('btnPlay').onclick = () => { snd.init(); snd.click(); startCampaign(0); };
$('btnEndless').onclick = () => { snd.init(); snd.click(); startEndless(); };
$('btnResume').onclick = () => resume();
$('btnQuit').onclick = () => toMenu();
$('btnRetry').onclick = () => { snd.init(); retry(); };
$('btnMenu2').onclick = () => toMenu();
$('btnMenu3').onclick = () => toMenu();
$('btnEndless2').onclick = () => { snd.init(); startEndless(); };
$('sens').value = String(G.sens);
$('sens').oninput = (e) => {
  G.sens = +e.target.value;
  store.set('sens', G.sens);
};
$('qual').value = String(gfx.quality);
$('qual').onchange = (e) => {
  setQuality(+e.target.value);
  store.set('qualityManual', true);
};
$('mus').checked = snd.musicOn;
$('mus').onchange = (e) => {
  snd.init();
  snd.setMusic(e.target.checked);
  store.set('music', e.target.checked);
};

buildMenu();
const startAt = parseInt(qs.get('dim') || '', 10);
if (qs.has('endless')) startEndless();
else if (startAt >= 1 && startAt <= DIMS.length) startCampaign(startAt - 1);
else {
  hud.show('menu', true);
  startDemo();
}
requestAnimationFrame(frame);
window.__hp = { G, Sim, gfx, snd, fire, startRewind, startCampaign, startEndless, toMenu, toServe };
