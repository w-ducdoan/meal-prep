// Deterministic SVG "plate" for each recipe: base, protein and veg as soft
// shapes, seeded from the recipe id so it never changes between renders.
const BASE = {
  rice: { fill: '#F4EFE4', grain: '#E2D9C6' },
  pasta: { fill: '#E9C88A', grain: '#D6AE66' },
  'sweet potato': { fill: '#E58A3C', grain: '#C96E26' }
};
const PROTEIN = {
  salmon: '#F08A6C',
  beef: '#7A4A33',
  chicken: '#D9A04A',
  shrimp: '#F4A3A0',
  pork: '#B9785A',
  ribeye: '#8E4A36'
};

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function blob(cx, cy, r, rand, wobble = 0.22) {
  const n = 7;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rand() * wobble);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  // Closed Catmull-Rom through the points, as cubic Beziers.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

export function plateSVG(recipe, variant, size = 120) {
  const rand = rng(recipe.id + (variant || ''));
  const base = BASE[recipe.base] || BASE.rice;
  const proteins = Array.isArray(recipe.protein) ? recipe.protein : [recipe.protein];
  const protein = variant === 'ground-beef' ? 'beef' : variant === 'chicken-thighs' ? 'chicken' : proteins[0];
  const pColor = PROTEIN[protein] || PROTEIN.chicken;
  const items = recipe.ingredients.map((i) => (Array.isArray(i.item) ? i.item[0] : i.item));
  const hasEgg = items.includes('eggs');
  const hasVeg = items.some((i) => ['frozen-broccoli', 'frozen-mixed-veg', 'thai-basil', 'avocado'].includes(i));
  const vegColor = items.includes('avocado') ? '#8DB255' : '#5E8E3E';

  let s = '';
  // Base: a soft mound, with texture marks.
  s += `<path d="${blob(54, 58, 26, rand, 0.18)}" fill="${base.fill}"/>`;
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 20;
    const x = 54 + Math.cos(a) * r, y = 58 + Math.sin(a) * r;
    if (recipe.base === 'pasta') {
      s += `<path d="M${(x - 4).toFixed(1)},${y.toFixed(1)} q4,-3 8,0" stroke="${base.grain}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    } else if (recipe.base === 'sweet potato') {
      s += `<rect x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6" rx="1.5" fill="${base.grain}" transform="rotate(${Math.round(rand() * 90)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    } else {
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.2" ry="1" fill="${base.grain}" transform="rotate(${Math.round(rand() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
  }
  // Protein: two or three overlapping pieces.
  const pieces = protein === 'salmon' || protein === 'ribeye' ? 1 : 3;
  for (let i = 0; i < pieces; i++) {
    const cx = 70 + (rand() - 0.5) * 12 + (pieces > 1 ? (i - 1) * 7 : 0);
    const cy = 50 + (rand() - 0.5) * 12 + (pieces > 1 ? (i % 2) * 8 : 0);
    const r = pieces > 1 ? 9 + rand() * 3 : 16;
    s += `<path d="${blob(cx, cy, r, rand, 0.3)}" fill="${pColor}"/>`;
    s += `<path d="${blob(cx - r * 0.25, cy - r * 0.25, r * 0.4, rand, 0.3)}" fill="#fff" opacity=".18"/>`;
  }
  if (hasEgg) {
    s += `<path d="${blob(44, 76, 13, rand, 0.32)}" fill="#FFFDF7"/>`;
    s += `<circle cx="45" cy="75" r="5.2" fill="#F2B233"/>`;
  }
  if (hasVeg) {
    for (let i = 0; i < 6; i++) {
      const x = 34 + rand() * 18, y = 36 + rand() * 14;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.5 + rand() * 2.5).toFixed(1)}" fill="${vegColor}"/>`;
    }
  }

  return `<svg class="plate" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true" focusable="false">
<circle cx="60" cy="62" r="56" fill="var(--plate-shadow)"/>
<circle cx="60" cy="60" r="56" fill="var(--plate-rim)"/>
<circle cx="60" cy="60" r="44" fill="var(--plate)"/>
<g transform="translate(60 60) scale(1.28) translate(-54 -58)">${s}</g></svg>`;
}
