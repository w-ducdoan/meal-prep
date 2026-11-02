// Cook mode: one step at a time, parallel timers, screen wake lock.
import { scaleIngredients, fmtQty } from './batch.js';
import { itemName } from './pantry.js';
import { esc, icon, sheet, announce } from './ui.js';

const timers = [];
let tickHandle = null;
let wakeLock = null;
let audio;

function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3);
    });
  } catch { /* audio blocked */ }
  if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 250]);
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function startTimer(label, minutes) {
  // Unlock audio on the user's tap so the alarm can play later.
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* ignore */ }
  timers.push({ id: Math.random().toString(36).slice(2), label, endsAt: Date.now() + minutes * 60000, done: false });
  ensureTicking();
}

function ensureTicking() {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    for (const t of timers) {
      if (!t.done && Date.now() >= t.endsAt) {
        t.done = true;
        beep();
        announce(`${t.label} timer done`);
      }
    }
    paintTimers();
    if (!timers.length) { clearInterval(tickHandle); tickHandle = null; }
  }, 500);
}

function paintTimers() {
  const strip = document.querySelector('.timer-strip');
  if (!strip) return;
  strip.hidden = !timers.length;
  strip.innerHTML = timers.map((t) => `
    <button class="timer ${t.done ? 'done' : ''}" data-timer="${t.id}" aria-label="${esc(t.label)} ${t.done ? 'done, tap to clear' : fmtClock(t.endsAt - Date.now()) + ' left, tap to cancel'}">
      <span class="timer-label">${esc(t.label)}</span>
      <span class="timer-time">${t.done ? 'Done' : fmtClock(t.endsAt - Date.now())}</span>
    </button>`).join('');
}

async function lockScreen() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { wakeLock = null; }
}

function onVisible() {
  if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) lockScreen();
}

export function exitCook() {
  document.body.classList.remove('cooking');
  document.removeEventListener('visibilitychange', onVisible);
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

export function renderCook(root, ctx, recipe, variant, servings, backHash) {
  document.body.classList.add('cooking');
  lockScreen();
  document.addEventListener('visibilitychange', onVisible);

  const steps = recipe.steps;
  let i = 0;
  const ingredients = scaleIngredients(ctx, recipe, variant, servings);

  root.innerHTML = `
    <section class="cook-mode" aria-label="Cook mode: ${esc(recipe.name)}">
      <header class="cook-top">
        <a class="icon-btn" href="${backHash}" aria-label="Exit cook mode">${icon('close')}</a>
        <div class="cook-title"><span>${esc(recipe.short)}</span><small>${servings} serving${servings > 1 ? 's' : ''}</small></div>
        <button class="icon-btn" data-act="ingredients" aria-label="Show ingredients">${icon('list')}</button>
      </header>
      <div class="timer-strip" hidden aria-label="Running timers"></div>
      <div class="cook-progress" aria-hidden="true"><span></span></div>
      <div class="cook-step" aria-live="polite"></div>
      <nav class="cook-nav">
        <button class="btn ghost big" data-act="prev">Back</button>
        <button class="btn primary big" data-act="next">Next</button>
      </nav>
    </section>`;

  const stepEl = root.querySelector('.cook-step');
  const bar = root.querySelector('.cook-progress span');
  const paint = () => {
    const st = steps[i];
    const last = i === steps.length - 1;
    stepEl.innerHTML = `
      <p class="step-count">Step ${i + 1} of ${steps.length}</p>
      <p class="step-text">${esc(st.text)}</p>
      ${st.timerMin ? `<button class="btn timer-btn" data-act="timer">${icon('clock')} Start ${st.timerMin} min timer</button>` : ''}`;
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    root.querySelector('[data-act="prev"]').disabled = i === 0;
    const next = root.querySelector('[data-act="next"]');
    next.textContent = last ? 'Done' : 'Next';
  };
  paint();
  paintTimers();

  const move = (d) => {
    if (i + d >= steps.length) { location.hash = backHash; return; }
    i = Math.max(0, Math.min(steps.length - 1, i + d));
    paint();
  };

  root.querySelector(".cook-mode").addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-timer]');
    if (!t) return;
    if (t.dataset.timer) {
      const idx = timers.findIndex((x) => x.id === t.dataset.timer);
      if (idx >= 0) timers.splice(idx, 1);
      paintTimers();
      return;
    }
    const act = t.dataset.act;
    if (act === 'next') move(1);
    if (act === 'prev') move(-1);
    if (act === 'timer') {
      const st = steps[i];
      startTimer(st.label || `Step ${i + 1}`, st.timerMin);
      paintTimers();
    }
    if (act === 'ingredients') {
      sheet(`<h2 class="sheet-title">Ingredients <small>${servings} serving${servings > 1 ? 's' : ''}</small></h2>
        <ul class="ing-list">${ingredients.map((g) => `<li><span>${esc(itemName(ctx, g.item))}${g.required ? '' : ' <em>(optional)</em>'}</span><b>${fmtQty(g.qty, g.unit)}</b></li>`).join('')}</ul>`,
      { label: 'Ingredients' });
    }
  });

  let sx = null, sy = null;
  stepEl.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stepEl.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  });
}
