// HYPERPONG — DOM heads-up display and screens.
const pad2 = (n) => String(n).padStart(2, '0');

export class Hud {
  constructor() {
    this.cache = Object.create(null);
    this.bigT = 0;
    this.warnT = 0;
    this.introT = 0;
  }
  $(id) {
    return document.getElementById(id);
  }
  html(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    this.$(id).innerHTML = v;
  }
  show(id, on) {
    this.$(id).classList.toggle('hidden', !on);
  }
  flag(id, on) {
    const k = 'f_' + id;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    this.show(id, on);
  }
  setTheme(pal) {
    const s = document.documentElement.style;
    s.setProperty('--a', pal.a);
    s.setProperty('--b', pal.b);
    s.setProperty('--c', pal.c);
  }
  setDim(dim, i, total) {
    this.setTheme(dim.pal);
    this.html('dimNo', i < 0 ? 'Endless mode' : `Dimension ${pad2(i + 1)} / ${pad2(total)}`);
    this.html('dimName', dim.name);
    const h = this.$('dimHint');
    h.textContent = dim.hint;
    h.classList.remove('fade');
    void h.offsetWidth;
    h.classList.add('fade');
  }
  showIntro(dim, i, total) {
    this.$('introNo').textContent = i < 0 ? 'Endless mode' : `Dimension ${pad2(i + 1)} of ${pad2(total)}`;
    this.$('introName').textContent = dim.name;
    this.$('introSub').textContent = dim.sub;
    this.$('introHint').textContent = dim.hint;
    const el = this.$('intro');
    clearTimeout(this.introT);
    el.classList.remove('hidden', 'out', 'in');
    void el.offsetWidth;
    el.classList.add('in');
  }
  hideIntro(now) {
    const el = this.$('intro');
    if (el.classList.contains('hidden')) return;
    clearTimeout(this.introT);
    if (now) {
      el.classList.add('hidden');
      return;
    }
    el.classList.add('out');
    this.introT = setTimeout(() => el.classList.add('hidden'), 450);
  }
  endScreens() {
    this.show('over', false);
    this.show('victory', false);
  }
  toast(text, kind = '') {
    const box = this.$('toasts');
    while (box.children.length > 3) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }
  big(text, sub = '', ms = 1200, kind = '') {
    this.$('bigText').textContent = text;
    this.$('subText').textContent = sub;
    const b = this.$('big');
    b.className = '';
    void b.offsetWidth;
    b.className = 'show ' + kind;
    clearTimeout(this.bigT);
    this.bigT = setTimeout(() => {
      b.className = '';
    }, ms);
  }
  warn(text, secs = 1.5) {
    const w = this.$('warn');
    w.textContent = '⚠ ' + text;
    w.classList.add('show');
    clearTimeout(this.warnT);
    this.warnT = setTimeout(() => w.classList.remove('show'), secs * 1000);
  }
  mutation(names) {
    this.big('MUTATION', names.join('  +  '), 1800, 'c');
  }
  flashCharges() {
    const c = this.$('charges');
    c.classList.remove('deny');
    void c.offsetWidth;
    c.classList.add('deny');
  }
  pips(id, n, max) {
    let s = '';
    for (let i = 0; i < max; i++) s += i < n ? '<i class="on"></i>' : '<i></i>';
    this.html(id, s);
  }
  showOver(G, where) {
    this.$('overStat').innerHTML = `Score <b>${G.score}</b><br>Reached <b>${where}</b><br>Best <b>${G.mode === 'endless' ? G.bestEndless : G.best}</b>`;
    this.show('over', true);
  }
  showVictory(G) {
    this.$('vicStat').innerHTML = `Final score <b>${G.score}</b><br>Best <b>${G.best}</b>`;
    this.show('victory', true);
  }
  update(G) {
    this.html('score', String(G.score).padStart(6, '0'));
    this.html('combo', G.combo > 2 ? `×${G.combo} rally` : '');
    this.pips('lives', Math.max(0, G.lives), Math.max(G.maxLives, G.lives));
    if (G.aiLives === Infinity) this.html('aiLives', '<b class="inf">∞</b>');
    else this.pips('aiLives', Math.max(0, G.aiLives), G.dim.aiLives);
    this.html('rewinds', '<i>⟲</i>'.repeat(Math.max(0, G.rewinds)));
    let c = '';
    for (let i = 0; i < 3; i++) c += i < G.charges ? '<i class="on"></i>' : '<i></i>';
    this.html('charges', c);
    const cf = G.chrono.toFixed(3);
    if (this.cache.cf !== cf) {
      this.cache.cf = cf;
      this.$('chronoFill').style.transform = `scaleX(${cf})`;
    }
    if (this.cache.ch !== G.chronoOn) {
      this.cache.ch = G.chronoOn;
      this.$('chrono').classList.toggle('active', G.chronoOn);
    }
    this.flag('serveHint', G.state === 'serve' && G.server === 'p' && !G.autopilot);
    this.flag('rwPrompt', G.state === 'missWindow');
    if (G.state === 'missWindow') this.$('rwBar').style.transform = `scaleX(${Math.max(0, G.mwT / 1.35).toFixed(3)})`;
    this.flag('rwOverlay', G.state === 'rewind');
    this.flag('invert', G.invertT > 0);
  }
}
