import { GraduationCap, User, Menu, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";

const AppHeader = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();

  const isNovaa = location.pathname === "/novaa";

  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card">
      <div className="flex items-center gap-2">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Logo / title — changes per page */}
        {isNovaa ? (
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

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <User className="w-5 h-5" />
        </Button>
      </div>
    </header>
  );
};

export default AppHeader;