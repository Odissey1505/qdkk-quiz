// ============================================================
//  ЩДК Studio — Клуб знавців
//  studio.js — ігровий рушій, анімації, таймер, звук, сесії
//
//  Дані: ті самі пакети з Supabase (supabase.js → dbLoadPackages)
//  Зіграні: той самий ключ localStorage 'qdkk_played' ("pkgId::номер"),
//           що й у рандомайзері.
//  Сесія студії: localStorage 'qdkk_studio_session'
//  Налаштування студії: localStorage 'qdkk_studio_prefs'
// ============================================================
'use strict';
(() => {

// ════════════════════════════════════════════
//  УТИЛІТИ
// ════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const app = $('app');
const SECTORS = 13;
const SESSION_KEY = 'qdkk_studio_session';
const PREFS_KEY = 'qdkk_studio_prefs';
const PLAYED_KEY = 'qdkk_played';
const SPIN_MS = { short: 2600, standard: 4200, cinematic: 6200 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, '0');
const uid8 = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { console.warn('localStorage:', e); return false; }
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function fmtClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)) {
    if (base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      out[k] = deepMerge(base[k], over[k]);
    } else if (over[k] !== undefined) out[k] = over[k];
  }
  return out;
}

// ════════════════════════════════════════════
//  НАЛАШТУВАННЯ (зберігаються між візитами)
// ════════════════════════════════════════════
const DEFAULT_PREFS = {
  timerDuration: 60,
  spinSpeed: 'standard',
  skipSpin: false,
  autoReveal: true,
  showSource: true,
  reducedMotion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
  uiScale: 1,
  toolbarCollapsed: false,
  audio: { muted: false, master: 0.8, sfx: 0.85, ambient: 0.4, ambientOn: false },
  setup: { format: 'classic', target: 6, rounds: 12, onlyUnplayed: true, markPlayed: true, packageIds: null, tags: [] },
};
let prefs = deepMerge(DEFAULT_PREFS, lsGet(PREFS_KEY, {}));
const savePrefs = () => lsSet(PREFS_KEY, prefs);

