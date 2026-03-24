// ─────────────────────────────────────────────────────────────────────────────
// OfflineBanner.tsx — Global offline indicator
// ─────────────────────────────────────────────────────────────────────────────
// Slides down from the top of the screen when the browser goes offline.
// Retracts with a brief "Back online — syncing…" message when connectivity
// returns, then disappears entirely.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { WifiOff, Wifi, CloudOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSyncQueueCount } from "@/lib/syncQueue";

export function OfflineBanner() {
  const { isOnline } = useOnlineStatus();
  const [show, setShow] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    if (!isOnline) {
      setShow(true);
      setReconnected(false);
      // Check pending queue count
      getSyncQueueCount().then(setQueueCount).catch(() => {});
    } else if (show) {
      // Was showing offline banner, now online → show reconnected briefly
      setReconnected(true);
      const t = setTimeout(() => {
        setShow(false);
        setReconnected(false);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  if (!show) return null;

  return (
    <div
      className="relative z-50 w-full overflow-hidden transition-all duration-500 ease-out"
      style={{
        maxHeight: show ? 48 : 0,
        opacity: show ? 1 : 0,
      }}
    >
      {reconnected ? (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
          style={{
            background: "linear-gradient(90deg, hsl(142 71% 25% / 0.9), hsl(142 71% 35% / 0.9))",
            color: "hsl(142 71% 90%)",
          }}
        >
          <Wifi className="h-3.5 w-3.5" />
          <span>Back online — syncing changes…</span>
        </div>
      ) : (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
          style={{
            background: "linear-gradient(90deg, hsl(30 80% 30% / 0.95), hsl(25 80% 35% / 0.95))",
            color: "hsl(40 80% 90%)",
          }}
        >
          <WifiOff className="h-3.5 w-3.5" />
          <span>You're offline</span>
          {queueCount > 0 && (
            <span className="ml-1 flex items-center gap-1 opacity-80">
              <CloudOff className="h-3 w-3" />
              {queueCount} pending
            </span>
          )}
        </div>
      )}
    </div>
  );
}