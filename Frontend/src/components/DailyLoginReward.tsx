import { useState, useEffect, useRef } from "react";
import { X, Flame, Gift, Sparkles, TrendingUp } from "lucide-react";
import { useCoins } from "@/contexts/CoinContext";

const CoinSVG = ({ size = 40, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
    <defs>
      <linearGradient id="dlr-coin" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="hsl(217,91%,72%)" />
        <stop offset="100%" stopColor="hsl(217,91%,50%)" />
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="18" fill="url(#dlr-coin)" stroke="hsl(217,91%,40%)" strokeWidth="1.5" />
    <circle cx="20" cy="20" r="14" fill="none" stroke="hsl(217,91%,60%)" strokeWidth="0.8" opacity="0.4" />
    <text x="20" y="25" textAnchor="middle" fontSize="14" fontWeight="bold" fill="white" fontFamily="sans-serif">S</text>
  </svg>
);

const FloatingCoins = () => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="absolute animate-float-coin" style={{ left: `${10 + Math.random() * 80}%`, animationDelay: `${i * 0.15}s`, animationDuration: `${1.5 + Math.random()}s` }}>
        <CoinSVG size={16 + Math.random() * 12} />
      </div>
    ))}
  </div>
);

export const DailyLoginReward = () => {
  const { initialized, claimDailyLogin } = useCoins();
  const [reward, setReward] = useState<{ coins_earned: number; new_streak: number; streak_bonus: number; streak_milestone: string | null } | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!initialized || attemptedRef.current) return;
    attemptedRef.current = true;

    const t = setTimeout(() => {
      claimDailyLogin()
        .then((r) => {
          if (r) {
            setReward(r);
            setVisible(true);
          }
        })
        .catch(() => {});
    }, 800);

    return () => clearTimeout(t);
  }, [initialized, claimDailyLogin]);

  const close = () => { setClosing(true); setTimeout(() => setVisible(false), 300); };
  if (!visible || !reward) return null;
  const total = reward.coins_earned + reward.streak_bonus;

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`} onClick={close} />
      <div className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-300 ${closing ? "opacity-0 scale-90" : "opacity-100 scale-100"}`}>
        <div className="relative w-full max-w-sm rounded-3xl overflow-hidden" style={{ background: "hsl(var(--card))" }} onClick={(e) => e.stopPropagation()}>
          {/* Header — primary blue gradient */}
          <div className="relative h-44 bg-gradient-to-br from-[hsl(217,91%,60%)] via-[hsl(217,91%,55%)] to-[hsl(230,80%,50%)] flex items-center justify-center overflow-hidden">
            <FloatingCoins />
            <button onClick={close} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white/90 transition-colors z-10">
              <X className="w-4 h-4" />
            </button>
            <div className="relative z-10 flex flex-col items-center">
              <div className="animate-bounce-gentle"><CoinSVG size={72} /></div>
              <div className="mt-1 px-4 py-1 rounded-full bg-white/20 backdrop-blur-sm">
                <span className="text-white font-bold text-lg tracking-wide">+{total}</span>
              </div>
            </div>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
            <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full bg-white/10" />
          </div>

          <div className="px-6 py-5 text-center space-y-4">
            <div>
              <h2 className="text-xl font-bold text-foreground flex items-center justify-center gap-2">
                <Gift className="w-5 h-5 text-primary" /> Welcome back!
              </h2>
              <p className="text-sm text-muted-foreground mt-1">You've earned your daily Study Coins</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-sm text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" /> Daily Login
                </span>
                <span className="font-semibold text-primary">+{reward.coins_earned}</span>
              </div>
              {reward.streak_bonus > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 animate-pulse">
                  <span className="text-sm text-foreground flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" /> {reward.streak_milestone}
                  </span>
                  <span className="font-semibold text-primary">+{reward.streak_bonus}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-3 py-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                <Flame className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">{reward.new_streak} day{reward.new_streak !== 1 ? "s" : ""}</span>
              </div>
              <span className="text-xs text-muted-foreground">streak</span>
            </div>

            <button onClick={close} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/20 active:scale-[0.98]">
              Collect & Continue
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float-coin { 0% { transform: translateY(180px) rotate(0deg); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-20px) rotate(360deg); opacity: 0; } }
        .animate-float-coin { animation: float-coin 2s ease-out forwards; }
        @keyframes bounce-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        .animate-bounce-gentle { animation: bounce-gentle 2s ease-in-out infinite; }
      `}</style>
    </>
  );
};