// ════════════════════════════════════════════
//  РЕПОЗИТОРІЙ ЗАПИТАНЬ (обгортка над supabase.js)
// ════════════════════════════════════════════
const Repo = {
  packages: [],
  map: new Map(),
  status: 'loading', // loading | ready | error
  error: null,

  async load() {
    this.status = 'loading';
    this.error = null;
    try {
      if (typeof dbLoadPackages !== 'function') throw new Error('supabase.js не підключено');
      const rows = await dbLoadPackages();
      this.packages = Array.isArray(rows) ? rows.filter(Boolean) : [];
      this.status = 'ready';
    } catch (e) {
      console.error('Supabase load error:', e);
      this.packages = [];
      this.error = e;
      this.status = 'error';
    }
    this.map.clear();
    for (const pkg of this.packages) {
      for (const q of (pkg.questions || [])) {
        if (!q) continue;
        const uid = `${pkg.id}::${q.number}`;
        if (!this.map.has(uid)) this.map.set(uid, { pkg, q });
      }
    }
  },
  has(uid) { return this.map.has(uid); },
  get(uid) {
    const e = this.map.get(uid);
    if (!e) return null;
    const { pkg, q } = e;
    return {
      uid, pkgId: pkg.id, pkgTitle: pkg.title || 'Без назви', tournament: pkg.tournament || '', date: pkg.date || '',
      number: q.number, question: q.question || '', answer: q.answer || '', comment: q.comment || '', topic: q.topic || '',
      tags: ((pkg.tags_data || {})[q.number]) || [],
    };
  },
  tagsFor(pkgIds) {
    const set = new Set();
    for (const pkg of this.packages) {
      if (!pkgIds.includes(pkg.id)) continue;
      for (const tags of Object.values(pkg.tags_data || {})) if (Array.isArray(tags)) tags.forEach((t) => set.add(t));
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'uk'));
  },
  getPlayed() {
    const a = lsGet(PLAYED_KEY, []);
    return new Set(Array.isArray(a) ? a : []);
  },
  markPlayed(uid) {
    // читаємо свіжий список, щоб не затерти позначки з рандомайзера
    const s = this.getPlayed();
    if (!s.has(uid)) { s.add(uid); lsSet(PLAYED_KEY, [...s]); }
  },
  /** Пул запитань за конфігурацією. exclude — uid, які вже були в цій грі. */
  pool(cfg, exclude = new Set()) {
    const played = this.getPlayed();
    const ids = cfg.packageIds || [];
    const tags = cfg.tags || [];
    const seen = new Set();
    let total = 0, unplayed = 0, filteredOut = 0;
    const list = [];
    for (const pkg of this.packages) {
      if (!ids.includes(pkg.id)) continue;
      for (const q of (pkg.questions || [])) {
        if (!q) continue;
        const uid = `${pkg.id}::${q.number}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        total++;
        const isPlayed = played.has(uid);
        if (!isPlayed) unplayed++;
        const qTags = ((pkg.tags_data || {})[q.number]) || [];
        if (tags.length && !qTags.some((t) => tags.includes(t))) { filteredOut++; continue; }
        if (cfg.onlyUnplayed && isPlayed) { filteredOut++; continue; }
        if (exclude.has(uid)) { filteredOut++; continue; }
        list.push(uid);
      }
    }
    return { list, total, unplayed, filteredOut };
  },
};

// ════════════════════════════════════════════
//  ЗВУК (синтез Web Audio — без сторонніх записів)
// ════════════════════════════════════════════
const Sound = {
  ctx: null, master: null, sfx: null, amb: null, ambNodes: null, whirr: null, _noise: null, lastClick: 0,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.amb = this.ctx.createGain();
        this.amb.gain.value = 0;
        this.sfx.connect(this.master);
        this.amb.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.apply();
      } catch (e) { console.warn('Audio unavailable', e); this.ctx = null; return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  apply() {
    app.classList.toggle('is-muted', !!prefs.audio.muted);
    if (!this.ctx) return;
    const a = prefs.audio, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(a.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(a.ambientOn ? a.ambient * 0.55 : 0, t, 0.6);
    if (a.ambientOn && !a.muted) this.startAmbient();
    else if (!a.ambientOn) this.stopAmbient();
  },
  get on() { return !!this.ctx && !prefs.audio.muted; },
  noise() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (this._noise = buf);
  },
  tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, attack = 0.012, freqEnd = null } = {}) {
    if (!this.on) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfx);
      o.start(t); o.stop(t + dur + 0.05);
    } catch {}
  },
  bell(freq, dur, vol = 0.15, delay = 0) {
    this.tone(freq, dur, { vol, delay, attack: 0.005 });
    this.tone(freq * 2.76, dur * 0.5, { vol: vol * 0.32, delay, attack: 0.004 });
    this.tone(freq * 5.4, dur * 0.25, { vol: vol * 0.12, delay, attack: 0.003 });
  },
  burst(dur, { freq = 1000, freqEnd = null, q = 1, vol = 0.15, delay = 0, type = 'bandpass' } = {}) {
    if (!this.on) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const src = ctx.createBufferSource(); src.buffer = this.noise();
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.sfx);
      src.start(t); src.stop(t + dur + 0.05);
    } catch {}
  },
  play(name) {
    if (!this.on) return;
    switch (name) {
      case 'launch':
        this.tone(95, 0.35, { vol: 0.22, freqEnd: 60 });
        this.burst(0.7, { freq: 350, freqEnd: 1800, q: 0.9, vol: 0.08 });
        break;
      case 'click': {
        const now = performance.now();
        if (now - this.lastClick < 45) return;
        this.lastClick = now;
        this.burst(0.03, { freq: 2600, q: 2.5, vol: 0.16 });
        this.tone(1700, 0.025, { type: 'square', vol: 0.015, attack: 0.002 });
        break;
      }
      case 'select':
        this.bell(880, 1.6, 0.13);
        this.bell(1318.5, 1.8, 0.08, 0.09);
        break;
      case 'reveal':
        this.tone(392, 1.3, { vol: 0.07, attack: 0.08 });
        this.tone(587.33, 1.3, { vol: 0.055, delay: 0.07, attack: 0.08 });
        this.tone(783.99, 1.5, { type: 'triangle', vol: 0.035, delay: 0.14, attack: 0.1 });
        break;
      case 'timerStart':
        this.bell(196, 2.4, 0.16);
        break;
      case 'tick':
        this.tone(1250, 0.06, { type: 'triangle', vol: 0.09, attack: 0.003 });
        break;
      case 'timeUp':
        this.bell(220, 2.6, 0.2);
        this.bell(261.63, 2.6, 0.13, 0.02);
        this.bell(164.81, 3, 0.16, 0.06);
        break;
      case 'pause':
        this.tone(520, 0.14, { vol: 0.07 });
        break;
      case 'answer':
        this.bell(659.25, 1.3, 0.1);
        this.bell(987.77, 1.5, 0.07, 0.11);
        break;
      case 'experts':
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, i === 2 ? 0.7 : 0.28, { type: 'triangle', vol: 0.12, delay: i * 0.11 }));
        break;
      case 'questions':
        this.tone(392, 0.32, { type: 'triangle', vol: 0.12 });
        this.tone(311.13, 0.7, { type: 'triangle', vol: 0.12, delay: 0.18 });
        break;
      case 'none':
        this.tone(440, 0.3, { vol: 0.07 });
        break;
      case 'undo':
        this.tone(620, 0.12, { vol: 0.07 });
        this.tone(470, 0.2, { vol: 0.07, delay: 0.1 });
        break;
      case 'final':
        [261.63, 329.63, 392, 523.25].forEach((f, i) => this.bell(f, 2.6, 0.1, i * 0.16));
        this.tone(130.81, 3.2, { vol: 0.08, delay: 0.64, attack: 0.3 });
        break;
    }
  },
  whirrStart() {
    if (!this.on) return;
    this.whirrStop();
    try {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const n = ctx.createBufferSource(); n.buffer = this.noise(); n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 800; nf.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0.0001;
      o.connect(f).connect(g).connect(this.sfx);
      n.connect(nf).connect(ng).connect(this.sfx);
      o.start(); n.start();
      this.whirr = { o, f, g, n, nf, ng };
    } catch {}
  },
  whirrUpdate(v) {
    const w = this.whirr; if (!w) return;
    const t = this.ctx.currentTime;
    w.o.frequency.setTargetAtTime(36 + v * 110, t, 0.05);
    w.f.frequency.setTargetAtTime(220 + v * 1300, t, 0.05);
    w.g.gain.setTargetAtTime(0.0001 + v * 0.05, t, 0.06);
    w.nf.frequency.setTargetAtTime(450 + v * 2000, t, 0.05);
    w.ng.gain.setTargetAtTime(0.0001 + v * 0.045, t, 0.06);
  },
  whirrStop() {
    const w = this.whirr; if (!w) return;
    this.whirr = null;
    try {
      const t = this.ctx.currentTime;
      w.g.gain.setTargetAtTime(0.0001, t, 0.06);
      w.ng.gain.setTargetAtTime(0.0001, t, 0.06);
      w.o.stop(t + 0.4); w.n.stop(t + 0.4);
    } catch {}
  },
  startAmbient() {
    if (this.ambNodes || !this.ctx) return;
    try {
      const ctx = this.ctx;
      const pad = ctx.createGain(); pad.gain.value = 0.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
      lp.connect(pad).connect(this.amb);
      const oscs = [[110, 0, 'sine', 0.22], [164.81, 4, 'sine', 0.16], [220, -5, 'sine', 0.1], [329.63, 3, 'triangle', 0.035]].map(([f, d, type, v]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = d;
        const g = ctx.createGain(); g.gain.value = v;
        o.connect(g).connect(lp); o.start();
        return o;
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.22;
      lfo.connect(lfoG).connect(pad.gain); lfo.start();
      const n = ctx.createBufferSource(); n.buffer = this.noise(); n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 380;
      const ng = ctx.createGain(); ng.gain.value = 0.05;
      n.connect(nf).connect(ng).connect(this.amb); n.start();
      this.ambNodes = [...oscs, lfo, n];
    } catch (e) { console.warn(e); }
  },
  stopAmbient() {
    if (!this.ambNodes) return;
    const nodes = this.ambNodes; this.ambNodes = null;
    const t = this.ctx.currentTime;
    nodes.forEach((n) => { try { n.stop(t + 1.5); } catch {} });
  },
};

// ════════════════════════════════════════════
//  ПІСОЧНИЙ ГОДИННИК (SVG)
// ════════════════════════════════════════════
const Hourglass = {
  full: $('hgFull'), end: $('hgEnd'), stream: $('hgStream'), last: '',
  // Координати в пікселях вихідних кадрів 1024×1536.
  // Шар «повний» (пісок угорі) показується в смузі між поверхнею піску вгорі та гіркою внизу;
  // поза смугою видно шар «кінець» (пісок унизу). Так пісок справді пересипається.
  G: { H: 1536, top0: 196, neck: 728, bottom: 1314, edgeEnd: 955, peakEnd: 878, xl: 21.5, xr: 78.5 },
  render(p) {
    p = clamp(p, 0, 1);
    const g = this.G;
    const yt = g.neck - (g.neck - g.top0) * Math.cbrt(1 - p);          // рівень у верхній колбі
    const dip = 16 * Math.min(1, p * 5) * (1 - p);                     // лійка в центрі
    const h = (1 - Math.cbrt(1 - 0.919 * p)) / (1 - Math.cbrt(0.081)); // наповнення нижньої колби
    const edge = g.bottom - (g.bottom - g.edgeEnd) * h;
    const peak = edge - (g.edgeEnd - g.peakEnd) * Math.sqrt(p);
    const Y = (v) => `${(v / g.H * 100).toFixed(2)}%`;
    const pts = [`${g.xl}% ${Y(yt)}`, `50% ${Y(yt + dip)}`, `${g.xr}% ${Y(yt)}`, `${g.xr}% ${Y(edge)}`];
    for (let k = 1; k < 10; k++) {
      const x = g.xr - (g.xr - g.xl) * k / 10;
      const u = Math.abs(x - 50) / (g.xr - 50);
      pts.push(`${x.toFixed(2)}% ${Y(peak + (edge - peak) * Math.pow(u, 1.25))}`);
    }
    pts.push(`${g.xl}% ${Y(edge)}`);
    const band = pts.join(',');
    if (band === this.last) return;
    this.last = band;
    this.full.style.clipPath = `polygon(${band})`;
    this.end.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${band}, ${pts[0]}, 0% 0%)`;
    const st = g.neck + 6;
    this.stream.style.top = Y(st);
    this.stream.style.height = p >= 0.999 ? '0' : Y(Math.max(0, peak - st));
  },
};

// ════════════════════════════════════════════
//  ТАЙМЕР (монотонний годинник performance.now)
// ════════════════════════════════════════════
const Timer = {
  duration: 60, elapsed: 0, startedAt: null, status: 'idle', // idle | running | paused | stopped | expired
  raf: 0, iv: 0, lastWhole: null, onExpire: null, onSecond: null,
  panel: $('timerPanel'), digits: $('timerDigits'), label: $('timerLabel'), bar: $('timerBarFill'),

  remainingMs() {
    const run = this.status === 'running' ? performance.now() - this.startedAt : 0;
    return Math.max(0, this.duration * 1000 - (this.elapsed + run));
  },
  progress() { return this.duration ? 1 - this.remainingMs() / (this.duration * 1000) : 0; },
  set(duration, remainingMs = null, status = 'idle') {
    this.stopLoop();
    this.duration = Math.max(1, Number(duration) || 60);
    const rem = remainingMs == null ? this.duration * 1000 : clamp(remainingMs, 0, this.duration * 1000);
    this.elapsed = this.duration * 1000 - rem;
    this.startedAt = null;
    this.status = status === 'running' ? 'paused' : status;
    if (this.status !== 'idle' && rem <= 0) this.status = 'expired';
    this.lastWhole = null;
    this.render();
  },
  start() {
    if (this.status === 'running' || this.status === 'expired') return;
    this.startedAt = performance.now();
    this.status = 'running';
    this.lastWhole = Math.ceil(this.remainingMs() / 1000);
    this.loop();
  },
  pause() {
    if (this.status !== 'running') return;
    this.elapsed += performance.now() - this.startedAt;
    this.startedAt = null;
    this.status = 'paused';
    this.stopLoop();
    this.render();
  },
  stop() {
    if (this.status === 'running') { this.elapsed += performance.now() - this.startedAt; this.startedAt = null; }
    if (this.status !== 'expired') this.status = 'stopped';
    this.stopLoop();
    this.render();
  },
  loop() {
    this.stopLoop();
    const frame = () => {
      if (this.status !== 'running') return;
      if (this.remainingMs() <= 0) { this.expire(); return; }
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    // Запасний цикл: rAF зупиняється у фоновій вкладці
    this.iv = setInterval(() => {
      if (this.status !== 'running') return;
      if (this.remainingMs() <= 0) this.expire();
      else if (document.hidden) this.render();
    }, 250);
    this.render();
  },
  stopLoop() { cancelAnimationFrame(this.raf); clearInterval(this.iv); this.raf = 0; this.iv = 0; },
  expire() {
    this.elapsed = this.duration * 1000;
    this.startedAt = null;
    this.status = 'expired';
    this.stopLoop();
    this.render();
    if (this.onExpire) this.onExpire();
  },
  tstate(rem) {
    if (this.status === 'expired') return 'expired';
    if (this.status === 'idle') return 'normal';
    if (rem > 20000) return 'normal';
    if (rem > 10000) return 'warning';
    return 'critical';
  },
  render() {
    const rem = this.remainingMs();
    const p = this.progress();
    const whole = Math.ceil(rem / 1000);
    this.digits.textContent = fmtClock(rem);
    this.bar.style.transform = `scaleX(${(1 - p).toFixed(4)})`;
    Hourglass.render(p);
    const ts = this.tstate(rem);
    if (this.panel.dataset.tstate !== ts) this.panel.dataset.tstate = ts;
    const appTs = (this.status === 'running' || this.status === 'paused') && ts === 'critical' ? 'critical' : '';
    if ((app.dataset.tstate || '') !== appTs) app.dataset.tstate = appTs;
    this.panel.classList.toggle('running', this.status === 'running');
    this.panel.classList.toggle('paused', this.status === 'paused');
    let label;
    switch (this.status) {
      case 'idle': label = this.duration === 60 ? 'Хвилина на обговорення' : 'Час на обговорення'; break;
      case 'running': label = ts === 'critical' ? 'Останні секунди' : 'Обговорення'; break;
      case 'paused': label = 'Пауза'; break;
      case 'stopped': label = 'Обговорення завершено'; break;
      case 'expired': label = 'Час вийшов!'; break;
    }
    if (this.label.textContent !== label) this.label.textContent = label;
    if (this.status === 'running' && whole !== this.lastWhole) {
      this.lastWhole = whole;
      if (whole <= 10 && whole > 0) Sound.play('tick');
      if (this.onSecond) this.onSecond(whole);
    }
  },
  snapshot() { return { duration: this.duration, remaining: Math.round(this.remainingMs()), status: this.status }; },
};

// ════════════════════════════════════════════
//  СТІЛ І ДЗИҐА
// ════════════════════════════════════════════
const Spinner = {
  angle: 152, raf: 0, running: false, final: 0, resolve: null,
  pointer: null, ghosts: [], sheen: $('topSheen'), figure: $('topFigure'),

  build() {
    const step = 360 / SECTORS;
    const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]; };
    // Геометрія фото столу: радіус 472 одиниці; кільця й конверти виміряно на зображенні
    const R = 472, side = (2 * R) / 0.9638, rIn = 0.396 * R, rOut = 0.962 * R, rEnv = 0.677 * R;
    const ew = 0.164 * R, eh = 0.102 * R;
    let s = `
    <defs>
      <radialGradient id="tbShadow" cx="50%" cy="50%" r="50%">
        <stop offset="80%" stop-color="#000" stop-opacity=".6"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="tbHl" cx="50%" cy="50%" r="50%">
        <stop offset="35%" stop-color="#e1c58d" stop-opacity="0"/><stop offset="100%" stop-color="#f3dca5" stop-opacity=".5"/>
      </radialGradient>
      <radialGradient id="tbTopShadow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#000" stop-opacity=".55"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </radialGradient>
      <filter id="envGlowF" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <circle r="508" cy="28" fill="url(#tbShadow)"/>
    <image href="assets/studio/table.webp" x="${-side / 2}" y="${-side / 2}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`;
    for (let i = 0; i < SECTORS; i++) {
      const a0 = i * step, a1 = (i + 1) * step, ac = (i + 0.5) * step;
      const [x0, y0] = pt(rIn, a0), [x1, y1] = pt(rOut, a0), [x2, y2] = pt(rOut, a1), [x3, y3] = pt(rIn, a1);
      s += `<path class="sector-hl" id="secHl${i}" d="M${x0},${y0} L${x1},${y1} A${rOut},${rOut} 0 0 1 ${x2},${y2} L${x3},${y3} A${rIn},${rIn} 0 0 0 ${x0},${y0} Z" fill="url(#tbHl)" style="mix-blend-mode:screen"/>`;
      const [ex, ey] = pt(rEnv, ac);
      s += `<g transform="translate(${ex},${ey}) rotate(${ac.toFixed(2)})">
        <rect class="env-glow" id="envGlow${i}" x="${-ew / 2 - 6}" y="${-eh / 2 - 6}" width="${ew + 12}" height="${eh + 12}" rx="8" fill="none" stroke="#ffe7b0" stroke-width="6" filter="url(#envGlowF)"/>
        <rect class="env-shade" id="envShade${i}" x="${-ew / 2}" y="${-eh / 2}" width="${ew}" height="${eh}" rx="3" fill="#1c0f08" fill-opacity=".62"/></g>`;
    }
    s += `<circle r="96" fill="url(#tbTopShadow)"/>`;
    $('tableSvg').innerHTML = s;

    // Стрілка: тінь + «шлейф» розмиття + сама стрілка. Обертаються лише CSS-трансформацією.
    const plane = document.querySelector('.table-plane');
    const layer = (cls, wrapShadow) => {
      const d = document.createElement('div');
      d.className = 'pointer-layer ' + cls;
      d.innerHTML = '<img class="pointer-img" src="assets/studio/pointer.webp" alt="" draggable="false" />';
      if (wrapShadow) {
        const w = document.createElement('div');
        w.className = 'pointer-shadow-wrap';
        w.appendChild(d);
        plane.appendChild(w);
      } else plane.appendChild(d);
      return d;
    };
    this.shadow = layer('pointer-shadow', true);
    for (let g = 0; g < 3; g++) this.ghosts.push(layer('pointer-ghost'));
    this.pointer = layer('pointer-main');
    this.apply(this.angle, 0, 0);
  },
  sectorAngle(i) { return (i + 0.5) * 360 / SECTORS; },
  apply(angle, v, now) {
    const tf = `rotate(${angle.toFixed(2)}deg)`;
    this.pointer.style.transform = tf;
    if (this.shadow) this.shadow.style.transform = tf;
    this.ghosts.forEach((g, i) => {
      const op = v > 0.05 ? (v * 0.3) / (i + 1) : 0;
      g.style.opacity = op.toFixed(3);
      if (op) g.style.transform = `rotate(${(angle - (i + 1) * (4 + v * 13)).toFixed(2)}deg)`;
    });
    // Блиск на корпусі дзиґи: смуги «біжать» зі швидкістю обертання
    if (this.sheen) {
      this.sheen.style.opacity = (v * 0.95).toFixed(3);
      if (v > 0.01) this.sheen.style.backgroundPosition = `${(-angle * 0.55).toFixed(1)}px 0`;
    }
    if (v > 0.02 && !prefs.reducedMotion) {
      this.figure.style.transform = `translateX(${(Math.sin(now / 41) * v * 1.4).toFixed(2)}px) rotate(${(Math.sin(now / 67) * v * 1.8).toFixed(2)}deg)`;
    } else this.figure.style.transform = '';
  },
  setAngle(a) { this.angle = ((a % 360) + 360) % 360; this.apply(this.angle, 0, 0); },
  spinTo(sector, ms) {
    return new Promise((resolve) => {
      this.cancel();
      const step = 360 / SECTORS;
      const target = this.sectorAngle(sector) + (Math.random() - 0.5) * step * 0.5;
      const base = this.angle;
      const cur = ((base % 360) + 360) % 360;
      const delta = ((target - cur) % 360 + 360) % 360;
      const turns = Math.max(2, Math.round((ms / 1000) * 1.6));
      const total = turns * 360 + delta;
      const peak = (2.4 * total) / ms;
      this.final = base + total;
      this.resolve = resolve;
      this.running = true;
      const t0 = performance.now();
      let lastA = base, lastT = t0, lastSector = Math.round(base / step);
      const ramp = 0.13;
      const ease = (t) => {
        const r = t < ramp ? (t / ramp) * (t / ramp) * (3 - 2 * (t / ramp)) : 1;
        return r * (1 - Math.pow(1 - t, 3.1));
      };
      Sound.play('launch');
      Sound.whirrStart();
      const frame = (now) => {
        const t = clamp((now - t0) / ms, 0, 1);
        const a = base + total * ease(t);
        const dt = Math.max(1, now - lastT);
        const v = clamp((a - lastA) / dt / peak, 0, 1);
        this.angle = a;
        this.apply(a, v, now);
        const sec = Math.round(a / step);
        if (sec !== lastSector) { lastSector = sec; if (v < 0.6) Sound.play('click'); }
        Sound.whirrUpdate(v);
        lastA = a; lastT = now;
        if (t < 1) this.raf = requestAnimationFrame(frame);
        else this.finish();
      };
      this.raf = requestAnimationFrame(frame);
    });
  },
  jumpTo(sector) {
    this.cancel();
    const step = 360 / SECTORS;
    this.setAngle(this.sectorAngle(sector) + (Math.random() - 0.5) * step * 0.5);
    return Promise.resolve();
  },
  finish() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (!this.running) return;
    this.running = false;
    this.setAngle(this.final);
    Sound.whirrStop();
    if (!prefs.reducedMotion && this.figure.animate) {
      this.figure.animate([
        { transform: 'rotate(1.8deg)' }, { transform: 'rotate(-1.2deg)' }, { transform: 'rotate(0.7deg)' },
        { transform: 'rotate(-0.3deg)' }, { transform: 'rotate(0deg)' },
      ], { duration: 950, easing: 'ease-out' });
    }
    const r = this.resolve; this.resolve = null;
    if (r) r();
  },
  skip() { if (this.running) this.finish(); },
  cancel() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.running) { this.running = false; this.resolve = null; Sound.whirrStop(); this.apply(this.angle, 0, 0); }
  },
  highlight(sector) {
    for (let i = 0; i < SECTORS; i++) {
      $('secHl' + i).classList.toggle('on', i === sector);
      $('envGlow' + i).classList.toggle('on', i === sector);
    }
  },
  setUsed(list, current = null) {
    const set = new Set(list || []);
    for (let i = 0; i < SECTORS; i++) $('envShade' + i).classList.toggle('used', set.has(i) && i !== current);
  },
};

