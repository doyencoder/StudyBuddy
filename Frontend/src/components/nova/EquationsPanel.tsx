import * as React from "react";
import {
  Trash2, Plus, MessageSquare, Mic,
  Sparkles, Calculator, Loader2, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/config/api";
import { normalizeEquationForNova } from "@/lib/novaMath";
import katex from "katex";
import "katex/dist/katex.min.css";
import "mathquill/build/mathquill.css";

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
  "nova-curve-1":  { backgroundColor: "hsl(var(--nova-curve-1))" },
  "nova-curve-2":  { backgroundColor: "hsl(var(--nova-curve-2))" },
  "nova-curve-3":  { backgroundColor: "hsl(var(--nova-curve-3))" },
  "nova-curve-4":  { backgroundColor: "hsl(var(--nova-curve-4))" },
  "nova-curve-5":  { backgroundColor: "hsl(var(--nova-curve-5))" },
  "nova-curve-6":  { backgroundColor: "hsl(var(--nova-curve-6))" },
  "nova-curve-7":  { backgroundColor: "hsl(var(--nova-curve-7))" },
  "nova-curve-8":  { backgroundColor: "hsl(var(--nova-curve-8))" },
  "nova-curve-9":  { backgroundColor: "hsl(var(--nova-curve-9))" },
  "nova-curve-10": { backgroundColor: "hsl(var(--nova-curve-10))" },
  "nova-curve-11": { backgroundColor: "hsl(var(--nova-curve-11))" },
  "nova-curve-12": { backgroundColor: "hsl(var(--nova-curve-12))" },
  "nova-curve-13": { backgroundColor: "hsl(var(--nova-curve-13))" },
  "nova-curve-14": { backgroundColor: "hsl(var(--nova-curve-14))" },
  "nova-curve-15": { backgroundColor: "hsl(var(--nova-curve-15))" },
  "nova-curve-16": { backgroundColor: "hsl(var(--nova-curve-16))" },
  "nova-curve-17": { backgroundColor: "hsl(var(--nova-curve-17))" },
  "nova-curve-18": { backgroundColor: "hsl(var(--nova-curve-18))" },
  "nova-curve-19": { backgroundColor: "hsl(var(--nova-curve-19))" },
  "nova-curve-20": { backgroundColor: "hsl(var(--nova-curve-20))" },
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
  s = s.replace(/abs\(([^()]+)\)/g, (_, inner) => `\\left|${latexifyExpr(inner)}\\right|`);
  s = s.replace(
    /\b(pi|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega)\s*\/\s*([\w.]+)/gi,
    (_, n, d) => `\\frac{${n}}{${d}}`,
  );
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
  s = s.replace(
    /(^|[^\\])frac(pi|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega)(\d+(?:\.\d+)?)/gi,
    (_, prefix, constant, denominator) =>
      `${prefix}\\frac{${GREEK[constant.toLowerCase()] ?? constant}}{${denominator}}`,
  );
  // Exponents first so x^2/9 becomes x^{2}/9 instead of x^{2/9}
  s = s.replace(/\^(\d+)/g, "^{$1}");
  s = s.replace(/\^\(([^)]+)\)/g, "^{$1}");
  // Fractions: multiple passes handles nested cases
  for (let pass = 0; pass < 4; pass++) {
    // powered variable / term  → \frac{x^{2}}{9}
    s = s.replace(
      /(^|[^\\a-zA-Z])([a-zA-Z](?:\^\{[^{}]+\})?)\s*\/\s*([\w.]+)/g,
      (_, prefix, n, d) => `${prefix}\\frac{${n}}{${d}}`,
    );
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
  // Multiplication: * → ·  (cdot, not ×)
  s = s.replace(/\s*\*\s*/g, " \\cdot ");
  // Clean up extra spaces
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeAIError(raw: string): string {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (!text) {
    return "Ask for a graph or equation, like 'y = x^2', 'ellipse', or 'sine wave'.";
  }

  if (
    lower.includes("content filtered")
    || lower.includes("responsibleaipolicyviolation")
    || lower.includes("filtered due to")
  ) {
    return "That request can't be turned into a graph here. Try a math prompt like 'unit circle' or 'y = sin(x)'.";
  }

  if (lower.includes("could not parse ai response") || lower.includes("parse")) {
    return "I couldn't turn that into a graph. Try a direct equation or graph request like 'parabola' or 'y = 2x + 1'.";
  }

  if (lower.includes("i can only graph math equations")) {
    return "Ask for something graphable, like 'ellipse', 'parabola', 'unit circle', or 'y = x^2'.";
  }

  return "Nova AI works best with graph requests. Try 'sine wave', 'parabola', or a direct equation like 'y = x^2'.";
}

function toLatex(raw: string): string {
  const s = normalizeEquationForNova(raw);
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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderKatex(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const html = katex.renderToString(toLatex(raw), {
      throwOnError: false,
      displayMode: false,
      output: "html",
    });
    if (html.includes("katex-error")) {
      return `<span class="font-mono text-xs">${escapeHtml(normalizeEquationForNova(raw))}</span>`;
    }
    return html;
  } catch {
    return `<span class="font-mono text-xs">${escapeHtml(normalizeEquationForNova(raw))}</span>`;
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
        // Prefer local bundled dependencies so Math mode works even when CDN is blocked.
        try {
          if (!window.MathQuill) {
            const jqueryModule = await import("jquery");
            const jq = (jqueryModule as any).default ?? jqueryModule;
            (window as any).jQuery = jq;
            (window as any).$ = jq;
            await import("mathquill/build/mathquill.js");
          }

          if (window.MathQuill) {
            return window.MathQuill.getInterface(2);
          }
        } catch {
          // Fall back to CDN loading if local bundling fails for any reason.
        }

        if (!(window as any).jQuery) {
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"
          );
        }
        await loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/mathquill/0.10.1/mathquill.min.js"
        );
        if (!window.MathQuill) {
          throw new Error("MathQuill failed to load");
        }
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
  const [fallbackValue, setFallbackValue] = React.useState(() =>
    initialLatex ? latexToMathjs(initialLatex) : "",
  );

  // Keep latest callbacks in refs so MathQuill handlers never capture stale closures.
  const onSubmitRef  = React.useRef(onSubmit);
  const onChangeRef  = React.useRef(onChange);
  const onEmptyRef   = React.useRef(onEmpty);
  onSubmitRef.current  = onSubmit;
  onChangeRef.current  = onChange;
  onEmptyRef.current   = onEmpty;

  React.useEffect(() => {
    setFallbackValue(initialLatex ? latexToMathjs(initialLatex) : "");
  }, [initialLatex]);

  const submitFallback = React.useCallback(() => {
    const value = fallbackValue.trim();
    if (!value) return;
    onSubmitRef.current(value);
    setFallbackValue("");
    lastVal.current = "";
    onChangeRef.current("");
    onEmptyRef.current?.();
  }, [fallbackValue]);

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

  // If MQ hasn't loaded yet (CDN offline or first load), show a working plain input
  if (!mq) {
    return (
      <input
        value={fallbackValue}
        onChange={(event) => {
          const next = event.target.value;
          setFallbackValue(next);
          lastVal.current = next;
          onChangeRef.current(next);
          if (!next.trim()) onEmptyRef.current?.();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submitFallback();
        }}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className={cn(
          "flex-1 min-w-0 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/60",
          className,
        )}
      />
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
  const [isListening, setIsListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const recognitionRef = React.useRef<any | null>(null);
  const baseTextRef = React.useRef("");

  // Reactive online status (navigator.onLine alone doesn't trigger re-renders)
  const [online, setOnline] = React.useState(navigator.onLine);
  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => { setOnline(false); setIsAIMode(false); }; // auto-switch to Math
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Prefetch MathQuill CDN scripts on mount so they're ready when the user
  // navigates to Nova — avoids the "Loading…" flash on first visit.
  useMathQuill();

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4200);
    return () => window.clearTimeout(timer);
  }, [error]);

  React.useEffect(() => {
    if (isAIMode) return;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [isAIMode]);

  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

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
          setError(normalizeAIError(String(data.error)));
          return;
        }
        if (!data.equations || data.equations.length === 0) {
          setError(normalizeAIError("I can only graph math equations."));
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
        setError("I couldn't reach Nova AI right now. Try again with a graph request like 'ellipse' or 'y = x^2'.");
      } finally {
        setIsLoading(false);
      }
    } else {
      // Math mode: add the raw expression directly
      onAddEquations([trimmed], "");
      setInputValue("");
      setMqValue("");
    }
  };

  const toggleListening = () => {
    if (!isAIMode || !online || isLoading) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError("Your browser doesn't support speech input. Try Chrome or Edge.");
      return;
    }

    const recognition: any = new SpeechRecognitionAPI();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseTextRef.current = inputValue;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }

      if (final) {
        baseTextRef.current = `${baseTextRef.current} ${final}`.trim();
      }

      setInputValue(`${baseTextRef.current} ${interim}`.trim());
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      const msgs: Record<string, string> = {
        "language-not-supported": "Speech input is not supported for this language.",
        "not-allowed": "Microphone access denied.",
        "no-speech": "No speech detected.",
        network: "Network error during speech recognition.",
      };
      setError(msgs[event.error] ?? "Speech recognition error. Try typing instead.");
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
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
    <div className="flex flex-col w-full h-full bg-card/95 border-t border-border/80 backdrop-blur-sm md:border-r md:border-t-0">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 h-11 border-b border-border/70 shrink-0 bg-background/25">
        <span className="text-[11px] font-semibold text-foreground uppercase tracking-[0.18em]">
          Equations
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{equations.length}</span>
      </div>

      {/* ── Equation list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-2.5 px-2.5 space-y-1.5">
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
            <div className="flex items-center gap-2 py-1.5 px-1">
              <div className="h-px flex-1 bg-border/70" />
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 h-4 border-dashed text-muted-foreground gap-1 bg-background/60"
              >
                <MessageSquare className="w-2 h-2" />
                from chat
              </Badge>
              <div className="h-px flex-1 bg-border/70" />
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
          <p className="text-xs text-muted-foreground text-center py-8 leading-relaxed px-3">
            No equations yet.
            <br />
            Add one below.
          </p>
        )}
      </div>

      {/* ── Input section ───────────────────────────────────────────────────── */}
      <div className="border-t border-border/70 shrink-0 bg-background/35">

        {/* Math / AI mode toggle */}
        <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1.5">
          <button
            onClick={() => setIsAIMode(false)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors flex-1 justify-center",
              !isAIMode
                ? "bg-background text-foreground border border-border shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Calculator className="w-3 h-3" />
            Math
          </button>
          <button
            onClick={() => { if (online) setIsAIMode(true); }}
            disabled={!online}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors flex-1 justify-center",
              !online
                ? "text-muted-foreground/40 cursor-not-allowed"
                : isAIMode
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
            )}
            title={!online ? "AI mode requires internet" : undefined}
          >
            {!online ? <WifiOff className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            AI
          </button>
        </div>

        <div className="px-2.5 pb-2.5 space-y-1.5">
          {/* Input row: MathQuillInput (Math) or plain input (AI) */}
          <div className="flex items-center gap-1.5">
            {isAIMode ? (
              // AI mode: plain text input, no math interception
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="Describe the graph..."
                className="flex-1 min-w-0 h-9 px-3 text-xs font-mono rounded-lg border bg-primary/5 border-primary/25 outline-none focus:border-primary/50 transition-colors"
                disabled={isLoading}
                spellCheck={false}
              />
            ) : (
              // Math mode: MathQuill rich math editor
              <div className="flex-1 min-w-0 min-h-[38px] flex items-center rounded-lg border bg-background/70 border-border/60 focus-within:border-primary/50 transition-colors px-2.5 py-1.5 overflow-x-auto shadow-sm">
                <MathQuillInput
                  onChange={(val) => setMqValue(val)}
                  onEmpty={() => setMqValue("")}
                  onSubmit={handleSubmit}
                  placeholder="y = x^2"
                  disabled={isLoading}
                  initialLatex={mqValue}
                  autoFocus={false}
                />
              </div>
            )}

            {isAIMode ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={toggleListening}
                className={cn(
                  "h-8 w-8 shrink-0 rounded-lg",
                  isListening
                    ? "text-destructive bg-destructive/10 hover:bg-destructive/15"
                    : "text-muted-foreground hover:text-primary hover:bg-background/70",
                )}
                disabled={isLoading || !online}
                title={isListening ? "Stop voice input" : "Start voice input"}
              >
                <Mic className={cn("w-3 h-3", isListening && "animate-pulse")} />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => handleSubmit()}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary hover:bg-background/70 rounded-lg"
                disabled={!submitValue.trim() || isLoading}
              >
                {isLoading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Plus className="w-3 h-3" />
                }
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 shadow-sm">
              <p className="text-[10px] font-medium text-destructive leading-tight">
                Nova AI only handles graph and equation requests.
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                {error}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EquationGroupRow
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

  const handleDeleteGroup = () => group.forEach((eq) => onDelete(eq.id));
  const handleToggleGroup = () => group.forEach((eq) => onToggleVisibility(eq.id));

  const hasDisplay = !!primary.displayExpression;

  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-2.5 py-2 rounded-lg border border-border/35 bg-background/35 transition-colors hover:bg-background/65 hover:border-border/55",
        isFromChat && "bg-primary/[0.035] border-primary/20",
        !allVisible && "opacity-40",
      )}
    >
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0 mt-[6px] transition-transform group-hover:scale-110 cursor-pointer"
        style={colorDotStyle[primary.color] ?? { backgroundColor: "hsl(var(--primary))" }}
        onClick={handleToggleGroup}
        title={allVisible ? "Hide" : "Show"}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        {hasDisplay ? (
          <EditableEquation
            equation={{ ...primary, expression: primary.displayExpression! }}
            onEdit={(_id, val) => {
              group.slice(1).forEach((eq) => onDelete(eq.id));
              onEdit(primary.id, val);
            }}
          />
        ) : (
          group.map((eq) => (
            <EditableEquation key={eq.id} equation={eq} onEdit={onEdit} />
          ))
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
        <button
          onClick={handleDeleteGroup}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
  const editorRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    if (!isEditing) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (editorRef.current?.contains(event.target as Node)) return;
      cancelEdit();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditing]);

  if (isEditing) {
    return (
      <div
        ref={editorRef}
        className="flex-1 min-w-0 min-h-[34px] flex items-center rounded-lg border bg-background/85 border-primary/30 px-2 py-1 overflow-x-auto shadow-sm focus-within:border-primary/55"
      >
          <MathQuillInput
            onChange={(val) => { editValueRef.current = val; }}
            onSubmit={commitEdit}
            initialLatex={equation.expression}
            autoFocus
          />
      </div>
    );
  }

  return (
    <div
      className="cursor-text hover:bg-muted/25 rounded-md px-1.5 py-1 transition-colors overflow-hidden"
      onClick={startEdit}
      title="Click to edit"
      dangerouslySetInnerHTML={{ __html: renderKatex(equation.expression) }}
    />
  );
}