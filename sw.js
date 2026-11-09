// Change VERSION whenever any app file changes, so phones pick up the new copy.
const VERSION = 'v4';
const CACHE = 'court-sheet-' + VERSION;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'shared.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

importScripts('shared.js');

self.addEventListener('install', (event) => {
  // 'reload' skips the browser's own cache. GitHub Pages lets browsers reuse files for 10 minutes,
  // which could otherwise save an old copy of a page into the new version.
  const fresh = FILES.map((f) => new Request(f, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('court-sheet-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Uploads go to script.google.com and are left alone.
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(event.request);
    } catch (err) {
      if (event.request.mode === 'navigate') return caches.match('index.html');
      throw err;
    }
  })());
});

// Background Sync: upload once the connection returns, even with the app closed.
// Chrome on Android supports this. iPhones upload the next time the app is opened instead.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'upload-games') return;
  event.waitUntil((async () => {
    const result = await CourtSheet.upload();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((w) => w.postMessage('games-changed'));
    if (result.state === 'network') throw new Error('Still offline'); // Asks the browser to retry.
  })());
});
