import * as store from './store.js';
import * as router from './router.js';
import {
  isoOf, addDays, dayName, shortDay, monthDay, mondayOf, weekLetter, WEEK_ORDER, SLOTS,
  slotRecipe, slotRef, parseRef, isCookDay, batchSource, freshness, proteinPlanned,
  setOverride, clearOverride
} from './plan.js';
import { planBatch, portionGuide, feedsLabel, fmtQty, scaleIngredients } from './batch.js';
import { GROUPS, canMake, missingFor, nearMisses, pantryIsEmpty, seedToPantry, itemName, itemShort } from './pantry.js';
import { FILTERS, applyFilters, candidates, sample, pickBatch, wheelSVG, spinTo } from './wheel.js';
import { renderCook, exitCook } from './cook.js';
import { plateSVG } from './art.js';
import { esc, macroChips, sheet, closeSheet, toast, announce, icon } from './ui.js';

const root = document.getElementById('app');
const ctx = {};
let seed;
let recipeList = [];

const DEFAULT_SETTINGS = {
  proteinTarget: 160,
  kcalTarget: 2300,
  cookDays: ['sun', 'wed'],
  rotationStart: '2026-11-02',
  shakeScoops: 2,
  proteinPerScoop: 25,
  kcalPerScoop: 120,
  eggsPerDay: 0,
  nextOrder: '2026-11-16',
  theme: 'system'
};

// "?date=YYYY-MM-DD" pins the day (for testing and screenshots).
function today() {
  const q = new URLSearchParams(location.search).get('date');
  return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : isoOf(new Date());
}

function save(key) { store.set(key, ctx[key]); }

function applyTheme() {
  const t = ctx.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1C1A17' : '#FBF7F0';
}

async function load() {
  const get = (f) => fetch(`data/${f}`).then((r) => r.json());
  const [plan, recipes, ingredients, pantrySeed] = await Promise.all([
    get('plan.json'), get('recipes.json'), get('ingredients.json'), get('pantry-seed.json')
  ]);
  seed = pantrySeed;
  recipeList = recipes;
  ctx.plan = plan;
  ctx.recipes = new Map(recipes.map((r) => [r.id, r]));
  ctx.ingredients = new Map(ingredients.map((i) => [i.id, i]));
  ctx.settings = { ...DEFAULT_SETTINGS, rotationStart: plan.rotationStart, cookDays: plan.cookDays, nextOrder: seed.nextOrder, ...store.get('settings', {}) };
  ctx.pantry = store.get('pantry', null) || seedToPantry(seed);
  ctx.overrides = store.get('overrides', {});
  ctx.extraCooks = store.get('extraCooks', {});
}

// ---------- shared bits ----------

function header(title, { back, right = '' } = {}) {
  return `<header class="page-head">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>` : ''}
    <h1 class="page-title">${title}</h1>${right}</header>`;
}

function recipeHref(r, variant) {
  return `#/recipes/${r.id}${variant ? `?v=${variant}` : ''}`;
}

function cookHref(r, servings = 1, variant, back) {
  const q = new URLSearchParams({ s: servings });
  if (variant) q.set('v', variant);
  if (back) q.set('back', back);
  return `#/cook/${r.id}?${q}`;
}

function variantLabel(variant) {
  return variant ? ` <span class="variant">(${esc(itemShort(ctx, variant))})</span>` : '';
}

function openSwap(date, slot) {
  const cur = slotRef(ctx, date, slot);
  const rows = [...recipeList].sort((a, b) => canMake(ctx, b) - canMake(ctx, a)).map((r) => {
    const miss = missingFor(ctx, r);
    return `<li><button class="pick-row" data-pick="${r.id}">
      ${plateSVG(r, null, 48)}
      <span class="pick-main"><b>${esc(r.name)}</b>
      <small>${r.macros.kcal} kcal · ${r.macros.p}g P · ${r.timeMin} min${r.type === 'fresh' ? ' · cook fresh' : ''}</small>
      ${miss.length ? `<small class="needs">Needs ${miss.map((m) => esc(itemShort(ctx, m))).join(', ')}</small>` : ''}</span>
    </button></li>`;
  }).join('');
  const panel = sheet(`
    <h2 class="sheet-title">Swap ${slot} <small>${dayName(date)}, ${monthDay(date)}</small></h2>
    <div class="sheet-actions">
      <a class="btn primary" href="#/spin?date=${date}&slot=${slot}" data-close>${icon('spin')} Spin instead</a>
      ${cur.overridden ? `<button class="btn ghost" data-reset>Reset to plan</button>` : ''}
    </div>
    <ul class="pick-list">${rows}</ul>`, { label: `Swap ${slot}` });
  panel.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      ctx.overrides = setOverride(ctx.overrides, date, slot, pick.dataset.pick);
      save('overrides');
      closeSheet();
      toast(`${shortDay(date)} ${slot} swapped`);
      render();
    }
    if (e.target.closest('[data-reset]')) {
      ctx.overrides = clearOverride(ctx.overrides, date, slot);
      save('overrides');
      closeSheet();
      toast('Back to the plan');
      render();
    }
  });
}

