// The ingredient wheel: candidate selection and the spinning SVG.
import { addDays, slotRecipe, SLOTS } from './plan.js';
import { canMake } from './pantry.js';
import { esc, reducedMotion } from './ui.js';

export const FILTERS = [
  { id: 'fresh', label: 'Fresh only', test: (r) => r.type === 'fresh' },
  { id: 'batch', label: 'Batch-friendly', test: (r) => r.type === 'batch' },
  { id: 'quick', label: 'Under 30 min', test: (r) => r.timeMin < 30 },
  { id: 'chicken', label: 'Chicken', protein: ['chicken'] },
  { id: 'beef', label: 'Beef', protein: ['beef', 'ribeye'] },
  { id: 'fish', label: 'Fish', protein: ['salmon', 'shrimp'] }
];

const proteinsOf = (r) => (Array.isArray(r.protein) ? r.protein : [r.protein]);

// Type and time chips narrow (AND); protein chips widen within themselves (OR).
export function applyFilters(recipes, active) {
  const on = FILTERS.filter((f) => active.has(f.id));
  const types = on.filter((f) => f.id === 'fresh' || f.id === 'batch');
  const quick = on.find((f) => f.id === 'quick');
  const prot = on.filter((f) => f.protein).flatMap((f) => f.protein);
  return recipes.filter((r) =>
    (!types.length || types.some((f) => f.test(r))) &&
    (!quick || quick.test(r)) &&
    (!prot.length || proteinsOf(r).some((p) => prot.includes(p))));
}

export function recentIds(ctx, date, days = 2) {
  const ids = new Set();
  for (let i = 1; i <= days; i++) {
    for (const slot of SLOTS) {
      const s = slotRecipe(ctx, addDays(date, -i), slot);
      if (s) ids.add(s.recipe.id);
    }
  }
  return ids;
}

export function candidates(ctx, recipes, active, date) {
  const makeable = applyFilters(recipes, active).filter((r) => canMake(ctx, r));
  const recent = recentIds(ctx, date);
  const fresh = makeable.filter((r) => !recent.has(r.id));
  // If skipping recent meals empties the wheel, fall back rather than show nothing.
  return { pool: fresh.length ? fresh : makeable, skipped: makeable.length - fresh.length, relaxed: !fresh.length && makeable.length > 0 };
}

export function sample(list, n, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// 2-3 batch-friendly recipes, preferring different proteins and bases.
export function pickBatch(ctx, recipes, date) {
  const pool = recipes.filter((r) => r.type === 'batch' && canMake(ctx, r));
  const recent = recentIds(ctx, date);
  const ordered = sample(pool).sort((a, b) => recent.has(a.id) - recent.has(b.id));
  const picked = [];
  const seenP = new Set(), seenB = new Set();
  for (const r of ordered) {
    const p = proteinsOf(r)[0];
    if (seenP.has(p) && picked.length < ordered.length - 1) continue;
    if (seenB.has(r.base) && seenP.size < 2) continue;
    picked.push(r); seenP.add(p); seenB.add(r.base);
    if (picked.length === 3) break;
  }
  for (const r of ordered) { if (picked.length >= 2) break; if (!picked.includes(r)) picked.push(r); }
  return picked;
}

// Deep warm tones so white labels stay readable in both themes.
const SEG = ['#B83A22', '#9C5F10', '#4A7336', '#7A4A33', '#A2432F', '#5E6B2E', '#8A3B4E', '#6E5536'];

export function wheelSVG(items) {
  const n = items.length;
  const R = 140, C = 150;
  let s = '';
  items.forEach((r, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const path = n === 1
      ? `<circle cx="${C}" cy="${C}" r="${R}" fill="${SEG[0]}"/>`
      : `<path d="M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${SEG[i % SEG.length]}"/>`;
    const mid = ((i + 0.5) / n) * 360 - 90;
    const label = r.short.length > 19 ? r.short.slice(0, 18) + '…' : r.short;
    s += `${path}<text transform="rotate(${mid.toFixed(2)} ${C} ${C}) translate(${C + R - 12} ${C})" text-anchor="end" dominant-baseline="middle" class="seg-label">${esc(label)}</text>`;
  });
  return `<svg viewBox="0 0 300 300" class="wheel-svg" aria-hidden="true">
    <circle cx="${C}" cy="${C}" r="${R + 6}" fill="var(--wheel-rim)"/>
    <g class="wheel-rot">${s}</g>
    <circle cx="${C}" cy="${C}" r="20" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/>
  </svg>`;
}

let audio;
function tick() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle'; o.frequency.value = 1400;
    g.gain.setValueAtTime(0.05, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.04);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.05);
  } catch { /* audio blocked */ }
}

// Spin so that segment `index` ends under the top pointer. Resolves when settled.
export function spinTo(svg, n, index) {
  const g = svg.querySelector('.wheel-rot');
  const segDeg = 360 / n;
  const target = 360 * 5 + (360 - (index + 0.5) * segDeg) + (Math.random() - 0.5) * segDeg * 0.6;
  if (reducedMotion()) {
    g.style.transform = `rotate(${target % 360}deg)`;
    return Promise.resolve();
  }
  const dur = 3500;
  const t0 = performance.now();
  let lastSeg = 0;
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      const deg = target * eased;
      g.style.transform = `rotate(${deg}deg)`;
      const seg = Math.floor(deg / segDeg);
      if (seg !== lastSeg) {
        lastSeg = seg;
        tick();
        if (navigator.vibrate) navigator.vibrate(6);
      }
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
