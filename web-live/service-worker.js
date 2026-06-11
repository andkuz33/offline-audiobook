// Кэш оболочки приложения. Сам перевод требует интернета (WebSocket к Gemini).
const CACHE = 'sync-translator-live-v1';
const ASSETS = [
  './', './index.html', './styles.css',
  './app.js', './audio.js', './gemini-live.js', './pcm-worklet.js',
  './manifest.webmanifest', './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(request).then((c) => c || fetch(request)));
});