// ════════════════════════════════════════════
//  СЕСІЯ ТА СКІНЧЕННИЙ АВТОМАТ ГРИ
// ════════════════════════════════════════════
/** Дозволені переходи. GAME_COMPLETE доступний з будь-якого ігрового стану (дострокове завершення). */
const FLOW = {
  SETUP: ['READY'],
  READY: ['SPINNING'],
  SPINNING: ['QUESTION_SELECTED'],
  QUESTION_SELECTED: ['QUESTION_REVEAL', 'QUESTION_VISIBLE'],
  QUESTION_REVEAL: ['QUESTION_VISIBLE'],
  QUESTION_VISIBLE: ['DISCUSSION', 'ANSWER_REVEAL'],
  DISCUSSION: ['DISCUSSION_PAUSED', 'TIME_EXPIRED', 'ANSWER_REVEAL', 'QUESTION_VISIBLE'],
  DISCUSSION_PAUSED: ['DISCUSSION', 'ANSWER_REVEAL', 'QUESTION_VISIBLE'],
  TIME_EXPIRED: ['ANSWER_REVEAL', 'QUESTION_VISIBLE'],
  ANSWER_REVEAL: ['SCORING', 'ROUND_COMPLETE'],
  SCORING: ['ROUND_COMPLETE'],
  ROUND_COMPLETE: ['READY', 'SCORING'],
  GAME_COMPLETE: ['SCORING'],
};
const PHASE = {
  SETUP: 'idle', READY: 'idle', SPINNING: 'spinning', QUESTION_SELECTED: 'selected',
  QUESTION_REVEAL: 'question', QUESTION_VISIBLE: 'question',
  DISCUSSION: 'discussion', DISCUSSION_PAUSED: 'discussion', TIME_EXPIRED: 'discussion',
  ANSWER_REVEAL: 'answer', SCORING: 'answer', ROUND_COMPLETE: 'answer', GAME_COMPLETE: 'final',
};
const QUESTION_STATES = new Set(['QUESTION_REVEAL', 'QUESTION_VISIBLE', 'DISCUSSION', 'DISCUSSION_PAUSED', 'TIME_EXPIRED', 'ANSWER_REVEAL', 'SCORING', 'ROUND_COMPLETE']);
const ANSWER_STATES = new Set(['ANSWER_REVEAL', 'SCORING', 'ROUND_COMPLETE']);
const ACTIVE = (s) => !!s && s.state !== 'GAME_COMPLETE' && s.state !== 'SETUP';

let S = null;               // поточна сесія (серіалізується в localStorage)
const ui = { answerHidden: false, pending: 0, screen: 'intro' };

