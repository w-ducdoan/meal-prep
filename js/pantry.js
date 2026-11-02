// Pantry state and "can I make this" checks.
export const GROUPS = [
  { id: 'protein', name: 'Proteins' },
  { id: 'carb', name: 'Carbs' },
  { id: 'veg', name: 'Veg' },
  { id: 'sauce', name: 'Sauces and extras' },
  { id: 'staple', name: 'Pantry staples' }
];

export function isStaple(ctx, item) {
  return !!ctx.ingredients.get(item)?.staple;
}

export function inStock(ctx, item) {
  return isStaple(ctx, item) || !!ctx.pantry[item]?.in;
}

// An ingredient's item can be a list of alternatives (fried rice: chicken or beef).
// Prefer the requested variant, then whichever is in stock, then the first.
export function resolveItem(ctx, item, variant) {
  if (!Array.isArray(item)) return item;
  if (variant && item.includes(variant)) return variant;
  return item.find((i) => inStock(ctx, i)) || item[0];
}

export function resolveIngredients(ctx, recipe, variant) {
  return recipe.ingredients.map((ing) => ({ ...ing, item: resolveItem(ctx, ing.item, variant) }));
}

// Required, non-staple items that aren't in stock.
export function missingFor(ctx, recipe) {
  const missing = [];
  for (const ing of recipe.ingredients) {
    if (!ing.required) continue;
    const opts = Array.isArray(ing.item) ? ing.item : [ing.item];
    if (!opts.some((i) => inStock(ctx, i))) missing.push(opts[0]);
  }
  return missing;
}

export const canMake = (ctx, recipe) => missingFor(ctx, recipe).length === 0;

export function nearMisses(ctx, recipes) {
  return recipes
    .map((r) => ({ recipe: r, missing: missingFor(ctx, r) }))
    .filter((x) => x.missing.length === 1);
}

export function pantryIsEmpty(ctx) {
  return !Object.entries(ctx.pantry).some(([id, v]) => v?.in && !isStaple(ctx, id));
}

export function seedToPantry(seed) {
  return structuredClone(seed.items);
}

export const itemName = (ctx, id) => ctx.ingredients.get(id)?.name || id;
export const itemShort = (ctx, id) => ctx.ingredients.get(id)?.short || itemName(ctx, id);
