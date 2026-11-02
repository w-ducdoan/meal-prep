// Date math and rotation lookup. Pure functions over a ctx object:
// { plan, recipes (Map), ingredients (Map), settings, overrides, extraCooks, pantry }
export const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const SLOTS = ['lunch', 'dinner'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dates are local "YYYY-MM-DD" strings throughout.
export function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m - 1, d];
}

export function addDays(s, n) {
  const [y, m, d] = parts(s);
  return isoOf(new Date(y, m, d + n, 12));
}

export function diffDays(a, b) {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2, d2) - Date.UTC(y1, m1, d1)) / 86400000);
}

export function dowIndex(s) {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

export const dowKey = (s) => DOW[dowIndex(s)];
export const dayName = (s) => DAY_NAMES[dowIndex(s)];
export const shortDay = (s) => DAY_NAMES[dowIndex(s)].slice(0, 3);
export function monthDay(s) {
  const [, m, d] = parts(s);
  return `${MONTHS[m]} ${d}`;
}

// Monday of the week containing s (weeks run Mon-Sun).
export function mondayOf(s) {
  return addDays(s, -((dowIndex(s) + 6) % 7));
}

export function weekLetter(s, rotationStart) {
  const weeks = Math.floor(diffDays(mondayOf(rotationStart), mondayOf(s)) / 7);
  return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

export function parseRef(ref) {
  if (!ref) return null;
  const [id, variant] = ref.split('@');
  return { id, variant: variant || null };
}

export function templateRef(ctx, date, slot) {
  const letter = weekLetter(date, ctx.settings.rotationStart);
  const day = ctx.plan.weeks[letter]?.[dowKey(date)];
  return day ? day[SLOTS.indexOf(slot)] : null;
}

// The recipe planned for a slot, with any date override applied.
export function slotRef(ctx, date, slot) {
  const o = ctx.overrides[date]?.[slot];
  if (o) return { ref: o, overridden: true };
  return { ref: templateRef(ctx, date, slot), overridden: false };
}

export function slotRecipe(ctx, date, slot) {
  const { ref, overridden } = slotRef(ctx, date, slot);
  const parsed = parseRef(ref);
  const recipe = parsed && ctx.recipes.get(parsed.id);
  return recipe ? { recipe, variant: parsed.variant, ref, overridden } : null;
}

export function isCookDay(ctx, date) {
  return ctx.settings.cookDays.includes(dowKey(date));
}

export function nextCookDay(ctx, date) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    if (isCookDay(ctx, d)) return d;
  }
  return addDays(date, 7);
}

// Which batch a date's meals come from: the latest cook (regular cook day or
// a "Cook today" run) before the date. A "Cook today" that covers its own day
// counts for that day too.
export function batchSource(ctx, date) {
  const extra = ctx.extraCooks || {};
  if (extra[date]?.includeToday) return { cookDate: date, extra: true };
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, -i);
    if (extra[d]) return { cookDate: d, extra: true };
    if (isCookDay(ctx, d)) return { cookDate: d, extra: false };
  }
  return null;
}

// Freshness for one meal slot: where it comes from and whether it's past its fridge life.
export function freshness(ctx, date, recipe) {
  if (recipe.type === 'fresh') return { kind: 'fresh', text: 'Cook fresh today' };
  const src = batchSource(ctx, date);
  if (!src) return { kind: 'unknown', text: 'No batch on record' };
  const day = diffDays(src.cookDate, date);
  const from = src.cookDate === date ? "today's batch" : `${dayName(src.cookDate)}'s batch`;
  const life = recipe.fridgeDays;
  if (day > life) {
    return { kind: 'stale', day, life, from, text: `From ${from}, day ${day}. Past its ${life}-day fridge limit.` };
  }
  return { kind: 'ok', day, life, from, text: `From ${from}, day ${Math.max(day, 1)} of ${life}` };
}

export function proteinPlanned(ctx, date) {
  let p = 0;
  let kcal = 0;
  for (const slot of SLOTS) {
    const r = slotRecipe(ctx, date, slot);
    if (r) { p += r.recipe.macros.p; kcal += r.recipe.macros.kcal; }
  }
  const s = ctx.settings;
  p += s.shakeScoops * s.proteinPerScoop + s.eggsPerDay * 6;
  kcal += s.shakeScoops * s.kcalPerScoop + s.eggsPerDay * 72;
  return { p: Math.round(p), kcal: Math.round(kcal) };
}

export function setOverride(overrides, date, slot, ref) {
  const next = structuredClone(overrides);
  next[date] = { ...(next[date] || {}), [slot]: ref };
  return next;
}

export function clearOverride(overrides, date, slot) {
  const next = structuredClone(overrides);
  if (next[date]) {
    delete next[date][slot];
    if (!Object.keys(next[date]).length) delete next[date];
  }
  return next;
}
