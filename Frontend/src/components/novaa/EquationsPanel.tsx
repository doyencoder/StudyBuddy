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
  "novaa-curve-1":  { backgroundColor: "hsl(var(--novaa-curve-1))" },
  "novaa-curve-2":  { backgroundColor: "hsl(var(--novaa-curve-2))" },
  "novaa-curve-3":  { backgroundColor: "hsl(var(--novaa-curve-3))" },
  "novaa-curve-4":  { backgroundColor: "hsl(var(--novaa-curve-4))" },
  "novaa-curve-5":  { backgroundColor: "hsl(var(--novaa-curve-5))" },
  "novaa-curve-6":  { backgroundColor: "hsl(var(--novaa-curve-6))" },
  "novaa-curve-7":  { backgroundColor: "hsl(var(--novaa-curve-7))" },
  "novaa-curve-8":  { backgroundColor: "hsl(var(--novaa-curve-8))" },
  "novaa-curve-9":  { backgroundColor: "hsl(var(--novaa-curve-9))" },
  "novaa-curve-10": { backgroundColor: "hsl(var(--novaa-curve-10))" },
  "novaa-curve-11": { backgroundColor: "hsl(var(--novaa-curve-11))" },
  "novaa-curve-12": { backgroundColor: "hsl(var(--novaa-curve-12))" },
  "novaa-curve-13": { backgroundColor: "hsl(var(--novaa-curve-13))" },
  "novaa-curve-14": { backgroundColor: "hsl(var(--novaa-curve-14))" },
  "novaa-curve-15": { backgroundColor: "hsl(var(--novaa-curve-15))" },
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
// MathQuill types (no @types/mathquill package exists, define minimal interface)
// ─────────────────────────────────────────────────────────────────────────────

interface MQMathField {
  latex(): string;
  latex(val: string): void;
  focus(): void;
  blur(): void;
  revert(): HTMLElement;
}

interface MQStatic {
  MathField(el: HTMLElement, config?: object): MQMathField;
}

declare global {
  interface Window {
    MathQuill: { getInterface(v: number): MQStatic };
    jQuery: any;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// latexToMathjs
// Converts the LaTeX string MathQuill gives us into the plain mathjs syntax
// that MathEvaluator and the graphing engine consume.
//
//   \frac{a}{b}  →  (a)/(b)
//   \sqrt{x}     →  sqrt(x)
//   \sin         →  sin   (same for cos, tan, ln, log, etc.)
//   \pi          →  pi
//   \theta       →  theta
//   x^{2}        →  x^(2)
//   \cdot        →  *
//   \left( \right) → ( )
//   \infty       →  infinity
// ─────────────────────────────────────────────────────────────────────────────

function latexToMathjs(latex: string): string {
  let s = latex.trim();

  // Remove MathQuill cursor/selection artefacts
  s = s.replace(/\\class\{[^}]*\}\{[^}]*\}/g, "");

  // \frac{num}{den} → (num)/(den)  — handle up to 3 levels of nesting
  for (let i = 0; i < 5; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }

  // \sqrt{expr} → sqrt(expr)
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\sqrt\s+/g, "sqrt");

  // \left( and \right) → plain parens
  s = s.replace(/\\left\(/g, "(").replace(/\\right\)/g, ")");
  s = s.replace(/\\left\[/g, "[").replace(/\\right\]/g, "]");
  s = s.replace(/\\left\|/g, "abs(").replace(/\\right\|/g, ")");

  // x^{expr} → x^(expr)
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");

  // Named functions — strip backslash
  const FNS = ["sin","cos","tan","cot","sec","csc","ln","log","exp","arcsin","arccos","arctan"];
  for (const fn of FNS) {
    s = s.replace(new RegExp(`\\\\${fn}\\b`, "g"), fn);
  }

  // Add implicit parens for function calls not followed by (
  // e.g. "sin x" → "sin(x)",  "cos 2x" → "cos(2x)",  "sin x + 1" → "sin(x)"
  // Matches: fn followed by space then a token (variable, number, or paren group)
  for (const fn of FNS) {
    s = s.replace(
      new RegExp(`\\b${fn}\\s+([a-zA-Z0-9_]+|\\([^)]*\\))`, "g"),
      `${fn}($1)`,
    );
  }

  // Greek letters and constants
  s = s
    .replace(/\\pi\b/g,      "pi")
    .replace(/\\theta\b/g,   "theta")
    .replace(/\\alpha\b/g,   "alpha")
    .replace(/\\beta\b/g,    "beta")
    .replace(/\\gamma\b/g,   "gamma")
    .replace(/\\delta\b/g,   "delta")
    .replace(/\\epsilon\b/g, "epsilon")
    .replace(/\\lambda\b/g,  "lambda")
    .replace(/\\mu\b/g,      "mu")
    .replace(/\\omega\b/g,   "omega")
    .replace(/\\phi\b/g,     "phi")
    .replace(/\\sigma\b/g,   "sigma")
    .replace(/\\infty\b/g,   "infinity");

  // Multiplication operators
  s = s.replace(/\\cdot\s*/g, "*").replace(/\\times\s*/g, "*");

  // Strip any remaining unknown latex commands
  s = s.replace(/\\[a-zA-Z]+/g, "");

  // Clean up spaces
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// useMathQuill — loads jQuery (CDN) then MathQuill (npm package via Vite)
// Both are loaded once and cached. Returns MQ interface or null while loading.
// ─────────────────────────────────────────────────────────────────────────────

