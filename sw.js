/* TL Mastery service worker. Scope: this app's folder only (registered as ./sw.js).
 * Bump VERSION on every change to this file (tests/sw_test.js checks it). */
const VERSION = 1;
const SHELL = 'tlm-shell-v' + VERSION;   // HTML, JS, manifest: network first, cache when offline
const MEDIA = 'tlm-media-v' + VERSION;   // images, audio, fonts: cache first
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const NET_WAIT_MS = 4000;                // slow network: show the saved copy after 4 s

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tlm-') && k !== SHELL && k !== MEDIA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isMedia = url => /\.(png|jpe?g|gif|webp|svg|ico|mp3|m4a|ogg|wav|mp4|woff2?)$/i.test(url.pathname) || url.hostname === 'fonts.gstatic.com';
const inScope = url => url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                              // the API (POST to Apps Script) is never cached
  const url = new URL(req.url);
  if (isMedia(url) && (inScope(url) || url.hostname === 'fonts.gstatic.com')) { e.respondWith(cacheFirst(req)); return; }
  if (inScope(url) || url.hostname === 'fonts.googleapis.com') { e.respondWith(networkFirst(req)); return; }
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const nav = req.mode === 'navigate';
  const saved = async () => (await cache.match(req, { ignoreSearch: nav })) || (nav ? (await cache.match('index.html')) || (await cache.match('./')) : undefined);
  const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
  const timer = new Promise(r => setTimeout(r, NET_WAIT_MS)).then(saved);
  try {
    const first = await Promise.race([net, timer]);
    if (first) return first;
    return await net;
  } catch (err) {
    const s = await saved(); if (s) return s; throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(MEDIA);
  const range = req.headers.get('range');
  let hit = await cache.match(req.url);
  if (!hit) {
    const res = await fetch(req.url, { mode: req.mode === 'no-cors' ? 'no-cors' : 'cors' }).catch(() => fetch(req));
    if (res && (res.ok || res.type === 'opaque') && res.status !== 206) await cache.put(req.url, res.clone());
    if (!range) return res;
    hit = res;
  }
  if (!range || hit.type === 'opaque') return hit;
  // audio/video asks for byte ranges: answer from the cached full file so it also plays offline
  const buf = await hit.clone().arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
