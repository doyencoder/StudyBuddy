/**
 * ModelSelector.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Inline model / provider picker for the ChatPage toolbar.
 *
 * Renders as a compact ghost button showing the active provider's name and a
 * chevron.  Opens a dropdown listing all available providers with an icon,
 * label, sub-description, and a check-mark next to the active choice.
 *
 * Design rules:
 *  • Matches the existing toolbar button aesthetic (h-8 ghost rounded-xl).
 *  • Provider label is hidden on narrow screens (< sm) — only the icon shows,
 *    so the toolbar never wraps on mobile.
 *  • Disabled when offline (mirrors the Send / Upload pattern in ChatPage).
 *  • Self-contained — no external state store, just a value + onChange prop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ChevronDown, Cpu, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Types ────────────────────────────────────────────────────────────────────

export type ProviderKey = "azure" | "gemini";

interface ProviderDef {
  key: ProviderKey;
  label: string;
  shortLabel: string;       // shown in the trigger button
  sub: string;              // shown as the description line in the dropdown
  Icon: React.FC<{ className?: string }>;
  badgeColor: string;       // tailwind text color for the live badge dot
}

// ── Provider catalogue ───────────────────────────────────────────────────────

const PROVIDERS: ProviderDef[] = [
  {
    key: "azure",
    label: "Azure OpenAI",
    shortLabel: "Azure",
    sub: "gpt-4o-mini · Default",
    Icon: Cpu,
    badgeColor: "text-blue-400",
  },
  {
    key: "gemini",
    label: "Gemini",
    shortLabel: "Gemini",
    sub: "gemini-2.5-flash · Google",
    Icon: Sparkles,
    badgeColor: "text-violet-400",
  },
];

// ── Component ────────────────────────────────────────────────────────────────

interface ModelSelectorProps {
  value: ProviderKey;
  onChange: (key: ProviderKey) => void;
  /** Pass true while offline to prevent model switches mid-stream */
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, disabled = false }: ModelSelectorProps) {
  const active = PROVIDERS.find((p) => p.key === value) ?? PROVIDERS[0];
  const ActiveIcon = active.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl font-normal select-none"
          title={`Model: ${active.label}`}
        >
          {/* Coloured dot — visual anchor even when label is hidden */}
          <span className={`w-1.5 h-1.5 rounded-full bg-current ${active.badgeColor} shrink-0`} />
          <ActiveIcon className="w-3.5 h-3.5 shrink-0" />
          {/* Label hidden on very narrow screens so the toolbar never wraps */}
          <span className="hidden sm:inline leading-none">{active.shortLabel}</span>
          <ChevronDown className="w-3 h-3 opacity-40 shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        className="bg-card border-border w-56 mb-1"
      >
        {/* Header label */}
        <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          AI Model
        </div>
        <DropdownMenuSeparator className="bg-border/50 my-0.5" />

        {PROVIDERS.map(({ key, label, sub, Icon, badgeColor }) => {
          const isActive = value === key;
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => !isActive && onChange(key)}
              className="gap-3 cursor-pointer py-2.5"
            >
              {/* Icon with coloured background pill when active */}
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isActive ? "bg-primary/15" : "bg-muted/50"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                />
              </div>

              {/* Text */}
              <div className="flex flex-col min-w-0 flex-1">
                <span
                  className={`text-sm leading-none mb-0.5 ${
                    isActive ? "text-foreground font-medium" : "text-foreground"
                  }`}
                >
                  {label}
                </span>
                <span className="text-[11px] text-muted-foreground leading-none">{sub}</span>
              </div>

              {/* Active indicator */}
              {isActive && (
                <span className={`text-xs font-bold ml-auto ${badgeColor}`}>✓</span>
              )}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator className="bg-border/50 my-0.5" />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
          Choice is saved per conversation and restored on reload.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}