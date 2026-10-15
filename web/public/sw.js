/* Cache the app shell and static references only. API responses and map tiles never enter CacheStorage. */
const CACHE = 'gtt-shell-v2';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/data/depot-references.json', '/data/gerbido-change-posts.json']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gtt-shell-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || !['navigate','script','style','image','manifest',''].includes(event.request.destination)) return;
  if (url.pathname !== '/' && !url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/data/') && !['/icon.svg','/manifest.webmanifest'].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(async () => (await caches.match(event.request)) ?? Response.error()));
});
