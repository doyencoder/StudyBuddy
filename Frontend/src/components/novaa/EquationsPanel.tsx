import * as React from "react";
import {
  Eye, EyeOff, Trash2, Plus, MessageSquare,
  Check, X, Sparkles, Calculator, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/config/api";
import katex from "katex";
import "katex/dist/katex.min.css";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Equation {
  id: string;
  /** Raw math expression used by the graphing engine e.g. "3 * sqrt(1 - x^2/9)" */
  expression: string;
  /** Optional pretty implicit form shown in the panel e.g. "x^2/9 + y^2/4 = 1" */
  displayExpression?: string;
  color: string;
  visible: boolean;
  fromChat?: boolean;
  /** Equations sharing a groupId belong to the same mathematical object (e.g. ellipse halves) */
  groupId?: string;
}

interface EquationsPanelProps {
  isCollapsed: boolean;
  equations: Equation[];
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onAddEquations: (
    expressions: string[],
    label: string,
    groupId?: string,
    displayExpression?: string,
  ) => void;
  onEditEquation: (id: string, newExpression: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color dot styles — map CSS variable names to inline styles
// ─────────────────────────────────────────────────────────────────────────────

const colorDotStyle: Record<string, React.CSSProperties> = {
  "novaa-curve-1": { backgroundColor: "hsl(var(--novaa-curve-1))" },
  "novaa-curve-2": { backgroundColor: "hsl(var(--novaa-curve-2))" },
  "novaa-curve-3": { backgroundColor: "hsl(var(--novaa-curve-3))" },
  "novaa-curve-4": { backgroundColor: "hsl(var(--novaa-curve-4))" },
};

// ─────────────────────────────────────────────────────────────────────────────
// LaTeX conversion: raw math string → LaTeX string for KaTeX rendering
// ─────────────────────────────────────────────────────────────────────────────

function latexifyExpr(s: string): string {
  // sqrt(expr) → \sqrt{expr}  — handles one level of nested parens
  s = s.replace(
    /sqrt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
    (_, inner) => `\\sqrt{${latexifyExpr(inner)}}`,
  );
  // abs(x) → |x|
  s = s.replace(/abs\(([^()]+)\)/g, "\\left|$1\\right|");
  // Trig / log functions
  s = s
    .replace(/\bsin\b/g, "\\sin")
    .replace(/\bcos\b/g, "\\cos")
    .replace(/\btan\b/g, "\\tan")
    .replace(/\bcot\b/g, "\\cot")
    .replace(/\bsec\b/g, "\\sec")
    .replace(/\bcsc\b/g, "\\csc")
    .replace(/\bln\b/g,  "\\ln")
    .replace(/\blog\b/g, "\\log")
    .replace(/\bexp\b/g, "e^");
  // Constants
  s = s.replace(/\bpi\b/g, "\\pi");
  s = s.replace(/\binfinity\b/gi, "\\infty");
  // Greek letters written out
  const GREEK: Record<string, string> = {
    alpha:"\\alpha", beta:"\\beta", gamma:"\\gamma", delta:"\\delta",
    epsilon:"\\epsilon", zeta:"\\zeta", eta:"\\eta", theta:"\\theta",
    iota:"\\iota", kappa:"\\kappa", lambda:"\\lambda", mu:"\\mu",
    nu:"\\nu", xi:"\\xi", rho:"\\rho", sigma:"\\sigma", tau:"\\tau",
    upsilon:"\\upsilon", phi:"\\phi", chi:"\\chi", psi:"\\psi", omega:"\\omega",
  };
  for (const [word, latex] of Object.entries(GREEK)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, "gi"), latex);
  }
  // Fractions: multiple passes handles nested cases
  for (let pass = 0; pass < 4; pass++) {
    // (a) / (b)
    s = s.replace(
      /\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g,
      (_, n, d) => `\\frac{${latexifyExpr(n)}}{${latexifyExpr(d)}}`,
    );
    // term / (b)
    s = s.replace(
      /([\w.\\{}]+)\s*\/\s*\(([^()]+)\)/g,
      (_, n, d) => `\\frac{${n}}{${latexifyExpr(d)}}`,
    );
    // (a) / term
    s = s.replace(
      /\(([^()]+)\)\s*\/\s*([\w.]+)/g,
      (_, n, d) => `\\frac{${latexifyExpr(n)}}{${d}}`,
    );
    // term / term  (simple numbers or single vars)
    s = s.replace(
      /([\w.]+)\s*\/\s*([\w.]+)/g,
      (_, n, d) => `\\frac{${n}}{${d}}`,
    );
  }
  // Exponents:  x^2 → x^{2},   x^(expr) → x^{expr}
  s = s.replace(/\^(\d+)/g, "^{$1}");
  s = s.replace(/\^\(([^)]+)\)/g, "^{$1}");
  // Multiplication: * → ·  (cdot, not ×)
  s = s.replace(/\s*\*\s*/g, " \\cdot ");
  // Clean up extra spaces
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function toLatex(raw: string): string {
  const s = raw.trim();
  // Explicit: "y = expr"  or  "f(x) = expr"
  const prefixMatch = s.match(/^(y|f\(x\))\s*=\s*/i);
  if (prefixMatch) {
    return `y = ${latexifyExpr(s.slice(prefixMatch[0].length).trim())}`;
  }
  // Implicit equation: contains "=" and both x and y  →  render whole thing
  if (s.includes("=")) {
    return latexifyExpr(s);
  }
  // Bare expression
  return latexifyExpr(s);
}

function renderKatex(raw: string): string {
  if (!raw.trim()) return "";
  try {
    return katex.renderToString(toLatex(raw), {
      throwOnError: false,
      displayMode: false,
      output: "html",
    });
  } catch {
    return `<span class="font-mono text-xs">${raw}</span>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartMathInput
// A text input that intercepts keystrokes for a Desmos-like math typing experience:
//   • Auto-close brackets:    (  →  (|)      [  →  [|]
//   • Skip closing bracket:   if cursor is before ) and you type ), jump over it
//   • Auto-close after ^:     x^  →  x^(|)
//   • Fraction shortcut:      typing / wraps the token before cursor in a fraction
//   • Greek shortcuts:        \a → alpha,  \b → beta,  \t → theta,  etc.
//   • sqrt shortcut:          \s → sqrt(
//   • pi shortcut:            \p → pi
//   • KaTeX preview above:    rendered live as you type (handled by parent)
// ─────────────────────────────────────────────────────────────────────────────

// Mapping from backslash shortcut key → expanded text
const BACKSLASH_SHORTCUTS: Record<string, string> = {
  // Greek lowercase
  a: "alpha",
  b: "beta",
  g: "gamma",
  d: "delta",
  e: "epsilon",
  z: "zeta",
  h: "eta",
  t: "theta",
  i: "iota",
  k: "kappa",
  l: "lambda",
  m: "mu",
  n: "nu",
  x: "xi",
  r: "rho",
  s: "sqrt(",     // special: not a greek letter but very common
  o: "omega",
  f: "phi",
  c: "chi",
  w: "psi",
  p: "pi",
  // Useful constants
  I: "infty",
};

// Extract the "token" immediately before the cursor position in the string.
// Used to determine what the numerator of a fraction should be.
function tokenBefore(val: string, cursor: number): { token: string; start: number } {
  const before = val.slice(0, cursor);
  // Match: a parenthesised group  OR  a sequence of word chars/dots
  const match = before.match(/(\([^()]+\)|[\w.]+)$/);
  if (!match) return { token: "", start: cursor };
  return { token: match[1], start: cursor - match[1].length };
}

interface SmartMathInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function SmartMathInput({
  value, onChange, onSubmit, placeholder, disabled, className,
}: SmartMathInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Helper: insert text at cursor position, optionally repositioning cursor
  const insertAt = (
    val: string,
    start: number,
    end: number,
    text: string,
    newCursorOffset?: number,
  ) => {
    const next = val.slice(0, start) + text + val.slice(end);
    onChange(next);
    const newCursor = start + (newCursorOffset ?? text.length);
    // Must defer because React hasn't flushed yet
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input) return;
    const { selectionStart: rawStart, selectionEnd: rawEnd, value: val } = input;
    const start = rawStart ?? val.length;
    const end   = rawEnd   ?? val.length;

    // ── Enter: submit the form ───────────────────────────────────────────────
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
      return;
    }

    // ── Auto-close ( → () with cursor inside ────────────────────────────────
    if (e.key === "(") {
      e.preventDefault();
      // If there's selected text, wrap it
      const selected = val.slice(start, end);
      if (selected) {
        insertAt(val, start, end, `(${selected})`, selected.length + 1);
      } else {
        insertAt(val, start, end, "()", 1);
      }
      return;
    }

    // ── Auto-close [ → [] with cursor inside ────────────────────────────────
    if (e.key === "[") {
      e.preventDefault();
      insertAt(val, start, end, "[]", 1);
      return;
    }

    // ── Skip over existing ) or ] if cursor is already before one ───────────
    if ((e.key === ")" || e.key === "]") && val[start] === e.key && start === end) {
      e.preventDefault();
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(start + 1, start + 1);
      });
      return;
    }

    // ── Caret ^ : insert ^() and place cursor inside parens ─────────────────
    if (e.key === "^") {
      e.preventDefault();
      insertAt(val, start, end, "^()", 2);
      return;
    }

    // ── Fraction /: wrap token before cursor in numerator slot ──────────────
    if (e.key === "/" && start === end) {
      e.preventDefault();
      const { token, start: tokenStart } = tokenBefore(val, start);
      if (token) {
        // Replace "token" with "(token)/()" and put cursor inside denominator
        const replacement = `(${token})/()`;
        insertAt(val, tokenStart, start, replacement, replacement.length - 1);
      } else {
        // Nothing before cursor — just insert the slash
        insertAt(val, start, end, "/");
      }
      return;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    const cursor = e.target.selectionStart ?? newVal.length;

    // ── Backslash shortcuts: detect \<key> just completed ───────────────────
    const beforeCursor = newVal.slice(0, cursor);
    const bsMatch = beforeCursor.match(/\\([a-zA-Z])$/);
    if (bsMatch) {
      const key = bsMatch[1];
      const expansion = BACKSLASH_SHORTCUTS[key];
      if (expansion) {
        const replStart = cursor - 2; // position of the backslash
        const nextVal = newVal.slice(0, replStart) + expansion + newVal.slice(cursor);
        onChange(nextVal);
        const newCursor = replStart + expansion.length;
        requestAnimationFrame(() => {
          inputRef.current?.setSelectionRange(newCursor, newCursor);
        });
        return;
      }
    }

    onChange(newVal);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsed panel: just a column of colour dots with tooltips
// ─────────────────────────────────────────────────────────────────────────────

function CollapsedPanel({
  equations,
  onToggleVisibility,
}: {
  equations: Equation[];
  onToggleVisibility: (id: string) => void;
}) {
  // For grouped equations, show only one dot per group
  const displayed = equations.filter((eq, idx, arr) =>
    !eq.groupId || arr.findIndex((e) => e.groupId === eq.groupId) === idx,
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col items-center gap-2 w-10 py-4 bg-card border-r border-border shrink-0">
        {displayed.map((eq) => (
          <Tooltip key={eq.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "w-3 h-3 rounded-full transition-all duration-200 hover:scale-125 shrink-0",
                  !eq.visible && "opacity-30",
                )}
                style={colorDotStyle[eq.color] ?? { backgroundColor: "hsl(var(--primary))" }}
                onClick={() => onToggleVisibility(eq.id)}
              />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <span className="font-mono text-xs">
                {eq.displayExpression ?? eq.expression}
              </span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main EquationsPanel
// ─────────────────────────────────────────────────────────────────────────────

export function EquationsPanel({
  isCollapsed,
  equations,
  onToggleVisibility,
  onDelete,
  onAddEquations,
  onEditEquation,
}: EquationsPanelProps) {
  const [isAIMode, setIsAIMode] = React.useState(false);
  const [inputValue, setInputValue] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const regularEquations = equations.filter((eq) => !eq.fromChat);
  const chatEquations    = equations.filter((eq) =>  eq.fromChat);

  // Group equations by groupId so related curves (ellipse halves etc.) stay together
  const groupEquations = (eqs: Equation[]): Equation[][] => {
    const groups: Equation[][] = [];
    const seen = new Set<string>();
    for (const eq of eqs) {
      if (eq.groupId) {
        if (!seen.has(eq.groupId)) {
          seen.add(eq.groupId);
          groups.push(eqs.filter((e) => e.groupId === eq.groupId));
        }
      } else {
        groups.push([eq]);
      }
    }
    return groups;
  };

  // ── Submit handler (both Math and AI modes) ────────────────────────────────
  const handleSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setError(null);

    if (isAIMode) {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/graph/ai-parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: trimmed }),
        });
        const data = await res.json();

        if (data.error) {
          setError(data.error);
          return;
        }
        if (!data.equations || data.equations.length === 0) {
          setError("I can only graph math equations. Try: 'sine wave', 'parabola', or 'unit circle'.");
          return;
        }

        // Multiple equations from one AI call share a groupId (e.g. ellipse top+bottom)
        const groupId = data.equations.length > 1
          ? `group_${Date.now()}`
          : undefined;

        onAddEquations(
          data.equations,
          data.label ?? "",
          groupId,
          data.display_equation ?? undefined,
        );
        setInputValue("");
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setIsLoading(false);
      }
    } else {
      // Math mode: add the raw expression directly
      onAddEquations([trimmed], "");
      setInputValue("");
    }
  };

  if (isCollapsed) {
    return (
      <CollapsedPanel
        equations={equations}
        onToggleVisibility={onToggleVisibility}
      />
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-card border-r border-border">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Equations
        </span>
        <span className="text-xs text-muted-foreground">{equations.length}</span>
      </div>

      {/* ── Equation list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-1.5 px-2 space-y-0.5">
        {groupEquations(regularEquations).map((group) => (
          <EquationGroupRow
            key={group[0].id}
            group={group}
            onToggleVisibility={onToggleVisibility}
            onDelete={onDelete}
            onEdit={onEditEquation}
          />
        ))}

        {chatEquations.length > 0 && (
          <>
            {/* Divider with "from chat" label */}
            <div className="flex items-center gap-1.5 py-1 px-1">
              <div className="h-px flex-1 bg-border" />
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 h-3.5 border-dashed text-muted-foreground gap-1"
              >
                <MessageSquare className="w-2 h-2" />
                from chat
              </Badge>
              <div className="h-px flex-1 bg-border" />
            </div>
            {groupEquations(chatEquations).map((group) => (
              <EquationGroupRow
                key={group[0].id}
                group={group}
                isFromChat
                onToggleVisibility={onToggleVisibility}
                onDelete={onDelete}
                onEdit={onEditEquation}
              />
            ))}
          </>
        )}

        {equations.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6 leading-relaxed px-2">
            No equations yet.
            <br />
            Add one below.
          </p>
        )}
      </div>

      {/* ── Input section ───────────────────────────────────────────────────── */}
      <div className="border-t border-border shrink-0 bg-muted/20">

        {/* Math / AI mode toggle */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1">
          <button
            onClick={() => setIsAIMode(false)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-1 justify-center",
              !isAIMode
                ? "bg-background text-foreground border border-border shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Calculator className="w-3 h-3" />
            Math
          </button>
          <button
            onClick={() => setIsAIMode(true)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-1 justify-center",
              isAIMode
                ? "bg-primary/10 text-primary border border-primary/20 shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles className="w-3 h-3" />
            AI
          </button>
        </div>

        <div className="px-2 pb-2 space-y-1">
          {/* KaTeX live preview — only in Math mode, only when there's input */}
          {!isAIMode && inputValue.trim() && (
            <div
              className="px-2 py-1 rounded bg-muted/40 border border-border/40 text-sm overflow-x-auto min-h-[28px]"
              dangerouslySetInnerHTML={{ __html: renderKatex(inputValue) }}
            />
          )}

          {/* Input row: SmartMathInput (Math) or plain input (AI) */}
          <div className="flex items-center gap-1">
            {isAIMode ? (
              // AI mode: plain text input, no math interception
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="Describe the graph..."
                className="flex-1 min-w-0 h-8 px-2 text-xs font-mono rounded-md border bg-primary/5 border-primary/30 outline-none focus:border-primary/50 transition-colors"
                disabled={isLoading}
                spellCheck={false}
              />
            ) : (
              // Math mode: SmartMathInput with all smart features
              <SmartMathInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={handleSubmit}
                placeholder="y = x^2   try: \t, \p, \a..."
                disabled={isLoading}
                className="flex-1 min-w-0 h-8 px-2 text-xs font-mono rounded-md border bg-background/50 border-border/60 outline-none focus:border-primary/50 transition-colors"
              />
            )}

            {/* Submit button — always outside the input so it can never overlap */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleSubmit}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
              disabled={!inputValue.trim() || isLoading}
            >
              {isLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Plus className="w-3 h-3" />
              }
            </Button>
          </div>

          {/* Shortcut hint — only in Math mode, only when input is empty */}
          {!isAIMode && !inputValue && (
            <p className="text-[10px] text-muted-foreground/60 leading-tight px-0.5">
              \p=π  \t=θ  \a=α  \s=sqrt(  ^=exponent  (/=fraction
            </p>
          )}

          {error && (
            <p className="text-[10px] text-destructive leading-tight">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EquationGroupRow
// Renders one "group" of equations (could be 1 standalone or 2 halves of an ellipse).
// If the group has a displayExpression, shows that ONE pretty implicit form.
// Otherwise shows each equation individually.
// ─────────────────────────────────────────────────────────────────────────────

function EquationGroupRow({
  group,
  onToggleVisibility,
  onDelete,
  onEdit,
  isFromChat = false,
}: {
  group: Equation[];
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, newExpression: string) => void;
  isFromChat?: boolean;
}) {
  const primary   = group[0];
  const allVisible = group.every((eq) => eq.visible);

  // Delete all equations in the group at once
  const handleDeleteGroup = () => group.forEach((eq) => onDelete(eq.id));

  // Toggle visibility for all in the group at once
  const handleToggleGroup = () => group.forEach((eq) => onToggleVisibility(eq.id));

  // Show ONE pretty display equation if the group has one (e.g. "x^2/9 + y^2/4 = 1")
  // rather than showing the two sqrt halves separately
  const hasDisplay = !!primary.displayExpression && group.length > 1;

  return (
    <div
      className={cn(
        "group flex items-start gap-1.5 px-2 py-1.5 rounded-md transition-colors hover:bg-background/70",
        isFromChat && "border border-dashed border-primary/15",
        !allVisible && "opacity-40",
      )}
    >
      {/* Colour dot — click to toggle visibility */}
      <div
        className="w-2 h-2 rounded-full shrink-0 mt-[5px] transition-transform group-hover:scale-110 cursor-pointer"
        style={colorDotStyle[primary.color] ?? { backgroundColor: "hsl(var(--primary))" }}
        onClick={handleToggleGroup}
        title={allVisible ? "Hide" : "Show"}
      />

      {/* Equation display area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {hasDisplay ? (
          // Show the single clean implicit form
          <EditableEquation
            equation={{ ...primary, expression: primary.displayExpression! }}
            onEdit={(_id, val) => {
              // When the display equation is edited, update all equations in the group
              group.forEach((eq) => onEdit(eq.id, val));
            }}
          />
        ) : (
          // Show each equation in the group individually
          group.map((eq) => (
            <EditableEquation key={eq.id} equation={eq} onEdit={onEdit} />
          ))
        )}
      </div>

      {/* Actions: eye + trash — appear on hover */}
      <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
        <button
          onClick={handleToggleGroup}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title={allVisible ? "Hide" : "Show"}
        >
          {allVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <button
          onClick={handleDeleteGroup}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditableEquation
// Shows a KaTeX-rendered equation. Click anywhere on it to enter edit mode.
// Pressing Enter or clicking away commits the edit; Escape cancels.
// ─────────────────────────────────────────────────────────────────────────────

function EditableEquation({
  equation,
  onEdit,
}: {
  equation: Equation;
  onEdit: (id: string, newExpression: string) => void;
}) {
  const [isEditing, setIsEditing]   = React.useState(false);
  const [editValue, setEditValue]   = React.useState(equation.expression);

  const startEdit = () => {
    setEditValue(equation.expression);
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== equation.expression) {
      onEdit(equation.id, trimmed);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditValue(equation.expression);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        {/* Use SmartMathInput here too so editing is also smart */}
        <SmartMathInput
          value={editValue}
          onChange={setEditValue}
          onSubmit={commitEdit}
          className="flex-1 min-w-0 font-mono text-xs bg-muted/50 border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary/50 text-foreground"
        />
        <button onClick={commitEdit} className="text-primary shrink-0">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={cancelEdit} className="text-muted-foreground shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Normal display: rendered KaTeX, click to edit
  return (
    <div
      className="cursor-text hover:bg-muted/30 rounded px-1 py-0.5 transition-colors overflow-hidden"
      onClick={startEdit}
      title="Click to edit"
      dangerouslySetInnerHTML={{ __html: renderKatex(equation.expression) }}
    />
  );
}