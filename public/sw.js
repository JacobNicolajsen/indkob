const CACHE = 'indkob-v5';

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
  '/indkob/js/views/staples.js',
  '/indkob/css/app.css',
  '/indkob/manifest.json',
];

// ── Install: pre-cache alle app-filer ────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())   // aktivér med det samme, vent ikke på lukning af gamle tabs
  );
});

// ── Activate: ryd gamle caches, claim clients, reload ved opdatering ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      const old      = keys.filter(k => k !== CACHE);
      const isUpdate = old.length > 0;  // kun reload hvis der fandtes en gammel cache
      return Promise.all(old.map(k => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          if (!isUpdate) return;
          // Reload alle åbne tabs så de får den nye version med det samme
          return self.clients.matchAll({ type: 'window' }).then(clients =>
            clients.forEach(c => c.navigate(c.url))
          );
        });
    })
  );
});

// ── Fetch: network-first for alle app-ressourcer ──────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API-kald: udelukkende netværk, ingen caching
  if (url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // App-filer: netværk-first — hent seneste version, gem i cache, brug cache kun ved offline
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && response.status === 200 && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))  // offline-fallback
  );
});
