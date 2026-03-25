import { useState, useEffect, useCallback, useRef } from "react";
import {
  User, LogOut, Trash2, CreditCard, Plug, Copy, Check,
  ExternalLink, Sun, Moon, Monitor, Volume2, Loader2, Settings2 as Settings2Icon, Mail, GraduationCap,
  Gift, Coins, Flame, Users, Share2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/config/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAppearance, type ColorMode, type ChatFont, type VoiceSetting } from "@/contexts/AppearanceContext";
import { offlineFetch } from "@/lib/offlineFetch";
import { addToSyncQueue } from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getCoinState, applyReferralCode, REWARDS,
  type CoinState,
} from "@/lib/coinStore";

// ── Constants ────────────────────────────────────────────────────────────────

const USER_ID = "student-001";

type SettingsTab = "general" | "account" | "billing" | "connectors";

// ── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  full_name: string;
  display_name: string;
  email: string;
}

interface Notifications {
  goal_reminders: boolean;
  long_term_goals_reminder: boolean;
  study_streak_alerts: boolean;
}

interface AIPreferences {
  simplified_explanations: boolean;
  auto_generate_flashcards: boolean;
}

interface Appearance {
  color_mode: "light" | "auto" | "dark";
  chat_font: "default" | "sans" | "system" | "dyslexic";
  voice: "buttery" | "airy" | "mellow" | "glassy" | "rounded";
}

interface UserSettings {
  profile: Profile;
  notifications: Notifications;
  ai_preferences: AIPreferences;
  appearance: Appearance;
}

interface ActiveSession {
  device: string;
  location: string;
  created: string;
  updated: string;
  is_current: boolean;
}

interface AccountInfo {
  user_id: string;
  organization_id: string;
  sessions: ActiveSession[];
}

interface BillingPlan {
  id: string;
  name: string;
  tagline: string;
  price: string;
  period: string;
  features: string[];
  is_current: boolean;
}

interface ConnectorItem {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  connected_at: string | null;
}

// ── Connector Icons ──────────────────────────────────────────────────────────

// ── Inline Microsoft SVG icons — no external URLs needed ─────────────────────
const MicrosoftOneDriveIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.5 10.5C14.5 10.5 13.5 8 10.5 8C7.5 8 6 10.5 6 10.5C4 10.5 2.5 12 2.5 14C2.5 16 4 17.5 6 17.5H18C19.7 17.5 21 16.2 21 14.5C21 12.8 19.7 11.5 18 11.5C18 11.5 17.5 10.5 16.5 10.5H14.5Z" fill="#0078D4"/>
    <path d="M9 10C9 10 8 8 6 8C4 8 2.5 9.5 2.5 11.5C2.5 12 2.6 12.5 2.8 12.9C3.6 12.3 4.7 12 6 12H9V10Z" fill="#1490DF"/>
  </svg>
);

const MicrosoftOutlookIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="4" width="14" height="16" rx="2" fill="#0078D4"/>
    <rect x="8" y="2" width="14" height="16" rx="2" fill="#1490DF"/>
    <ellipse cx="15" cy="10" rx="3.5" ry="3.5" fill="white"/>
    <rect x="9" y="13" width="12" height="1.5" rx="0.75" fill="white" opacity="0.7"/>
    <rect x="9" y="15.5" width="9" height="1.5" rx="0.75" fill="white" opacity="0.5"/>
  </svg>
);

const MicrosoftTeamsIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.5 8C13.5 9.1 12.6 10 11.5 10C10.4 10 9.5 9.1 9.5 8C9.5 6.9 10.4 6 11.5 6C12.6 6 13.5 6.9 13.5 8Z" fill="#5059C9"/>
    <path d="M16 10H21C21.6 10 22 10.4 22 11V15.5C22 17.4 20.4 19 18.5 19H18.4C17.9 20.2 16.8 21 15.5 21C13.6 21 12 19.4 12 17.5V13C12 11.3 13.3 10 15 10H16Z" fill="#5059C9"/>
    <circle cx="18.5" cy="7.5" r="2.5" fill="#5059C9"/>
    <path d="M9 12H13C14.1 12 15 12.9 15 14V18C15 19.7 13.7 21 12 21H5C3.3 21 2 19.7 2 18V14C2 12.9 2.9 12 4 12H9Z" fill="#7B83EB"/>
    <circle cx="8.5" cy="8.5" r="2.5" fill="#7B83EB"/>
  </svg>
);

const MicrosoftOneNoteIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="13" height="18" rx="2" fill="#7719AA"/>
    <rect x="9" y="3" width="13" height="18" rx="2" fill="#9332BF"/>
    <text x="10.5" y="15.5" fontSize="9" fontWeight="bold" fill="white" fontFamily="Arial">N</text>
    <rect x="3" y="7" width="6" height="1.5" rx="0.75" fill="white" opacity="0.6"/>
    <rect x="3" y="10" width="6" height="1.5" rx="0.75" fill="white" opacity="0.6"/>
    <rect x="3" y="13" width="6" height="1.5" rx="0.75" fill="white" opacity="0.6"/>
  </svg>
);

const CONNECTOR_ICON_MAP: Record<string, React.ReactNode> = {
  "onedrive":  <MicrosoftOneDriveIcon />,
  "outlook":   <MicrosoftOutlookIcon />,
  "teams":     <MicrosoftTeamsIcon />,
  "onenote":   <MicrosoftOneNoteIcon />,
};

// ── Main Component ───────────────────────────────────────────────────────────

const SettingsPage = () => {
  const { setColorMode, setChatFont, setVoice } = useAppearance();
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as SettingsTab | null;
  const validTabs: SettingsTab[] = ["general", "account", "billing", "connectors"];
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    urlTab && validTabs.includes(urlTab) ? urlTab : "general"
  );

  // Swipe gesture refs
  const swipeStartX = useRef<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pageRef = useRef<HTMLDivElement>(null);           // stable ref — works from first render
  const activeTabRef = useRef<SettingsTab>("general");    // mirror of activeTab for the closure below
  const TABS_ORDER: SettingsTab[] = ["general", "account", "billing", "connectors"];

  // Keep activeTabRef in sync with state
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Auto-scroll active tab into center of the tab bar
  useEffect(() => {
    const btn = tabRefs.current[activeTab];
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeTab]);

  // Swipe left/right — attach once, reads activeTabRef so it never needs remounting
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => { swipeStartX.current = e.touches[0].clientX; };
    const onTouchEnd = (e: TouchEvent) => {
      if (swipeStartX.current === null) return;
      const dx = e.changedTouches[0].clientX - swipeStartX.current;
      swipeStartX.current = null;
      if (Math.abs(dx) < 50) return;
      const idx = TABS_ORDER.indexOf(activeTabRef.current);
      if (dx < 0 && idx < TABS_ORDER.length - 1) setActiveTab(TABS_ORDER[idx + 1]);
      if (dx > 0 && idx > 0) setActiveTab(TABS_ORDER[idx - 1]);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => { el.removeEventListener("touchstart", onTouchStart); el.removeEventListener("touchend", onTouchEnd); };
  }, []); // ← runs once on mount, never needs to re-register

  const [settings, setSettings] = useState<UserSettings>({
    profile: { full_name: "", display_name: "", email: "" },
    notifications: { goal_reminders: false, long_term_goals_reminder: false, study_streak_alerts: false },
    ai_preferences: { simplified_explanations: true, auto_generate_flashcards: false },
    appearance: { color_mode: "auto", chat_font: "default", voice: "buttery" },
  });

  // ── Curriculum state (top-level on Cosmos doc, not nested in settings) ───
  const [curriculumBoard, setCurriculumBoard]     = useState<string | null>(null);
  const [curriculumGrade, setCurriculumGrade]     = useState<string | null>(null);
  const [curriculumEnabled, setCurriculumEnabled] = useState<boolean>(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [showPlansDialog, setShowPlansDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [copiedOrgId, setCopiedOrgId] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Fetch Settings (offline-aware) ──────────────────────────────────────

  const { isOnline } = useOnlineStatus();

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/?user_id=${USER_ID}`);
      const appearance = data.appearance || { color_mode: "auto", chat_font: "default", voice: "buttery" };
      setSettings({
        profile: data.profile || { full_name: "", display_name: "", email: "" },
        notifications: data.notifications || { goal_reminders: false, long_term_goals_reminder: false, study_streak_alerts: false },
        ai_preferences: data.ai_preferences || { simplified_explanations: true, auto_generate_flashcards: false },
        appearance,
      });
      setColorMode(appearance.color_mode as ColorMode);
      setChatFont(appearance.chat_font as ChatFont);
      setVoice(appearance.voice as VoiceSetting);
        // Hydrate curriculum fields (null-safe — existing users won't have these)
        setCurriculumBoard(data.curriculum_board ?? null);
        setCurriculumGrade(data.curriculum_grade ?? null);
        setCurriculumEnabled(data.curriculum_enabled ?? false);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  }, [setColorMode, setChatFont, setVoice]);

  const fetchAccount = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/account?user_id=${USER_ID}`);
      setAccount(data);
    } catch (err) {
      console.error("Failed to fetch account:", err);
    }
  }, []);

  const fetchBilling = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/billing?user_id=${USER_ID}`);
      setBillingPlans(data.plans);
      setCurrentPlan(data.current_plan);
    } catch (err) {
      console.error("Failed to fetch billing:", err);
      // Fallback plans — matches Backend/app/routers/settings.py PLANS exactly
      setBillingPlans([
        { id: "free", name: "Free", tagline: "Get started with Study Buddy", price: "$0", period: "", features: ["5 AI chat messages per day","3 quiz generations per day","Basic diagram generation","Upload up to 5 files","Community support"], is_current: true },
        { id: "pro", name: "Pro", tagline: "For serious students", price: "$12", period: "USD/month", features: ["Everything in Free and:","Unlimited AI chat messages","Unlimited quiz generations","Advanced diagram generation","Upload up to 50 files","Priority support","Study plan generation","Voice input & output","Translation to 8 languages"], is_current: false },
        { id: "max", name: "Max", tagline: "For power users & teams", price: "From $30", period: "USD/month", features: ["Everything in Pro, plus:","Unlimited file uploads","Custom AI model tuning","Team collaboration","API access","Dedicated support","Advanced analytics","Custom integrations"], is_current: false },
      ]);
      setCurrentPlan("free");
    }
  }, []);

  const fetchConnectors = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/connectors?user_id=${USER_ID}`);
      setConnectors(data.connectors);
    } catch (err) {
      console.error("Failed to fetch connectors:", err);
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchSettings(), fetchAccount(), fetchBilling(), fetchConnectors()]);
      setLoading(false);
    };
    loadAll();
  }, [fetchSettings, fetchAccount, fetchBilling, fetchConnectors]);

  // ── Save Settings ────────────────────────────────────────────────────────
  // Shows "Saving…" immediately on any change, debounces the actual API call 800ms.

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveSettings = useCallback((updates: Partial<UserSettings>) => {
    // Show indicator immediately — no 600ms lag before the dot appears
    setSaving(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
      } catch {
        // Offline — queue for later sync
        addToSyncQueue({
          type: "settings_save",
          url: `${API_BASE}/settings/?user_id=${USER_ID}`,
          method: "PUT",
          body: JSON.stringify(updates),
          createdAt: new Date().toISOString(),
        }).catch(() => {});
        if (!navigator.onLine) {
          toast.info("Settings saved locally — will sync when online", { duration: 2000 });
        }
      } finally {
        setSaving(false);
      }
    }, 800);
  }, []);

  // ── Curriculum Setting Save ───────────────────────────────────────────────
  // Curriculum fields live top-level on the Cosmos doc (not in a nested section),
  // so they are sent as plain keys alongside the standard sections.
  // Uses the same debounce + saving indicator as saveSettings.
  const saveCurriculumSetting = useCallback(async (
    patch: { curriculum_board?: string | null; curriculum_grade?: string | null; curriculum_enabled?: boolean }
  ) => {
    setSaving(true);
    try {
      if (!navigator.onLine) {
        await addToSyncQueue({
          type: "settings_save",
          url: `${API_BASE}/settings/?user_id=${USER_ID}`,
          method: "PUT",
          body: JSON.stringify(patch),
          createdAt: new Date().toISOString(),
        });
        return;
      }

      await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      // Keep UI optimistic even when the network call fails.
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Connector Placeholder ────────────────────────────────────────────────
  const handleConnectorClick = (connectorName: string) => {
    toast.info(`${connectorName} connector coming soon.`);
  };

  // ── Plan Upgrade ─────────────────────────────────────────────────────────

  const handleUpgrade = async (planId: string) => {
    try {
      const res = await fetch(`${API_BASE}/settings/billing/upgrade?user_id=${USER_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (res.ok) {
        
        setShowPlansDialog(false);
        await fetchBilling();
      }
    } catch {

    }
  };

  // ── Copy Org ID ──────────────────────────────────────────────────────────

  const copyOrgId = () => {
    if (account) {
      navigator.clipboard.writeText(account.organization_id);
      setCopiedOrgId(true);
      setTimeout(() => setCopiedOrgId(false), 2000);
    }
  };

  // ── Tabs Config ──────────────────────────────────────────────────────────

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <User className="w-4 h-4" /> },
    { id: "account", label: "Account", icon: <LogOut className="w-4 h-4" /> },
    { id: "billing", label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
    { id: "connectors", label: "Connectors", icon: <Plug className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <div ref={pageRef} className="overflow-y-auto h-full">
        {/* Hero skeleton */}
        <div className="bg-gradient-to-b from-primary/5 to-transparent px-6 pt-10 pb-0">
          <div className="max-w-3xl mx-auto text-center space-y-3 pb-6">
            <div className="w-14 h-14 rounded-2xl bg-secondary/60 animate-pulse mx-auto" />
            <div className="h-8 w-32 bg-secondary/60 rounded-xl animate-pulse mx-auto" />
            <div className="h-4 w-56 bg-secondary/40 rounded-lg animate-pulse mx-auto" />
          </div>
          {/* Tab bar skeleton */}
          <div className="max-w-3xl mx-auto flex gap-6 border-b border-border">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-9 w-20 bg-secondary/40 rounded-t-lg animate-pulse" />
            ))}
          </div>
        </div>
        <div className="px-6 py-8 max-w-3xl mx-auto space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-5 w-24 bg-secondary/60 rounded-lg" />
              <div className="h-px w-full bg-border" />
              {[...Array(2)].map((_, j) => (
                <div key={j} className="flex items-center justify-between">
                  <div className="space-y-1.5">
                    <div className="h-4 w-32 bg-secondary/60 rounded" />
                    <div className="h-3 w-48 bg-secondary/40 rounded" />
                  </div>
                  <div className="h-8 w-24 bg-secondary/40 rounded-lg" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={pageRef} className="overflow-y-auto h-full">
      {/* ── Hero header — gradient band, icon, title, subtitle ── */}
      <div className="bg-gradient-to-b from-primary/8 via-primary/3 to-transparent">
        <div className="max-w-3xl mx-auto px-6 pt-10 pb-0 text-center">
          {/* Icon badge */}
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 mb-4 shadow-sm">
            <Settings2Icon className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Manage your profile, appearance, and preferences.
          </p>
          {saving && (
            <span className="inline-flex items-center gap-1.5 text-xs text-primary/70 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
              Saving…
            </span>
          )}
        </div>

        {/* ── Underline tab bar ── */}
        <div className="max-w-3xl mx-auto px-6 mt-6">
          <nav className="flex gap-0 overflow-x-auto scrollbar-none border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                  activeTab === tab.id
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
                {/* Active underline indicator */}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Tab content — full-width cards, centered ── */}
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        {activeTab === "general" && (
          <GeneralTab
            settings={settings}
            setSettings={setSettings}
            saveSettings={saveSettings}
            saving={saving}
            curriculumBoard={curriculumBoard}
            setCurriculumBoard={setCurriculumBoard}
            curriculumGrade={curriculumGrade}
            setCurriculumGrade={setCurriculumGrade}
            curriculumEnabled={curriculumEnabled}
            setCurriculumEnabled={setCurriculumEnabled}
            saveCurriculumSetting={saveCurriculumSetting}
          />
        )}
        {activeTab === "account" && (
          <AccountTab
            account={account}
            copiedOrgId={copiedOrgId}
            copyOrgId={copyOrgId}
            showLogoutDialog={showLogoutDialog}
            setShowLogoutDialog={setShowLogoutDialog}
            showDeleteDialog={showDeleteDialog}
            setShowDeleteDialog={setShowDeleteDialog}
          />
        )}
        {activeTab === "billing" && (
          <BillingTab
            billingPlans={billingPlans}
            currentPlan={currentPlan}
            showPlansDialog={showPlansDialog}
            setShowPlansDialog={setShowPlansDialog}
            handleUpgrade={handleUpgrade}
          />
        )}
        {activeTab === "connectors" && (
          <ConnectorsTab
            connectors={connectors}
            handleConnectorClick={handleConnectorClick}
          />
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Tab Components
// ════════════════════════════════════════════════════════════════════════════

// ── General Tab ──────────────────────────────────────────────────────────────

interface GeneralTabProps {
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  saveSettings: (updates: Partial<UserSettings>) => void;
  saving: boolean;
  curriculumBoard: string | null;
  setCurriculumBoard: React.Dispatch<React.SetStateAction<string | null>>;
  curriculumGrade: string | null;
  setCurriculumGrade: React.Dispatch<React.SetStateAction<string | null>>;
  curriculumEnabled: boolean;
  setCurriculumEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  saveCurriculumSetting: (patch: { curriculum_board?: string | null; curriculum_grade?: string | null; curriculum_enabled?: boolean }) => void;
}

const GeneralTab = ({
  settings, setSettings, saveSettings, saving,
  curriculumBoard, setCurriculumBoard,
  curriculumGrade, setCurriculumGrade,
  curriculumEnabled, setCurriculumEnabled,
  saveCurriculumSetting,
}: GeneralTabProps) => {
  const { setColorMode, setChatFont, setVoice } = useAppearance();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  const playVoicePreview = async (voiceStyle: string) => {
    // Stop any currently playing preview
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPreviewingVoice(voiceStyle);
    try {
      const res = await fetch(
        `${API_BASE}/settings/voice-preview?voice_style=${encodeURIComponent(voiceStyle)}`
      );
      if (!res.ok) throw new Error("Failed to fetch voice preview");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
        audioRef.current = null;
      };
      await audio.play();
    } catch (err) {
      console.error("Voice preview error:", err);

      setPreviewingVoice(null);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const colorModes: { id: Appearance["color_mode"]; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: "Light", icon: <Sun className="w-5 h-5" /> },
    { id: "auto", label: "Auto", icon: <Monitor className="w-5 h-5" /> },
    { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" /> },
  ];

  const chatFonts: { id: Appearance["chat_font"]; label: string; style: string }[] = [
    { id: "default", label: "Default", style: "font-serif" },
    { id: "sans", label: "Sans", style: "font-sans" },
    { id: "system", label: "System", style: "font-mono" },
    { id: "dyslexic", label: "Dyslexic friendly", style: "font-sans tracking-wider" },
  ];

  const voices: Appearance["voice"][] = ["buttery", "airy", "mellow", "glassy", "rounded"];

  const updateProfile = (field: keyof Profile, value: string) => {
    const updated = { ...settings, profile: { ...settings.profile, [field]: value } };
    setSettings(updated);
  };

  const updateNotification = (field: keyof Notifications, value: boolean) => {
    const updated = { ...settings, notifications: { ...settings.notifications, [field]: value } };
    setSettings(updated);
    saveSettings({ notifications: updated.notifications });
  };

  const updateAIPref = (field: keyof AIPreferences, value: boolean) => {
    const updated = { ...settings, ai_preferences: { ...settings.ai_preferences, [field]: value } };
    setSettings(updated);
    saveSettings({ ai_preferences: updated.ai_preferences });
  };

  const updateAppearance = (field: keyof Appearance, value: string) => {
    const updated = { ...settings, appearance: { ...settings.appearance, [field]: value } };
    setSettings(updated);
    saveSettings({ appearance: updated.appearance as Appearance });

    // Apply the change in real time via AppearanceContext
    if (field === "color_mode") setColorMode(value as ColorMode);
    if (field === "chat_font") setChatFont(value as ChatFont);
    if (field === "voice") setVoice(value as VoiceSetting);
  };

  return (
    <>
      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Full name</Label>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                  {settings.profile.full_name
                    ? settings.profile.full_name.charAt(0).toUpperCase()
                    : "S"}
                </div>
                <Input
                  value={settings.profile.full_name}
                  onChange={(e) => updateProfile("full_name", e.target.value)}
                  onBlur={() => saveSettings({ profile: settings.profile })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); saveSettings({ profile: settings.profile }); } }}
                  placeholder="Your name"
                  className="bg-background border-border"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">
                What should Study Buddy call you?
              </Label>
              <Input
                value={settings.profile.display_name}
                onChange={(e) => updateProfile("display_name", e.target.value)}
                onBlur={() => saveSettings({ profile: settings.profile })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); saveSettings({ profile: settings.profile }); } }}
                placeholder="Display name"
                className="bg-background border-border"
              />
            </div>
          </div>
          {/* Email field — full width below */}
          <div className="mt-4">
            <Label className="text-sm text-muted-foreground mb-2 block">Email address</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="email"
                  value={settings.profile.email ?? ""}
                  onChange={(e) => updateProfile("email", e.target.value)}
                  onBlur={() => saveSettings({ profile: settings.profile })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); saveSettings({ profile: settings.profile }); } }}
                  placeholder="you@example.com"
                  className="bg-background border-border pl-9"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-border shrink-0"
                onClick={() => saveSettings({ profile: settings.profile })}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Used for goal reminders, weekly updates, and streak alerts. Press Enter or click Save.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Notifications</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Emails are sent to the address in your profile. Make sure it's set above.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            {
              field: "goal_reminders" as const,
              label: "Daily goals reminder",
              desc: "Email at 9 PM if daily goals aren't complete",
            },
            {
              field: "long_term_goals_reminder" as const,
              label: "Long-term goals reminder",
              desc: "Weekly email with progress on your long-term goals",
            },
            {
              field: "study_streak_alerts" as const,
              label: "Study streak alerts",
              desc: "Email at 9 PM if you haven't visited today",
            },
          ]).map((item) => (
            <div key={item.field} className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-foreground">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={settings.notifications[item.field]}
                onCheckedChange={(v) => {
                  if (v && !settings.profile.email) {
                    toast.error("Please add your email address in the Profile section first.");
                    return;
                  }
                  updateNotification(item.field, v);
                }}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* AI Preferences */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">AI Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Simplified explanations</Label>
              <p className="text-xs text-muted-foreground">AI explains in simple terms by default</p>
            </div>
            <Switch
              checked={settings.ai_preferences.simplified_explanations}
              onCheckedChange={(v) => updateAIPref("simplified_explanations", v)}
              className="data-[state=checked]:bg-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Auto-generate flashcards</Label>
              <p className="text-xs text-muted-foreground">Create flashcards from chat topics</p>
            </div>
            <Switch
              checked={settings.ai_preferences.auto_generate_flashcards}
              onCheckedChange={(v) => updateAIPref("auto_generate_flashcards", v)}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Color Mode */}
          <div>
            <Label className="text-sm text-muted-foreground mb-3 block">Color mode</Label>
            <div className="grid grid-cols-3 gap-3">
              {colorModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => updateAppearance("color_mode", mode.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    settings.appearance.color_mode === mode.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${
                    settings.appearance.color_mode === mode.id ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  }`}>
                    {mode.icon}
                  </div>
                  <span className={`text-xs font-medium ${
                    settings.appearance.color_mode === mode.id ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {mode.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Chat Font */}
          <div>
            <Label className="text-sm text-muted-foreground mb-3 block">Chat font</Label>
            <div className="grid grid-cols-2 gap-3">
              {chatFonts.map((font) => (
                <button
                  key={font.id}
                  onClick={() => updateAppearance("chat_font", font.id)}
                  className={`flex flex-col items-center gap-2 px-5 py-4 rounded-xl border-2 transition-all ${
                    settings.appearance.chat_font === font.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  <span className={`text-lg ${font.style} ${
                    settings.appearance.chat_font === font.id ? "text-primary" : "text-muted-foreground"
                  }`}>
                    Aa
                  </span>
                  <span className={`text-xs font-medium ${
                    settings.appearance.chat_font === font.id ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {font.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Voice */}
          <div>
            <Label className="text-sm text-muted-foreground mb-3 block">Voice</Label>
            <p className="text-xs text-muted-foreground mb-3">Click a voice to preview it</p>
            <div className="grid grid-cols-2 gap-3">
              {voices.map((voice) => (
                <button
                  key={voice}
                  onClick={() => {
                    updateAppearance("voice", voice);
                    playVoicePreview(voice);
                  }}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
                    settings.appearance.voice === voice
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  {previewingVoice === voice ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  ) : (
                    <Volume2 className={`w-4 h-4 ${
                      settings.appearance.voice === voice ? "text-primary" : "text-muted-foreground"
                    }`} />
                  )}
                  <span className={`text-sm font-medium capitalize ${
                    settings.appearance.voice === voice ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {voice}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Curriculum Context ─────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-primary" />
            <CardTitle className="text-base text-foreground">Curriculum</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Tell StudyBuddy your board and class so every explanation, quiz, and study
            plan is tailored to your exact syllabus.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Board selector */}
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">Board</Label>
            <Select
              value={curriculumBoard ?? ""}
              onValueChange={(board) => {
                const next = board || null;
                setCurriculumBoard(next);
                setCurriculumGrade(null);
                saveCurriculumSetting({ curriculum_board: next, curriculum_grade: null });
              }}
            >
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Select board" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CBSE">CBSE</SelectItem>
                <SelectItem value="ICSE">ICSE</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground/60 mt-1.5">More boards coming soon.</p>
          </div>

          {/* Grade selector */}
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">Class</Label>
            <Select
              value={curriculumGrade ?? ""}
              onValueChange={(grade) => {
                const next = grade || null;
                setCurriculumGrade(next);
                saveCurriculumSetting({ curriculum_grade: next });
              }}
              disabled={!curriculumBoard}
            >
              <SelectTrigger className="bg-background border-border disabled:opacity-50">
                <SelectValue placeholder={curriculumBoard ? "Select class" : "Select board first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Class 9">Class 9</SelectItem>
                <SelectItem value="Class 10">Class 10</SelectItem>
                <SelectItem value="Class 11">Class 11</SelectItem>
                <SelectItem value="Class 12">Class 12</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Enable toggle — dimmed until both board and grade are set */}
          <div className={`flex items-center justify-between transition-opacity ${
            curriculumBoard && curriculumGrade ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}>
            <div>
              <Label className="text-sm text-foreground">Apply curriculum context to responses</Label>
              <p className="text-xs text-muted-foreground">
                {curriculumBoard && curriculumGrade
                  ? `AI will tailor every response to ${curriculumBoard} ${curriculumGrade}`
                  : "Select a board and class above to enable"}
              </p>
            </div>
            <Switch
              checked={curriculumEnabled && Boolean(curriculumBoard && curriculumGrade)}
              onCheckedChange={(v) => {
                setCurriculumEnabled(v);
                saveCurriculumSetting({ curriculum_enabled: v });
              }}
              className="data-[state=checked]:bg-primary"
            />
          </div>

          {/* Active indicator pill — only shown when fully configured and ON */}
          {curriculumEnabled && curriculumBoard && curriculumGrade && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
              <p className="text-xs text-primary font-medium">
                Active — responses are tailored to {curriculumBoard} {curriculumGrade}
              </p>
            </div>
          )}

        </CardContent>
      </Card>

      {/* ── Referral & Study Coins ─────────────────────────────────────────── */}
      <ReferralSection />
    </>
  );
};

// ── Referral Section (embedded in General tab) ──────────────────────────────

const ReferralSection = () => {
  const [coinState, setCoinState] = useState<CoinState>(getCoinState());
  const [copiedCode, setCopiedCode] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [applyingCode, setApplyingCode] = useState(false);
  const navigate = useNavigate();

  const copyReferralCode = async () => {
    try {
      await navigator.clipboard.writeText(coinState.referral_code);
      setCopiedCode(true);
      toast.success("Referral code copied!");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const shareReferral = async () => {
    const text = `Hey! Join me on StudyBuddy — the AI-powered study companion. Use my referral code ${coinState.referral_code} to get ${REWARDS.REFERRAL_RECEIVER} bonus Study Coins when you sign up!`;
    if (navigator.share) {
      try { await navigator.share({ title: "StudyBuddy Referral", text }); } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Referral message copied to clipboard!");
    }
  };

  const handleApplyCode = () => {
    if (!friendCode.trim()) { toast.error("Enter a referral code first"); return; }
    setApplyingCode(true);
    setTimeout(() => {
      const success = applyReferralCode(friendCode.trim().toUpperCase());
      if (success) {
        toast.success(`Referral applied! You earned ${REWARDS.REFERRAL_RECEIVER} Study Coins!`);
        setCoinState(getCoinState());
        setFriendCode("");
      } else {
        if (friendCode.trim().toUpperCase() === coinState.referral_code) {
          toast.error("You can't use your own referral code!");
        } else if (coinState.referred_by) {
          toast.error("You've already used a referral code");
        } else {
          toast.error("Invalid referral code");
        }
      }
      setApplyingCode(false);
    }, 400);
  };

  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Refer Friends & Earn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance mini-display */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/8 border border-primary/15">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Coins className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Your Study Coins</p>
            <p className="text-lg font-bold text-primary leading-tight">{coinState.balance.toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Flame className="w-3.5 h-3.5 text-primary" />
            <span>{coinState.login_streak}d streak</span>
          </div>
          <Button size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-primary/10 text-xs h-8" onClick={() => navigate("/store")}>
            <Gift className="w-3 h-3 mr-1" /> Store
          </Button>
        </div>

        <Separator className="bg-border" />

        {/* Your referral code */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">Your referral code</Label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-background border border-border font-mono text-base tracking-widest text-foreground select-all">
              {coinState.referral_code}
            </div>
            <Button size="icon" variant="outline" className="border-border h-[42px] w-[42px]" onClick={copyReferralCode}>
              {copiedCode ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button size="icon" variant="outline" className="border-border h-[42px] w-[42px]" onClick={shareReferral}>
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Share your code — you get <span className="text-primary font-semibold">{REWARDS.REFERRAL_SENDER}</span> coins and your friend gets <span className="text-primary font-semibold">{REWARDS.REFERRAL_RECEIVER}</span> coins!
          </p>
        </div>

        {/* Apply friend's code */}
        {!coinState.referred_by ? (
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">Have a friend's code?</Label>
            <div className="flex gap-2">
              <Input
                value={friendCode}
                onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                placeholder="SB-XXXXXX"
                className="bg-background border-border font-mono tracking-wider uppercase"
                maxLength={9}
                onKeyDown={(e) => { if (e.key === "Enter") handleApplyCode(); }}
              />
              <Button
                onClick={handleApplyCode}
                disabled={applyingCode || !friendCode.trim()}
              >
                {applyingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/20">
            <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
            <p className="text-xs text-green-500 font-medium">
              Referral applied — you received {REWARDS.REFERRAL_RECEIVER} bonus coins
            </p>
          </div>
        )}

        {/* Referral stats */}
        {coinState.referral_count > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span>{coinState.referral_count} friend{coinState.referral_count !== 1 ? "s" : ""} joined with your code</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── Account Tab ──────────────────────────────────────────────────────────────

interface AccountTabProps {
  account: AccountInfo | null;
  copiedOrgId: boolean;
  copyOrgId: () => void;
  showLogoutDialog: boolean;
  setShowLogoutDialog: (v: boolean) => void;
  showDeleteDialog: boolean;
  setShowDeleteDialog: (v: boolean) => void;
}

const AccountTab = ({
  account,
  copiedOrgId,
  copyOrgId,
  showLogoutDialog,
  setShowLogoutDialog,
  showDeleteDialog,
  setShowDeleteDialog,
}: AccountTabProps) => {
  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logout */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-foreground font-medium">Log out of all devices</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutDialog(true)}
              className="border-border shrink-0"
            >
              Log out
            </Button>
          </div>

          <Separator className="bg-border" />

          {/* Delete Account */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-foreground font-medium">Delete your account</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="border-destructive text-destructive hover:bg-destructive/10 shrink-0"
            >
              Delete account
            </Button>
          </div>

          <Separator className="bg-border" />

          {/* Organization ID */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-primary font-medium shrink-0">Organization ID</p>
            <div className="flex items-center gap-1.5 min-w-0">
              <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded font-mono truncate max-w-[140px] sm:max-w-[200px]">
                {account?.organization_id || "—"}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={copyOrgId}
              >
                {copiedOrgId ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Sessions — compact, no horizontal scroll needed */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-primary">Active sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {account?.sessions && account.sessions.length > 0 ? (
            <div className="divide-y divide-border">
              {account.sessions.map((session, i) => (
                <div key={i} className="flex items-center justify-between px-6 py-3 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">{session.device}</span>
                      {session.is_current && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{session.location}</p>
                  </div>
                  <span className="text-muted-foreground cursor-pointer hover:text-foreground text-sm shrink-0">•••</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground px-6 py-4">No active sessions.</p>
          )}
        </CardContent>
      </Card>

      {/* Logout Dialog */}
      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Log out of all devices</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will log you out of all devices including this one.
              Since authentication is not yet implemented, this is a placeholder action.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogoutDialog(false)}>Cancel</Button>
            <Button onClick={() => { setShowLogoutDialog(false); }}>
              Log out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete your account</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This action cannot be undone. All your data including chats, quizzes, and study plans will be permanently deleted.
              Since authentication is not yet implemented, this is a placeholder action.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { setShowDeleteDialog(false); }}
            >
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Billing Tab ──────────────────────────────────────────────────────────────

interface BillingTabProps {
  billingPlans: BillingPlan[];
  currentPlan: string;
  showPlansDialog: boolean;
  setShowPlansDialog: (v: boolean) => void;
  handleUpgrade: (planId: string) => Promise<void>;
}

const BillingTab = ({
  billingPlans,
  currentPlan,
  showPlansDialog,
  setShowPlansDialog,
  handleUpgrade,
}: BillingTabProps) => {
  const current = billingPlans.find((p) => p.id === currentPlan) || billingPlans[0];

  return (
    <>
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{current?.name || "Free"} plan</h3>
                <p className="text-sm text-muted-foreground">{current?.tagline || "Get started"}</p>
              </div>
            </div>
            <Button onClick={() => setShowPlansDialog(true)} variant="outline" className="border-border">
              Upgrade plan
            </Button>
          </div>

          <div className="space-y-2">
            {current?.features.map((feature, i) => (
              <div key={i} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-muted-foreground">{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Plans Comparison Dialog */}
      <Dialog open={showPlansDialog} onOpenChange={setShowPlansDialog}>
        <DialogContent className="bg-card border-border max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl text-foreground">Plans that grow with you</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {billingPlans.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-xl border-2 p-5 flex flex-col transition-all ${
                  plan.is_current
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="mb-4">
                  <h3 className="font-bold text-lg text-foreground">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground">{plan.tagline}</p>
                </div>
                <div className="mb-4">
                  <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                  {plan.period && (
                    <span className="text-xs text-muted-foreground ml-1">{plan.period}</span>
                  )}
                </div>
                <Button
                  className="w-full mb-4"
                  variant={plan.is_current ? "secondary" : "default"}
                  disabled={plan.is_current}
                  onClick={() => handleUpgrade(plan.id)}
                >
                  {plan.is_current ? "Current plan" : `Get ${plan.name} plan`}
                </Button>
                <div className="space-y-2 flex-1">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-muted-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-center text-muted-foreground mt-4">
            *Usage limits apply. Prices shown don't include applicable tax.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Connectors Tab ───────────────────────────────────────────────────────────

interface ConnectorsTabProps {
  connectors: ConnectorItem[];
  handleConnectorClick: (name: string) => void;
}

const ConnectorsTab = ({ connectors, handleConnectorClick }: ConnectorsTabProps) => {
  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <div>
            <CardTitle className="text-base text-foreground">Connectors</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Allow Study Buddy to reference other apps and services for more context.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {connectors.map((connector, index) => (
            <div key={connector.id}>
              <button
                type="button"
                onClick={() => handleConnectorClick(connector.name)}
                className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-secondary/30 rounded-lg px-2"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
                    {CONNECTOR_ICON_MAP[connector.icon] ?? (
                      <span className="text-xs font-bold text-muted-foreground">
                        {connector.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{connector.name}</p>
                    <p className="text-xs text-muted-foreground">Coming soon</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleConnectorClick(connector.name);
                  }}
                  className="border-border min-w-[100px]"
                >
                  Coming soon
                </Button>
              </button>
              {index < connectors.length - 1 && <Separator className="bg-border" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

export default SettingsPage;