const Engine = {
  go(to) {
    if (!S) return false;
    const from = S.state;
    if (to !== 'GAME_COMPLETE' && !(FLOW[from] || []).includes(to)) {
      console.warn(`Недозволений перехід ${from} → ${to}`);
      return false;
    }
    clearTimeout(ui.pending);
    S.state = to;
    this.enter(to, from);
    this.save();
    renderAll();
    return true;
  },
  later(ms, expectState, fn) {
    clearTimeout(ui.pending);
    ui.pending = setTimeout(() => { if (S && S.state === expectState) fn(); }, ms);
  },
  enter(to, from) {
    const fast = prefs.reducedMotion;
    switch (to) {
      case 'READY':
        Spinner.highlight(null);
        Spinner.setUsed(S.sectorsUsed);
        closeCard();
        announce('');
        Timer.set(S.config.timerDuration);
        break;
      case 'QUESTION_SELECTED':
        Spinner.highlight(S.current.sector);
        announce('Запитання обрано!', `Сектор ${S.current.sector + 1}`);
        Sound.play('select');
        if (prefs.autoReveal) this.later(fast ? 500 : 1500, 'QUESTION_SELECTED', () => this.showQuestion());
        break;
      case 'QUESTION_REVEAL':
        announce('');
        openCard(false);
        Sound.play('reveal');
        this.later(fast ? 60 : 1050, 'QUESTION_REVEAL', () => this.go('QUESTION_VISIBLE'));
        break;
      case 'QUESTION_VISIBLE':
        if (from === 'QUESTION_SELECTED') { announce(''); openCard(true); }
        if (from === 'QUESTION_REVEAL') $('qLayer').classList.add('instant');
        if (['DISCUSSION', 'DISCUSSION_PAUSED', 'TIME_EXPIRED'].includes(from)) Timer.set(S.config.timerDuration);
        break;
      case 'DISCUSSION':
        if (from === 'QUESTION_VISIBLE') {
          Timer.set(S.config.timerDuration);
          Sound.play('timerStart');
          const tp = $('timerPanel'); tp.classList.remove('glint'); void tp.offsetWidth; tp.classList.add('glint');
        }
        Timer.start();
        break;
      case 'DISCUSSION_PAUSED':
        Timer.pause();
        Sound.play('pause');
        break;
      case 'TIME_EXPIRED':
        Sound.play('timeUp');
        break;
      case 'ANSWER_REVEAL':
        Timer.stop();
        ui.answerHidden = false;
        renderAnswer();
        if (S.config.markPlayed && S.current) Repo.markPlayed(S.current.uid);
        Sound.play('answer');
        this.later(fast ? 60 : 700, 'ANSWER_REVEAL', () => this.go('SCORING'));
        break;
      case 'GAME_COMPLETE':
        Timer.stop();
        Spinner.cancel();
        Sound.whirrStop();
        showScreen('final');
        renderFinal();
        Sound.play('final');
        break;
    }
  },
  save() {
    if (!S) return;
    S.updatedAt = Date.now();
    S.timer = Timer.snapshot();
    S.pointerAngle = Math.round(Spinner.angle * 100) / 100;
    lsSet(SESSION_KEY, S);
  },

  // ---- Створення / відновлення ----
  newGame(cfg) {
    const { list } = Repo.pool(cfg);
    if (!list.length) return false;
    clearTimeout(ui.pending);
    Spinner.cancel();
    S = {
      v: 1, id: uid8(), createdAt: Date.now(), updatedAt: Date.now(),
      config: { ...cfg },
      order: shuffle([...list]), cursor: 0, used: [],
      state: 'READY', round: 0, current: null, sectorsUsed: [],
      score: { experts: 0, questions: 0 }, history: [], corrections: 0,
      gameOver: false, endReason: null, timer: null, pointerAngle: Spinner.angle,
    };
    ui.answerHidden = false;
    prevScore.e = prevScore.q = 0;
    Timer.set(cfg.timerDuration);
    Spinner.setUsed([]);
    Spinner.highlight(null);
    closeCard();
    announce('');
    showScreen('studio');
    this.save();
    renderAll();
    return true;
  },
  resume() {
    const saved = lsGet(SESSION_KEY, null);
    if (!ACTIVE(saved)) return false;
    S = saved;
    S.history = S.history || []; S.used = S.used || []; S.sectorsUsed = S.sectorsUsed || [];
    // Безпечне відновлення: анімації завершено, таймер на паузі, відповідь не показуємо автоматично
    const map = { SPINNING: 'QUESTION_SELECTED', QUESTION_REVEAL: 'QUESTION_VISIBLE', DISCUSSION: 'DISCUSSION_PAUSED', ANSWER_REVEAL: 'SCORING' };
    S.state = map[S.state] || S.state;
    ui.answerHidden = ANSWER_STATES.has(S.state);
    const t = S.timer || {};
    Timer.set(t.duration || S.config.timerDuration, t.remaining, t.status || 'idle');
    if (S.state === 'DISCUSSION_PAUSED' && Timer.status === 'idle') Timer.status = 'paused';
    Spinner.setAngle(S.pointerAngle || 0);
    Spinner.setUsed(S.sectorsUsed, S.current ? S.current.sector : null);
    Spinner.highlight(S.state === 'QUESTION_SELECTED' && S.current ? S.current.sector : null);
    prevScore.e = S.score.experts; prevScore.q = S.score.questions;
    closeCard();
    announce(S.state === 'QUESTION_SELECTED' ? 'Запитання обрано!' : '', S.current ? `Сектор ${S.current.sector + 1}` : '');
    showScreen('studio');
    if (QUESTION_STATES.has(S.state)) { openCard(true); renderAnswer(); }
    this.save();
    renderAll();
    toast('Гру відновлено. Таймер на паузі.');
    return true;
  },

  // ---- Дії ведучого ----
  reserve() {
    const used = new Set(S.used);
    while (S.cursor < S.order.length) {
      const uid = S.order[S.cursor++];
      if (!used.has(uid) && Repo.has(uid)) return uid;
    }
    return null;
  },
  pickSector() {
    if (S.sectorsUsed.length >= SECTORS) S.sectorsUsed = [];
    const free = [];
    for (let i = 0; i < SECTORS; i++) if (!S.sectorsUsed.includes(i)) free.push(i);
    const s = free[Math.floor(Math.random() * free.length)];
    S.sectorsUsed.push(s);
    return s;
  },
  spin() {
    if (!S || S.state !== 'READY' || Spinner.running || S.gameOver) return;
    const uid = this.reserve();               // 1. обираємо й резервуємо запитання
    if (!uid) { this.save(); this.exhausted(); return; }
    S.round += 1;
    S.current = { uid, sector: this.pickSector(), round: S.round }; // 2. сектор для анімації
    S.used.push(uid);
    ui.answerHidden = false;
    if (!this.go('SPINNING')) return;
    Spinner.setUsed(S.sectorsUsed, S.current.sector);
    const ms = prefs.skipSpin ? 0 : (prefs.reducedMotion ? 800 : SPIN_MS[prefs.spinSpeed] || SPIN_MS.standard);
    const p = ms ? Spinner.spinTo(S.current.sector, ms) : Spinner.jumpTo(S.current.sector); // 3. дзиґа зупиняється на секторі
    p.then(() => { if (S && S.state === 'SPINNING') this.go('QUESTION_SELECTED'); });
  },
  skipAnimation() {
    if (!S) return;
    if (S.state === 'SPINNING') Spinner.skip();
    else if (S.state === 'QUESTION_REVEAL') this.go('QUESTION_VISIBLE');
  },
  showQuestion() { if (S && S.state === 'QUESTION_SELECTED') this.go('QUESTION_REVEAL'); },
  startTimer() { if (S && S.state === 'QUESTION_VISIBLE') this.go('DISCUSSION'); },
  pause() { if (S && S.state === 'DISCUSSION') this.go('DISCUSSION_PAUSED'); },
  resumeTimer() { if (S && S.state === 'DISCUSSION_PAUSED') this.go('DISCUSSION'); },
  toggleTimer() {
    if (!S) return;
    if (S.state === 'QUESTION_VISIBLE') this.startTimer();
    else if (S.state === 'DISCUSSION') this.pause();
    else if (S.state === 'DISCUSSION_PAUSED') this.resumeTimer();
  },
  resetTimer() {
    if (S && ['DISCUSSION', 'DISCUSSION_PAUSED', 'TIME_EXPIRED'].includes(S.state)) this.go('QUESTION_VISIBLE');
  },
  revealAnswer() {
    if (!S) return;
    if (['QUESTION_VISIBLE', 'DISCUSSION', 'DISCUSSION_PAUSED', 'TIME_EXPIRED'].includes(S.state)) this.go('ANSWER_REVEAL');
    else if (ui.answerHidden && ANSWER_STATES.has(S.state)) {
      ui.answerHidden = false;
      renderAnswer();
      Sound.play('answer');
      renderToolbar(true);
    }
  },
  score(result) {
    if (!S || !['ANSWER_REVEAL', 'SCORING'].includes(S.state) || ui.answerHidden || !S.current) return;
    if (S.history.some((h) => h.round === S.round)) return; // захист від подвійного нарахування
    S.history.push({ round: S.round, uid: S.current.uid, sector: S.current.sector, result, at: Date.now() });
    if (result === 'experts') S.score.experts++;
    if (result === 'questions') S.score.questions++;
    S.gameOver = this.isOver();
    Sound.play(result);
    this.go('ROUND_COMPLETE');
    if (S.gameOver) toast(this.overText());
  },
  isOver() {
    const c = S.config;
    if (c.format === 'classic') return S.score.experts >= c.target || S.score.questions >= c.target;
    if (c.format === 'rounds') return S.round >= c.rounds;
    return false;
  },
  overText() {
    const { experts: e, questions: q } = S.score;
    if (S.config.format === 'classic') return e > q ? `Знавці набрали ${e} — перемога!` : `Запитання набрали ${q} — перемога запитань`;
    return 'Останній раунд зіграно';
  },
  undo() {
    if (!S) return;
    if (!['ROUND_COMPLETE', 'GAME_COMPLETE'].includes(S.state)) { toast('Скасувати можна після нарахування бала'); return; }
    const last = S.history[S.history.length - 1];
    if (!last || last.round !== S.round || (S.state === 'GAME_COMPLETE' && S.endReason === 'manual')) { toast('Немає що скасовувати'); return; }
    S.history.pop();
    if (last.result === 'experts') S.score.experts = Math.max(0, S.score.experts - 1);
    if (last.result === 'questions') S.score.questions = Math.max(0, S.score.questions - 1);
    S.gameOver = false;
    S.endReason = null;
    const fromFinal = S.state === 'GAME_COMPLETE';
    Sound.play('undo');
    this.go('SCORING');
    if (fromFinal) {
      showScreen('studio');
      openCard(true);
      renderAnswer();
      renderAll();
    }
    toast('Останній бал скасовано');
  },
  next() {
    if (!S || S.state !== 'ROUND_COMPLETE') return;
    if (S.gameOver) { this.finish(S.config.format === 'classic' ? 'target' : 'rounds'); return; }
    S.current = null;
    this.go('READY');
  },
  finish(reason) {
    if (!S) return;
    S.endReason = reason;
    S.finishedAt = Date.now();
    this.go('GAME_COMPLETE');
  },
  askEnd() {
    if (!S) return;
    dialog({
      title: 'Завершити гру?',
      text: `Поточний рахунок ${S.score.experts} : ${S.score.questions}. Гра перейде до підсумків.`,
      actions: [
        { label: 'Скасувати', cls: 'btn-ghost' },
        { label: 'Завершити гру', cls: 'btn-danger', run: () => this.finish('manual') },
      ],
    });
  },
  exhausted() {
    dialog({
      title: 'Запитання закінчились',
      text: 'У вибраних пакетах більше немає доступних запитань для цієї гри.\nОберіть, що робити далі:',
      actions: [
        { label: 'Змінити пакети', cls: 'btn-ghost', run: () => Setup.open(true) },
        { label: 'Дозволити повтори', cls: 'btn-ghost', run: () => this.allowRepeats() },
        { label: 'Завершити гру', cls: 'btn-gold', run: () => this.finish('exhausted') },
      ],
    });
  },
  allowRepeats() {
    const cfg = { ...S.config, onlyUnplayed: false };
    let { list } = Repo.pool(cfg, new Set(S.used));
    if (!list.length) { list = Repo.pool(cfg).list; S.used = S.current ? [S.current.uid] : []; }
    if (!list.length) { toast('У вибраних пакетах немає жодного запитання'); return; }
    S.config.onlyUnplayed = false;
    S.order = shuffle([...list]);
    S.cursor = 0;
    this.save();
    renderAll();
    toast(`Доступно ще ${list.length} ${plural(list.length, 'запитання', 'запитання', 'запитань')} — крутіть дзиґу`);
  },
  applyConfig(cfg) {
    // Зміна пакетів посеред гри: рахунок і історія зберігаються
    Object.assign(S.config, cfg);
    const exclude = new Set(S.used);
    S.order = shuffle([...Repo.pool(S.config, exclude).list]);
    S.cursor = 0;
    if (S.state === 'ROUND_COMPLETE') S.gameOver = this.isOver();
    if (Timer.status === 'idle') Timer.set(S.config.timerDuration);
    showScreen('studio');
    this.save();
    renderAll();
    toast('Налаштування гри оновлено');
  },
  replay() {
    if (!S) { Setup.open(false); return; }
    const cfg = { ...S.config };
    if (!this.newGame(cfg)) {
      dialog({
        title: 'Немає нових запитань',
        text: 'Усі запитання з цих пакетів уже зіграні.',
        actions: [
          { label: 'Змінити пакети', cls: 'btn-ghost', run: () => Setup.open(false) },
          { label: 'Дозволити повтори', cls: 'btn-gold', run: () => { if (!this.newGame({ ...cfg, onlyUnplayed: false })) toast('У пакетах немає запитань'); } },
        ],
      });
    }
  },
  fixScore(side, d) {
    if (!ACTIVE(S)) return;
    S.score[side] = Math.max(0, S.score[side] + d);
    S.corrections = (S.corrections || 0) + 1;
    if (S.state === 'ROUND_COMPLETE') S.gameOver = this.isOver();
    this.save();
    renderAll();
  },
};

