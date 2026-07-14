const CACHE = 'vcap-v4';
const URLS = ['index.html', 'manifest.json',
  'css/styles.css',
  'js/shared.js?v=3', 'js/config.js?v=3', 'js/supabase.js?v=3', 'js/app.js?v=3'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.pathname === '/vendedor-app/' || url.pathname === '/vendedor-app/index.html' || url.pathname === '/vendedor-app/') {
    e.respondWith(
      fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchP = fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; });
      return cached || fetchP;
    })
  );
});
