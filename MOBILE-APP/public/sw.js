/* ==================================================================
   ATLAS — service worker

   This exists for two reasons only: so the app can be installed to a
   home screen, and so it opens instead of showing a browser error when
   the shop wifi drops.

   IT IS DELIBERATELY NETWORK-FIRST.

   The usual advice for service workers is cache-first, because it is
   faster. It also means that after you deploy, staff keep running the
   old code until they clear their browser — which is exactly the sort
   of problem that is miserable to diagnose from a WhatsApp message.

   So: always try the network. Use the cache only when the network
   actually fails. The app is a few hundred milliseconds slower to open
   and it is never, ever stale.

   Bump CACHE when you change this file.
   ================================================================== */

const CACHE = 'atlas-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const { request } = e

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never touch Supabase. Data must always be live, and caching an
  // authenticated response is a good way to show one person another
  // person's figures.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return

  e.respondWith(
    fetch(request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {})
        }
        return res
      })
      .catch(async () => {
        const hit = await caches.match(request)
        if (hit) return hit
        // A page request that failed with nothing cached: hand back the
        // shell so the router can at least draw something.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        })
      })
  )
})

// lets the app tell a waiting worker to take over immediately
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting()
})
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => new Response('Offline', { status: 503 }))
  );
});
