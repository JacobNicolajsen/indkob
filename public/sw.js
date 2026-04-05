const CACHE = 'indkob-v3';
const STATIC = [
  '/indkob/',
  '/indkob/js/app.js',
  '/indkob/js/api.js',
  '/indkob/js/constants.js',
  '/indkob/js/views/mealplan.js',
  '/indkob/js/views/recipes.js',
  '/indkob/js/views/shoppinglist.js',
  '/indkob/js/views/catalog.js',
  '/indkob/js/views/more.js',
  '/indkob/css/app.css',
  '/indkob/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API-kald: altid netværk, fallback til cache ved fejl
  if (url.pathname.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Statiske filer: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      });
    })
  );
});