// ---------- Today ----------

function proteinRing(date) {
  const { p, kcal } = proteinPlanned(ctx, date);
  const target = ctx.settings.proteinTarget;
  const pct = Math.min(1, p / target);
  const r = 42, c = 2 * Math.PI * r;
  const low = p < target * 0.94;
  const shake = ctx.settings.shakeScoops * ctx.settings.proteinPerScoop;
  return `<section class="card ring-card ${low ? 'low' : ''}" aria-label="Planned protein">
    <svg viewBox="0 0 100 100" class="ring" role="img" aria-label="${p} of ${target} grams protein planned">
      <circle cx="50" cy="50" r="${r}" class="ring-track"/>
      <circle cx="50" cy="50" r="${r}" class="ring-fill" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
      <text x="50" y="49" class="ring-num">${p}</text><text x="50" y="64" class="ring-sub">of ${target}g</text>
    </svg>
    <div class="ring-copy">
      <h2>Protein planned</h2>
      <p>${low ? `About ${target - p}g short. Add a scoop or a couple of eggs.` : 'On target for today.'}</p>
      <p class="muted">Meals ${p - shake - ctx.settings.eggsPerDay * 6}g + shake ${shake}g${ctx.settings.eggsPerDay ? ` + eggs ${ctx.settings.eggsPerDay * 6}g` : ''} · ${kcal.toLocaleString()} of ${ctx.settings.kcalTarget.toLocaleString()} kcal</p>
    </div></section>`;
}

function mealCard(date, slot, cookingToday) {
  const s = slotRecipe(ctx, date, slot);
  if (!s) return `<article class="card meal empty"><p>No ${slot} planned.</p><button class="btn" data-swap="${slot}">Pick one</button></article>`;
  const { recipe: r, variant, overridden } = s;
  const fr = freshness(ctx, date, r);
  const stale = fr.kind === 'stale';
  const showCook = r.type === 'fresh' || cookingToday;
  return `<article class="card meal ${stale ? 'stale' : ''}">
    <a class="meal-art" href="${recipeHref(r, variant)}" tabindex="-1" aria-hidden="true">${plateSVG(r, variant, 76)}</a>
    <div class="meal-body">
      <p class="slot-label">${slot === 'lunch' ? 'Lunch' : 'Dinner'}${overridden ? ' <span class="tag">swapped</span>' : ''}</p>
      <h2 class="meal-name"><a href="${recipeHref(r, variant)}">${esc(r.name)}</a>${variantLabel(variant)}</h2>
      ${macroChips(r.macros)}
      <p class="fresh-line ${fr.kind}">${esc(fr.text)}</p>
      ${stale ? '<p class="stale-hint">Swap it for something fresh, or eat it earlier next batch.</p>' : ''}
    </div>
    <div class="meal-actions">
      <button class="btn ${stale ? 'primary' : 'ghost'}" data-swap="${slot}">${icon('swap', 18)} Swap</button>
      ${showCook ? `<a class="btn primary" href="${cookHref(r, 1, variant, '#/today')}">${icon('flame', 18)} Cook</a>` : ''}
    </div></article>`;
}

