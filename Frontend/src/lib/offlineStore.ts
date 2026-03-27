// ─────────────────────────────────────────────────────────────────────────────
// offlineStore.ts — IndexedDB wrapper for StudyBuddy offline data
// ─────────────────────────────────────────────────────────────────────────────
// Stores structured data that needs to survive page reloads and be queryable.
// The Service Worker handles HTTP response caching; this handles app-level data.
//
// Stores:
//   apiCache      — Last-fetched API responses keyed by endpoint path
//   quizDetails   — Full quiz detail (with correct_index) for offline retake
//   conversations — Recent conversation history for offline browsing
//   syncQueue     — Pending mutations to replay when online
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = "studybuddy_offline";
const DB_VERSION = 1;

type StoreName = "apiCache" | "quizDetails" | "conversations" | "syncQueue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("apiCache")) {
        db.createObjectStore("apiCache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("quizDetails")) {
        db.createObjectStore("quizDetails", { keyPath: "quiz_id" });
      }
      if (!db.objectStoreNames.contains("conversations")) {
        db.createObjectStore("conversations", { keyPath: "conversation_id" });
      }
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Generic helpers ──────────────────────────────────────────────────────────

async function put(store: StoreName, value: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get<T = any>(store: StoreName, key: string | number): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function getAll<T = any>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function remove(store: StoreName, key: string | number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clear(store: StoreName): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── API Cache (keyed by endpoint path) ───────────────────────────────────────

export async function cacheAPIResponse(key: string, data: any): Promise<void> {
  await put("apiCache", {
    key,
    data,
    cachedAt: new Date().toISOString(),
  });
}

export async function getCachedAPI<T = any>(key: string): Promise<{ data: T; cachedAt: string } | null> {
  const result = await get<{ key: string; data: T; cachedAt: string }>("apiCache", key);
  return result ? { data: result.data, cachedAt: result.cachedAt } : null;
}

/**
 * Wipe the entire API response cache.
 * Called by UserContext.switchUser() to prevent data from one profile
 * bleeding into another profile's UI on user switch.
 */
export async function clearAPICache(): Promise<void> {
  await clear("apiCache");
}

// ── Quiz Details (for offline retake — includes correct_index) ───────────────

export interface CachedQuizDetail {
  quiz_id: string;
  topic: string;
  questions: Array<{
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  }>;
  timer_seconds?: number | null;
  num_questions?: number;
  cachedAt: string;
}

export async function cacheQuizDetail(quiz: CachedQuizDetail): Promise<void> {
  await put("quizDetails", quiz);
}

export async function getCachedQuizDetail(quizId: string): Promise<CachedQuizDetail | null> {
  return get<CachedQuizDetail>("quizDetails", quizId);
}

// ── Conversations (for offline browsing) ─────────────────────────────────────

export interface CachedConversation {
  conversation_id: string;
  messages: any[];
  starred?: boolean;
  cachedAt: string;
}

export async function cacheConversation(conv: CachedConversation): Promise<void> {
  await put("conversations", conv);
  // Keep last 25 conversations, never evict starred ones
  const all = await getAll<CachedConversation>("conversations");
  if (all.length > 25) {
    const sorted = all.sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
    const toRemove = sorted.slice(25).filter(c => !c.starred);
    for (const c of toRemove) {
      await remove("conversations", c.conversation_id);
    }
  }
}

export async function getCachedConversation(convId: string): Promise<CachedConversation | null> {
  return get<CachedConversation>("conversations", convId);
}

// ── Sync Queue (pending mutations) ───────────────────────────────────────────

export interface SyncQueueItem {
  id?: number;         // auto-incremented
  type: string;        // "goal_create" | "goal_update" | "goal_delete" | "settings_save" | "quiz_submit"
  url: string;
  method: string;
  body: string;
  createdAt: string;
}

export async function addToSyncQueue(item: Omit<SyncQueueItem, "id">): Promise<void> {
  await put("syncQueue", { ...item, createdAt: new Date().toISOString() });
}

export async function getAllSyncQueue(): Promise<SyncQueueItem[]> {
  return getAll<SyncQueueItem>("syncQueue");
}

export async function removeSyncQueueItem(id: number): Promise<void> {
  await remove("syncQueue", id);
}

export async function clearSyncQueue(): Promise<void> {
  await clear("syncQueue");
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function formatCachedTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  } catch {
    return "";
  }
}