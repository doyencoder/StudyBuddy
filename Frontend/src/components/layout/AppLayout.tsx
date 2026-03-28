import { useEffect, useRef } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { Outlet } from "react-router-dom";
import { API_BASE } from "@/config/api";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DailyLoginReward } from "@/components/DailyLoginReward";
import { useUser } from "@/contexts/UserContext";

function useStudyHeartbeat(userId: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendBeat = () => {
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;

    fetch(`${API_BASE}/sessions/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => {});

    fetch(`${API_BASE}/notifications/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => {});
  };

  useEffect(() => {
    sendBeat();
    intervalRef.current = setInterval(sendBeat, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        sendBeat();
        intervalRef.current = setInterval(sendBeat, 60_000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId]); // re-register when user changes so heartbeats use the correct user_id
}

// ── Layout ────────────────────────────────────────────────────────────────────
const AppLayout = () => {
  const { currentUser } = useUser();
  useStudyHeartbeat(currentUser.id);

  return (
    <SidebarProvider>
      <DailyLoginReward />
      <div className="flex w-full overflow-hidden" style={{ height: "100dvh" }}>
        <AppSidebar key={currentUser.id}/>
        <div className="flex-1 flex flex-col min-w-0" style={{ height: "100dvh" }}>
          <OfflineBanner />
          <AppHeader />
          <main key={currentUser.id} className="flex-1 flex flex-col overflow-hidden">
          {/*
            key={currentUser.id} is on <main>, not <Outlet>.
            Keying <Outlet> alone doesn't reliably remount the child page because
            React Router manages the rendered component separately. Keying the
            parent <main> forces the entire subtree — including the page rendered
            by Outlet — to fully unmount and remount, so all useEffect fetches
            re-fire immediately with the new USER_ID. No manual refresh needed.
          */}
          <Outlet />
        </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
