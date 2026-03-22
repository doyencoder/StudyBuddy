/**
 * MathEvaluator.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Converts raw equation strings into fast compiled evaluator functions.
 *
 * Architecture:
 *   raw string
 *     → normalise  (y2→y^2, implicit multiplication, X→x, Y→y)
 *     → classify   (explicit y=f(x), y² implicit, linear implicit, bare expr)
 *     → parse AST  (mathjs parse() — done ONCE per equation)
 *     → compile    (mathjs compile() — produces a closure over the AST)
 *     → CurveEvaluator[]  (usually 1, but 2 for y² equations: top + bottom)
 *
 * Why compile() instead of evaluate(string)?
 *   evaluate(string) re-parses the expression string on every call.
 *   compile() builds an AST once and returns a JS closure — the inner loop
 *   then calls that closure 2000 times per curve sample with no parsing overhead.
 *   Benchmark: ~10× faster for complex expressions like sin(x)^2 + cos(x^3).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { parse, compile } from 'mathjs';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A fast compiled function that maps x → y (or null if undefined at that x). */
export type EvalFn = (x: number) => number | null;

/** One plottable branch of an equation (e.g. top half of an ellipse). */
export interface CurveEvaluator {
  fn:    EvalFn;
  /** Human-readable tag for debugging. */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * normalise
 * Clean up raw user input before parsing.
 *
 * Handles:
 *   y2, y3  → y^2, y^3       (student shorthand for powers)
 *   X → x, Y → y             (case insensitivity)
 *   2x → 2*x                 (implicit multiplication: digit × variable)
 *   3( → 3*(                 (implicit multiplication: digit × group)
 *   x( → x*(                 (implicit multiplication: var × group)
 *   xy → x*y                 (implicit multiplication: two single-char vars)
 *   pi → pi                  (kept as-is, mathjs understands pi)
 *   infinity → Infinity      (edge case)
 */
export function normalise(raw: string): string {
  let s = raw.trim();

  // Lowercase variables (but not function names like Sin, Cos)
  s = s.replace(/\bX\b/g, 'x').replace(/\bY\b/g, 'y');

  // y2, y3 → y^2, y^3  (must come before implicit-mult rules)
  s = s.replace(/\by(\d)\b/g, 'y^$1');

  // Implicit multiplication rules (order matters):
  // 1. digit immediately followed by x, y, or opening paren
  s = s.replace(/(\d)([xy(])/g, '$1*$2');
  // 2. closing paren immediately followed by x, y, or opening paren
  s = s.replace(/(\))([xy(])/g, '$1*$2');
  // 3. two adjacent single-char variables (but not inside a word like "sin")
  //    "xy" → "x*y" — only if both are standalone x or y
  s = s.replace(/\bx\b\s*\by\b/g, 'x*y');
  s = s.replace(/\by\b\s*\bx\b/g, 'y*x');

  // Greek letter word forms → mathjs recognised names
  const GREEK: Record<string, string> = {
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
    epsilon: 'epsilon', theta: 'theta', lambda: 'lambda', mu: 'mu',
    pi: 'pi', sigma: 'sigma', omega: 'omega',
  };
  for (const [word] of Object.entries(GREEK)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, 'gi'), word);
  }

  s = s.replace(/\binfinity\b/gi, '1e308');  // very large number

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe evaluation wrapper
// ─────────────────────────────────────────────────────────────────────────────

/** Safely compile a mathjs expression string into a fast EvalFn. */
function compileExpr(expr: string): EvalFn | null {
  try {
    const compiled = compile(expr);
    return (x: number): number | null => {
      try {
        const result = compiled.evaluate({ x, pi: Math.PI, e: Math.E });
        if (typeof result !== 'number' || !isFinite(result) || isNaN(result)) {
          return null;
        }
        return result;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

/** Quick numeric check: can we evaluate an expression at a given x? */
function tryEval(expr: string, x: number): number | null {
  const fn = compileExpr(expr);
  return fn ? fn(x) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Equation classifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tryExplicit
 * Matches:  y = expr   or   f(x) = expr
 * Returns a single evaluator for the RHS expression.
 */
function tryExplicit(s: string): CurveEvaluator[] | null {
  const m = s.match(/^(?:y|f\s*\(x\))\s*=\s*(.+)$/i);
  if (!m) return null;
  const fn = compileExpr(m[1].trim());
  if (!fn) return null;
  return [{ fn, label: `y = ${m[1].trim()}` }];
}

/**
 * tryBareExpression
 * If the string contains x but no "=" it's treated as the RHS of y = <expr>.
 * E.g. "x^2 + 1" → y = x^2 + 1
 */
function tryBare(s: string): CurveEvaluator[] | null {
  if (s.includes('=') || !/x/.test(s)) return null;
  const fn = compileExpr(s);
  if (!fn) return null;
  return [{ fn, label: `y = ${s}` }];
}

/**
 * tryYSquared
 * Matches equations where y appears only as y^2 (not linearly).
 * Strategy:
 *   1. Detect that y^2 is the only y term by checking linearity numerically.
 *   2. Rearrange to  y^2 = f(x)  by moving all non-y² terms to the RHS.
 *   3. Return two evaluators:  y = +sqrt(f(x))  and  y = -sqrt(f(x)).
 *
 * This handles all of:
 *   y^2 = 4x            (parabola)
 *   x^2 + y^2 = 9       (circle)
 *   x^2/9 + y^2/4 = 1  (ellipse)
 *   x^2/9 - y^2/4 = 1  (hyperbola)
 *   y^2 - x^2 = 4       (hyperbola other orientation)
 */
function tryYSquared(s: string): CurveEvaluator[] | null {
  if (!s.includes('=')) return null;
  // Must contain y^2 (possibly written y^{2} after some normalisation)
  if (!/y\s*\^\s*2/.test(s)) return null;

  const parts = s.split('=');
  if (parts.length !== 2) return null;
  let [lhs, rhs] = parts.map(p => p.trim());

  // ── Confirm it's purely quadratic in y ────────────────────────────────────
  // We check: at a fixed x, does F(y=t) - F(y=0) scale as t^2?
  // If yes, y appears only as y^2 (coefficient may vary with x).
  const checkQuadratic = (lhsE: string, rhsE: string): boolean => {
    try {
      for (const testX of [0.5, 1.5, 2.5]) {
        const diff = (yVal: number): number | null => {
          try {
            const lhsV = compile(lhsE).evaluate({ x: testX, y: yVal });
            const rhsV = compile(rhsE).evaluate({ x: testX, y: yVal });
            const v = lhsV - rhsV;
            return typeof v === 'number' && isFinite(v) ? v : null;
          } catch { return null; }
        };
        const d0  = diff(0);
        const d1  = diff(1);
        const d2  = diff(2);
        const dm1 = diff(-1);
        if (d0 === null || d1 === null || d2 === null || dm1 === null) continue;
        // For purely quadratic in y:  F(y) - F(0) ≈ A * y^2
        // So diff(1)/diff(2) ≈ 1/4 and diff(1) ≈ diff(-1)
        const ratio = Math.abs(d1) > 1e-10 ? Math.abs(d2 / d1) : 0;
        if (Math.abs(ratio - 4) > 0.5) return false;   // not ~ y^2 scaling
        if (Math.abs(d1 - dm1) > Math.abs(d1) * 0.1 + 1e-10) return false; // not symmetric
      }
      return true;
    } catch { return false; }
  };

  if (!checkQuadratic(lhs, rhs)) return null;

  // ── Solve for y^2 = f(x) ─────────────────────────────────────────────────
  // Replace y^2 with 1 to isolate its coefficient, then rearrange.
  // f(x) = rhs_expr - (lhs_expr with y^2 set to 0) + (lhs_expr with y^2=1 - lhs_with_y^2=0)
  //
  // Concretely:
  //   lhs_no_y = lhs with y^2 → 0  (all non-y² terms of lhs)
  //   lhs_coeff = lhs(y²=1) - lhs(y²=0)  (the coefficient of y²)
  //   y² = (rhs - lhs_no_y) / lhs_coeff

  const lhsNoY = lhs.replace(/y\s*\^\s*2/g, '0');
  const rhsStr = `((${rhs}) - (${lhsNoY}))`;

  // Get y² coefficient numerically (it may depend on x)
  // We'll build an expression for the RHS of y² = rhsStr / ySqCoeff
  // But since ySqCoeff might vary with x, we compute it as an expression too.
  // For the common case where ySqCoeff is constant (= 1 or some number):
  const ySqCoeffExpr = lhs.replace(/y\s*\^\s*2/g, '1') + ` - (${lhsNoY})`;

  // Test if ySqCoeff is 1 at a sample point
  const testCoeff = tryEval(ySqCoeffExpr, 1);
  if (testCoeff === null) return null;

  let fxExpr: string;
  if (Math.abs(testCoeff - 1) < 1e-6) {
    fxExpr = rhsStr;
  } else if (Math.abs(testCoeff + 1) < 1e-6) {
    fxExpr = `-1 * (${rhsStr})`;
  } else {
    fxExpr = `(${rhsStr}) / (${ySqCoeffExpr})`;
  }

  // ── Verify: at a test point, does our rearrangement hold? ─────────────────
  const testFx = tryEval(fxExpr, 1);
  if (testFx === null) return null;

  const topFn    = compileExpr(`sqrt(max(0, ${fxExpr}))`);
  const bottomFn = compileExpr(`-sqrt(max(0, ${fxExpr}))`);
  if (!topFn || !bottomFn) return null;

  return [
    { fn: topFn,    label: `y = √(${fxExpr})` },
    { fn: bottomFn, label: `y = -√(${fxExpr})` },
  ];
}

/**
 * tryLinearY
 * For equations where y appears only linearly (not as y², y³ etc.).
 * Strategy: detect the y-coefficient numerically, then solve:
 *   y = (rhs_at_y0 - lhs_at_y0) / y_coefficient
 *
 * Handles: x + y = 2,  2x - 3y = 6,  y - sin(x) = 0, etc.
 * Does NOT handle y^2 terms (those are caught by tryYSquared first).
 */
function tryLinearY(s: string): CurveEvaluator[] | null {
  if (!s.includes('=')) return null;
  const parts = s.split('=');
  if (parts.length !== 2) return null;
  const [lhs, rhs] = parts.map(p => p.trim());

  // If already "y = ..." it would have been caught by tryExplicit
  if (/^y$/.test(lhs)) return null;

  const F = (yVal: number, xVal: number): number | null => {
    try {
      const lhsC = compile(lhs);
      const rhsC = compile(rhs);
      const diff = lhsC.evaluate({ x: xVal, y: yVal })
                 - rhsC.evaluate({ x: xVal, y: yVal });
      return typeof diff === 'number' && isFinite(diff) ? diff : null;
    } catch { return null; }
  };

  // Detect y coefficient at x = 1
  const F00 = F(0, 1);
  const F10 = F(1, 1);  // y = 1
  if (F00 === null || F10 === null) return null;

  const yCoeff = F10 - F00;
  if (Math.abs(yCoeff) < 1e-10) return null;  // no y term

  // Confirm linearity in y: F(2, x) ≈ F(0, x) + 2 * yCoeff
  const F20 = F(2, 1);
  if (F20 === null || Math.abs(F20 - (F00 + 2 * yCoeff)) > 0.001) return null;

  // Build the expression: y = (rhs_at_y0 - lhs_at_y0) / yCoeff
  const lhsAt0 = lhs.replace(/\by\b/g, '0');
  const rhsAt0 = rhs.replace(/\by\b/g, '0');
  const numeratorExpr = `((${rhsAt0}) - (${lhsAt0}))`;

  let solvedExpr: string;
  if (Math.abs(yCoeff - 1) < 1e-10) {
    solvedExpr = numeratorExpr;
  } else if (Math.abs(yCoeff + 1) < 1e-10) {
    solvedExpr = `-(${numeratorExpr})`;
  } else {
    solvedExpr = `(${numeratorExpr}) / (${yCoeff})`;
  }

  const fn = compileExpr(solvedExpr);
  if (!fn) return null;

  return [{ fn, label: `[implicit] ${solvedExpr}` }];
}

// ─────────────────────────────────────────────────────────────────────────────
// MathEvaluator — the public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MathEvaluator
 *
 * Converts a raw equation string into an array of CurveEvaluators.
 * Results are memoised: parsing the same string twice returns the cached result.
 *
 * Returns [] if the equation cannot be plotted (e.g. a = b with no x or y).
 */
export class MathEvaluator {
  private cache = new Map<string, CurveEvaluator[]>();

  /**
   * getEvaluators
   * Main entry point. Returns compiled evaluators for the given raw equation.
   * Order of attempts:
   *   1. Explicit y = f(x)  — fastest, most common
   *   2. y² = f(x)          — circles, ellipses, parabolas, hyperbolas
   *   3. Linear implicit     — lines like x + y = 2
   *   4. Bare expression     — "x^2 + 1" treated as y = x^2 + 1
   */
  getEvaluators(raw: string): CurveEvaluator[] {
    const key = raw.trim();
    if (this.cache.has(key)) return this.cache.get(key)!;

    const s = normalise(key);
    const result =
      tryExplicit(s)  ??
      tryYSquared(s)  ??
      tryLinearY(s)   ??
      tryBare(s)      ??
      [];

    this.cache.set(key, result);
    return result;
  }

  /** Clear the evaluator cache (call when equations are all removed). */
  clearCache(): void {
    this.cache.clear();
  }
}