// ════════════════════════════════════════════
//  ДІЇ ПАНЕЛІ ВЕДУЧОГО
// ════════════════════════════════════════════
const ACTIONS = {
  spin: { label: 'Крутити дзиґу', key: 'S', cls: 'btn-gold', run: () => Engine.spin() },
  skip: { label: 'Пропустити анімацію', key: 'Enter', cls: 'btn-ghost', run: () => Engine.skipAnimation() },
  showQuestion: { label: 'Показати запитання', key: 'Enter', cls: 'btn-gold', run: () => Engine.showQuestion() },
  startTimer: { label: 'Почати обговорення', key: 'Пробіл', cls: 'btn-gold', run: () => Engine.startTimer() },
  pause: { label: 'Пауза', key: 'Пробіл', cls: 'btn-ghost', run: () => Engine.pause() },
  resume: { label: 'Продовжити', key: 'Пробіл', cls: 'btn-gold', run: () => Engine.resumeTimer() },
  resetTimer: { label: 'Скинути таймер', key: 'R', cls: 'btn-ghost', run: () => Engine.resetTimer() },
  revealAnswer: { label: 'Показати відповідь', key: 'Enter', cls: (st) => (['TIME_EXPIRED', 'SCORING', 'ROUND_COMPLETE', 'ANSWER_REVEAL'].includes(st) ? 'btn-gold' : 'btn-ghost'), run: () => Engine.revealAnswer() },
  scoreExperts: { label: 'Бал знавцям', key: '1', cls: 'btn-experts', run: () => Engine.score('experts') },
  scoreQuestions: { label: 'Бал запитанням', key: '2', cls: 'btn-questions', run: () => Engine.score('questions') },
  scoreNone: { label: 'Без бала', key: '0', cls: 'btn-ghost', run: () => Engine.score('none') },
  next: { label: () => (S && S.gameOver ? 'До підсумків гри' : 'Наступний раунд'), key: '→', cls: 'btn-gold', run: () => Engine.next() },
  undo: { label: 'Скасувати бал', key: 'Z', cls: 'btn-ghost', run: () => Engine.undo() },
  endGame: { label: 'Завершити гру', key: '', cls: 'btn-danger', run: () => Engine.askEnd() },
};
function actionsFor(st) {
  switch (st) {
    case 'READY': return S && S.round > 0 ? ['spin', 'endGame'] : ['spin'];
    case 'SPINNING': return ['skip'];
    case 'QUESTION_SELECTED': return ['showQuestion'];
    case 'QUESTION_REVEAL': return ['skip'];
    case 'QUESTION_VISIBLE': return ['startTimer', 'revealAnswer'];
    case 'DISCUSSION': return ['pause', 'resetTimer', 'revealAnswer'];
    case 'DISCUSSION_PAUSED': return ['resume', 'resetTimer', 'revealAnswer'];
    case 'TIME_EXPIRED': return ['revealAnswer', 'resetTimer'];
    case 'ANSWER_REVEAL':
    case 'SCORING': return ui.answerHidden ? ['revealAnswer'] : ['scoreExperts', 'scoreQuestions', 'scoreNone'];
    case 'ROUND_COMPLETE': {
      const a = ['next', 'undo'];
      if (ui.answerHidden) a.unshift('revealAnswer');
      if (!S.gameOver) a.push('endGame');
      return a;
    }
    default: return [];
  }
}
const PHASE_TEXT = {
  READY: 'Готові до раунду', SPINNING: 'Дзиґа крутиться', QUESTION_SELECTED: 'Запитання обрано',
  QUESTION_REVEAL: 'Відкриваємо запитання', QUESTION_VISIBLE: 'Читання запитання', DISCUSSION: 'Обговорення',
  DISCUSSION_PAUSED: 'Пауза', TIME_EXPIRED: 'Час вийшов', ANSWER_REVEAL: 'Хто отримує бал?', SCORING: 'Хто отримує бал?',
  ROUND_COMPLETE: 'Раунд завершено', GAME_COMPLETE: 'Гру завершено',
};
function runAction(id) {
  Sound.ensure();
  const a = ACTIONS[id];
  if (a && actionsFor(S && S.state).includes(id)) a.run();
}

// ════════════════════════════════════════════
//  РЕНДЕР
// ════════════════════════════════════════════
const prevScore = { e: 0, q: 0 };
let lastTbKey = '';

