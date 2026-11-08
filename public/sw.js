/**
 * Offline cache for the simulator.
 *
 * The build emits content-hashed file names, so there is nothing stable to
 * pre-cache by hand; instead every same-origin GET is cached the first time it
 * is fetched and served from the cache afterwards, which is exactly right for
 * hashed assets (a new build asks for new names) and for the 7.5 MB car model
 * (fetched once, then never again).
 *
 * Navigations go to the network first so a redeploy is picked up while online,
 * and fall back to the cached page when there is none — that is what makes the
 * home-screen icon work on a plane or with no signal.
 *
 * Bump CACHE when the caching rules themselves change; old caches are dropped
 * on activate.
 */
const CACHE = 'bmw-f90-sim-__BUILD__';

/**
 * Pull in everything listed in sw-manifest.json (written by
 * scripts/build-sw-manifest.mjs at build time). Files are added one at a time
 * rather than with cache.addAll so that one failure does not throw the whole
 * install away — a partly warm cache still beats none.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  let urls = ['./'];
  try {
    const res = await fetch('./sw-manifest.json', { cache: 'no-cache' });
    if (res.ok) urls = (await res.json()).urls ?? urls;
  } catch {
    /* dev server, or offline during install — runtime caching still applies */
  }
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
    } catch {
      /* skip this one */
    }
  }));
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

/**
 * `ignoreVary` matters here. Static hosts (vite preview, GitHub Pages, most
 * CDNs) answer with `Vary: Origin`, and the Origin header a precache fetch
 * sends is not always the one the browser sends when it later asks for the
 * same file as a module script — so a strict match misses an entry that is
 * sitting right there, and the app fails to start offline. Everything cached
 * here is a same-origin static file, so varying on Origin is meaningless.
 */
const MATCH = { ignoreVary: true };

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) {
    // Hashed names never change contents, so there is nothing to revalidate.
    return hit;
  }
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request, MATCH)) || (await cache.match('./', MATCH));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDNs and analytics are not ours to cache
  if (request.mode === 'navigate') {
    e.respondWith(networkFirst(request));
    return;
  }
  e.respondWith(cacheFirst(request));
});
