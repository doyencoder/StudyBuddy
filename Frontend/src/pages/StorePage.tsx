import { useState, useEffect, useRef } from "react";
import {
  Gift, Coins, ShoppingBag, Flame, Star, Trophy, Check,
  Sparkles, ArrowRight, TrendingUp, Lock,
  LogIn, ClipboardCheck, Upload, Users, FilePlus, Brain,
  ClipboardList, Moon, TreePine, GraduationCap, Volume2, Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  STORE_ITEMS, EARN_MISSIONS,
  isMissionCompletedToday, type CoinState,
} from "@/lib/coinStore";
import { useCoins } from "@/contexts/CoinContext";

type StoreTab = "redeem" | "earn" | "orders";

// ── Icon map: iconKey → React component ─────────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  "log-in": <LogIn className="w-5 h-5" />,
  "clipboard-check": <ClipboardCheck className="w-5 h-5" />,
  "upload": <Upload className="w-5 h-5" />,
  "flame": <Flame className="w-5 h-5" />,
  "star": <Star className="w-5 h-5" />,
  "trophy": <Trophy className="w-5 h-5" />,
  "users": <Users className="w-5 h-5" />,
  "file-plus": <FilePlus className="w-5 h-5" />,
  "brain": <Brain className="w-5 h-5" />,
  "clipboard-list": <ClipboardList className="w-5 h-5" />,
  "moon": <Moon className="w-5 h-5" />,
  "tree-pine": <TreePine className="w-5 h-5" />,
  "graduation-cap": <GraduationCap className="w-5 h-5" />,
  "volume-2": <Volume2 className="w-5 h-5" />,
  "shield": <Shield className="w-5 h-5" />,
};
const getIcon = (key: string) => ICON_MAP[key] ?? <Coins className="w-5 h-5" />;

// ── Coin SVG (primary blue) ─────────────────────────────────────────────────
const CoinIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" className="inline-block flex-shrink-0">
    <defs><linearGradient id="sc-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="hsl(217,91%,72%)"/><stop offset="100%" stopColor="hsl(217,91%,50%)"/></linearGradient></defs>
    <circle cx="20" cy="20" r="18" fill="url(#sc-g)" stroke="hsl(217,91%,40%)" strokeWidth="1.5"/>
    <circle cx="20" cy="20" r="14" fill="none" stroke="hsl(217,91%,60%)" strokeWidth="0.8" opacity="0.4"/>
    <text x="20" y="25" textAnchor="middle" fontSize="14" fontWeight="bold" fill="white" fontFamily="sans-serif">S</text>
  </svg>
);

// ── Main Store Page ─────────────────────────────────────────────────────────

const StorePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initTab = (searchParams.get("tab") as StoreTab) || "redeem";
  const [activeTab, setActiveTab] = useState<StoreTab>(["redeem","earn","orders"].includes(initTab) ? initTab : "redeem");
  const { coinState } = useCoins();

  const swipeStartX = useRef<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeTabRef = useRef<StoreTab>(activeTab);
  const TABS: StoreTab[] = ["redeem", "earn", "orders"];

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { tabRefs.current[activeTab]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }, [activeTab]);
  useEffect(() => {
    const el = pageRef.current; if (!el) return;
    const s = (e: TouchEvent) => { swipeStartX.current = e.touches[0].clientX; };
    const e2 = (e: TouchEvent) => { if (swipeStartX.current === null) return; const dx = e.changedTouches[0].clientX - swipeStartX.current; swipeStartX.current = null; if (Math.abs(dx) < 50) return; const i = TABS.indexOf(activeTabRef.current); if (dx < 0 && i < TABS.length - 1) setActiveTab(TABS[i+1]); if (dx > 0 && i > 0) setActiveTab(TABS[i-1]); };
    el.addEventListener("touchstart", s, { passive: true }); el.addEventListener("touchend", e2, { passive: true });
    return () => { el.removeEventListener("touchstart", s); el.removeEventListener("touchend", e2); };
  }, []);

  const tabs: { id: StoreTab; label: string; icon: React.ReactNode }[] = [
    { id: "redeem", label: "Redeem", icon: <Gift className="w-4 h-4" /> },
    { id: "earn", label: "Earn Coins", icon: <Coins className="w-4 h-4" /> },
    { id: "orders", label: "Orders", icon: <ShoppingBag className="w-4 h-4" /> },
  ];

  return (
    <div ref={pageRef} className="overflow-y-auto h-full bg-[radial-gradient(circle_at_20%_-10%,hsl(var(--primary)/0.18),transparent_35%),radial-gradient(circle_at_85%_0%,hsl(var(--primary)/0.12),transparent_30%)]">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/14 via-primary/6 to-transparent" />
        <div className="relative max-w-5xl mx-auto px-6 pt-10 pb-0">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-5 mb-6">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
                <Gift className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div className="text-center sm:text-left flex-1">
              <h1 className="text-3xl font-bold text-foreground tracking-tight">StudyBuddy Store</h1>
              <p className="text-muted-foreground text-sm mt-1">Earn coins by studying, redeem for boosts and rewards</p>
            </div>
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-primary/10 border border-primary/20 shadow-sm shadow-primary/10">
              <CoinIcon size={28} />
              <div>
                <p className="text-xs text-muted-foreground leading-none">Your Balance</p>
                <p className="text-2xl font-bold text-primary leading-tight">{coinState.balance.toLocaleString()}</p>
              </div>
              <div className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Flame className="w-3.5 h-3.5 text-primary" /><span>{coinState.login_streak}d login</span>
              </div>
            </div>
          </div>

          <nav className="flex gap-0 overflow-x-auto scrollbar-none border-b border-border bg-card/35 backdrop-blur-sm rounded-t-xl px-1">
            {tabs.map((t) => (
              <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} onClick={() => setActiveTab(t.id)}
                className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${activeTab === t.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {t.icon}{t.label}
                {activeTab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === "redeem" && <RedeemSection coinState={coinState} />}
        {activeTab === "earn" && <EarnSection coinState={coinState} />}
        {activeTab === "orders" && <OrdersSection coinState={coinState} />}
      </div>
    </div>
  );
};

// ── Redeem ──────────────────────────────────────────────────────────────────
const RedeemSection = ({ coinState }: { coinState: CoinState }) => {
  const cats = [
    { key: "boost", label: "Study Boosts", desc: "Enhance your learning experience" },
    { key: "cosmetic", label: "Cosmetics & Badges", desc: "Customize your StudyBuddy" },
  ];
  return (
    <div className="space-y-10">
      {cats.map(cat => {
        const items = STORE_ITEMS.filter(i => i.category === cat.key);
        return (
          <div key={cat.key}>
            <div className="mb-4"><h2 className="text-lg font-semibold text-foreground">{cat.label}</h2><p className="text-sm text-muted-foreground">{cat.desc}</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map(item => (
                <Card key={item.id} className="group relative overflow-hidden border border-border bg-card/90 transition-shadow hover:shadow-lg hover:shadow-primary/10">
                  <div className={`h-28 bg-gradient-to-br ${item.gradient} flex items-center justify-center relative`}>
                    <div className="text-primary/60 group-hover:scale-110 transition-transform">{getIcon(item.iconKey)}</div>
                    {item.limited && <Badge className="absolute top-2 right-2 bg-primary/80 text-primary-foreground text-[10px] px-1.5 py-0.5 border-0">Limited</Badge>}
                    <div className="absolute inset-0 bg-card/60 backdrop-blur-[1px] flex items-center justify-center">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 border border-primary/25">
                        <Lock className="w-3.5 h-3.5 text-primary" />
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-5 space-y-3">
                    <div><h3 className="font-semibold text-sm text-foreground">{item.name}</h3><p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p></div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5"><CoinIcon size={18} /><span className="font-bold text-sm text-primary">{item.cost.toLocaleString()}</span></div>
                      <Button size="sm" disabled className="text-xs h-8 bg-secondary text-muted-foreground">Locked</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Earn Section (no achievements, no graph equation, no 7-day streak) ──────
const EarnSection = ({ coinState }: { coinState: CoinState }) => {
  const cats = [
    { key: "daily", label: "Daily Missions", iconEl: <Sparkles className="w-5 h-5 text-primary" />, desc: "Reset every day — complete them for easy coins" },
    { key: "streak", label: "Streak Milestones", iconEl: <Flame className="w-5 h-5 text-primary" />, desc: "Stay consistent to unlock big bonuses" },
    { key: "social", label: "Social", iconEl: <Users className="w-5 h-5 text-primary" />, desc: "Invite friends and earn together" },
  ];

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Earned", value: coinState.lifetime_earned.toLocaleString(), icon: <TrendingUp className="w-4 h-4 text-green-500" /> },
          { label: "Current Login Streak", value: `${coinState.login_streak}d`, icon: <Flame className="w-4 h-4 text-primary" /> },
          { label: "Best Login Streak", value: `${coinState.longest_streak}d`, icon: <Trophy className="w-4 h-4 text-primary" /> },
          { label: "Referrals", value: coinState.referral_count.toString(), icon: <Users className="w-4 h-4 text-primary" /> },
        ].map(s => (
          <div key={s.label} className="px-4 py-3 rounded-xl bg-card border border-border text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">{s.icon}<span className="text-lg font-bold text-foreground">{s.value}</span></div>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {cats.map(cat => {
        const missions = EARN_MISSIONS.filter(m => m.category === cat.key);
        return (
          <div key={cat.key}>
            <div className="flex items-center gap-2 mb-3">
              {cat.iconEl}
              <div><h2 className="text-base font-semibold text-foreground">{cat.label}</h2><p className="text-xs text-muted-foreground">{cat.desc}</p></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {missions.map(mission => {
                const completedToday = isMissionCompletedToday(mission.id, coinState);
                const everCompleted = coinState.missions[mission.id]?.completed;
                const done = mission.repeatable ? completedToday : everCompleted;
                return (
                  <div key={mission.id} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all ${done ? "bg-green-500/5 border-green-500/20" : "bg-card border-border hover:border-primary/30"}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${done ? "bg-green-500/15 text-green-500" : "bg-primary/10 text-primary"}`}>
                      {done ? <Check className="w-5 h-5" /> : getIcon(mission.iconKey)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground truncate">{mission.name}</h3>
                      <p className="text-[11px] text-muted-foreground truncate">{mission.description}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className={`text-sm font-bold ${done ? "text-green-500" : "text-primary"}`}>{done ? <Check className="w-4 h-4" /> : `+${mission.reward}`}</span>
                      {!done && <CoinIcon size={14} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Orders ──────────────────────────────────────────────────────────────────
const OrdersSection = ({ coinState }: { coinState: CoinState }) => {
  if (coinState.orders.length === 0 && coinState.transactions.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary/60 mb-2"><ShoppingBag className="w-8 h-8 text-muted-foreground" /></div>
        <h3 className="text-lg font-semibold text-foreground">No orders yet</h3>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">Visit the Redeem tab to spend your Study Coins on boosts, themes, and badges!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {coinState.orders.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Order History</h2>
            <Badge variant="secondary" className="text-xs">{coinState.orders.length} item{coinState.orders.length !== 1 ? "s" : ""}</Badge>
          </div>
          <div className="space-y-2">
            {coinState.orders.map(order => {
              const item = STORE_ITEMS.find(i => i.id === order.item_id);
              return (
                <div key={order.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-card border border-border">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">{item ? getIcon(item.iconKey) : <ShoppingBag className="w-5 h-5" />}</div>
                  <div className="flex-1 min-w-0"><h3 className="text-sm font-medium text-foreground truncate">{order.item_name}</h3><p className="text-[11px] text-muted-foreground">{new Date(order.ordered_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p></div>
                  <div className="flex items-center gap-1.5 flex-shrink-0"><CoinIcon size={16} /><span className="text-sm font-semibold text-muted-foreground">{order.cost}</span></div>
                  <Badge className={`text-[10px] px-2 py-0.5 border-0 ${order.status === "delivered" ? "bg-green-500/15 text-green-500" : "bg-primary/15 text-primary"}`}>{order.status === "delivered" ? "Delivered" : "Pending"}</Badge>
                </div>
              );
            })}
          </div>
        </>
      )}

      {coinState.transactions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Recent Transactions</h2>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {coinState.transactions.slice(0, 50).map(tx => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${tx.type === "earn" ? "bg-green-500/15" : "bg-red-500/15"}`}>
                    <ArrowRight className={`w-3.5 h-3.5 ${tx.type === "earn" ? "text-green-500 rotate-[-45deg]" : "text-red-500 rotate-[135deg]"}`} />
                  </div>
                  <div className="min-w-0"><p className="text-sm text-foreground truncate">{tx.reason}</p><p className="text-[10px] text-muted-foreground">{new Date(tx.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>
                </div>
                <span className={`text-sm font-semibold flex-shrink-0 ${tx.type === "earn" ? "text-green-500" : "text-red-400"}`}>{tx.type === "earn" ? "+" : "-"}{tx.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StorePage;
