// Cache the app shell and data so it opens instantly and works offline.
// Bump VERSION whenever shell files change.
const VERSION = 'v1';
const CACHE = `meal-prep-${VERSION}`;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/router.js', 'js/store.js', 'js/plan.js', 'js/batch.js', 'js/wheel.js',
  'js/pantry.js', 'js/cook.js', 'js/art.js', 'js/ui.js',
  'data/recipes.json', 'data/ingredients.json', 'data/plan.json', 'data/pantry-seed.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('meal-prep-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: answer from cache, refresh in the background.
// Covers Google Fonts too, so type survives offline after the first visit.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: sameOrigin && req.mode === 'navigate' });
      const network = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
      return cached || network;
    })
  );
});
