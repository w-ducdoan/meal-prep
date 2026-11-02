// localStorage wrapper. Every read and write is guarded; if storage is
// blocked (private mode, previews) it falls back to an in-memory map.
const PREFIX = 'mealprep:';
const memory = new Map();
let persistent = true;

function probe() {
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
  } catch {
    persistent = false;
  }
}
probe();

export function get(key, fallback) {
  if (persistent) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw != null) return JSON.parse(raw);
    } catch { /* fall through */ }
  }
  return memory.has(key) ? structuredClone(memory.get(key)) : fallback;
}

export function set(key, value) {
  memory.set(key, structuredClone(value));
  if (!persistent) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* quota or blocked; memory copy still holds */ }
}

export function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export const KEYS = ['pantry', 'overrides', 'settings', 'extraCooks'];

export function exportAll() {
  const out = { app: 'meal-prep', version: 1, exported: new Date().toISOString() };
  for (const k of KEYS) out[k] = get(k, null);
  return out;
}

export function importAll(data) {
  if (!data || data.app !== 'meal-prep') throw new Error('Not a Meal Prep export');
  for (const k of KEYS) {
    if (data[k] != null) set(k, data[k]);
  }
}

export const isPersistent = () => persistent;
