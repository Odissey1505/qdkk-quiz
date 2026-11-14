// ============================================================
//  games.js — спільне для кількох ігор:
//  «Що? Де? Коли?», «ГлуздоГерць» (паб-квіз турами), «Своя гра»
//  Перемикач гри, структура пакетів, текстовий імпорт, медіа.
// ============================================================

const GAMES = {
  chgk:   { id: 'chgk',   name: 'Що? Де? Коли?', short: 'ЩДК',        icon: '❓', unit: ['запитання', 'запитання', 'запитань'] },
  gluzdo: { id: 'gluzdo', name: 'ГлуздоГерць',   short: 'ГлуздоГерць', icon: '🧠', unit: ['запитання', 'запитання', 'запитань'] },
  svoya:  { id: 'svoya',  name: 'Своя гра',      short: 'Своя гра',    icon: '🎯', unit: ['запитання', 'запитання', 'запитань'] },
};
const GAME_KEY = 'qdkk_game';

function gPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function gEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Поточна гра ─────────────────────────────
function getCurrentGame() {
  const u = new URLSearchParams(location.search).get('game');
  if (u && GAMES[u]) { try { localStorage.setItem(GAME_KEY, u); } catch {} return u; }
  let s = null;
  try { s = localStorage.getItem(GAME_KEY); } catch {}
  return GAMES[s] ? s : 'chgk';
}
function setCurrentGame(id) {
  if (!GAMES[id]) return;
  try { localStorage.setItem(GAME_KEY, id); } catch {}
}

// ── Перемикач гри ───────────────────────────
(function injectSwitcherCss() {
  if (typeof document === 'undefined' || document.getElementById('gameSwitcherCss')) return;
  const st = document.createElement('style');
  st.id = 'gameSwitcherCss';
  st.textContent = `
  .game-switcher { display:inline-flex; flex-wrap:wrap; gap:.35rem; padding:.3rem; margin:0 0 1.2rem;
    background:var(--bg-card,#161b22); border:1px solid var(--border,#2a3040); border-radius:999px; }
  .game-switcher button { border:0; background:transparent; color:var(--text-muted,#7d8590); cursor:pointer;
    font:600 .92rem 'Source Sans 3',sans-serif; padding:.5rem 1rem; border-radius:999px; transition:all .18s; display:flex; gap:.4rem; align-items:center; }
  .game-switcher button:hover { color:var(--text,#e6edf3); background:rgba(201,168,76,.08); }
  .game-switcher button.active { background:var(--accent,#c9a84c); color:#0d1117; }
  .game-badge { display:inline-flex; gap:.3rem; align-items:center; font-size:.75rem; font-weight:700; letter-spacing:.04em;
    padding:.15rem .55rem; border-radius:999px; border:1px solid var(--border,#2a3040); color:var(--accent,#c9a84c); }
  `;
  document.head.appendChild(st);
})();

