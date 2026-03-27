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

// ── Завантажити всі пакети ────────────────────
async function dbLoadPackages() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?select=*&order=date.desc`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const rows = await res.json();
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
  };
}

// ── Зберегти новий пакет ─────────────────────
async function dbInsertPackage(pkg) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/packages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      id:         pkg.id,
      title:      pkg.title,
      tournament: pkg.tournament || null,
      date:       pkg.date       || null,
      result:     pkg.result     || null,
      questions:  pkg.questions,
      tags_data:  pkg.tags_data  || {},
    }),
  });
  if (!res.ok) {
    const err = await res.text();
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