function showScreen(name) {
  ui.screen = name;
  app.dataset.screen = name;
  if (name !== 'studio') app.dataset.phase = name === 'final' ? 'final' : 'idle';
  $('dsecScore').hidden = !(name === 'studio' && ACTIVE(S));
  $('dsecGame').hidden = !(name === 'studio' && ACTIVE(S));
}
function renderAll() {
  if (!S) return;
  if (ui.screen === 'studio') app.dataset.phase = PHASE[S.state] || 'idle';
  renderHeader();
  renderToolbar();
  $('dsecScore').hidden = !(ui.screen === 'studio' && ACTIVE(S));
  $('dsecGame').hidden = !(ui.screen === 'studio' && ACTIVE(S));
  $('fixExperts').textContent = S.score.experts;
  $('fixQuestions').textContent = S.score.questions;
}
function renderHeader() {
  const { experts: e, questions: q } = S.score;
  const ex = $('scoreExperts'), qs = $('scoreQuestions');
  ex.textContent = pad2(e);
  qs.textContent = pad2(q);
  if (e !== prevScore.e) bump(ex);
  if (q !== prevScore.q) bump(qs);
  prevScore.e = e; prevScore.q = q;
  const shown = Math.max(1, S.state === 'READY' ? S.round + 1 : S.round);
  $('roundLabel').textContent = S.config.format === 'rounds' ? `${pad2(Math.min(shown, S.config.rounds))} / ${pad2(S.config.rounds)}` : pad2(shown);
  const c = S.config;
  const fmt = c.format === 'classic' ? `Гра до ${c.target} ${plural(c.target, 'бала', 'балів', 'балів')}` : c.format === 'rounds' ? `${c.rounds} ${plural(c.rounds, 'раунд', 'раунди', 'раундів')}` : 'Тренування без обмежень';
  const n = (c.packageIds || []).length;
  $('sourceBar').textContent = `${fmt} · ${n} ${plural(n, 'пакет', 'пакети', 'пакетів')} · ${c.timerDuration} с на обговорення`;
}
function bump(el) {
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function renderToolbar(force) {
  const st = S ? S.state : null;
  const list = actionsFor(st);
  const key = `${st}|${list.join(',')}|${S && S.gameOver}`;
  let phase = PHASE_TEXT[st] || '';
  if (st === 'ROUND_COMPLETE' && S.gameOver) phase = S.config.format === 'classic' ? 'Переможця визначено' : 'Останній раунд';
  $('phaseLabel').textContent = phase;
  if (key === lastTbKey && !force) return;
  lastTbKey = key;
  $('tbActions').innerHTML = list.map((id) => {
    const a = ACTIONS[id];
    const label = typeof a.label === 'function' ? a.label() : a.label;
    const cls = typeof a.cls === 'function' ? a.cls(st) : a.cls;
    return `<button class="btn ${cls} anim-in" type="button" data-action="${id}">${esc(label)}${a.key ? `<kbd>${esc(a.key)}</kbd>` : ''}</button>`;
  }).join('');
}

// ---- Картка запитання ----
function openCard(instant) {
  const layer = $('qLayer');
  const q = S && S.current ? Repo.get(S.current.uid) : null;
  $('qNum').textContent = `Запитання № ${S.round}`;
  const meta = [];
  meta.push(`<span>Сектор ${S.current ? S.current.sector + 1 : '—'}</span>`);
  if (prefs.showSource && q) {
    const src = [q.pkgTitle, q.tournament, q.date ? formatDate(q.date) : '', `№ ${q.number}`].filter(Boolean).join(' · ');
    meta.push(`<span> · ${esc(src)}</span>`);
    if (q.topic) meta.push(`<span> · ${esc(q.topic)}</span>`);
    (q.tags || []).forEach((t) => meta.push(`<span class="tag">${esc(t)}</span>`));
  }
  $('qMeta').innerHTML = meta.join('');
  const txt = $('qText');
  if (q) { txt.textContent = q.question.trim() || 'Текст запитання відсутній'; txt.classList.toggle('missing', !q.question.trim()); }
  else { txt.textContent = 'Запитання недоступне — пакет змінено або видалено. Можна завершити раунд без бала.'; txt.classList.add('missing'); }
  $('qAnswerSlot').innerHTML = '';
  layer.classList.remove('is-open', 'instant');
  if (instant) layer.classList.add('instant');
  void layer.offsetWidth;
  layer.classList.add('is-open');
  requestAnimationFrame(fitText);
}
function closeCard() {
  const layer = $('qLayer');
  layer.classList.remove('is-open', 'instant');
  $('qAnswerSlot').innerHTML = '';
}
function renderAnswer() {
  const slot = $('qAnswerSlot');
  if (!S || !S.current || !ANSWER_STATES.has(S.state)) { slot.innerHTML = ''; return; }
  if (ui.answerHidden) {
    slot.innerHTML = '<div class="q-answer hidden-after-restore">Відповідь приховано після відновлення гри. Натисніть «Показати відповідь» або Enter.</div>';
  } else {
    // Відповідь потрапляє в DOM лише в цей момент — за командою ведучого
    const q = Repo.get(S.current.uid);
    const ans = q && q.answer.trim() ? q.answer : 'Відповідь не вказана';
    slot.innerHTML = `<div class="q-answer"><div class="q-answer-label">Відповідь</div><div class="q-answer-text">${esc(ans)}</div>${q && q.comment.trim() ? `<div class="q-answer-comment"><b>Коментар</b>${esc(q.comment)}</div>` : ''}</div>`;
  }
  requestAnimationFrame(fitText);
}
function fitText() {
  const layer = $('qLayer');
  if (!layer.classList.contains('is-open')) return;
  const body = $('qBody'), el = $('qText');
  body.classList.remove('scrollable');
  body.scrollTop = 0;
  const vh = window.innerHeight, vw = window.innerWidth;
  const hi = clamp(Math.min(vh * 0.06, vw * 0.034), 22, 68) * prefs.uiScale;
  let lo = 18;
  // offsetHeight не залежить від transform-анімацій (на відміну від scrollHeight)
  const fits = () => el.offsetHeight <= body.clientHeight + 1;
  el.style.fontSize = hi + 'px';
  if (fits()) return;
  let top = hi;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + top) / 2;
    el.style.fontSize = mid + 'px';
    if (fits()) lo = mid; else top = mid;
  }
  el.style.fontSize = lo + 'px';
  if (!fits()) body.classList.add('scrollable');
}
let annTimer = 0;
function announce(text, sub = '') {
  const el = $('announce');
  clearTimeout(annTimer);
  if (!text) { el.classList.remove('show'); return; }
  el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  el.classList.add('show');
}

// ---- Фінал ----
function renderFinal() {
  const { experts: e, questions: q } = S.score;
  $('finalWinner').textContent = e > q ? 'ЗНАВЦІ ПЕРЕМОГЛИ!' : q > e ? 'ПЕРЕМОГЛИ ЗАПИТАННЯ' : 'НІЧИЯ';
  $('finalScore').textContent = `${e} : ${q}`;
  const h = S.history;
  const count = (r) => h.filter((x) => x.result === r).length;
  const stats = [
    [h.length, plural(h.length, 'раунд зіграно', 'раунди зіграно', 'раундів зіграно')],
    [count('experts'), 'правильних відповідей'],
    [count('questions'), 'неправильних відповідей'],
    [count('none'), 'без бала / пропущено'],
  ];
  $('finalStats').innerHTML = stats.map(([n, l]) => `<div class="final-stat"><b>${n}</b><span>${esc(l)}</span></div>`).join('');
  const last = h[h.length - 1];
  $('btnFinalUndo').hidden = !(last && last.round === S.round && ['target', 'rounds'].includes(S.endReason));
}

