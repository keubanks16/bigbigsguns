// Caches the app shell so it opens without a connection.
const CACHE = 'bbgc-v9';
const SHELL = ['./', 'index.html', 'styles.css', 'db.js', 'vault.js', 'account.js', 'csvimport.js', 'stockphoto.js', 'recognize.js', 'app.js', 'logo.png', 'favicon.png', 'apple-touch-icon.png', 'manifest.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates show up; fall back to cache offline.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
