// HYPERPONG — procedural audio: every sound is synthesized, and the music is a
// generative synthwave loop whose tempo is bent by the game's time scale.
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const PROGS = [
  [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']],
  [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']],
  [[0, 'm'], [1, 'M'], [0, 'm'], [8, 'M']],
  [[0, 'm'], [10, 'M'], [8, 'M'], [10, 'M']],
  [[0, 'm'], [3, 'M'], [10, 'M'], [5, 'm']],
  [[0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']],
  [[0, 'm'], [1, 'M'], [8, 'M'], [7, 'M']],
  [[0, 'm'], [8, 'M'], [10, 'M'], [7, 'M']],
];
const ARP = [0, 1, 2, 1, 2, 0, 1, 2, 0, 2, 1, 0, 1, 2, 0, 1];

export class Sound {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.bpm = 112;
    this.key = 45;
    this.prog = PROGS[0];
    this.intensity = 0.55;
    this.tempoScale = 1;
    this.kicks = [];
    this.step = 0;
    this.paused = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musLP = c.createBiquadFilter();
    this.musLP.type = 'lowpass';
    this.musLP.frequency.value = 16000;
    this.musLP.Q.value = 0.8;
    this.mus = c.createGain();
    this.mus.gain.value = this.musicOn ? 0.42 : 0;
    this.mus.connect(this.musLP);
    this.musLP.connect(this.master);
    this.dly = c.createDelay(1.5);
    this.dly.delayTime.value = (3 * 60) / this.bpm / 4;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const wet = c.createGain();
    wet.gain.value = 0.45;
    this.dly.connect(fb);
    fb.connect(this.dly);
    this.dly.connect(wet);
    wet.connect(this.mus);
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.nextT = c.currentTime + 0.1;
    setInterval(() => this.sched(), 25);
  }

  get t() {
    return this.ctx.currentTime + 0.005;
  }

  osc(t, type, f0, f1, dur, vol, dest, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(5, f1), t + (o.glide || dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    osc.connect(g);
    let node = g;
    if (o.lp || o.hp || o.bp) {
      const f = c.createBiquadFilter();
      f.type = o.lp ? 'lowpass' : o.hp ? 'highpass' : 'bandpass';
      f.frequency.setValueAtTime(o.lp || o.hp || o.bp, t);
      if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + dur);
      f.Q.value = o.q || 0.8;
      g.connect(f);
      node = f;
    }
    if (o.pan !== undefined && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(dest || this.sfx);
    if (o.send) node.connect(o.send);
    osc.start(t);
    osc.stop(t + a + dur + 0.05);
    return osc;
  }

  noise(t, dur, vol, dest, o = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = this.noiseBuf;
    s.loop = true;
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q || 1;
    const a = o.attack || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    s.connect(f);
    f.connect(g);
    let node = g;
    if (o.pan !== undefined && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(dest || this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + a + dur + 0.05);
  }

  // ---------- sound effects ----------
  hitP(power = 0.6, spin = 0) {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 560 + power * 320, 120, 0.13, 0.55);
    this.osc(t, 'square', 1200, 300, 0.05, 0.06, null, { lp: 4000 });
    this.noise(t, 0.05, 0.26, null, { f: 3500, q: 0.9 });
    if (spin > 2.4) this.osc(t + 0.02, 'triangle', 900, 2600, 0.2, 0.1);
  }
  hitA() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 380, 90, 0.15, 0.38);
    this.noise(t, 0.06, 0.16, null, { f: 1600, q: 1.2 });
    this.osc(t, 'triangle', 760, 190, 0.08, 0.07);
  }
  wall(pan = 0, depth = 0) {
    if (!this.ctx) return;
    const t = this.t;
    const v = 0.14 * (1 - Math.min(1, depth) * 0.6);
    this.osc(t, 'triangle', 1500 - depth * 600, 900 - depth * 400, 0.05, v, null, { pan });
    this.noise(t, 0.025, v * 0.8, null, { f: 6000, type: 'highpass', pan });
  }
  shoot() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sawtooth', 2200, 160, 0.16, 0.15, null, { lp: 3500, lp1: 400 });
    this.osc(t, 'square', 880, 110, 0.12, 0.05);
    this.noise(t, 0.06, 0.1, null, { f: 8000, type: 'highpass' });
  }
  empty() {
    if (!this.ctx) return;
    this.osc(this.t, 'square', 140, 120, 0.06, 0.08, null, { lp: 900 });
  }
  deflect() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 700, 1900, 0.12, 0.28);
    this.noise(t, 0.12, 0.2, null, { f: 2500, f1: 9000, q: 2 });
  }
  stun() {
    if (!this.ctx) return;
    const t = this.t;
    for (let i = 0; i < 6; i++) this.osc(t + i * 0.035, 'square', 200 + Math.random() * 900, 60, 0.04, 0.08, null, { lp: 3000 });
    this.noise(t, 0.3, 0.2, null, { f: 4000, f1: 300, q: 3 });
  }
  shield() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'triangle', 2600, 2100, 0.16, 0.12);
    this.osc(t, 'sine', 1300, 1250, 0.2, 0.08);
  }
  score() {
    if (!this.ctx) return;
    const t = this.t;
    [0, 4, 7, 12, 16].forEach((s, i) => this.osc(t + i * 0.06, 'triangle', mtof(72 + s), 0, 0.25, 0.15, null, { send: this.dly }));
    this.osc(t, 'sine', 90, 40, 0.5, 0.5);
    this.noise(t, 0.5, 0.16, null, { f: 800, f1: 120, type: 'lowpass' });
  }
  miss() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sawtooth', 240, 35, 0.7, 0.3, null, { lp: 2200, lp1: 90 });
    this.osc(t, 'sine', 70, 30, 0.6, 0.6);
    this.noise(t, 0.6, 0.28, null, { f: 1200, f1: 80, type: 'lowpass' });
  }
  missWindow() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 120, 40, 1.2, 0.32);
    this.osc(t, 'triangle', 600, 150, 1.0, 0.07);
  }
  teleport() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sawtooth', 120, 1400, 0.32, 0.11, null, { bp: 900, q: 3 });
    this.osc(t, 'sawtooth', 126, 1450, 0.32, 0.09, null, { bp: 1200, q: 3 });
    this.noise(t, 0.35, 0.16, null, { f: 300, f1: 6000, q: 4 });
  }
  split() {
    if (!this.ctx) return;
    const t = this.t;
    [1200, 1500, 1800].forEach((f, i) => this.osc(t + i * 0.02, 'sine', f, f * 1.5, 0.25, 0.07));
  }
  collapse() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 2400, 500, 0.22, 0.18);
    this.osc(t, 'triangle', 3200, 800, 0.15, 0.07);
    this.noise(t, 0.08, 0.14, null, { f: 5000 });
  }
  bh() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 55, 110, 0.6, 0.4);
    this.osc(t, 'sawtooth', 110, 440, 0.5, 0.07, null, { lp: 800 });
  }
  slowOn() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 320, 70, 0.45, 0.3);
    this.musLP.frequency.cancelScheduledValues(t);
    this.musLP.frequency.setTargetAtTime(650, t, 0.08);
  }
  slowOff() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 70, 320, 0.25, 0.2);
    this.musLP.frequency.cancelScheduledValues(t);
    this.musLP.frequency.setTargetAtTime(this.paused ? 500 : 16000, t, 0.12);
  }
  rewind() {
    if (!this.ctx) return;
    const t = this.t;
    const o = this.osc(t, 'sawtooth', 300, 900, 0.9, 0.11, null, { lp: 2400 });
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    lfo.frequency.value = 14;
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 1);
    this.noise(t, 0.9, 0.07, null, { f: 3000, type: 'highpass' });
  }
  rewindEnd() {
    if (!this.ctx) return;
    this.osc(this.t, 'sine', 200, 600, 0.2, 0.2);
  }
  warn() {
    if (!this.ctx) return;
    const t = this.t;
    for (let i = 0; i < 3; i++) this.osc(t + i * 0.18, 'square', 880, 880, 0.08, 0.05, null, { lp: 2000 });
  }
  shift() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 45, 90, 1.1, 0.5);
    this.osc(t, 'sawtooth', 90, 360, 0.9, 0.07, null, { lp: 900 });
  }
  boltFire() {
    if (!this.ctx) return;
    this.osc(this.t, 'square', 760, 240, 0.28, 0.07, null, { bp: 1200, q: 2 });
  }
  boltHit() {
    if (!this.ctx) return;
    const t = this.t;
    for (let i = 0; i < 10; i++) this.osc(t + i * 0.03, 'square', 100 + Math.random() * 2000, 0, 0.03, 0.07);
    this.noise(t, 0.4, 0.24, null, { f: 2000, q: 0.5 });
  }
  boltKill() {
    if (!this.ctx) return;
    const t = this.t;
    this.osc(t, 'sine', 1200, 200, 0.2, 0.2);
    this.noise(t, 0.15, 0.18, null, { f: 4000 });
  }
  serve() {
    if (!this.ctx) return;
    this.osc(this.t, 'sine', 660, 990, 0.09, 0.12);
  }
  clear() {
    if (!this.ctx) return;
    const t = this.t;
    [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => this.osc(t + i * 0.08, 'triangle', mtof(60 + s), 0, 0.4, 0.13, null, { send: this.dly }));
  }
  click() {
    if (!this.ctx) return;
    this.osc(this.t, 'triangle', 1400, 1100, 0.04, 0.08);
  }

  // ---------- music ----------
  setDim(dim, i) {
    this.bpm = dim.bpm;
    this.key = dim.key;
    this.prog = PROGS[(dim.prog !== undefined ? dim.prog : i) % PROGS.length];
    if (this.dly) this.dly.delayTime.setTargetAtTime((3 * 60) / this.bpm / 4, this.ctx.currentTime, 0.2);
  }
  setIntensity(x) {
    this.intensity = x;
  }
  setTimeScale(ts) {
    this.tempoScale = ts;
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.ctx) this.mus.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.1);
  }
  setPaused(p) {
    this.paused = p;
    if (this.ctx) this.musLP.frequency.setTargetAtTime(p ? 500 : 16000, this.ctx.currentTime, 0.1);
  }
  beat() {
    const c = this.ctx;
    if (!c) return 0;
    const now = c.currentTime;
    let last = -1;
    for (let i = 0; i < this.kicks.length; i++) if (this.kicks[i] <= now) last = this.kicks[i];
    return last < 0 ? 0 : Math.exp(-(now - last) * 6);
  }
  sched() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.nextT < c.currentTime - 0.25) this.nextT = c.currentTime + 0.05;
    const spb = 60 / this.bpm / 4;
    while (this.nextT < c.currentTime + 0.14) {
      if (this.musicOn) this.playStep(this.step, this.nextT, spb);
      this.nextT += spb / Math.max(0.3, this.tempoScale);
      this.step = (this.step + 1) % 64;
    }
  }
  playStep(step, t, spb) {
    const bar = step >> 4;
    const s = step & 15;
    const ch = this.prog[bar];
    const root = this.key + ch[0];
    const tri = ch[1] === 'm' ? [0, 3, 7] : [0, 4, 7];
    const full = this.intensity > 0.7 && !this.paused;
    if (s % 4 === 0) {
      this.kicks.push(t);
      if (this.kicks.length > 8) this.kicks.shift();
    }
    if (full) {
      if (s % 4 === 0) {
        this.osc(t, 'sine', 150, 42, 0.26, 0.8, this.mus, { glide: 0.12 });
        this.noise(t, 0.012, 0.1, this.mus, { f: 3000 });
      }
      if (s === 4 || s === 12) {
        this.noise(t, 0.16, 0.2, this.mus, { f: 1900, q: 0.7 });
        this.osc(t, 'triangle', 200, 140, 0.08, 0.1, this.mus);
      }
      if (s % 2 === 1) this.noise(t, 0.03, s % 4 === 3 ? 0.055 : 0.028, this.mus, { f: 9000, type: 'highpass' });
    }
    if (s % 2 === 0) {
      const f = mtof(root + (s % 8 === 6 ? 12 : 0));
      this.osc(t, 'sawtooth', f, 0, spb * 1.7, 0.18, this.mus, { lp: 900, lp1: 220, q: 4 });
      this.osc(t, 'sine', f, 0, spb * 1.7, 0.16, this.mus);
    }
    const n = root + 24 + tri[ARP[s]] + (s >= 8 && full ? 12 : 0);
    this.osc(t, 'square', mtof(n), 0, spb * 0.9, 0.04, this.mus, { lp: 2800, send: this.dly });
    if (s === 0) {
      for (const k of tri) {
        this.osc(t, 'sawtooth', mtof(root + 12 + k), 0, spb * 16, 0.028, this.mus, { attack: 0.35, lp: 1200, detune: 7 });
        this.osc(t, 'sawtooth', mtof(root + 12 + k), 0, spb * 16, 0.028, this.mus, { attack: 0.35, lp: 1200, detune: -7 });
      }
    }
  }
}
