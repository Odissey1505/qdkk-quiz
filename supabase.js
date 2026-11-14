// ============================================================
//  supabase.js — єдиний модуль для роботи з базою даних
//  Підключається до Supabase замість localStorage
// ============================================================

const SUPABASE_URL = 'https://yhekszqxheljbxoucalt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZWtzenF4aGVsamJ4b3VjYWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE1NTIsImV4cCI6MjA5MDE4NzU1Mn0.cHUU9AFy2yUnfHXjqYTidmXaN6s3ybl0gi7U11eP4bY';

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation',
};

// ── Завантажити пакети ────────────────────────
//  game: 'chgk' (за замовчуванням) | 'gluzdo' | 'svoya' | 'all'
//  Пакети без колонки game (старі) вважаються пакетами «Що? Де? Коли?».
let DB_HAS_GAME_COLUMN = null; // null — ще не знаємо

async function dbLoadPackages(game = 'chgk') {
  const base = `${SUPABASE_URL}/rest/v1/packages?select=*&order=date.desc`;
  let rows;
  if (game !== 'all' && DB_HAS_GAME_COLUMN !== false) {
    const filter = game === 'chgk' ? '&or=(game.is.null,game.eq.chgk)' : `&game=eq.${encodeURIComponent(game)}`;
    const res = await fetch(base + filter, { headers: HEADERS });
    if (res.ok) {
      DB_HAS_GAME_COLUMN = true;
      rows = await res.json();
    } else if (res.status === 400) {
      // колонки game ще немає (SQL з supabase-setup.sql не виконано)
      DB_HAS_GAME_COLUMN = false;
    } else {
      throw new Error(`Load failed: ${res.status}`);
    }
  }
  if (!rows) {
    const res = await fetch(base, { headers: HEADERS });
    if (!res.ok) throw new Error(`Load failed: ${res.status}`);
    rows = await res.json();
    if (game !== 'all') rows = rows.filter(r => (r.game || 'chgk') === game);
  }
  // Нормалізуємо questions для кожного пакету
  return rows.map(pkg => normalizePackage(pkg));
}

function normalizePackage(pkg) {
  if (!pkg) return null;
  return {
    ...pkg,
    questions: Array.isArray(pkg.questions)
      ? pkg.questions
      : (typeof pkg.questions === 'string' ? JSON.parse(pkg.questions) : []),
    tags_data: (pkg.tags_data && typeof pkg.tags_data === 'object') ? pkg.tags_data : {},
    game: pkg.game || 'chgk',
  };
}

// ── Зберегти новий пакет ─────────────────────
async function dbInsertPackage(pkg) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/packages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(Object.assign({
      id:         pkg.id,
      title:      pkg.title,
      tournament: pkg.tournament || null,
      date:       pkg.date       || null,
      result:     pkg.result     || null,
      questions:  pkg.questions,
      tags_data:  pkg.tags_data  || {},
    }, pkg.game && pkg.game !== 'chgk' ? { game: pkg.game } : {})),
  });
  if (!res.ok) {
    const err = await res.text();
    if (pkg.game && pkg.game !== 'chgk' && /game/.test(err)) {
      throw new Error('у базі ще немає колонки «game». Виконайте SQL із файлу supabase-setup.sql у Supabase → SQL Editor');
    }
    throw new Error(`Insert failed: ${res.status} — ${err}`);
  }
  return await res.json();
}

// ── Оновити існуючий пакет ───────────────────
async function dbUpdatePackage(pkg) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?id=eq.${encodeURIComponent(pkg.id)}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        title:      pkg.title,
        tournament: pkg.tournament || null,
        date:       pkg.date       || null,
        result:     pkg.result     || null,
        questions:  pkg.questions,
        tags_data:  pkg.tags_data  || {},
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Update failed: ${res.status} — ${err}`);
  }
  return await res.json();
}

// ── Видалити пакет ───────────────────────────
async function dbDeletePackage(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: HEADERS }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Delete failed: ${res.status} — ${err}`);
  }
}

// ── Завантажити один пакет за ID ─────────────
async function dbGetPackage(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Get failed: ${res.status}`);
  const rows = await res.json();
  const pkg = rows[0] || null;
  // Supabase може повернути questions як рядок — парсимо на всяк випадок
  return normalizePackage(pkg);
}


// ── Зберегти теги пакету ─────────────────────
async function dbUpdateTags(pkgId, tagsData) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?id=eq.${encodeURIComponent(pkgId)}`,
    {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ tags_data: tagsData }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tags update failed: ${res.status} — ${err}`);
  }
}


// ── Медіа (картинки, аудіо, відео) у Supabase Storage ──
//  Бакет «qdkk-media» створюється SQL-скриптом supabase-setup.sql
const MEDIA_BUCKET = 'qdkk-media';

async function dbUploadMedia(file, folder = 'misc') {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 404 || /bucket/i.test(err)) {
      throw new Error('сховище медіа не налаштоване. Виконайте SQL із файлу supabase-setup.sql');
    }
    throw new Error(`Upload failed: ${res.status} — ${err}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}
