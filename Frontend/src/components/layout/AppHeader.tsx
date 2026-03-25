import { GraduationCap, User, Menu, BarChart2, Coins, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { useCoins } from "@/contexts/CoinContext";

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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground shrink-0" aria-label="Toggle menu">
          <Menu className="w-5 h-5" />
        </Button>
        {isNova ? (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center"><BarChart2 className="w-5 h-5 text-primary" /></div>
            <span className="text-lg font-semibold text-foreground">Nova</span>
          </div>
        ) : (
          <button onClick={() => navigate("/chat")} className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity shrink-0" aria-label="Go to chat">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-primary" /></div>
            <span className="text-lg font-semibold text-foreground">Study Buddy</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Coin balance — primary theme, opens Store on click */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => navigate("/store")} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors cursor-pointer" aria-label="Open store">
              <Coins className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-xs font-bold text-primary">{balance.toLocaleString()}</span>
              {loginStreak > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-primary/70">
                  <Flame className="w-3 h-3" />{loginStreak}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Open Store</p></TooltipContent>
        </Tooltip>

        {/* Mobile coin icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => navigate("/store")} className="flex sm:hidden items-center justify-center w-8 h-8 rounded-full bg-primary/10 border border-primary/20" aria-label="Open store">
              <Coins className="w-4 h-4 text-primary" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Open Store</p></TooltipContent>
        </Tooltip>

        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <User className="w-5 h-5" />
        </Button>
      </div>
    </header>
  );
};

export default AppHeader;
