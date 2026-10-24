/* NODAC SchoolSuite - offline shell. Network first (updates always arrive), cache only this site's own files.
   Requests to the database/auth servers are never touched or stored here. */
const CACHE = 'nodac-shell-v4';
const FILES = ['./', './index.html', './local-engine.js', './cloud-config.js', './manifest.json', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); } return r; }).catch(() => caches.match(e.request)));
});