// ════════════════════════════════════════════
//  ЕКРАН ПІДГОТОВКИ
// ════════════════════════════════════════════
const Setup = {
  mid: false, cfg: null,
  open(mid) {
    this.mid = !!(mid && ACTIVE(S));
    const base = this.mid ? S.config : { ...prefs.setup, timerDuration: prefs.timerDuration };
    const all = Repo.packages.map((p) => p.id);
    let ids = base.packageIds ? base.packageIds.filter((id) => all.includes(id)) : all;
    if (!this.mid && !base.packageIds) ids = all;
    this.cfg = {
      packageIds: ids, tags: [...(base.tags || [])], format: base.format || 'classic',
      target: base.target || 6, rounds: base.rounds || 12, onlyUnplayed: base.onlyUnplayed !== false,
      markPlayed: base.markPlayed !== false, timerDuration: base.timerDuration || prefs.timerDuration || 60,
    };
    $('pkgSearch').value = '';
    $('btnStart').hidden = this.mid;
    $('btnApplyMid').hidden = !this.mid;
    $('setupTitle').textContent = this.mid ? 'Зміна пакетів' : 'Підготовка до гри';
    closeDrawer();
    showScreen('setup');
    this.render();
  },
  render() { this.renderPackages(); this.renderTags(); this.renderOptions(); this.renderSummary(); },
  renderPackages() {
    const list = $('pkgList');
    if (Repo.status === 'loading') { list.innerHTML = '<div class="pkg-empty">Завантаження бази…</div>'; return; }
    if (Repo.status === 'error') {
      list.innerHTML = '<div class="pkg-empty">Не вдалося завантажити базу запитань. Перевірте з\'єднання з інтернетом.<br><button class="btn btn-ghost" type="button" data-retry>Спробувати ще раз</button></div>';
      return;
    }
    if (!Repo.packages.length) {
      list.innerHTML = '<div class="pkg-empty">У базі поки немає пакетів. Додайте запитання, щоб розпочати гру.<br><a class="btn btn-ghost" href="index.html">📦 До бази пакетів</a></div>';
      return;
    }
    const played = Repo.getPlayed();
    const term = $('pkgSearch').value.trim().toLowerCase();
    list.innerHTML = Repo.packages.map((p) => {
      const qs = p.questions || [];
      const un = qs.filter((q) => q && !played.has(`${p.id}::${q.number}`)).length;
      const sub = [p.tournament, p.date ? formatDate(p.date) : ''].filter(Boolean).join(' · ');
      const hidden = term && !(`${p.title} ${p.tournament || ''}`.toLowerCase().includes(term));
      return `<label class="pkg-item"${hidden ? ' hidden' : ''}>
        <input type="checkbox" data-pkg="${esc(p.id)}" ${this.cfg.packageIds.includes(p.id) ? 'checked' : ''} />
        <span class="pkg-name" title="${esc(p.title)}">${esc(p.title || 'Без назви')}${sub ? `<span class="pkg-sub">${esc(sub)}</span>` : ''}</span>
        <span class="pkg-count"><b>${un}</b> / ${qs.length}<span class="pkg-sub">незіграні</span></span>
      </label>`;
    }).join('');
  },
  renderTags() {
    const tags = Repo.tagsFor(this.cfg.packageIds);
    this.cfg.tags = this.cfg.tags.filter((t) => tags.includes(t));
    $('tagTitle').hidden = !tags.length;
    $('tagList').innerHTML = tags.map((t) => `<button type="button" data-tag="${esc(t)}" class="${this.cfg.tags.includes(t) ? 'active' : ''}">${esc(t)}</button>`).join('');
  },
  renderOptions() {
    const c = this.cfg;
    document.querySelectorAll('#segFormat button').forEach((b) => { const on = b.dataset.val === c.format; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    $('rowTarget').hidden = c.format !== 'classic';
    $('rowRounds').hidden = c.format !== 'rounds';
    $('inpTarget').value = c.target;
    $('inpRounds').value = c.rounds;
    document.querySelectorAll('#chipsRounds button').forEach((b) => b.classList.toggle('active', +b.dataset.val === c.rounds));
    $('formatNote').textContent = c.format === 'classic'
      ? `Гра триває, доки знавці або запитання не наберуть ${c.target} ${plural(c.target, 'бал', 'бали', 'балів')}.`
      : c.format === 'rounds' ? 'Після останнього раунду гра завершується. Нічия можлива.' : 'Без обмежень — ведучий сам завершує гру.';
    document.querySelectorAll('#chipsTimer button').forEach((b) => b.classList.toggle('active', +b.dataset.val === c.timerDuration));
    $('inpTimer').value = c.timerDuration;
    $('optOnlyUnplayed').checked = c.onlyUnplayed;
    $('optMarkPlayed').checked = c.markPlayed;
  },
  renderSummary() {
    const c = this.cfg;
    const warn = $('summaryWarn');
    warn.hidden = true; warn.className = 'summary-warn'; warn.innerHTML = '';
    const showWarn = (html, error) => { warn.hidden = false; warn.classList.toggle('error', !!error); warn.innerHTML = html; };
    const exclude = this.mid ? new Set(S.used) : new Set();
    const pool = Repo.pool(c, exclude);
    const avail = pool.list.length;
    const fmt = c.format === 'classic' ? `до ${c.target} ${plural(c.target, 'бала', 'балів', 'балів')}` : c.format === 'rounds' ? `${c.rounds} ${plural(c.rounds, 'раунд', 'раунди', 'раундів')}` : 'тренування';
    const rows = [
      ['Пакетів обрано', `${c.packageIds.length} з ${Repo.packages.length}`],
      ['Усього запитань', pool.total],
      ['Незіграних', pool.unplayed],
      ['Відсіяно фільтрами', pool.filteredOut],
      ['Формат', fmt],
      ['Таймер', `${c.timerDuration} с`],
      ['Звук', prefs.audio.muted ? 'вимкнено' : (prefs.audio.ambientOn ? 'ефекти + атмосфера' : 'ефекти')],
      ['Доступно для гри', avail],
    ];
    $('summaryList').innerHTML = rows.map(([k, v], i) => `<dt>${esc(k)}</dt><dd class="${i === rows.length - 1 ? 'big' : ''}">${esc(v)}</dd>`).join('');
    let ok = avail > 0 && Repo.status === 'ready';
    if (Repo.status === 'error') showWarn('Базу запитань не вдалося завантажити. Перевірте інтернет і спробуйте ще раз.<br><button class="btn btn-ghost" type="button" data-retry>Спробувати ще раз</button>', true);
    else if (Repo.status === 'ready' && !Repo.packages.length) showWarn('У базі поки немає пакетів. Додайте запитання, щоб розпочати гру.', true);
    else if (!c.packageIds.length) showWarn('Оберіть хоча б один пакет.', true);
    else if (!avail) {
      const allPlayed = c.onlyUnplayed && pool.total > 0 && pool.unplayed === 0;
      showWarn(allPlayed
        ? 'Усі запитання у вибраних пакетах уже зіграні.<br><button class="btn btn-ghost" type="button" data-allow-repeats>Дозволити повтори</button>'
        : 'У вибраних пакетах немає доступних запитань.', true);
    } else if (c.format === 'rounds' && avail < c.rounds) showWarn(`Доступно лише ${avail} ${plural(avail, 'запитання', 'запитання', 'запитань')} на ${c.rounds} раундів — гра може закінчитися раніше.`);
    else if (c.format === 'classic' && avail < c.target * 2 - 1) showWarn(`Доступно ${avail} ${plural(avail, 'запитання', 'запитання', 'запитань')} — для гри до ${c.target} може знадобитися до ${c.target * 2 - 1}.`);
    $('btnStart').disabled = !ok;
    $('btnApplyMid').disabled = !ok;
  },
  start() {
    const c = { ...this.cfg };
    const doStart = () => {
      const allSelected = Repo.packages.length && c.packageIds.length === Repo.packages.length;
      prefs.setup = { format: c.format, target: c.target, rounds: c.rounds, onlyUnplayed: c.onlyUnplayed, markPlayed: c.markPlayed, packageIds: allSelected ? null : [...c.packageIds], tags: [...c.tags] };
      prefs.timerDuration = c.timerDuration;
      savePrefs();
      Sound.ensure();
      if (!Engine.newGame(c)) toast('Немає доступних запитань');
    };
    const saved = S && ACTIVE(S) ? S : lsGet(SESSION_KEY, null);
    if (ACTIVE(saved)) {
      dialog({
        title: 'Розпочати нову гру?',
        text: `Є незавершена гра: рахунок ${saved.score.experts} : ${saved.score.questions}, раунд ${saved.round}.\nЯкщо почати нову, попередня гра буде закрита.`,
        actions: [
          { label: 'Скасувати', cls: 'btn-ghost' },
          { label: 'Почати нову гру', cls: 'btn-gold', run: doStart },
        ],
      });
    } else doStart();
  },
  bind() {
    $('pkgList').addEventListener('change', (e) => {
      const id = e.target.dataset.pkg; if (!id) return;
      const set = new Set(this.cfg.packageIds);
      e.target.checked ? set.add(id) : set.delete(id);
      this.cfg.packageIds = Repo.packages.map((p) => p.id).filter((x) => set.has(x));
      this.renderTags(); this.renderSummary();
    });
    $('pkgSearch').addEventListener('input', () => this.renderPackages());
    $('btnPkgAll').onclick = () => { this.cfg.packageIds = Repo.packages.map((p) => p.id); this.render(); };
    $('btnPkgNone').onclick = () => { this.cfg.packageIds = []; this.render(); };
    $('tagList').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tag]'); if (!t) return;
      const tag = t.dataset.tag;
      this.cfg.tags = this.cfg.tags.includes(tag) ? this.cfg.tags.filter((x) => x !== tag) : [...this.cfg.tags, tag];
      this.renderTags(); this.renderSummary();
    });
    $('segFormat').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.cfg.format = b.dataset.val; this.renderOptions(); this.renderSummary(); });
    document.querySelectorAll('[data-step="target"]').forEach((b) => b.addEventListener('click', () => { this.cfg.target = clamp(this.cfg.target + +b.dataset.d, 1, 30); this.renderOptions(); this.renderSummary(); }));
    $('inpTarget').addEventListener('change', (e) => { this.cfg.target = clamp(parseInt(e.target.value, 10) || 6, 1, 30); this.renderOptions(); this.renderSummary(); });
    $('chipsRounds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.cfg.rounds = +b.dataset.val; this.renderOptions(); this.renderSummary(); });
    $('inpRounds').addEventListener('change', (e) => { this.cfg.rounds = clamp(parseInt(e.target.value, 10) || 12, 1, 200); this.renderOptions(); this.renderSummary(); });
    $('chipsTimer').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.cfg.timerDuration = +b.dataset.val; this.renderOptions(); this.renderSummary(); });
    $('inpTimer').addEventListener('change', (e) => { this.cfg.timerDuration = clamp(parseInt(e.target.value, 10) || 60, 5, 900); this.renderOptions(); this.renderSummary(); });
    $('optOnlyUnplayed').addEventListener('change', (e) => { this.cfg.onlyUnplayed = e.target.checked; this.renderSummary(); });
    $('optMarkPlayed').addEventListener('change', (e) => { this.cfg.markPlayed = e.target.checked; });
    $('screenSetup').addEventListener('click', async (e) => {
      if (e.target.closest('[data-allow-repeats]')) { this.cfg.onlyUnplayed = false; this.renderOptions(); this.renderSummary(); }
      if (e.target.closest('[data-retry]')) { Repo.status = 'loading'; this.render(); await Repo.load(); this.open(this.mid); updateIntroStatus(); }
    });
    $('btnStart').onclick = () => this.start();
    $('btnApplyMid').onclick = () => Engine.applyConfig({ ...this.cfg });
    $('btnSetupBack').onclick = () => { if (this.mid && ACTIVE(S)) { showScreen('studio'); renderAll(); } else showScreen('intro'); };
  },
};

// ════════════════════════════════════════════
//  ШУХЛЯДА НАЛАШТУВАНЬ, ДІАЛОГИ, ТОСТ
// ════════════════════════════════════════════
function openDrawer() { syncDrawer(); app.classList.add('drawer-open'); $('settingsDrawer').setAttribute('aria-hidden', 'false'); }
function closeDrawer() { app.classList.remove('drawer-open'); $('settingsDrawer').setAttribute('aria-hidden', 'true'); }
function syncDrawer() {
  const dur = S && ACTIVE(S) ? S.config.timerDuration : prefs.timerDuration;
  document.querySelectorAll('#dChipsTimer button').forEach((b) => b.classList.toggle('active', +b.dataset.val === dur));
  $('dInpTimer').value = dur;
  document.querySelectorAll('#segSpin button').forEach((b) => b.classList.toggle('active', b.dataset.val === prefs.spinSpeed));
  document.querySelectorAll('#segScale button').forEach((b) => b.classList.toggle('active', +b.dataset.val === prefs.uiScale));
  $('optSkipSpin').checked = prefs.skipSpin;
  $('optAutoReveal').checked = prefs.autoReveal;
  $('optShowSource').checked = prefs.showSource;
  $('optReducedMotion').checked = prefs.reducedMotion;
  $('optMute').checked = prefs.audio.muted;
  $('volMaster').value = prefs.audio.master;
  $('volSfx').value = prefs.audio.sfx;
  $('optAmbient').checked = prefs.audio.ambientOn;
  $('volAmbient').value = prefs.audio.ambient;
  if (S) { $('fixExperts').textContent = S.score.experts; $('fixQuestions').textContent = S.score.questions; }
}
function setTimerDuration(v) {
  v = clamp(parseInt(v, 10) || 60, 5, 900);
  prefs.timerDuration = v; savePrefs();
  if (S && ACTIVE(S)) {
    S.config.timerDuration = v;
    if (Timer.status === 'idle') Timer.set(v);
    Engine.save();
    renderHeader();
  }
  syncDrawer();
}
function applyVisualPrefs() {
  app.classList.toggle('reduced-motion', !!prefs.reducedMotion);
  app.classList.toggle('toolbar-collapsed', !!prefs.toolbarCollapsed);
  document.documentElement.style.setProperty('--ui-scale', prefs.uiScale);
}
function bindDrawer() {
  $('dChipsTimer').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTimerDuration(b.dataset.val); });
  $('dInpTimer').addEventListener('change', (e) => setTimerDuration(e.target.value));
  $('segSpin').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.spinSpeed = b.dataset.val; savePrefs(); syncDrawer(); });
  $('segScale').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.uiScale = +b.dataset.val; savePrefs(); applyVisualPrefs(); syncDrawer(); setTimeout(fitText, 50); });
  const bool = (id, fn) => $(id).addEventListener('change', (e) => { fn(e.target.checked); savePrefs(); });
  bool('optSkipSpin', (v) => (prefs.skipSpin = v));
  bool('optAutoReveal', (v) => (prefs.autoReveal = v));
  bool('optShowSource', (v) => { prefs.showSource = v; if (S && QUESTION_STATES.has(S.state)) refreshCardMeta(); });
  bool('optReducedMotion', (v) => { prefs.reducedMotion = v; applyVisualPrefs(); });
  bool('optMute', (v) => { prefs.audio.muted = v; Sound.ensure(); Sound.apply(); });
  bool('optAmbient', (v) => { prefs.audio.ambientOn = v; Sound.ensure(); Sound.apply(); });
  const range = (id, key) => $(id).addEventListener('input', (e) => { prefs.audio[key] = +e.target.value; Sound.ensure(); Sound.apply(); savePrefs(); });
  range('volMaster', 'master'); range('volSfx', 'sfx'); range('volAmbient', 'ambient');
  $('settingsDrawer').addEventListener('click', (e) => {
    const f = e.target.closest('[data-fix]');
    if (f) { Engine.fixScore(f.dataset.fix, +f.dataset.d); syncDrawer(); }
  });
  $('btnChangePkgs').onclick = () => Setup.open(true);
  $('btnDrawerEnd').onclick = () => { closeDrawer(); Engine.askEnd(); };
  $('drawerBackdrop').onclick = closeDrawer;
}
function refreshCardMeta() {
  // Перемальовуємо лише рядок джерела, не чіпаючи відповідь
  const slot = $('qAnswerSlot').innerHTML;
  openCard(true);
  $('qAnswerSlot').innerHTML = slot;
  requestAnimationFrame(fitText);
}