let _mqPromise: Promise<MQStatic> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function useMathQuill(): MQStatic | null {
  const [mq, setMq] = React.useState<MQStatic | null>(() =>
    window.MathQuill ? window.MathQuill.getInterface(2) : null
  );

  React.useEffect(() => {
    if (mq) return;
    if (!_mqPromise) {
      _mqPromise = (async () => {
        // 1. Load MathQuill CSS from CDN
        if (!document.querySelector('link[data-mq]')) {
          const link = document.createElement("link");
          link.rel  = "stylesheet";
          link.setAttribute("data-mq", "1");
          link.href = "https://cdnjs.cloudflare.com/ajax/libs/mathquill/0.10.1/mathquill.min.css";
          document.head.appendChild(link);
        }
        // 2. Load jQuery from CDN (MathQuill requires it)
        if (!(window as any).jQuery) {
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"
          );
        }
        // 3. Load MathQuill JS from CDN
        await loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/mathquill/0.10.1/mathquill.min.js"
        );
        return window.MathQuill.getInterface(2);
      })();
    }
    _mqPromise.then(setMq).catch(() => { _mqPromise = null; });
  }, [mq]);

  return mq;
}

// ─────────────────────────────────────────────────────────────────────────────
// MathQuillInput
// Drop-in replacement for SmartMathInput.
// Renders a MathQuill MathField inside a styled wrapper.
// onChange receives the plain mathjs string (converted from LaTeX).
// ─────────────────────────────────────────────────────────────────────────────

interface MathQuillInputProps {
  onSubmit:    (val?: string) => void;
  onChange:    (mathjsValue: string) => void;
  onEmpty?:    () => void;
  placeholder?: string;
  disabled?:   boolean;
  className?:  string;
  initialLatex?: string;
  autoFocus?:  boolean;
}

