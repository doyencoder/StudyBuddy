import { useState, useEffect, useCallback } from "react";
import {
  User, LogOut, Trash2, CreditCard, Plug, Copy, Check,
  ExternalLink, Sun, Moon, Monitor, Volume2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAppearance, type ColorMode, type ChatFont, type VoiceSetting } from "@/contexts/AppearanceContext";

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8000";
const USER_ID = "student-001";

type SettingsTab = "general" | "account" | "billing" | "connectors";

// ── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  full_name: string;
  display_name: string;
}

interface Notifications {
  goal_reminders: boolean;
  quiz_reminders: boolean;
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

const connectorIcons: Record<string, string> = {
  "google-drive": "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
  "gmail": "https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg",
  "google-calendar": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg",
  "github": "",
};

// ── Main Component ───────────────────────────────────────────────────────────

const SettingsPage = () => {
  const { setColorMode, setChatFont, setVoice } = useAppearance();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<UserSettings>({
    profile: { full_name: "", display_name: "" },
    notifications: { goal_reminders: false, quiz_reminders: false, study_streak_alerts: false },
    ai_preferences: { simplified_explanations: true, auto_generate_flashcards: false },
    appearance: { color_mode: "auto", chat_font: "default", voice: "buttery" },
  });
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

  // ── Fetch Settings ───────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`);
      if (res.ok) {
        const data = await res.json();
        const appearance = data.appearance || { color_mode: "auto", chat_font: "default", voice: "buttery" };
        setSettings({
          profile: data.profile || { full_name: "", display_name: "" },
          notifications: data.notifications || { goal_reminders: false, quiz_reminders: false, study_streak_alerts: false },
          ai_preferences: data.ai_preferences || { simplified_explanations: true, auto_generate_flashcards: false },
          appearance,
        });
        // Sync AppearanceContext so the theme/font/voice apply immediately
        setColorMode(appearance.color_mode as ColorMode);
        setChatFont(appearance.chat_font as ChatFont);
        setVoice(appearance.voice as VoiceSetting);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  }, [setColorMode, setChatFont, setVoice]);

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/account?user_id=${USER_ID}`);
      if (res.ok) setAccount(await res.json());
    } catch (err) {
      console.error("Failed to fetch account:", err);
    }
  }, []);

  const fetchBilling = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/billing?user_id=${USER_ID}`);
      if (res.ok) {
        const data = await res.json();
        setBillingPlans(data.plans);
        setCurrentPlan(data.current_plan);
      }
    } catch (err) {
      console.error("Failed to fetch billing:", err);
    }
  }, []);

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/connectors?user_id=${USER_ID}`);
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors);
      }
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

  const saveSettings = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings/?user_id=${USER_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        toast.success("Settings saved");
        await fetchSettings();
      } else {
        toast.error("Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // ── Connector Toggle ─────────────────────────────────────────────────────

  const handleConnectorToggle = async (connectorId: string, connected: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/settings/connectors/toggle?user_id=${USER_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connector_id: connectorId,
          action: connected ? "disconnect" : "connect",
        }),
      });
      if (res.ok) {
        toast.success(connected ? "Disconnected" : "Connected");
        await fetchConnectors();
      }
    } catch {
      toast.error("Failed to toggle connector");
    }
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
        toast.success(`Plan updated successfully!`);
        setShowPlansDialog(false);
        await fetchBilling();
      }
    } catch {
      toast.error("Failed to upgrade plan");
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
      <div className="p-4 md:p-6 overflow-y-auto h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Customize your Study Buddy experience.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar Tabs */}
          <nav className="md:w-48 flex-shrink-0">
            <div className="flex md:flex-col gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Content Area */}
          <div className="flex-1 min-w-0 space-y-6">
            {activeTab === "general" && (
              <GeneralTab
                settings={settings}
                setSettings={setSettings}
                saveSettings={saveSettings}
                saving={saving}
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
                handleConnectorToggle={handleConnectorToggle}
              />
            )}
          </div>
        </div>
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
  saveSettings: (updates: Partial<UserSettings>) => Promise<void>;
  saving: boolean;
}

const GeneralTab = ({ settings, setSettings, saveSettings, saving }: GeneralTabProps) => {
  const { setColorMode, setChatFont, setVoice } = useAppearance();

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
                placeholder="Display name"
                className="bg-background border-border"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            { field: "goal_reminders" as const, label: "Goal reminders", desc: "Get notified about daily goals" },
            { field: "quiz_reminders" as const, label: "Quiz reminders", desc: "Reminder to practice quizzes" },
            { field: "study_streak_alerts" as const, label: "Study streak alerts", desc: "Don't break your streak!" },
          ]).map((item) => (
            <div key={item.field} className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-foreground">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={settings.notifications[item.field]}
                onCheckedChange={(v) => updateNotification(item.field, v)}
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
            <div className="flex gap-3">
              {colorModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => updateAppearance("color_mode", mode.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all min-w-[90px] ${
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
            <div className="flex gap-3 flex-wrap">
              {chatFonts.map((font) => (
                <button
                  key={font.id}
                  onClick={() => updateAppearance("chat_font", font.id)}
                  className={`flex flex-col items-center gap-2 px-5 py-3 rounded-xl border-2 transition-all min-w-[90px] ${
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
            <div className="flex gap-3 flex-wrap">
              {voices.map((voice) => (
                <button
                  key={voice}
                  onClick={() => updateAppearance("voice", voice)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all ${
                    settings.appearance.voice === voice
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  <Volume2 className={`w-4 h-4 ${
                    settings.appearance.voice === voice ? "text-primary" : "text-muted-foreground"
                  }`} />
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
    </>
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
        <CardContent className="space-y-5">
          {/* Logout */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground font-medium">Log out of all devices</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutDialog(true)}
              className="border-border"
            >
              Log out
            </Button>
          </div>

          <Separator className="bg-border" />

          {/* Delete Account */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground font-medium">Delete your account</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="border-destructive text-destructive hover:bg-destructive/10"
            >
              Delete account
            </Button>
          </div>

          <Separator className="bg-border" />

          {/* Organization ID */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-primary font-medium">Organization ID</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded font-mono max-w-[200px] truncate">
                {account?.organization_id || "—"}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
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

      {/* Active Sessions */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-primary">Active sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-primary text-xs font-semibold">Device</TableHead>
                  <TableHead className="text-primary text-xs font-semibold">Location</TableHead>
                  <TableHead className="text-primary text-xs font-semibold">Created</TableHead>
                  <TableHead className="text-primary text-xs font-semibold">Updated</TableHead>
                  <TableHead className="text-xs font-semibold w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account?.sessions.map((session, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="text-sm text-foreground">
                      <div className="flex items-center gap-2">
                        {session.device}
                        {session.is_current && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Current
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{session.location}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{session.created}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{session.updated}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground cursor-pointer hover:text-foreground">•••</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
            <Button onClick={() => { setShowLogoutDialog(false); toast.info("Logout functionality coming soon"); }}>
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
              onClick={() => { setShowDeleteDialog(false); toast.info("Account deletion coming soon"); }}
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
  handleConnectorToggle: (id: string, connected: boolean) => Promise<void>;
}

const ConnectorsTab = ({ connectors, handleConnectorToggle }: ConnectorsTabProps) => {
  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-foreground">Connectors</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Allow Study Buddy to reference other apps and services for more context.
              </p>
            </div>
            <Button variant="outline" size="sm" className="border-border">
              Browse connectors
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {connectors.map((connector, index) => (
            <div key={connector.id}>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
                    {connector.icon === "github" ? (
                      <svg viewBox="0 0 24 24" className="w-5 h-5 text-foreground fill-current">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                    ) : (
                      <img
                        src={connectorIcons[connector.icon]}
                        alt={connector.name}
                        className="w-5 h-5"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{connector.name}</p>
                    {connector.connected && connector.connected_at && (
                      <p className="text-xs text-muted-foreground">
                        Connected {new Date(connector.connected_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant={connector.connected ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => handleConnectorToggle(connector.id, connector.connected)}
                  className="border-border min-w-[100px]"
                >
                  {connector.connected ? "Disconnect" : "Connect"}
                </Button>
              </div>
              {index < connectors.length - 1 && <Separator className="bg-border" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

export default SettingsPage;