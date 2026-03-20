import { useEffect, useRef } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { Outlet } from "react-router-dom";
import { API_BASE } from "@/config/api";

// ── Heartbeat: fires every 60s while the tab is active and focused ────────────
const USER_ID = "student-001";

function useStudyHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendBeat = () => {
    if (document.visibilityState !== "visible") return;
    fetch(`${API_BASE}/sessions/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID }),
    }).catch(() => {});
  };

  useEffect(() => {
    intervalRef.current = setInterval(sendBeat, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        intervalRef.current = setInterval(sendBeat, 60_000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
}

// ── Layout ────────────────────────────────────────────────────────────────────
const AppLayout = () => {
  useStudyHeartbeat();
  return (
    <SidebarProvider>
      <div className="h-screen flex w-full overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 h-screen">
          <AppHeader />
          <main className="flex-1 flex flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;