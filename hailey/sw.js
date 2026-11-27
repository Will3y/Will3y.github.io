// Hors ligne : on répond tout de suite avec la copie en cache, puis on la met à jour
// en arrière-plan. Une nouvelle version du jeu apparaît donc à l'ouverture suivante.
// La progression n'est pas ici : elle reste dans le localStorage de l'appareil.
const CACHE = 'hailey-v5';
const FILES = ['./', './index.html', './manifest.webmanifest', './img/icon-192.png', './img/icon-512.png', './img/apple-touch-icon.png'];
const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !FONTS.includes(url.hostname)) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
        if (cached) { event.waitUntil(fresh.catch(() => {})); return cached; }
        return fresh;
      }),
    ),
  );
});
