// Small shared UI helpers: escaping, chips, bottom sheets, toasts.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function macroChips(m) {
  const est = m.source === 'estimate' ? '<span class="est">est.</span>' : '';
  return `<div class="macros" aria-label="${m.kcal} calories, ${m.p} grams protein, ${m.c} grams carbs, ${m.f} grams fat">
    <span class="chip kcal">${m.kcal.toLocaleString()} kcal</span>
    <span class="chip pro">${m.p}g P</span>
    <span class="chip">${m.c}g C</span>
    <span class="chip">${m.f}g F</span>${est}</div>`;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Bottom sheet with drag handle; swipe down, backdrop tap or Escape closes.
let openSheet = null;
export function sheet(html, { label = 'Sheet', onClose } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
      <div class="sheet-handle" aria-hidden="true"><span></span></div>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  const panel = wrap.querySelector('.sheet');
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => wrap.classList.add('open'));
  panel.focus({ preventScroll: true });

  let startY = null, dy = 0;
  const handleZone = (e) => e.target.closest('.sheet-handle') || panel.querySelector('.sheet-body').scrollTop <= 0;
  panel.addEventListener('touchstart', (e) => {
    if (!handleZone(e)) return;
    startY = e.touches[0].clientY; dy = 0;
    panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (startY == null) return;
    panel.style.transition = '';
    panel.style.transform = '';
    startY = null;
    if (dy > 90) closeSheet();
  });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);

  openSheet = { wrap, onClose, onKey, prevFocus };
  return panel;
}

export function closeSheet() {
  if (!openSheet) return;
  const { wrap, onClose, onKey, prevFocus } = openSheet;
  openSheet = null;
  document.removeEventListener('keydown', onKey);
  wrap.classList.remove('open');
  setTimeout(() => wrap.remove(), reducedMotion() ? 0 : 220);
  if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  onClose?.();
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function announce(msg) {
  const el = document.getElementById('live');
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}

// Line icons (stroke uses currentColor).
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  spin: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4M12 12 5.6 18.4M12 12H3"/>',
  recipes: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  pantry: '<path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M3 4h18v3H3zM10 11h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>'
};
export function icon(name, size = 22) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}