function mountGameSwitcher(el, current, onChange) {
  if (!el) return;
  el.className = 'game-switcher';
  el.setAttribute('role', 'tablist');
  el.innerHTML = Object.values(GAMES).map((g) =>
    `<button type="button" role="tab" data-game="${g.id}" class="${g.id === current ? 'active' : ''}" aria-selected="${g.id === current}">
       <span>${g.icon}</span><span>${g.name}</span></button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-game]');
    if (!b || b.dataset.game === current) return;
    current = b.dataset.game;
    setCurrentGame(current);
    el.querySelectorAll('[data-game]').forEach((x) => { x.classList.toggle('active', x.dataset.game === current); x.setAttribute('aria-selected', x.dataset.game === current); });
    onChange && onChange(current);
  });
}

// ── Медіа в запитаннях ──────────────────────
function mediaTypeFromUrl(url, mime) {
  const s = (mime || url || '').toLowerCase();
  if (/image|\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/.test(s)) return 'image';
  if (/audio|\.(mp3|ogg|wav|m4a|aac|flac)(\?|$)/.test(s)) return 'audio';
  if (/video|\.(mp4|webm|mov|m4v)(\?|$)/.test(s)) return 'video';
  return 'image';
}
function renderMediaHTML(media, opts = {}) {
  if (!Array.isArray(media) || !media.length) return '';
  const cls = opts.cls || 'q-media';
  return `<div class="${cls}">` + media.map((m) => {
    const url = gEsc(m.url);
    if (m.type === 'audio') return `<audio controls preload="metadata" src="${url}"></audio>`;
    if (m.type === 'video') return `<video controls preload="metadata" playsinline src="${url}"></video>`;
    return `<img src="${url}" alt="${gEsc(m.name || 'Зображення')}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'media-error',textContent:'Не вдалося завантажити зображення'}))" />`;
  }).join('') + '</div>';
}

// ════════════════════════════════════════════
//  ГЛУЗДОГЕРЦЬ — тури
//  question: { number, tour, question, answer, comment, media: [] }
//  назви турів: tags_data.__tours = { "1": "Розминка", ... }
// ════════════════════════════════════════════
const Gluzdo = {
  tourName(pkg, t) {
    const n = ((pkg.tags_data || {}).__tours || {})[t];
    return n ? n : `Тур ${t}`;
  },
  tours(pkg) {
    const map = new Map();
    for (const q of pkg.questions || []) {
      const t = Number(q.tour) || 1;
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(q);
    }
    const names = (pkg.tags_data || {}).__tours || {};
    for (const k of Object.keys(names)) if (!map.has(Number(k))) map.set(Number(k), []);
    return [...map.keys()].sort((a, b) => a - b).map((t) => ({ tour: t, name: this.tourName(pkg, t), questions: map.get(t) }));
  },
  stats(pkg) {
    const tours = this.tours(pkg);
    return { tours: tours.length, questions: (pkg.questions || []).length };
  },
  summary(pkg) {
    const s = this.stats(pkg);
    return `${s.tours} ${gPlural(s.tours, 'тур', 'тури', 'турів')} · ${s.questions} ${gPlural(s.questions, 'запитання', 'запитання', 'запитань')}`;
  },
  template(tours = 8, perTour = 8) {
    const questions = [];
    let n = 1;
    for (let t = 1; t <= tours; t++) for (let i = 0; i < perTour; i++) {
      questions.push({ number: n++, tour: t, question: '', answer: '', comment: '', media: [] });
    }
    return { questions, tags_data: { __tours: {} } };
  },
  /** Текстовий формат:
   *  # Тур 1: Розминка
   *  1. Текст запитання (можна в кілька рядків)
   *  Відповідь: ...
   *  Коментар: ...
   *  Картинка: https://...   /  Аудіо: https://...  /  Відео: https://...
   */
  parseText(text) {
    const questions = [], tourNames = {};
    let tour = 1, cur = null, field = 'question', n = 1, seenTour = false;
    const push = () => { if (cur && cur.question.trim()) { cur.question = cur.question.trim(); questions.push(cur); } cur = null; };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { if (cur && field !== 'question') field = 'question_end'; continue; }
      const th = line.match(/^#+\s*(?:тур\s*(\d+)\s*[:.\-–—]?\s*)?(.*)$/i);
      if (th) {
        push();
        tour = th[1] ? Number(th[1]) : (seenTour ? tour + 1 : 1);
        seenTour = true;
        if (th[2] && th[2].trim()) tourNames[tour] = th[2].trim();
        continue;
      }
      const qm = line.match(/^(?:запитання\s*)?(\d+)\s*[.)]\s*(.*)$/i);
      if (qm && (field !== 'question' || !cur || cur.question)) {
        push();
        cur = { number: n++, tour, question: qm[2], answer: '', comment: '', media: [] };
        field = 'question';
        continue;
      }
      if (!cur) continue;
      const fm = line.match(/^(відповідь|коментар|джерело|картинка|зображення|аудіо|відео)\s*:\s*(.*)$/i);
      if (fm) {
        const key = fm[1].toLowerCase();
        if (key === 'відповідь') { cur.answer = fm[2]; field = 'answer'; }
        else if (key === 'коментар' || key === 'джерело') { cur.comment = (cur.comment ? cur.comment + '\n' : '') + fm[2]; field = 'comment'; }
        else { cur.media.push({ type: key === 'аудіо' ? 'audio' : key === 'відео' ? 'video' : 'image', url: fm[2].trim() }); }
        continue;
      }
      if (field === 'question' || field === 'question_end') { cur.question += (cur.question ? '\n' : '') + line; field = 'question'; }
      else if (field === 'answer') cur.answer += ' ' + line;
      else if (field === 'comment') cur.comment += '\n' + line;
    }
    push();
    return { questions, tourNames };
  },
};

// ════════════════════════════════════════════
//  СВОЯ ГРА — раунди, теми, ціни
//  question: { number, round: 1|2|…|'F', theme, value, type: 'normal'|'cat'|'auction',
//              catTheme, catValue, question, answer, comment, media: [] }
//  назви раундів: tags_data.__rounds = { "1": "Перший раунд", "F": "Фінал" }
// ════════════════════════════════════════════
const Svoya = {
  FINAL: 'F',
  TYPES: { normal: 'Звичайне', cat: 'Кіт у мішку', auction: 'Аукціон' },
  roundName(pkg, key) {
    const n = ((pkg.tags_data || {}).__rounds || {})[key];
    if (n) return n;
    return key === 'F' ? 'Фінал' : `Раунд ${key}`;
  },
  roundKeys(pkg) {
    const set = new Set((pkg.questions || []).map((q) => String(q.round ?? 1)));
    for (const k of Object.keys((pkg.tags_data || {}).__rounds || {})) set.add(String(k));
    return [...set].sort((a, b) => (a === 'F') - (b === 'F') || Number(a) - Number(b));
  },
  /** [{ key, name, isFinal, themes: [{ name, questions: [...] }] }] — теми в порядку появи */
  rounds(pkg) {
    const themeOrder = ((pkg.tags_data || {}).__themes) || {};
    return this.roundKeys(pkg).map((key) => {
      const qs = (pkg.questions || []).filter((q) => String(q.round ?? 1) === key);
      const themes = [];
      const idx = new Map();
      for (const q of qs) {
        const t = q.theme || 'Без теми';
        if (!idx.has(t)) { idx.set(t, themes.length); themes.push({ name: t, questions: [] }); }
        themes[idx.get(t)].questions.push(q);
      }
      for (const t of (themeOrder[key] || [])) if (!idx.has(t)) { idx.set(t, themes.length); themes.push({ name: t, questions: [] }); }
      themes.forEach((t) => t.questions.sort((a, b) => (a.value || 0) - (b.value || 0)));
      return { key, name: this.roundName(pkg, key), isFinal: key === 'F', themes };
    });
  },
  stats(pkg) {
    const rs = this.rounds(pkg);
    const regular = rs.filter((r) => !r.isFinal);
    return { rounds: regular.length, final: rs.some((r) => r.isFinal), themes: rs.reduce((s, r) => s + r.themes.length, 0), questions: (pkg.questions || []).length };
  },
  summary(pkg) {
    const s = this.stats(pkg);
    return `${s.rounds} ${gPlural(s.rounds, 'раунд', 'раунди', 'раундів')}${s.final ? ' + фінал' : ''} · ${s.themes} ${gPlural(s.themes, 'тема', 'теми', 'тем')}`;
  },
  template({ rounds = 3, themes = 5, perTheme = 5, base = 100, final = true } = {}) {
    const questions = [];
    let n = 1;
    for (let r = 1; r <= rounds; r++) {
      for (let t = 1; t <= themes; t++) {
        for (let i = 1; i <= perTheme; i++) {
          questions.push({ number: n++, round: r, theme: `Тема ${t}`, value: base * r * i, type: 'normal', question: '', answer: '', comment: '', media: [] });
        }
      }
    }
    if (final) for (let t = 1; t <= 3; t++) questions.push({ number: n++, round: 'F', theme: `Фінальна тема ${t}`, value: 0, type: 'normal', question: '', answer: '', comment: '', media: [] });
    return { questions, tags_data: { __rounds: {} } };
  },
  /** Текстовий формат:
   *  # Раунд 1                 (або «# Фінал»)
   *  ## Столиці
   *  100. Текст запитання
   *  Відповідь: Київ
   *  200 [кіт]. ...            (кіт у мішку; «[аукціон]» — аукціон)
   *  Коментар: ... / Картинка: URL / Аудіо: URL / Відео: URL
   *  У фіналі: «## Тема» і далі просто текст запитання + «Відповідь:»
   */
  parseText(text) {
    const questions = [], roundNames = {};
    let round = 1, theme = '', cur = null, field = 'question', n = 1, seenRound = false;
    const push = () => { if (cur && (cur.question.trim() || cur.media.length)) { cur.question = cur.question.trim(); questions.push(cur); } cur = null; };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let m = line.match(/^##\s*(?:тема\s*[:.\-–—]?\s*)?(.+)$/i);
      if (m) { push(); theme = m[1].trim(); field = 'question'; continue; }
      m = line.match(/^#\s*(.*)$/);
      if (m) {
        push();
        const title = m[1].trim();
        if (/^фінал/i.test(title)) round = 'F';
        else { const d = title.match(/(\d+)/); round = d ? Number(d[1]) : (seenRound && round !== 'F' ? round + 1 : 1); }
        seenRound = true;
        if (title && !/^(раунд\s*\d+|фінал)$/i.test(title)) roundNames[round] = title;
        theme = '';
        continue;
      }
      m = line.match(/^(\d+)\s*(?:\[(кіт|кот|кіт у мішку|аукціон)\])?\s*[.)|:\-–—]\s*(.*)$/i);
      if (m && round !== 'F') {
        push();
        const tp = m[2] ? (/аукц/i.test(m[2]) ? 'auction' : 'cat') : 'normal';
        let q = m[3], a = '';
        const pipe = q.split(/\s+\|\s+/);
        if (pipe.length > 1) { q = pipe[0]; a = pipe.slice(1).join(' | '); }
        cur = { number: n++, round, theme: theme || 'Без теми', value: Number(m[1]), type: tp, question: q, answer: a, comment: '', media: [] };
        field = a ? 'answer' : 'question';
        continue;
      }
      const fm = line.match(/^(відповідь|коментар|джерело|картинка|зображення|аудіо|відео|тема кота|ціна кота)\s*:\s*(.*)$/i);
      if (fm) {
        if (!cur) { if (round === 'F') { cur = { number: n++, round: 'F', theme: theme || 'Фінал', value: 0, type: 'normal', question: '', answer: '', comment: '', media: [] }; } else continue; }
        const key = fm[1].toLowerCase();
        if (key === 'відповідь') { cur.answer = fm[2]; field = 'answer'; }
        else if (key === 'коментар' || key === 'джерело') { cur.comment = (cur.comment ? cur.comment + '\n' : '') + fm[2]; field = 'comment'; }
        else if (key === 'тема кота') cur.catTheme = fm[2];
        else if (key === 'ціна кота') cur.catValue = Number(fm[2]) || 0;
        else cur.media.push({ type: key === 'аудіо' ? 'audio' : key === 'відео' ? 'video' : 'image', url: fm[2].trim() });
        continue;
      }
      if (round === 'F' && !cur) {
        cur = { number: n++, round: 'F', theme: theme || 'Фінал', value: 0, type: 'normal', question: line, answer: '', comment: '', media: [] };
        field = 'question';
        continue;
      }
      if (!cur) continue;
      if (field === 'question') cur.question += (cur.question ? '\n' : '') + line;
      else if (field === 'answer') cur.answer += ' ' + line;
      else cur.comment += '\n' + line;
    }
    push();
    return { questions, roundNames };
  },
};

/** Підсумок для картки пакета будь-якої гри */
function packageSummary(pkg) {
  const g = pkg.game || 'chgk';
  if (g === 'gluzdo') return Gluzdo.summary(pkg);
  if (g === 'svoya') return Svoya.summary(pkg);
  const n = (pkg.questions || []).length;
  return `${n} ${gPlural(n, 'запитання', 'запитання', 'запитань')}`;
}
function packageUrl(pkg) {
  const g = pkg.game || 'chgk';
  return g === 'chgk' ? `questions.html?id=${encodeURIComponent(pkg.id)}` : `pack.html?id=${encodeURIComponent(pkg.id)}`;
}
function playUrl(pkg) {
  const g = pkg.game || 'chgk';
  if (g === 'gluzdo') return `gluzdo.html?id=${encodeURIComponent(pkg.id)}`;
  if (g === 'svoya') return `svoya.html?id=${encodeURIComponent(pkg.id)}`;
  return 'studio.html';
}

if (typeof module !== 'undefined') module.exports = { GAMES, Gluzdo, Svoya, packageSummary };
