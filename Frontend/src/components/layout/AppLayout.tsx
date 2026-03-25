import { useEffect, useRef } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AppHeader from "./AppHeader";
import { Outlet } from "react-router-dom";
import { API_BASE } from "@/config/api";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DailyLoginReward } from "@/components/DailyLoginReward";

// ── Heartbeat + Checkin: fires every 60s while the tab is active ────────────
const USER_ID = "student-001";
const DAILY_GOALS_KEY = "studybuddy_daily_goals";

/** Read daily goals from localStorage and return total/done counts */
function getDailyGoalCounts(): { total: number; done: number } {
  try {
    const raw = localStorage.getItem(DAILY_GOALS_KEY);
    if (!raw) return { total: 0, done: 0 };
    const stored = JSON.parse(raw);
    // Check if goals are from today (local date, not UTC)
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (stored.date !== today) return { total: 0, done: 0 };
    const goals = stored.goals || [];
    return { total: goals.length, done: goals.filter((g: any) => g.completed).length };
  } catch {
    return { total: 0, done: 0 };
  }
}

function useStudyHeartbeat() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendBeat = () => {
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;

    // 1) Session heartbeat
    fetch(`${API_BASE}/sessions/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID }),
    }).catch(() => {});

    // 2) Notification checkin — sends daily goals status so the 9 PM
    //    scheduler knows whether to send the reminder email.
    //    This runs every 60s from ANY page, not just GoalsPage.
    const { total, done } = getDailyGoalCounts();
    fetch(`${API_BASE}/notifications/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, daily_goals_total: total, daily_goals_done: done }),
    }).catch(() => {});
  };

  useEffect(() => {
    // Send immediately on mount, then every 60s
    sendBeat();
    intervalRef.current = setInterval(sendBeat, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        // Send immediately when tab becomes visible again
        sendBeat();
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
      <DailyLoginReward />
      <div className="flex w-full overflow-hidden" style={{ height: "100dvh" }}>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0" style={{ height: "100dvh" }}>
          <OfflineBanner />
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