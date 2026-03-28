import { useState, useEffect, useCallback, useRef } from "react";
import {
  User, Trash2, CreditCard, Copy, Check,
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
import { useUser } from "@/contexts/UserContext";
import { offlineFetch } from "@/lib/offlineFetch";
import { addToSyncQueue } from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { StudentExcellenceProgram } from "@/components/StudentExcellenceProgram";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  REWARDS,
} from "@/lib/coinStore";
import { useCoins } from "@/contexts/CoinContext";

// ── Constants ────────────────────────────────────────────────────────────────


type SettingsTab = "general" | "billing";

// ── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  display_name: string;
  email: string;
}

interface Notifications {
  goal_reminders: boolean;
  long_term_goals_reminder: boolean;
  study_streak_alerts: boolean;
  flashcard_review_reminders: boolean;
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

const DEFAULT_PROFILE: Profile = { display_name: "", email: "" };
const DEFAULT_NOTIFICATIONS: Notifications = {
  goal_reminders: false,
  long_term_goals_reminder: false,
  study_streak_alerts: false,
  flashcard_review_reminders: false,
};
const DEFAULT_AI_PREFERENCES: AIPreferences = {
  simplified_explanations: true,
  auto_generate_flashcards: false,
};
const DEFAULT_APPEARANCE: Appearance = {
  color_mode: "auto",
  chat_font: "default",
  voice: "buttery",
};

interface ActiveSession {
  device: string;
  location: string;
  created: string;
  updated: string;
  is_current: boolean;
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

// ── Connector Icons ──────────────────────────────────────────────────────────

// ── Inline Microsoft SVG icons — no external URLs needed ─────────────────────
// ── Main Component ───────────────────────────────────────────────────────────

const SettingsPage = () => {
  const { currentUser, setProfileName } = useUser();
  const USER_ID = currentUser.id;
  const { setColorMode, setChatFont, setVoice } = useAppearance();
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as SettingsTab | null;
  const validTabs: SettingsTab[] = ["general", "billing"];
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    urlTab && validTabs.includes(urlTab) ? urlTab : "general"
  );

