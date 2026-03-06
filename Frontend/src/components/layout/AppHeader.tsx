import { GraduationCap, User } from "lucide-react";
import { Button } from "@/components/ui/button";

const AppHeader = () => {
  return (
    <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-primary" />
        </div>
        <span className="text-lg font-semibold text-foreground hidden sm:inline">
          Study Buddy
        </span>
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