function MathQuillInput({
  onSubmit, onChange, onEmpty, placeholder, disabled, className, initialLatex, autoFocus,
}: MathQuillInputProps) {
  const mq        = useMathQuill();
  const spanRef   = React.useRef<HTMLSpanElement>(null);
  const mqRef     = React.useRef<MQMathField | null>(null);
  const lastVal   = React.useRef("");

  // Keep latest callbacks in refs so MathQuill handlers never capture stale closures.
  const onSubmitRef  = React.useRef(onSubmit);
  const onChangeRef  = React.useRef(onChange);
  const onEmptyRef   = React.useRef(onEmpty);
  onSubmitRef.current  = onSubmit;
  onChangeRef.current  = onChange;
  onEmptyRef.current   = onEmpty;

  // Expose a clear() method via an imperative handle so the parent can
  // clear the MathQuill field visually after a successful submit.
  // We store it on the span element so the parent can call spanRef.current?.__mqClear?.()
  // without needing React.forwardRef complexity.

  // Init MathField once MQ is loaded
  React.useEffect(() => {
    if (!mq || !spanRef.current || mqRef.current) return;

    const field = mq.MathField(spanRef.current, {
      spaceBehavesLikeTab: false,
      autoCommands: "pi theta alpha beta gamma delta epsilon lambda mu omega phi sigma sqrt",
      autoOperatorNames: "sin cos tan cot sec csc ln log exp arcsin arccos arctan",
      handlers: {
        edited: (mathField: MQMathField) => {
          const latex  = mathField.latex();
          const mathjs = latexToMathjs(latex);
          if (mathjs !== lastVal.current) {
            lastVal.current = mathjs;
            onChangeRef.current(mathjs);
            if (!mathjs.trim()) onEmptyRef.current?.();
          }
        },
        enter: () => {
          const val = lastVal.current.trim();
          if (!val) return;
          onSubmitRef.current(val);       // pass live value directly — bypasses state timing
          field.latex("");
          lastVal.current = "";
          onChangeRef.current("");
        },
      },
    });

    mqRef.current = field;

    if (initialLatex) field.latex(initialLatex);
    if (autoFocus)    setTimeout(() => field.focus(), 50);

    return () => {
      try { field.revert(); } catch { /* ignore */ }
      mqRef.current = null;
    };
  }, [mq]); // eslint-disable-line react-hooks/exhaustive-deps

  // If MQ hasn't loaded yet, show a plain input as fallback
  if (!mq) {
    return (
      <span
        className={cn(
          "flex-1 min-w-0 flex items-center px-2 text-xs text-muted-foreground",
          className,
        )}
      >
        Loading…
      </span>
    );
  }

  return (
    <span
      ref={spanRef}
      className={cn(
        // Reset MQ's default styling to match the panel's design
        "mq-nova",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      data-placeholder={placeholder}
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
  const [inputValue, setInputValue] = React.useState("");   // AI mode text / mathjs from MQ
  const [mqValue,    setMqValue]    = React.useState("");   // live mathjs from MathQuill field
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The value to submit depends on mode
  const submitValue = isAIMode ? inputValue : mqValue;

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
  // valueOverride: used by MathQuill's enter handler to pass the live lastVal
  // directly, bypassing React state timing (edited fires setMqValue but React
  // may not have re-rendered before enter fires).
  const handleSubmit = async (valueOverride?: string) => {
    const trimmed = (valueOverride ?? submitValue).trim();
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
      setMqValue("");
      // Note: MathQuill field is cleared visually by the enter handler itself.
      // If submitted via + button, we rely on setMqValue("") to disable the button.
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
          {/* Input row: MathQuillInput (Math) or plain input (AI) */}
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
              // Math mode: MathQuill rich math editor
              <div className="flex-1 min-w-0 min-h-[32px] flex items-center rounded-md border bg-background/50 border-border/60 focus-within:border-primary/50 transition-colors px-2 py-1 overflow-x-auto">
                <MathQuillInput
                  onChange={(val) => setMqValue(val)}
                  onEmpty={() => setMqValue("")}
                  onSubmit={handleSubmit}
                  placeholder="y = x^2"
                  disabled={isLoading}
                  autoFocus={false}
                />
              </div>
            )}

            {/* Submit button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => handleSubmit()}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
              disabled={!submitValue.trim() || isLoading}
            >
              {isLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Plus className="w-3 h-3" />
              }
            </Button>
          </div>

          {/* Shortcut hint — Math mode only */}
          {!isAIMode && !mqValue && (
            <p className="text-[10px] text-muted-foreground/60 leading-tight px-0.5">
              type ^ for exponent · / for fraction · pi, theta, sqrt auto-render
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
              // Delete all non-primary group members — the edited equation
              // will have groupId cleared by handleEdit, so it stands alone.
              // The MathEvaluator handles y² forms internally (two evaluators
              // per CurveEntry), so we don't need two separate equations anymore.
              group.slice(1).forEach((eq) => onDelete(eq.id));
              onEdit(primary.id, val);
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
  const [isEditing, setIsEditing] = React.useState(false);
  const editValueRef = React.useRef(equation.expression);

  const startEdit = () => {
    editValueRef.current = equation.expression;
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValueRef.current.trim();
    if (trimmed && trimmed !== equation.expression) {
      onEdit(equation.id, trimmed);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0 min-h-[24px] flex items-center rounded border bg-muted/50 border-border px-1.5 py-0.5 overflow-x-auto focus-within:border-primary/50">
          <MathQuillInput
            onChange={(val) => { editValueRef.current = val; }}
            onSubmit={commitEdit}
            initialLatex={equation.expression}
            autoFocus
          />
        </div>
        <button onClick={commitEdit} className="text-primary shrink-0">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={cancelEdit} className="text-muted-foreground shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="cursor-text hover:bg-muted/30 rounded px-1 py-0.5 transition-colors overflow-hidden"
      onClick={startEdit}
      title="Click to edit"
      dangerouslySetInnerHTML={{ __html: renderKatex(equation.expression) }}
    />
  );
}