  // Swipe gesture refs
  const swipeStartX = useRef<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pageRef = useRef<HTMLDivElement>(null);           // stable ref — works from first render
  const activeTabRef = useRef<SettingsTab>("general");    // mirror of activeTab for the closure below
  const TABS_ORDER: SettingsTab[] = ["general", "billing"];

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
    profile: { ...DEFAULT_PROFILE },
    notifications: { ...DEFAULT_NOTIFICATIONS },
    ai_preferences: { ...DEFAULT_AI_PREFERENCES },
    appearance: { ...DEFAULT_APPEARANCE },
  });

  // ── Curriculum state (top-level on Cosmos doc, not nested in settings) ───
  const [curriculumBoard, setCurriculumBoard]     = useState<string | null>(null);
  const [curriculumGrade, setCurriculumGrade]     = useState<string | null>(null);
  const [curriculumEnabled, setCurriculumEnabled] = useState<boolean>(false);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [showPlansDialog, setShowPlansDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Fetch Settings (offline-aware) ──────────────────────────────────────

  const { isOnline } = useOnlineStatus();

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/?user_id=${USER_ID}`);
      const appearance = { ...DEFAULT_APPEARANCE, ...(data.appearance || {}) };
      setSettings({
        profile: { ...DEFAULT_PROFILE, ...(data.profile || {}) },
        notifications: { ...DEFAULT_NOTIFICATIONS, ...(data.notifications || {}) },
        ai_preferences: { ...DEFAULT_AI_PREFERENCES, ...(data.ai_preferences || {}) },
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

  const fetchBilling = useCallback(async () => {
    try {
      const { data } = await offlineFetch(`${API_BASE}/settings/billing?user_id=${USER_ID}`);
      setBillingPlans(data.plans);
      setCurrentPlan(data.current_plan);
    } catch (err) {
      console.error("Failed to fetch billing:", err);
      // Fallback plans — matches Backend/app/routers/settings.py PLANS exactly
      setBillingPlans([
        { id: "free", name: "Free", tagline: "Get started with Study Buddy", price: "$0", period: "", features: [
            "Limited AI chat messages per day",
            "Limited Tools use per day",
            "Basic diagram generation",
            "Upload up to 5 files(max 20 MB per file and 35 pages for PDFs)",
            "Limited TTS usage per month"], is_current: true },
        { id: "pro", name: "Pro", tagline: "For serious students", price: "$12", period: "USD/month", features: [
            "More AI chat messages per day",
            "More Tools use per day",
            "Advanced diagram generation",
            "Upload up to 7 files((max 50 MB per file))",
            "More TTS usage per month",
            "More Models to choose from for AI chat",
            "Limited access to new features of StudyBuddy",
            "More translation languages"
        ], is_current: false },
        { id: "max", name: "Max", tagline: "For power users & teams", price: "From $30", period: "USD/month", features: [
            "20x AI chat messages per day compared to Pro",
            "Unlimited Tools use",
            "Upload up to 7 files(max 100 MB per file)",
            "Early access to new features of StudyBuddy",
            "Priority access at high traffic times",
            "Unlimited TTS usage",
        ], is_current: false },
      ]);
      setCurrentPlan("free");
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchSettings(), fetchBilling()]);
      setLoading(false);
    };
    loadAll();
  }, [fetchSettings, fetchBilling]);

  // ── Save Settings ────────────────────────────────────────────────────────
  // Shows "Saving…" immediately on any change, debounces the actual API call 800ms.

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveSettings = useCallback((updates: Partial<UserSettings>) => {
    // Show indicator immediately — no 600ms lag before the dot appears
    setSaving(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!response.ok) {
          throw new Error(`Settings save failed with status ${response.status}`);
        }
        // Bug 4: sync display_name change to global UserContext immediately
        if (updates.profile?.display_name !== undefined) {
          setProfileName(USER_ID, updates.profile.display_name);
        }
      } catch {
        // Offline — queue for later sync
        if (!navigator.onLine) {
          addToSyncQueue({
            type: "settings_save",
            url: `${API_BASE}/settings/?user_id=${USER_ID}`,
            method: "PUT",
            body: JSON.stringify(updates),
            createdAt: new Date().toISOString(),
          }).catch(() => {});
          toast.info("Settings saved locally — will sync when online", { duration: 2000 });
        } else {
          toast.error("Couldn't save settings. Restoring the last saved values.");
          fetchSettings().catch(() => {});
        }
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [fetchSettings]);

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
  // ── Plan Upgrade ─────────────────────────────────────────────────────────

  const handleUpgrade = async (planId: string) => {
    const selectedPlan = billingPlans.find((plan) => plan.id === planId);
    const planName = selectedPlan?.name ?? "This";
    toast.info(`${planName} plan upgrade is coming soon.`);
  };

  // ── Tabs Config ──────────────────────────────────────────────────────────

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <User className="w-4 h-4" /> },
    { id: "billing", label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
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
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-9 w-20 bg-secondary/40 rounded-t-lg animate-pulse" />
            ))}
          </div>
        </div>
        <div className="px-6 py-8 max-w-3xl mx-auto space-y-4">
          {[...Array(2)].map((_, i) => (
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
{activeTab === "billing" && (
          <BillingTab
            billingPlans={billingPlans}
            currentPlan={currentPlan}
            showPlansDialog={showPlansDialog}
            setShowPlansDialog={setShowPlansDialog}
            handleUpgrade={handleUpgrade}
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
          <div>
  <Label className="text-sm text-muted-foreground mb-2 block">
    What should StudyBuddy call you?
  </Label>
    <div className="flex gap-2">
      <Input
        value={settings.profile.display_name}
        onChange={(e) => updateProfile("display_name", e.target.value)}
        onBlur={() => saveSettings({ profile: settings.profile })}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); saveSettings({ profile: settings.profile }); } }}
        placeholder="Display name"
        className="bg-background border-border"
      />
      <Button
        size="sm"
        variant="outline"
        className="border-border shrink-0"
        onClick={() => saveSettings({ profile: settings.profile })}
      >
        Save
      </Button>
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
              Used for goal reminders, weekly updates, streak alerts, and flashcard reminders. Press Enter or click Save.
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
            {
              field: "flashcard_review_reminders" as const,
              label: "Flashcard review reminder",
              desc: "Daily email at 12 PM IST to revise your flashcards",
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
  const { coinState, applyReferralCode } = useCoins();
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
    setTimeout(async () => {
      try {
        const result = await applyReferralCode(friendCode.trim().toUpperCase());
        if (result.applied) {
          toast.success(`Referral applied! You earned ${REWARDS.REFERRAL_RECEIVER} Study Coins!`);
          setFriendCode("");
        } else if (result.reason === "self_referral") {
          toast.error("You can't use your own referral code!");
        } else if (result.reason === "already_referred") {
          toast.error("You've already used a referral code");
        } else {
          toast.error("Invalid referral code");
        }
      } catch {
        toast.error("Could not apply referral code right now.");
      } finally {
        setApplyingCode(false);
      }
    }, 400);
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-base text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Refer Friends & Earn
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance mini-display */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-background/60 border border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Coins className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Your Study Coins</p>
            <p className="text-lg font-bold text-primary leading-tight">{coinState.balance.toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Flame className="w-3.5 h-3.5 text-primary" />
            <span>{coinState.login_streak}d login streak</span>
          </div>
          <Button size="sm" variant="outline" className="border-border text-primary hover:bg-background/80 text-xs h-8" onClick={() => navigate("/store")}>
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

      {/* ── Student Excellence Program ── */}
      <StudentExcellenceProgram />

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


export default SettingsPage;