import { useState, useRef, useEffect } from "react";
import { GraduationCap, Menu, BarChart2, Coins, Flame, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { useCoins } from "@/contexts/CoinContext";
import { useUser } from "@/contexts/UserContext";
import type { UserProfile } from "@/config/users";

// ── Derive initials dynamically from any name string ─────────────────────────
// Takes up to the first letter of each word, max 2 chars, always uppercase.
// "john" → "JO"  |  "John Smith" → "JS"  |  "" → "??"
function deriveInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    // Single word — use first two letters
    return trimmed.slice(0, 2).toUpperCase();
  }
  // Multiple words — first letter of each word, max 2
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ── Avatar helper ─────────────────────────────────────────────────────────────
function Avatar({
  user,
  displayName,
  size = "md",
  showRing = false,
}: {
  user: UserProfile;
  /** Live name — initials are derived from this, not from user.initials */
  displayName: string;
  size?: "sm" | "md" | "lg";
  showRing?: boolean;
}) {
  const sizeClasses = {
    sm: "w-7 h-7 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-sm",
  }[size];

  return (
    <div
      className={`
        ${sizeClasses} rounded-full flex items-center justify-center font-bold shrink-0
        bg-muted/70 text-foreground border border-border
        ${showRing ? "ring-2 ring-primary/25 ring-offset-2 ring-offset-background" : ""}
        transition-all duration-200
      `}
    >
      {deriveInitials(displayName)}
    </div>
  );
}

// ── Profile Switcher Dropdown ─────────────────────────────────────────────────
function ProfileSwitcher() {
  const { currentUser, allUsers, switchUser, getDisplayName } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Navigate to /chat on switch so ChatPage resets its state
  const handleSwitch = (id: string) => {
    switchUser(id);
    setOpen(false);
    navigate("/chat", { replace: true });
  };

  const currentDisplayName = getDisplayName(currentUser.id);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={`
          flex items-center gap-2 px-2 py-1.5 rounded-lg
          hover:bg-accent transition-colors duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${open ? "bg-accent" : ""}
        `}
        aria-label="Switch profile"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Avatar user={currentUser} displayName={currentDisplayName} size="md" showRing />
        <div className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-xs font-semibold text-foreground">{currentDisplayName}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground hidden sm:block transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="
            absolute right-0 top-full mt-2 w-72 z-50
            bg-card border border-border rounded-xl shadow-xl
            overflow-hidden
            animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150
          "
          role="menu"
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <Avatar user={currentUser} displayName={currentDisplayName} size="lg" showRing />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Hello, {currentDisplayName} 👋
                </p>
              </div>
            </div>
          </div>

          {/* Switch profile section */}
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-1.5">
              Switch Profile
            </p>
            <div className="space-y-0.5">
              {allUsers.map((user) => {
                const isActive = user.id === currentUser.id;
                const name = getDisplayName(user.id);
                return (
                  <button
                    key={user.id}
                    onClick={() => handleSwitch(user.id)}
                    role="menuitem"
                    className={`
                      w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg
                      text-left transition-colors duration-100
                      ${
                        isActive
                          ? "bg-primary/10 cursor-default"
                          : "hover:bg-accent cursor-pointer"
                      }
                    `}
                  >
                    <Avatar user={user} displayName={name} size="sm" showRing={isActive} />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          isActive ? "text-foreground" : "text-foreground/80"
                        }`}
                      >
                        {name}
                      </p>
                    </div>
                    {isActive && (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-muted/70 text-primary border border-border">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AppHeader ─────────────────────────────────────────────────────────────────
const AppHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const { coinState } = useCoins();
  const balance = coinState.balance;
  const loginStreak = coinState.login_streak;

  const isNova = location.pathname === "/nova";

  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card">
      {/* Left — logo / page title */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
        {isNova ? (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-primary" />
            </div>
            <span className="text-lg font-semibold text-foreground">Nova</span>
          </div>
        ) : (
          <button
            onClick={() => navigate("/chat")}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity shrink-0"
            aria-label="Go to chat"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-primary" />
            </div>
            <span className="text-lg font-semibold text-foreground">Study Buddy</span>
          </button>
        )}
      </div>

      {/* Right — coins + profile switcher */}
      <div className="flex items-center gap-2">
        {/* Coin balance — desktop */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate("/store")}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors cursor-pointer"
              aria-label="Open store"
            >
              <Coins className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-xs font-bold text-primary">{balance.toLocaleString()}</span>
              {loginStreak > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-primary/70">
                  <Flame className="w-3 h-3" />
                  {loginStreak}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Open Store</p>
          </TooltipContent>
        </Tooltip>

        {/* Coin balance — mobile */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate("/store")}
              className="flex sm:hidden items-center justify-center w-8 h-8 rounded-full bg-primary/10 border border-primary/20"
              aria-label="Open store"
            >
              <Coins className="w-4 h-4 text-primary" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Open Store</p>
          </TooltipContent>
        </Tooltip>

        {/* Profile Switcher */}
        <ProfileSwitcher />
      </div>
    </header>
  );
};

export default AppHeader;