/* TrackFleet : service worker.
   Le serveur remplace le marqueur de version ci-dessous à chaque déploiement : le cache se renouvelle tout seul.
   Jamais en cache : l'API (/api/), le flux temps réel et les tuiles de carte (autre origine). */
'use strict';
const BUILD = '__BUILD__';
const CACHE = `tf-static-${BUILD}`;
const PRECACHE = [
  '/', '/login.html', '/offline.html', '/style.css', '/app.js', '/i18n.js', '/login.js', '/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.svg',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/images/layers.png', '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png'
];
const NETWORK_WAIT_MS = 3500; // réseau lent : on affiche la copie en cache et on met à jour en arrière-plan

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier manquant ne doit pas empêcher l'installation
    await Promise.allSettled(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tf-static-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// La page propose « Actualiser » quand une nouvelle version attend ; elle nous le confirme par ce message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Réseau d'abord (toujours à jour quand on est en ligne), copie en cache si le réseau est absent ou trop lent
async function networkFirst(request, key, event) {
  const cache = await caches.open(CACHE);
  const fetching = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(key || request, res.clone());
    return res;
  });
  const timer = new Promise((resolve) => setTimeout(() => resolve('slow'), NETWORK_WAIT_MS));
  const first = await Promise.race([fetching.catch(() => null), timer]);
  if (first && first !== 'slow') return first;
  const hit = await cache.match(key || request);
  if (hit) { event.waitUntil(fetching.catch(() => {})); return hit; }
  return fetching.catch(() => null); // rien en cache : on attend le réseau
}

// Fichiers versionnés (Leaflet, icônes) : cache d'abord
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch { return Response.error(); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tuiles OpenStreetMap : réseau direct
  const p = url.pathname;
  if (p.startsWith('/api/') || p === '/sw.js') return; // données en direct : jamais interceptées

  if (req.mode === 'navigate') {
    const key = p === '/login.html' ? '/login.html' : (p === '/' || p === '/index.html' ? '/' : null);
    event.respondWith((async () => {
      const res = key ? await networkFirst(req, key, event) : await fetch(req).catch(() => null);
      return res || (await caches.match('/offline.html')) || Response.error();
    })());
    return;
  }
  if (p.startsWith('/vendor/') || p.startsWith('/icons/')) { event.respondWith(cacheFirst(req)); return; }
  event.respondWith((async () => (await networkFirst(req, null, event)) || Response.error())());
});