function batchCard(plan, { extra = false } = {}) {
  const n = plan.items.length;
  const windowText = plan.window.length
    ? `Covers ${shortDay(plan.window[0])} through ${shortDay(plan.window[plan.window.length - 1])}`
    : '';
  const guide = portionGuide(ctx, plan.window[0] || plan.cookDate, ctx.settings.nextOrder);
  const summary = n
    ? `Make ${n} recipe${n > 1 ? 's' : ''}, ${plan.servings} servings, about ${plan.minutes} min`
    : 'Nothing to batch in this window';
  return `<section class="card batch">
    <details ${extra ? 'open' : ''}>
      <summary><span class="batch-kicker">Batch cook</span><span class="batch-sum">${summary}</span>${icon('chevron', 20)}</summary>
      <div class="batch-body">
        <p class="muted">${windowText}${plan.includeToday ? ' (including today)' : ''}.</p>
        ${extra ? `<label class="check-row"><input type="checkbox" data-act="include-today" ${plan.includeToday ? 'checked' : ''}> Also cover today's meals</label>` : ''}
        ${plan.flags.map((f) => `<p class="flag">${esc(f.recipe.short)} on ${shortDay(f.date)} ${f.slot} is day ${f.day} after cooking, past its ${f.recipe.fridgeDays}-day limit. Move it earlier or swap it.</p>`).join('')}
        ${plan.missing.length ? `<p class="flag">Not in your pantry: ${plan.missing.map((m) => esc(itemShort(ctx, m.item))).join(', ')}.</p>` : ''}
        ${plan.items.map((it) => `
          <div class="batch-item">
            <div class="batch-item-head">${plateSVG(it.recipe, it.variant, 56)}
              <div><h3><a href="${recipeHref(it.recipe, it.variant)}">${esc(it.recipe.name)}</a>${variantLabel(it.variant)}</h3>
              <p class="muted">${it.servings} serving${it.servings > 1 ? 's' : ''} · feeds ${feedsLabel(it.feeds)}</p></div>
            </div>
            <ul class="ing-list compact">${it.ingredients.filter((g) => !ctx.ingredients.get(g.item)?.staple).map((g) => `<li><span>${esc(itemName(ctx, g.item))}${g.required ? '' : ' <em>(opt.)</em>'}</span><b>${fmtQty(g.qty, g.unit)}</b></li>`).join('')}</ul>
            <a class="btn ghost small" href="${cookHref(it.recipe, it.servings, it.variant, '#/today')}">${icon('flame', 18)} Cook ${it.servings}</a>
          </div>`).join('')}
        ${plan.fresh.length ? `<div class="fresh-days"><h3>Cook day-of</h3><ul>${plan.fresh.map((f) => `<li>${shortDay(f.date)} ${f.slot}: ${esc(f.recipe.short)}</li>`).join('')}</ul></div>` : ''}
        ${guide.length ? `<div class="guide"><h3>Portion guide</h3><ul>${guide.map((g) => `<li>${g.lb} lb ${esc(itemShort(ctx, g.item))} across ${g.servings} servings = about <b>${g.ozEach.toFixed(1)} oz raw each</b></li>`).join('')}</ul><p class="muted">Until the next grocery order (${monthDay(ctx.settings.nextOrder)}). Update the pounds in Pantry as you use meat.</p></div>` : ''}
        ${plan.order.length ? `<div class="order"><h3>Cook order</h3><ol>${plan.order.map((o) => `<li><b>${esc(o.title)}</b><span>${esc(o.detail)}</span></li>`).join('')}</ol></div>` : ''}
        ${extra ? '<button class="btn ghost small" data-act="cancel-cook">Cancel cook today</button>' : ''}
      </div>
    </details></section>`;
}

function viewToday() {
  const date = today();
  const cookDay = isCookDay(ctx, date);
  const extra = ctx.extraCooks[date];
  const letter = weekLetter(date, ctx.settings.rotationStart);
  const cookingToday = cookDay || !!extra;
  let bottom;
  if (extra) bottom = batchCard(planBatch(ctx, date, !!extra.includeToday), { extra: true });
  else if (cookDay) bottom = batchCard(planBatch(ctx, date, false));
  else {
    const src = batchSource(ctx, date);
    bottom = `<section class="card calm">
      <h2>Nothing to cook today</h2>
      <p class="muted">${src ? `Eating from ${src.cookDate === date ? "today's" : dayName(src.cookDate) + "'s"} batch.` : 'No batch on record yet.'}</p>
      <a class="btn primary wide" href="#/spin">${icon('spin', 20)} Want something fresh? Spin</a>
      <button class="btn ghost wide" data-act="cook-today">Cook today instead</button>
    </section>`;
  }
  root.innerHTML = `
    <header class="today-head">
      <div>
        <h1 class="day">${dayName(date)}</h1>
        <p class="date">${monthDay(date)} <span class="chip week">Week ${letter}</span>${cookingToday ? '<span class="chip cook">Cook day</span>' : ''}</p>
      </div>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${icon('gear')}</a>
    </header>
    <div class="meals">${mealCard(date, 'lunch', cookingToday)}${mealCard(date, 'dinner', cookingToday)}</div>
    ${proteinRing(date)}
    ${bottom}`;
  root.onclick = (e) => {
    const sw = e.target.closest('[data-swap]');
    if (sw) return openSwap(date, sw.dataset.swap);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cook-today') {
      ctx.extraCooks = { ...ctx.extraCooks, [date]: { includeToday: false } };
      save('extraCooks'); render();
    }
    if (act === 'cancel-cook') {
      const next = { ...ctx.extraCooks }; delete next[date];
      ctx.extraCooks = next; save('extraCooks'); render();
    }
  };
  root.onchange = (e) => {
    if (e.target.dataset.act === 'include-today') {
      ctx.extraCooks = { ...ctx.extraCooks, [date]: { includeToday: e.target.checked } };
      save('extraCooks'); render();
    }
  };
}

// ---------- Week ----------

function viewWeek(query) {
  const mode = query.get('w') || 'this';
  const t = today();
  const template = mode === 'A' || mode === 'B';
  const monday = mode === 'next' ? addDays(mondayOf(t), 7) : mondayOf(t);
  const letter = template ? mode : weekLetter(monday, ctx.settings.rotationStart);
  const seg = [['this', 'This week'], ['next', 'Next week'], ['A', 'Week A'], ['B', 'Week B']];
  const days = WEEK_ORDER.map((k, i) => {
    const date = template ? null : addDays(monday, i);
    const cook = ctx.settings.cookDays.includes(k);
    const slots = SLOTS.map((slot) => {
      let r, variant, overridden = false;
      if (template) {
        const p = parseRef(ctx.plan.weeks[mode][k][SLOTS.indexOf(slot)]);
        r = ctx.recipes.get(p.id); variant = p.variant;
      } else {
        const s = slotRecipe(ctx, date, slot);
        r = s?.recipe; variant = s?.variant; overridden = s?.overridden;
      }
      const inner = r ? `${plateSVG(r, variant, 40)}<span><small>${slot === 'lunch' ? 'Lunch' : 'Dinner'}</small><b>${esc(r.short)}</b>${r.type === 'fresh' ? '<em>fresh</em>' : ''}</span>` : `<span><small>${slot}</small><b>Nothing planned</b></span>`;
      return `<div class="slot ${overridden ? 'over' : ''}">
        ${template ? `<div class="slot-btn static">${inner}</div>` : `<button class="slot-btn" data-date="${date}" data-slot="${slot}" aria-label="${dayName(date)} ${slot}: ${esc(r?.name || 'nothing')}. Tap to swap.">${inner}</button>`}
        ${overridden ? `<button class="reset-link" data-reset="${date}|${slot}">Reset to plan</button>` : ''}
      </div>`;
    }).join('');
    const isToday = date === t;
    return `<li class="day-row ${isToday ? 'today' : ''} ${cook ? 'cook' : ''}" ${isToday ? 'aria-current="date"' : ''}>
      <div class="day-label"><b>${template ? dayName(addDays('2026-11-02', i)).slice(0, 3) : shortDay(date)}</b>${date ? `<small>${monthDay(date)}</small>` : ''}${cook ? '<span class="chip cook">Cook</span>' : ''}</div>
      <div class="day-slots">${slots}</div></li>`;
  }).join('');
  root.innerHTML = `
    ${header(`Week ${letter}`, { right: template ? '' : `<span class="head-note">${monthDay(monday)} to ${monthDay(addDays(monday, 6))}</span>` })}
    <div class="segmented" role="tablist">${seg.map(([id, label]) => `<a role="tab" href="#/week?w=${id}" aria-selected="${mode === id}">${label}</a>`).join('')}</div>
    ${template ? '<p class="muted note">Template view. Swaps apply to real dates, so use This week or Next week to change a day.</p>' : ''}
    <ol class="week-list">${days}</ol>`;
  root.onclick = (e) => {
    const reset = e.target.closest('[data-reset]');
    if (reset) {
      const [d, s] = reset.dataset.reset.split('|');
      ctx.overrides = clearOverride(ctx.overrides, d, s); save('overrides'); render();
      return;
    }
    const b = e.target.closest('.slot-btn[data-date]');
    if (b) openSwap(b.dataset.date, b.dataset.slot);
  };
  root.onchange = null;
}

// ---------- Spin ----------

const spinState = { filters: new Set(), batch: false, spinning: false };

function filterChips(active, attr = 'data-filter') {
  return `<div class="chips" role="group" aria-label="Filters">${FILTERS.map((f) =>
    `<button class="fchip" ${attr}="${f.id}" aria-pressed="${active.has(f.id)}">${f.label}</button>`).join('')}</div>`;
}

function viewSpin(query) {
  const date = query.get('date') || today();
  const targetSlot = query.get('slot');
  if (pantryIsEmpty(ctx)) {
    root.innerHTML = `${header('Spin')}<section class="card calm empty-state"><h2>Mark what's in your fridge first</h2>
      <p class="muted">The wheel only picks recipes you can make right now.</p><a class="btn primary wide" href="#/pantry">Go to Pantry</a></section>`;
    root.onclick = null;
    return;
  }
  const { pool, skipped, relaxed } = candidates(ctx, recipeList, spinState.filters, date);
  const segs = sample(pool, 8);
  const misses = nearMisses(ctx, applyFilters(recipeList, spinState.filters));
  root.innerHTML = `
    ${header('Spin', { right: `<label class="switch"><input type="checkbox" data-act="batch-mode" ${spinState.batch ? 'checked' : ''}><span>Spin a batch</span></label>` })}
    ${targetSlot ? `<p class="muted note">Picking ${dayName(date)} ${targetSlot}.</p>` : ''}
    ${filterChips(spinState.filters)}
    ${spinState.batch ? `<section class="card calm"><h2>Spin a batch</h2><p class="muted">Picks 2 or 3 batch-friendly recipes you can make from what's on hand, with different proteins.</p>
      <button class="btn primary wide big" data-act="spin-batch">Spin a batch</button></section>`
    : segs.length ? `
      <div class="wheel-wrap">
        <div class="pointer" aria-hidden="true"></div>
        ${wheelSVG(segs)}
      </div>
      <p class="muted center">${pool.length} you can make${pool.length > 8 ? ', 8 on the wheel' : ''}${skipped && !relaxed ? ` · skipping ${skipped} from the last 2 days` : ''}${relaxed ? ' · only recent meals match, so they are back in' : ''}</p>
      <button class="btn primary wide big" data-act="spin">Spin</button>`
    : `<section class="card calm"><h2>Nothing matches</h2><p class="muted">No recipe fits these filters with what's in your pantry.</p></section>`}
    ${misses.length ? `<section class="misses"><h2>One ingredient away</h2><ul>${misses.map((m) => `<li><a href="${recipeHref(m.recipe)}">${esc(m.recipe.short)}</a> <span class="muted">needs ${esc(itemShort(ctx, m.missing[0]))}</span></li>`).join('')}</ul></section>` : ''}`;

  root.onchange = (e) => {
    if (e.target.dataset.act === 'batch-mode') { spinState.batch = e.target.checked; render(); }
  };
  root.onclick = async (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      const id = f.dataset.filter;
      spinState.filters.has(id) ? spinState.filters.delete(id) : spinState.filters.add(id);
      render();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'spin' && !spinState.spinning) {
      spinState.spinning = true;
      const btn = e.target.closest('button');
      btn.disabled = true;
      const idx = Math.floor(Math.random() * segs.length);
      await spinTo(root.querySelector('.wheel-svg'), segs.length, idx);
      spinState.spinning = false;
      btn.disabled = false;
      showResult(segs[idx], date, targetSlot);
    }
    if (act === 'spin-batch') {
      const picks = pickBatch(ctx, recipeList, date);
      if (!picks.length) { toast('No batch recipes are makeable right now'); return; }
      announce(`Batch: ${picks.map((p) => p.short).join(', ')}`);
      sheet(`<h2 class="sheet-title">Your batch</h2>
        <ul class="pick-list">${picks.map((r) => `<li><a class="pick-row" href="${recipeHref(r)}" data-close>${plateSVG(r, null, 48)}<span class="pick-main"><b>${esc(r.name)}</b><small>${r.timeMin} min · keeps ${r.fridgeDays} days · ${r.macros.p}g P</small></span></a></li>`).join('')}</ul>
        <div class="sheet-actions"><button class="btn ghost" data-respin>Spin again</button></div>`, { label: 'Batch result' })
        .addEventListener('click', (ev) => { if (ev.target.closest('[data-respin]')) { closeSheet(); root.querySelector('[data-act="spin-batch"]').click(); } });
    }
  };
}

function showResult(r, date, targetSlot) {
  announce(`The wheel picked ${r.name}`);
  const slots = targetSlot ? [targetSlot] : SLOTS;
  const isToday = date === today();
  const panel = sheet(`
    <div class="result">
      ${plateSVG(r, null, 132)}
      <h2 class="sheet-title center">${esc(r.name)}</h2>
      <p class="muted center">${r.timeMin} min · ${r.type === 'fresh' ? 'cook fresh' : `batches well, keeps ${r.fridgeDays} days`}</p>
      ${macroChips(r.macros)}
    </div>
    <div class="sheet-actions stack">
      <a class="btn primary big" href="${cookHref(r, 1, null, '#/spin')}" data-close>${icon('flame', 20)} Cook it now</a>
      ${slots.map((s) => `<button class="btn ghost big" data-put="${s}">Put it in ${isToday ? "today's" : dayName(date) + "'s"} ${s}</button>`).join('')}
    </div>`, { label: 'Wheel result' });
  panel.addEventListener('click', (e) => {
    const put = e.target.closest('[data-put]');
    if (!put) return;
    ctx.overrides = setOverride(ctx.overrides, date, put.dataset.put, r.id);
    save('overrides');
    closeSheet();
    toast(`${r.short} is ${isToday ? "today's" : dayName(date) + "'s"} ${put.dataset.put}`);
    if (targetSlot) location.hash = isToday ? '#/today' : '#/week';
  });
}

// ---------- Recipes ----------

const recipeState = { q: '', filters: new Set(), checked: new Map() };

function recipeCards() {
  const q = recipeState.q.trim().toLowerCase();
  const list = applyFilters(recipeList, recipeState.filters).filter((r) =>
    !q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => [].concat(i.item).some((id) => itemName(ctx, id).toLowerCase().includes(q))));
  if (!list.length) return '<p class="muted center">No recipes match.</p>';
  return list.map((r) => `
    <a class="card recipe-card" href="${recipeHref(r)}">
      ${plateSVG(r, null, 84)}
      <div><h2>${esc(r.name)}</h2>
      <p class="muted">${r.timeMin} min · ${r.type === 'fresh' ? 'Cook fresh' : `Batches well · ${r.fridgeDays} d`}${canMake(ctx, r) ? '' : ' · <span class="needs">missing items</span>'}</p>
      ${macroChips(r.macros)}</div></a>`).join('');
}

function viewRecipes() {
  root.innerHTML = `${header('Recipes')}
    <label class="search"><span class="sr-only">Search recipes</span><input type="search" placeholder="Search recipes or ingredients" value="${esc(recipeState.q)}" data-act="search"></label>
    ${filterChips(recipeState.filters)}
    <div class="recipe-grid">${recipeCards()}</div>`;
  root.oninput = (e) => {
    if (e.target.dataset.act === 'search') {
      recipeState.q = e.target.value;
      root.querySelector('.recipe-grid').innerHTML = recipeCards();
    }
  };
  root.onchange = null;
  root.onclick = (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    const id = f.dataset.filter;
    recipeState.filters.has(id) ? recipeState.filters.delete(id) : recipeState.filters.add(id);
    f.setAttribute('aria-pressed', recipeState.filters.has(id));
    root.querySelector('.recipe-grid').innerHTML = recipeCards();
  };
}

const SERVINGS = [1, 2, 3, 4, 6];

function viewRecipe(id, query) {
  const r = ctx.recipes.get(id);
  if (!r) { root.innerHTML = `${header('Not found', { back: '#/recipes' })}<p class="muted">That recipe isn't in the list.</p>`; return; }
  const variant = query.get('v');
  let servings = Number(query.get('s')) || 1;
  const checked = recipeState.checked.get(id) || new Set();
  recipeState.checked.set(id, checked);
  const missing = missingFor(ctx, r);
  const paintIngredients = () => scaleIngredients(ctx, r, variant, servings).map((g, i) => `
    <li><button class="ing-check" data-ing="${i}" aria-pressed="${checked.has(i)}">
      <span class="box" aria-hidden="true"></span>
      <span class="ing-name">${esc(itemName(ctx, g.item))}${g.required ? '' : ' <em>(optional)</em>'}</span>
      <b>${fmtQty(g.qty, g.unit)}</b></button></li>`).join('');
  root.innerHTML = `
    ${header('', { back: '#/recipes' })}
    <article class="recipe-page">
      <div class="recipe-hero">${plateSVG(r, variant, 168)}</div>
      <h1 class="recipe-title">${esc(r.name)}${variantLabel(variant)}</h1>
      <div class="badges">
        <span class="badge ${r.type}">${r.type === 'fresh' ? 'Cook fresh' : 'Batches well'}</span>
        ${r.methods.map((m) => `<span class="badge">${esc(m[0].toUpperCase() + m.slice(1))}</span>`).join('')}
        <span class="badge">${icon('clock', 16)} ${r.timeMin} min</span>
        <span class="badge">${r.fridgeDays ? `Keeps ${r.fridgeDays} days` : 'Same day'}</span>
      </div>
      <p class="muted per">Per serving</p>
      ${macroChips(r.macros)}
      ${missing.length ? `<p class="flag">Not in your pantry: ${missing.map((m) => esc(itemShort(ctx, m))).join(', ')}.</p>` : ''}
      <div class="stepper" role="group" aria-label="Servings">
        <span>Servings</span>
        ${SERVINGS.map((n) => `<button data-serv="${n}" aria-pressed="${n === servings}">${n}</button>`).join('')}
      </div>
      <h2 class="section-h">Ingredients</h2>
      <ul class="ing-checklist">${paintIngredients()}</ul>
      <h2 class="section-h">Steps</h2>
      <ol class="steps">${r.steps.map((s) => `<li>${esc(s.text)}${s.timerMin ? ` <span class="muted">(${s.timerMin} min)</span>` : ''}</li>`).join('')}</ol>
      <div class="sticky-cta"><a class="btn primary wide big" data-start href="${cookHref(r, servings, variant, `#/recipes/${r.id}`)}">${icon('flame', 20)} Start cooking</a></div>
    </article>`;
  root.onchange = null;
  root.oninput = null;
  root.onclick = (e) => {
    const sv = e.target.closest('[data-serv]');
    if (sv) {
      servings = Number(sv.dataset.serv);
      root.querySelectorAll('[data-serv]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.serv) === servings));
      root.querySelector('.ing-checklist').innerHTML = paintIngredients();
      root.querySelector('[data-start]').href = cookHref(r, servings, variant, `#/recipes/${r.id}`);
      history.replaceState(null, '', `#/recipes/${r.id}?${new URLSearchParams({ ...(variant ? { v: variant } : {}), s: servings })}`);
      return;
    }
    const ing = e.target.closest('[data-ing]');
    if (ing) {
      const i = Number(ing.dataset.ing);
      checked.has(i) ? checked.delete(i) : checked.add(i);
      ing.setAttribute('aria-pressed', checked.has(i));
    }
  };
}

