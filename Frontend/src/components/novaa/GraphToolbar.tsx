import * as React from "react";
import { Sparkles, Send, Minus, X, Sigma, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { API_BASE } from "@/config/api";

interface GraphToolbarProps {
  onSubmit: (equations: string[], label: string) => void;
  onToolClick: (tool: "tangent" | "intersect" | "area") => void;
  activeTool: "tangent" | "intersect" | "area" | null;
}

const tools: {
  id: "tangent" | "intersect" | "area";
  icon: React.ElementType;
  label: string;
  shortcut: string;
}[] = [
  { id: "tangent",   icon: Minus,  label: "Tangent line",         shortcut: "T" },
  { id: "intersect", icon: X,      label: "Intersection",         shortcut: "I" },
  { id: "area",      icon: Sigma,  label: "Area under curve (∫)", shortcut: "A" },
];

// Detects direct math input vs natural language.
// Matches: y=, f(x)=, bare expressions starting with a number/paren/minus,
// or known math function names (sin, cos, tan, sqrt, log, exp, abs, x alone, X alone)
const DIRECT_EQ_RE = /^(y\s*=|f\s*\(x\)\s*=|[+\-\d(]|sin\s*\(|cos\s*\(|tan\s*\(|sqrt\s*\(|log\s*\(|exp\s*\(|abs\s*\(|[xX]\s*$|[xX]\s*[\^+\-*/])/i;

// Normalise expression: lowercase x, wrap if no y= prefix
function normaliseEquation(raw: string): string {
  // Replace capital X with lowercase x for mathjs
  const withLowerX = raw.replace(/X/g, "x");
  return /^(y|f\(x\))\s*=/i.test(withLowerX) ? withLowerX : `y = ${withLowerX}`;
}

export function GraphToolbar({ onSubmit, onToolClick, activeTool }: GraphToolbarProps) {
  const [inputValue, setInputValue] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setError(null);

    // Direct math input — no AI needed
    if (DIRECT_EQ_RE.test(trimmed)) {
      onSubmit([normaliseEquation(trimmed)], "");
      setInputValue("");
      return;
    }

    // Natural language → AI
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/graph/ai-parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (!data.equations || data.equations.length === 0) {
        setError("Couldn't parse that. Try: \"y = x^2\" or \"plot a sine wave\".");
        return;
      }
      // Normalise AI response too (might return capital X)
      onSubmit(data.equations.map(normaliseEquation), data.label ?? "");
      setInputValue("");
    } catch {
      setError("AI parse failed. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "t" || e.key === "T") onToolClick("tangent");
      if (e.key === "i" || e.key === "I") onToolClick("intersect");
      if (e.key === "a" || e.key === "A") onToolClick("area");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToolClick]);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3 px-4 h-14">

          {/* Title */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">Novaa</h1>
          </div>

          <div className="h-6 w-px bg-border/50 shrink-0" />

          {/* Smart input */}
          <form onSubmit={handleSubmit} className="flex-1 max-w-2xl">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-primary/5 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.2)] pointer-events-none" />
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder='Type "y = x^2" or describe it: "plot a normal distribution"'
                className="relative h-10 pr-10 bg-transparent border-border/30 font-mono text-sm placeholder:text-muted-foreground/40 focus-visible:border-primary/50"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className={cn(
                  "absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 transition-colors",
                  inputValue.trim() ? "text-primary" : "text-muted-foreground"
                )}
                disabled={!inputValue.trim() || isLoading}
              >
                {isLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>

          <div className="h-6 w-px bg-border/50 shrink-0" />

          {/* Quick tools */}
          <div className="flex items-center gap-1 shrink-0">
            {tools.map((tool) => (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9 transition-colors",
                      activeTool === tool.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    onClick={() => onToolClick(tool.id)}
                  >
                    <tool.icon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  <div className="flex items-center gap-2">
                    <span>{tool.label}</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                      {tool.shortcut}
                    </kbd>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {error && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <span className="text-xs text-destructive">{error}</span>
            <button onClick={() => setError(null)} className="text-xs text-muted-foreground hover:text-foreground ml-auto">
              dismiss
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}