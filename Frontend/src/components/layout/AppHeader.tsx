import { GraduationCap, User, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";

const AppHeader = () => {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();

  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card">
      <div className="flex items-center gap-2">
        {/* Hamburger — only visible on mobile, toggles the sidebar drawer */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Logo — always visible, navigates to /chat on click */}
        <button
          onClick={() => navigate("/chat")}
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity shrink-0"
          aria-label="Go to chat"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary" />
          </div>
          {/* Fix 3: removed "hidden sm:inline" so title is always visible */}
          <span className="text-lg font-semibold text-foreground">
            Study Buddy
          </span>
        </button>
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