// ---------- Pantry ----------

function viewPantry() {
  const groups = GROUPS.map((g) => {
    const items = [...ctx.ingredients.values()].filter((i) => i.group === g.id);
    return `<section class="pantry-group"><h2 class="section-h">${g.name}${g.id === 'staple' ? ' <small>always assumed</small>' : ''}</h2>
      <ul>${items.map((i) => {
        const on = !!ctx.pantry[i.id]?.in;
        const weighable = g.id === 'protein' && !['eggs', 'protein-powder'].includes(i.id);
        return `<li class="pantry-row">
          <button class="toggle-row" data-item="${i.id}" aria-pressed="${on}"><span class="dot" aria-hidden="true"></span><span>${esc(i.name)}</span><small>${on ? 'In stock' : 'Out'}</small></button>
          ${weighable ? `<label class="lb"><input type="number" inputmode="decimal" min="0" step="0.1" value="${ctx.pantry[i.id]?.lb ?? ''}" data-lb="${i.id}" aria-label="${esc(i.name)} pounds"><span>lb</span></label>` : ''}
        </li>`;
      }).join('')}</ul></section>`;
  }).join('');
  const guide = portionGuide(ctx, today(), ctx.settings.nextOrder);
  root.innerHTML = `${header('Pantry')}
    <p class="muted note">Tap what's in the fridge. The wheel and the batch planner read this.</p>
    ${guide.length ? `<section class="card guide"><h2>Portion guide</h2><ul>${guide.map((g) => `<li>${g.lb} lb ${esc(itemShort(ctx, g.item))} across ${g.servings} servings = about <b>${g.ozEach.toFixed(1)} oz raw each</b></li>`).join('')}</ul><p class="muted">Planned servings from today until ${monthDay(ctx.settings.nextOrder)}.</p></section>` : ''}
    ${groups}
    <button class="btn ghost wide" data-act="reset-pantry">Reset to last grocery order (${monthDay(seed.order)})</button>`;
  root.onclick = (e) => {
    const t = e.target.closest('[data-item]');
    if (t) {
      const id = t.dataset.item;
      const cur = ctx.pantry[id] || {};
      ctx.pantry = { ...ctx.pantry, [id]: { ...cur, in: !cur.in } };
      save('pantry');
      t.setAttribute('aria-pressed', !cur.in);
      t.querySelector('small').textContent = !cur.in ? 'In stock' : 'Out';
      return;
    }
    if (e.target.closest('[data-act="reset-pantry"]')) {
      if (!confirm('Reset the pantry to the last grocery order?')) return;
      ctx.pantry = seedToPantry(seed); save('pantry'); render(); toast('Pantry reset');
    }
  };
  root.onchange = (e) => {
    const id = e.target.dataset.lb;
    if (!id) return;
    const v = parseFloat(e.target.value);
    const cur = ctx.pantry[id] || {};
    const next = { ...cur };
    if (Number.isFinite(v) && v > 0) { next.lb = v; next.in = true; } else delete next.lb;
    ctx.pantry = { ...ctx.pantry, [id]: next }; save('pantry'); render();
  };
  root.oninput = null;
}

