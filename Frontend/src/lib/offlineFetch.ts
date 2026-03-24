// ─────────────────────────────────────────────────────────────────────────────
// offlineFetch.ts — Drop-in fetch wrapper with offline-first behaviour
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//   import { offlineFetch } from "@/lib/offlineFetch";
//   const { data, fromCache, cachedAt } = await offlineFetch<MyType>(url);
//
// Online:  fetches from network, caches response in IndexedDB, returns data.
// Offline: returns cached data from IndexedDB if available.
// ─────────────────────────────────────────────────────────────────────────────

import { cacheAPIResponse, getCachedAPI } from "./offlineStore";

export interface OfflineFetchResult<T> {
  data: T;
  fromCache: boolean;
  cachedAt?: string;
}

/**
 * Fetches data from the network and caches it. Falls back to cache when offline.
 *
 * @param url       Full URL to fetch
 * @param cacheKey  Unique key for IndexedDB storage (defaults to URL pathname + search)
 */
export async function offlineFetch<T = any>(
  url: string,
  cacheKey?: string,
): Promise<OfflineFetchResult<T>> {
  const key = cacheKey ?? new URL(url).pathname + new URL(url).search;

  // ── Try network first ──────────────────────────────────────────────────────
  if (navigator.onLine) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        // Cache in IndexedDB (non-blocking)
        cacheAPIResponse(key, data).catch(() => {});
        return { data, fromCache: false };
      }
    } catch {
      // Network error — fall through to cache
    }
  }

  // ── Fallback to cache ──────────────────────────────────────────────────────
  const cached = await getCachedAPI<T>(key);
  if (cached) {
    return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
  }

  // ── No cache available ─────────────────────────────────────────────────────
  throw new Error("offline_no_cache");
}