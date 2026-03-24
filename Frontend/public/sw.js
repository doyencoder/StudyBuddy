// ─────────────────────────────────────────────────────────────────────────────
// StudyBuddy Service Worker — Offline-Capable PWA
// ─────────────────────────────────────────────────────────────────────────────
// Strategy:
//   App shell (HTML/JS/CSS/fonts) → Cache-First (install-time + runtime)
//   API calls                     → Network-First, cache fallback
//   Blob images                   → Cache-First with runtime caching (limit 60)
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = "sb-v1";
const SHELL_CACHE  = `shell-${CACHE_VERSION}`;
const API_CACHE    = `api-${CACHE_VERSION}`;
const IMAGE_CACHE  = `images-${CACHE_VERSION}`;

const MAX_CACHED_IMAGES = 60;

// API paths we want to cache for offline access
const CACHEABLE_API_PATHS = [
  "/quiz/history",
  "/quiz/",               // quiz detail (GET /quiz/{id})
  "/diagrams/history",
  "/goals/",
  "/settings/",
  "/settings/dismissed-weak-topics",
  "/settings/account",
  "/settings/billing",
  "/settings/connectors",
  "/sessions/weekly",
  "/chat/conversations",
  "/chat/history/",       // conversation detail
];

// ── Install: cache the app shell ─────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll([
        "/",
        "/chat",
        "/dashboard",
        "/quizzes",
        "/goals",
        "/settings",
        "/images",
        "/nova",
      ]).catch(() => {
        // Non-critical — pages will be cached on first visit
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== API_CACHE && k !== IMAGE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Helper: is this an API request we should cache? ──────────────────────────
function isCacheableAPI(url) {
  return CACHEABLE_API_PATHS.some((path) => url.pathname.includes(path));
}

// ── Helper: is this a blob storage image? ────────────────────────────────────
function isBlobImage(url) {
  return (
    url.hostname.includes("blob.core.windows.net") ||
    url.pathname.includes("/upload/view-file")
  );
}

// ── Helper: trim image cache to MAX size ─────────────────────────────────────
async function trimImageCache() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_CACHED_IMAGES) {
    // Delete oldest entries (first in = first out)
    const toDelete = keys.slice(0, keys.length - MAX_CACHED_IMAGES);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}

// ── Fetch handler ────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST/PUT/DELETE are mutations — never cache)
  if (event.request.method !== "GET") return;

  // ── Blob images: Cache-First ──────────────────────────────────────────────
  if (isBlobImage(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(IMAGE_CACHE).then((cache) => {
              cache.put(event.request, clone);
              trimImageCache();
            });
          }
          return response;
        }).catch(() => {
          // Offline + not cached — return error so <img onError> fires in the app
          return new Response("Offline — image not cached", { status: 503 });
        });
      })
    );
    return;
  }

  // ── CDN scripts/styles (jQuery, MathQuill, KaTeX): Cache-First ────────────
  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response("Offline — CDN resource not cached", { status: 503 }));
      })
    );
    return;
  }

  // ── API calls: Network-First with cache fallback ──────────────────────────
  if (isCacheableAPI(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) {
              // Add header so frontend knows this is cached data
              const headers = new Headers(cached.headers);
              headers.set("X-SW-Cached", "true");
              return new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers,
              });
            }
            // No cache available — return a structured error
            return new Response(
              JSON.stringify({ error: "offline", message: "No cached data available" }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          });
        })
    );
    return;
  }

  // ── App shell / static assets: Cache-First with network fallback ──────────
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache successful responses for static assets
          if (response.ok && (
            url.pathname.endsWith(".js") ||
            url.pathname.endsWith(".css") ||
            url.pathname.endsWith(".woff2") ||
            url.pathname.endsWith(".svg") ||
            url.pathname.endsWith(".ico")
          )) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          // For navigation requests, return the cached root page (SPA fallback)
          if (event.request.mode === "navigate") {
            return caches.match("/") || caches.match("/chat");
          }
          return new Response("Offline", { status: 503 });
        });
      })
    );
    return;
  }
});

// ── Message handler: force sync queue flush ──────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});