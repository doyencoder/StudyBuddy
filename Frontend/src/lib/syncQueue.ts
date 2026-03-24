// ─────────────────────────────────────────────────────────────────────────────
// syncQueue.ts — Replays queued mutations when connectivity returns
// ─────────────────────────────────────────────────────────────────────────────
// When the user performs a mutation offline (create goal, save settings, etc.),
// it gets queued in IndexedDB via addToSyncQueue(). This module processes the
// queue sequentially when the browser fires the "online" event.
// ─────────────────────────────────────────────────────────────────────────────

import { getAllSyncQueue, removeSyncQueueItem, type SyncQueueItem } from "./offlineStore";
import { toast } from "sonner";

let isSyncing = false;

/**
 * Process all pending items in the sync queue, one at a time.
 * Called automatically when the browser goes online and can also be
 * called manually from the UI.
 */
export async function processSyncQueue(): Promise<number> {
  if (isSyncing) return 0;
  isSyncing = true;

  let processed = 0;
  let failed = 0;

  try {
    const items = await getAllSyncQueue();
    if (items.length === 0) {
      isSyncing = false;
      return 0;
    }

    for (const item of items) {
      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: item.body,
        });

        if (response.ok || response.status === 409) {
          // 409 = conflict (e.g. goal already exists) — treat as success
          await removeSyncQueueItem(item.id!);
          processed++;
        } else {
          // Server error — leave in queue for next attempt
          console.warn(`[SyncQueue] Failed to sync item ${item.id}: HTTP ${response.status}`);
          failed++;
        }
      } catch (err) {
        // Network error — stop processing, we're probably offline again
        console.warn(`[SyncQueue] Network error syncing item ${item.id}:`, err);
        failed++;
        break;
      }
    }

    if (processed > 0) {
      toast.success(`Synced ${processed} offline change${processed > 1 ? "s" : ""}`, {
        description: failed > 0 ? `${failed} item${failed > 1 ? "s" : ""} will retry later` : undefined,
        duration: 3000,
      });
    }
  } finally {
    isSyncing = false;
  }

  return processed;
}

/**
 * Returns the number of items currently pending in the sync queue.
 */
export async function getSyncQueueCount(): Promise<number> {
  const items = await getAllSyncQueue();
  return items.length;
}