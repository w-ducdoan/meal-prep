// Hash router: "#/recipes/beef-linguine?s=2" -> { parts: ['recipes', 'beef-linguine'], query }
export function current() {
  const raw = location.hash.replace(/^#\/?/, '') || 'today';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts: parts.length ? parts : ['today'], query: new URLSearchParams(qs || '') };
}

export function go(hash, replace = false) {
  const target = hash.startsWith('#') ? hash : `#/${hash}`;
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function onChange(fn) {
  window.addEventListener('hashchange', fn);
}