// ---------- Settings ----------

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function viewSettings() {
  const s = ctx.settings;
  const num = (key, label, step = 1, suffix = '') => `<label class="field"><span>${label}</span><span class="field-in"><input type="number" inputmode="decimal" step="${step}" min="0" data-set="${key}" value="${s[key]}">${suffix ? `<small>${suffix}</small>` : ''}</span></label>`;
  root.innerHTML = `${header('Settings', { back: '#/today' })}
    <section class="card form">
      <h2>Targets</h2>
      ${num('proteinTarget', 'Protein target', 5, 'g')}
      ${num('kcalTarget', 'Calorie target', 50, 'kcal')}
      ${num('shakeScoops', 'Shake scoops per day', 1)}
      ${num('proteinPerScoop', 'Protein per scoop', 1, 'g')}
      ${num('eggsPerDay', 'Eggs per day outside meals', 1)}
    </section>
    <section class="card form">
      <h2>Schedule</h2>
      <div class="field"><span>Cook days</span><div class="chips">${DAY_KEYS.map((d) => `<button class="fchip" data-cookday="${d}" aria-pressed="${s.cookDays.includes(d)}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
      <label class="field"><span>Week A starts (a Monday)</span><input type="date" data-set="rotationStart" value="${s.rotationStart}"></label>
      <label class="field"><span>Next grocery order</span><input type="date" data-set="nextOrder" value="${s.nextOrder}"></label>
    </section>
    <section class="card form">
      <h2>Theme</h2>
      <div class="segmented" role="radiogroup">${['system', 'light', 'dark'].map((t) => `<button role="radio" data-theme-pick="${t}" aria-checked="${s.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    </section>
    <section class="card form">
      <h2>Your data</h2>
      <p class="muted">Pantry, swaps and settings live in this browser only${store.isPersistent() ? '' : ' (storage is blocked here, so changes last until you close the tab)'}.</p>
      <div class="sheet-actions"><button class="btn ghost" data-act="export">Export JSON</button>
      <label class="btn ghost">Import JSON<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
    </section>`;
  root.oninput = null;
  root.onchange = async (e) => {
    const key = e.target.dataset.set;
    if (key) {
      let v = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
      if (e.target.type === 'number' && !Number.isFinite(v)) return;
      if (key === 'rotationStart' && v) v = mondayOf(v);
      ctx.settings = { ...ctx.settings, [key]: v };
      save('settings');
      if (key === 'rotationStart') { e.target.value = v; toast(`Week A starts ${monthDay(v)}`); }
    }
    if (e.target.dataset.act === 'import' && e.target.files[0]) {
      try {
        store.importAll(JSON.parse(await e.target.files[0].text()));
        await load(); applyTheme(); render(); toast('Data imported');
      } catch (err) { toast(err.message || 'Import failed'); }
    }
  };
  root.onclick = (e) => {
    const cd = e.target.closest('[data-cookday]');
    if (cd) {
      const d = cd.dataset.cookday;
      const days = ctx.settings.cookDays.includes(d) ? ctx.settings.cookDays.filter((x) => x !== d) : [...ctx.settings.cookDays, d];
      ctx.settings = { ...ctx.settings, cookDays: days }; save('settings');
      cd.setAttribute('aria-pressed', days.includes(d));
      return;
    }
    const th = e.target.closest('[data-theme-pick]');
    if (th) {
      ctx.settings = { ...ctx.settings, theme: th.dataset.themePick }; save('settings'); applyTheme();
      root.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', b === th));
      return;
    }
    if (e.target.closest('[data-act="export"]')) {
      const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `meal-prep-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };
}

// ---------- routing ----------

function buildTabbar() {
  const tabs = [['today', 'Today'], ['week', 'Week'], ['spin', 'Spin'], ['recipes', 'Recipes'], ['pantry', 'Pantry']];
  document.querySelector('.tabbar').innerHTML = tabs.map(([id, label]) =>
    `<a href="#/${id}" data-tab="${id}">${icon(id, 24)}<span>${label}</span></a>`).join('');
}

function setTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function render() {
  const { parts, query } = router.current();
  const [page, id] = parts;
  closeSheet();
  if (page !== 'cook') exitCook();
  root.oninput = null;
  switch (page) {
    case 'week': setTab('week'); viewWeek(query); break;
    case 'spin': setTab('spin'); viewSpin(query); break;
    case 'recipes': setTab('recipes'); id ? viewRecipe(id, query) : viewRecipes(); break;
    case 'pantry': setTab('pantry'); viewPantry(); break;
    case 'settings': setTab('today'); viewSettings(); break;
    case 'cook': {
      const r = ctx.recipes.get(id);
      if (!r) { router.go('#/recipes', true); return; }
      root.onclick = null; root.onchange = null;
      renderCook(root, ctx, r, query.get('v'), Number(query.get('s')) || 1, query.get('back') || `#/recipes/${id}`);
      break;
    }
    default: setTab('today'); viewToday();
  }
}

let lastPath = '';
router.onChange(() => {
  const path = location.hash.split('?')[0];
  render();
  if (path !== lastPath) { window.scrollTo(0, 0); root.focus({ preventScroll: true }); }
  lastPath = path;
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

buildTabbar();
load().then(() => {
  applyTheme();
  lastPath = location.hash.split('?')[0];
  render();
}).catch((err) => {
  root.innerHTML = `<section class="card calm"><h2>Couldn't load the recipes</h2><p class="muted">${esc(err.message)}</p></section>`;
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
