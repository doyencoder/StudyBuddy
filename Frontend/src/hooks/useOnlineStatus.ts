// ─────────────────────────────────────────────────────────────────────────────
// useOnlineStatus.ts — React hook for network connectivity awareness
// ─────────────────────────────────────────────────────────────────────────────
// Returns { isOnline, lastOnlineAt } and automatically triggers sync queue
// processing when the browser transitions from offline → online.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from "react";
import { processSyncQueue } from "@/lib/syncQueue";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    // On startup: if online and queue has pending items, process them
    // This handles the case where user queued actions offline, then reloaded while online
    if (navigator.onLine) {
      setTimeout(() => processSyncQueue().catch(console.error), 2000);
    }
  }, []); // runs once on mount

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setTimeout(() => processSyncQueue().catch(console.error), 1500);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline };
}