let dialogActions = [];
function dialog({ title, text, actions }) {
  $('dialogTitle').textContent = title;
  $('dialogText').textContent = text || '';
  dialogActions = actions || [{ label: 'Добре', cls: 'btn-gold' }];
  $('dialogActions').innerHTML = dialogActions.map((a, i) => `<button class="btn ${a.cls || 'btn-ghost'}" type="button" data-dlg="${i}">${esc(a.label)}</button>`).join('');
  openModal('dialog');
  setTimeout(() => { const btns = $('dialogActions').querySelectorAll('button'); if (btns.length) btns[btns.length - 1].focus(); }, 30);
}
function openModal(id) { const m = $(id); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
function closeModal(id) { const m = $(id); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
const anyModal = () => $('dialog').classList.contains('open') || $('helpModal').classList.contains('open');

let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ════════════════════════════════════════════
//  ПОВНИЙ ЕКРАН, ПАНЕЛЬ, КЛАВІАТУРА
// ════════════════════════════════════════════
function toggleFullscreen() {
  const d = document;
  try {
    if (d.fullscreenElement) { d.exitFullscreen().catch(() => {}); return; }
    const el = d.documentElement;
    if (!el.requestFullscreen) { toast('Повноекранний режим недоступний у цьому браузері'); return; }
    el.requestFullscreen().catch(() => toast('Повноекранний режим недоступний'));
  } catch { toast('Повноекранний режим недоступний'); }
}
function toggleToolbar(force) {
  prefs.toolbarCollapsed = typeof force === 'boolean' ? force : !prefs.toolbarCollapsed;
  app.classList.remove('toolbar-peeking');
  savePrefs();
  applyVisualPrefs();
  setTimeout(fitText, 380);
}
function toggleMute() {
  prefs.audio.muted = !prefs.audio.muted;
  savePrefs();
  Sound.ensure();
  Sound.apply();
  syncDrawer();
  toast(prefs.audio.muted ? 'Звук вимкнено' : 'Звук увімкнено', 1400);
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const typing = t && ((t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape') {
    if (typing) t.blur();
    if ($('dialog').classList.contains('open')) closeModal('dialog');
    else if ($('helpModal').classList.contains('open')) closeModal('helpModal');
    else if (app.classList.contains('drawer-open')) closeDrawer();
    return;
  }
  if (typing || anyModal() || app.classList.contains('drawer-open')) return;
  const code = e.code;
  if (code === 'KeyF') { e.preventDefault(); toggleFullscreen(); return; }
  if (code === 'Slash' && e.shiftKey) { openModal('helpModal'); return; }
  if (ui.screen !== 'studio' || !S) return;
  if (e.repeat) { if (code === 'Space') e.preventDefault(); return; }
  Sound.ensure();
  const st = S.state;
  switch (code) {
    case 'KeyS': runAction('spin'); break;
    case 'Space':
      e.preventDefault();
      Engine.toggleTimer();
      break;
    case 'Enter': case 'NumpadEnter':
      e.preventDefault();
      if (st === 'SPINNING' || st === 'QUESTION_REVEAL') Engine.skipAnimation();
      else if (st === 'QUESTION_SELECTED') Engine.showQuestion();
      else Engine.revealAnswer();
      break;
    case 'ArrowRight':
      if (st === 'SPINNING') { toast('Зачекайте — дзиґа ще крутиться'); break; }
      Engine.next();
      break;
    case 'Digit1': case 'Numpad1': Engine.score('experts'); break;
    case 'Digit2': case 'Numpad2': Engine.score('questions'); break;
    case 'Digit0': case 'Numpad0': Engine.score('none'); break;
    case 'KeyZ': Engine.undo(); break;
    case 'KeyR': Engine.resetTimer(); break;
    case 'KeyH': toggleToolbar(); break;
    case 'KeyM': toggleMute(); break;
    default: return;
  }
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tbActions')) document.activeElement.blur();
}

// ════════════════════════════════════════════
//  ДЕКОР: годинник і емблема
// ════════════════════════════════════════════
function buildDecor() {
  // Настінний годинник показує справжній час
  const hour = $('clockHour'), min = $('clockMin');
  const tickClock = () => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
    hour.style.transform = `rotate(${(h * 30).toFixed(2)}deg)`;
    min.style.transform = `rotate(${(m * 6).toFixed(2)}deg)`;
  };
  tickClock();
  setInterval(tickClock, 10000);
  // Пилинки у світлі прожектора (кілька, ледь помітні)
  const dust = $('sceneDust');
  let html = '';
  for (let i = 0; i < 16; i++) {
    const size = (1.5 + Math.random() * 2.5).toFixed(1);
    const dur = (16 + Math.random() * 18).toFixed(1);
    html += `<span class="dust" style="left:${(38 + Math.random() * 24).toFixed(1)}%;top:${(10 + Math.random() * 60).toFixed(1)}%;width:${size}px;height:${size}px;` +
      `--dx:${(Math.random() * 60 - 30).toFixed(0)}px;--dy:${(-60 - Math.random() * 120).toFixed(0)}px;--o:${(0.25 + Math.random() * 0.4).toFixed(2)};` +
      `animation-duration:${dur}s;animation-delay:-${(Math.random() * dur).toFixed(1)}s"></span>`;
  }
  dust.innerHTML = html;
}

// ════════════════════════════════════════════
//  ІНІЦІАЛІЗАЦІЯ
// ════════════════════════════════════════════
function updateIntroStatus() {
  const el = $('introStatus');
  if (Repo.status === 'loading') el.textContent = 'Завантаження бази запитань…';
  else if (Repo.status === 'error') el.textContent = 'Не вдалося завантажити базу запитань — перевірте інтернет.';
  else if (!Repo.packages.length) el.textContent = 'У базі поки немає пакетів. Додайте запитання, щоб розпочати гру.';
  else {
    const total = Repo.map.size, n = Repo.packages.length;
    el.textContent = `У базі ${n} ${plural(n, 'пакет', 'пакети', 'пакетів')} · ${total} ${plural(total, 'запитання', 'запитання', 'запитань')}`;
  }
}
function offerResume() {
  const saved = lsGet(SESSION_KEY, null);
  const has = ACTIVE(saved);
  $('btnIntroResume').hidden = !has;
  if (!has) return;
  const when = new Date(saved.updatedAt || Date.now()).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  dialog({
    title: 'Продовжити попередню гру?',
    text: `Рахунок ${saved.score.experts} : ${saved.score.questions}, раунд ${saved.round || 1}.\nЗбережено ${when}.`,
    actions: [
      { label: 'Почати нову', cls: 'btn-ghost', run: () => Setup.open(false) },
      { label: 'Продовжити', cls: 'btn-gold', run: () => { Sound.ensure(); Engine.resume(); } },
    ],
  });
}

function bindGlobal() {
  $('btnIntroNew').onclick = () => { Sound.ensure(); Setup.open(false); };
  $('btnIntroResume').onclick = () => { Sound.ensure(); Engine.resume(); };
  $('tbActions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    runAction(b.dataset.action);
    b.blur();
  });
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { if (o.dataset.open === 'settings') openDrawer(); else openModal('helpModal'); return; }
    const c = e.target.closest('[data-close]');
    if (c) { if (c.dataset.close === 'settings') closeDrawer(); else closeModal('helpModal'); return; }
    const d = e.target.closest('[data-dlg]');
    if (d) {
      const a = dialogActions[+d.dataset.dlg];
      closeModal('dialog');
      if (a && a.run) a.run();
    }
  });
  ['dialog', 'helpModal'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target.id === id) closeModal(id); }));
  $('btnMute').onclick = toggleMute;
  $('btnFullscreen').onclick = toggleFullscreen;
  $('btnToolbarToggle').onclick = () => toggleToolbar(true);
  $('btnToolbarPeek').onclick = () => toggleToolbar(false);
  $('toolbarHotzone').addEventListener('mouseenter', () => app.classList.add('toolbar-peeking'));
  $('toolbar').addEventListener('mouseleave', () => setTimeout(() => app.classList.remove('toolbar-peeking'), 500));
  $('btnFinalReplay').onclick = () => { Sound.ensure(); Engine.replay(); };
  $('btnFinalNew').onclick = () => Setup.open(false);
  $('btnFinalUndo').onclick = () => Engine.undo();
  document.addEventListener('keydown', onKey);
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(fitText, 120); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Engine.save(); else Timer.render(); });
  window.addEventListener('pagehide', () => Engine.save());
  Timer.onExpire = () => { if (S && S.state === 'DISCUSSION') Engine.go('TIME_EXPIRED'); };
  Timer.onSecond = () => Engine.save();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitText());
}

async function init() {
  applyVisualPrefs();
  Sound.apply();
  buildDecor();
  Spinner.build();
  Timer.set(prefs.timerDuration);
  Setup.bind();
  bindDrawer();
  bindGlobal();
  showScreen('intro');
  updateIntroStatus();
  await Repo.load();
  updateIntroStatus();
  if (ui.screen === 'setup') Setup.open(Setup.mid);
  offerResume();
}

// Доступ для налагодження та майбутнього «пульта ведучого» в окремому вікні
window.Studio = { Engine, Repo, Timer, Spinner, Sound, get session() { return S; }, get state() { return S && S.state; } };

init();
})();
