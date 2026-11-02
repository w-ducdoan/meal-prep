// Batch planner: what to cook on a cook day, how much, in what order.
import { addDays, diffDays, nextCookDay, slotRecipe, SLOTS, shortDay } from './plan.js';
import { resolveIngredients, inStock, isStaple } from './pantry.js';

// A batch cooked on cookDate covers cookDate+1 through the next cook day,
// inclusive. "Cook today" can optionally cover cookDate itself.
export function batchWindow(ctx, cookDate, includeToday = false) {
  const end = nextCookDay(ctx, cookDate);
  const dates = [];
  for (let d = includeToday ? cookDate : addDays(cookDate, 1); diffDays(d, end) >= 0; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

export function scaleIngredients(ctx, recipe, variant, servings) {
  return resolveIngredients(ctx, recipe, variant).map((ing) => ({ ...ing, qty: ing.qty * servings }));
}

function addTotals(totals, items) {
  for (const ing of items) {
    const key = `${ing.item}|${ing.unit}`;
    const t = totals.get(key) || { item: ing.item, unit: ing.unit, qty: 0, required: false };
    t.qty += ing.qty;
    t.required = t.required || ing.required;
    totals.set(key, t);
  }
}

export function planBatch(ctx, cookDate, includeToday = false) {
  const window = batchWindow(ctx, cookDate, includeToday);
  const groups = new Map();
  const fresh = [];
  const flags = [];

  for (const date of window) {
    for (const slot of SLOTS) {
      const s = slotRecipe(ctx, date, slot);
      if (!s) continue;
      const { recipe, variant, ref } = s;
      if (recipe.type === 'fresh') {
        fresh.push({ date, slot, recipe });
        continue;
      }
      const g = groups.get(ref) || { ref, recipe, variant, servings: 0, feeds: [] };
      g.servings += 1;
      g.feeds.push({ date, slot });
      groups.set(ref, g);
      const day = diffDays(cookDate, date);
      if (day > recipe.fridgeDays) flags.push({ date, slot, recipe, day });
    }
  }

  const totals = new Map();
  const items = [...groups.values()].map((g) => {
    const ingredients = scaleIngredients(ctx, g.recipe, g.variant, g.servings);
    addTotals(totals, ingredients);
    return { ...g, ingredients };
  });

  const combined = [...totals.values()].filter((t) => !isStaple(ctx, t.item));
  const missing = combined.filter((t) => t.required && !inStock(ctx, t.item));
  const servings = items.reduce((n, i) => n + i.servings, 0);

  return {
    cookDate,
    includeToday,
    window,
    items,
    fresh,
    flags,
    combined,
    missing,
    servings,
    order: cookOrder(items),
    minutes: estimateMinutes(items)
  };
}

// MVP heuristic: unattended carbs first, air fryer by temperature (hottest
// first), stovetop while the air fryer runs, then portion.
export function cookOrder(items) {
  const steps = [];
  const rice = items.flatMap((i) => i.ingredients.filter((g) => g.item === 'rice'));
  const pasta = items.flatMap((i) => i.ingredients.filter((g) => ['linguine', 'rigatoni', 'spaghetti'].includes(g.item)));
  const riceCups = rice.reduce((n, g) => n + g.qty, 0);
  const carbBits = [];
  if (riceCups) carbBits.push(`rice (${fmtNum(riceCups)} cups dry)`);
  if (pasta.length) carbBits.push('pasta water');
  if (carbBits.length) steps.push({ title: `Start ${carbBits.join(' and ')}`, detail: 'Longest and unattended, so it goes first.' });

  const air = new Map();
  for (const i of items) {
    for (const st of i.recipe.steps) {
      if (!st.airF) continue;
      const list = air.get(st.airF) || [];
      list.push(`${st.label.replace(/\s*\d+F$/, '')} for ${i.recipe.name} (${i.servings})`);
      air.set(st.airF, list);
    }
  }
  [...air.keys()].sort((a, b) => b - a).forEach((temp) => {
    steps.push({ title: `Air fryer at ${temp}F`, detail: air.get(temp).join('; ') });
  });

  const stove = items.filter((i) => i.recipe.methods.some((m) => m === 'stovetop' || m === 'pan'));
  if (stove.length) {
    steps.push({ title: air.size ? 'Stovetop while the air fryer runs' : 'Stovetop', detail: stove.map((i) => `${i.recipe.name} (${i.servings})`).join('; ') });
  }
  const n = items.reduce((s, i) => s + i.servings, 0);
  if (n) steps.push({ title: `Portion into ${n} containers`, detail: 'Label by day; eat the shortest fridge life first.' });
  return steps;
}

export function estimateMinutes(items) {
  if (!items.length) return 0;
  const sum = items.reduce((s, i) => s + i.recipe.timeMin, 0);
  return Math.round((10 + sum * 0.6 + 10) / 5) * 5;
}

// Spread each protein's pantry weight across its planned servings until the
// next grocery order.
export function portionGuide(ctx, fromDate, untilDate) {
  const counts = new Map();
  for (let d = fromDate; diffDays(d, untilDate) > 0; d = addDays(d, 1)) {
    for (const slot of SLOTS) {
      const s = slotRecipe(ctx, d, slot);
      if (!s) continue;
      for (const ing of resolveIngredients(ctx, s.recipe, s.variant)) {
        if (ing.unit !== 'oz' || ctx.ingredients.get(ing.item)?.group !== 'protein') continue;
        counts.set(ing.item, (counts.get(ing.item) || 0) + 1);
      }
    }
  }
  const out = [];
  for (const [item, servings] of counts) {
    const lb = Number(ctx.pantry[item]?.lb);
    if (!ctx.pantry[item]?.in || !lb) continue;
    out.push({ item, lb, servings, ozEach: (lb * 16) / servings });
  }
  return out.sort((a, b) => b.lb - a.lb);
}

export function feedsLabel(feeds) {
  return feeds.map((f) => `${shortDay(f.date)} ${f.slot === 'lunch' ? 'L' : 'D'}`).join(', ');
}

export function fmtNum(n) {
  const r = Math.round(n * 100) / 100;
  const whole = Math.floor(r);
  const frac = r - whole;
  const fracs = [[0.25, '1/4'], [0.33, '1/3'], [0.5, '1/2'], [0.66, '2/3'], [0.67, '2/3'], [0.75, '3/4']];
  for (const [v, s] of fracs) {
    if (Math.abs(frac - v) < 0.02) return whole ? `${whole} ${s}` : s;
  }
  return String(Math.round(r * 10) / 10);
}

export function fmtQty(qty, unit) {
  if (unit === 'ea') return `${Math.ceil(qty - 0.01)}`;
  if (unit === 'oz' && qty >= 16) return `${fmtNum(qty)} oz (${fmtNum(qty / 16)} lb)`;
  if (unit === 'tsp' && qty >= 3) return `${fmtNum(qty / 3)} tbsp`;
  if (unit === 'tbsp' && qty >= 8) return `${fmtNum(qty / 16)} cup`;
  return `${fmtNum(qty)} ${unit}`;
}
