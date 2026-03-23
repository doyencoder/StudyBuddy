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
export type ResidualFn = (x: number, y: number) => number | null;

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
  const functionNames = ['arcsin', 'arccos', 'arctan', 'sqrt', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'abs'];
  const functionPattern = functionNames.join('|');
  const constantNames = ['pi', 'e', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'lambda', 'mu', 'sigma', 'omega'];
  const constantPattern = constantNames.join('|');
  const compactFunctionArgPattern = `(?:\\([^()]*\\)|${constantPattern}|[xy]|\\d+(?:\\.\\d+)?(?:[xy])?)`;

  // Nova only supports x/y variables, so fold them aggressively to lowercase.
  s = s.replace(/X/g, 'x').replace(/Y/g, 'y');

  for (const fn of functionNames) {
    s = s.replace(new RegExp(`\\b${fn}\\b`, 'gi'), fn);
  }
  for (const constant of constantNames) {
    s = s.replace(new RegExp(`\\b${constant}\\b`, 'gi'), constant);
  }

  // Strip parentheses from simple numeric exponents that MathQuill emits:
  // x^(2) → x^2,  y^(4) → y^4,  x^(10) → x^10
  // This normalises MathQuill LaTeX output (^{n} → ^(n) via latexToMathjs)
  // so that all downstream regexes can use the plain x^n form.
  s = s.replace(/\^\((\d+)\)/g, '^$1');

  // y2, y3 → y^2, y^3  (must come before implicit-mult rules)
  s = s.replace(/\by(\d)\b/g, 'y^$1');

  // Cross-multiply simple quotient equations so singular denominators don't
  // confuse the implicit renderer. Examples:
  //   x / y = 1     →   x = 1 * y
  //   2 / y = x     →   2 = x * y
  //   x / y^2 = 1   →   x = 1 * y^2
  const rewriteSimpleQuotient = (expr: string): string => {
    if (!expr.includes('=')) return expr;
    const parts = expr.split('=');
    if (parts.length !== 2) return expr;
    const [lhs, rhs] = parts.map((p) => p.trim());
    const quotientPattern = /^(.+?)\s*\/\s*\(?\s*([xy](?:\s*\^\s*\d+)?)\s*\)?$/;

    const lhsMatch = lhs.match(quotientPattern);
    if (lhsMatch) {
      return `(${lhsMatch[1].trim()}) = (${rhs}) * (${lhsMatch[2].trim()})`;
    }

    const rhsMatch = rhs.match(quotientPattern);
    if (rhsMatch) {
      return `(${lhs}) * (${rhsMatch[2].trim()}) = (${rhsMatch[1].trim()})`;
    }

    return expr;
  };
  s = rewriteSimpleQuotient(s);

  // Dot used as multiplication: x.y → x*y, 2.x → 2*x
  // Must come BEFORE the implicit multiplication rules to avoid double-conversion
  s = s.replace(/([a-zA-Z0-9])\s*\.\s*([a-zA-Z])/g, '$1*$2');

  const applyCompactFunctionPass = (input: string): string => {
    let next = input;

    // Insert explicit multiplication before recognised function names:
    //   xsinx -> x*sinx, 2tan(x) -> 2*tan(x), )logx -> )*logx
    next = next.replace(new RegExp(`([0-9xy)])\\s*(${functionPattern})(?=[a-zA-Z0-9(])`, 'g'), '$1*$2');
    next = next.replace(new RegExp(`(${constantPattern})\\s*(${functionPattern})(?=[a-zA-Z0-9(])`, 'g'), '$1*$2');
    next = next.replace(new RegExp(`([0-9xy)])\\s*(${constantPattern})\\b`, 'g'), '$1*$2');
    next = next.replace(new RegExp(`(${constantPattern})\\s*([xy(])`, 'g'), '$1*$2');

    // Compact bare function calls:
    //   sinx -> sin(x), tan2x -> tan(2x), log10 -> log(10), sinpi -> sin(pi)
    for (const fn of functionNames) {
      next = next.replace(
        new RegExp(`\\b${fn}(?!\\s*\\()\\s*(${compactFunctionArgPattern})`, 'g'),
        `${fn}($1)`,
      );
    }

    return next;
  };

  // Run a few normalisation passes so chained compact input stabilises:
  //   xsinx      -> x*sin(x)
  //   xtanx      -> x*tan(x)
  //   sinxcosx   -> sin(x)*cos(x)
  //   2sin3x     -> 2*sin(3*x)
  for (let pass = 0; pass < 4; pass++) {
    const next = applyCompactFunctionPass(s);
    if (next === s) break;
    s = next;
  }

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

  // ── Fractional exponent real-valued fix ───────────────────────────────────
  // mathjs treats x^(p/q) as complex for negative x (principal complex root).
  // We want the real-valued interpretation:
  //   even numerator: x^(p/q) = |x|^(p/q)          (always positive, symmetric)
  //   odd numerator:  x^(p/q) = sign(x)*|x|^(p/q)  (preserves sign)
  // Replace: x^(p/q) or y^(p/q) with abs-based expressions.
  // Also handles the MathQuill output x^((p)/(q)) form.
  const fractionalPow = (base: string, num: string, den: string): string => {
    const n = parseInt(num, 10);
    const expr = `(${num})/(${den})`;
    if (n % 2 === 0) {
      return `(abs(${base})^(${expr}))`;
    } else {
      return `(sign(${base})*abs(${base})^(${expr}))`;
    }
  };
  // Match: var^(num/den) or var^((num)/(den))
  s = s.replace(/\b([xy])\s*\^\s*\(\s*\(?(\d+)\)?\s*\/\s*\(?(\d+)\)?\s*\)/g,
    (_, base, num, den) => fractionalPow(base, num, den));

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
  // i.e. (F(2)-F(0)) / (F(1)-F(0)) ≈ 4  and  F(-1)-F(0) ≈ F(1)-F(0)
  //
  // IMPORTANT: we use F(y)-F(0) (relative to y=0), NOT F(y) directly.
  // Using F(y) directly fails whenever there's a constant offset in the equation
  // (e.g. x^2/9 + y^2/4 = 5 has a large constant -5 that drowns the y^2 signal).
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

        // Use relative values: subtract the y=0 baseline so constant offsets cancel
        const r1  = d1 - d0;   // F(1) - F(0) ≈ A
        const r2  = d2 - d0;   // F(2) - F(0) ≈ 4A
        const rm1 = dm1 - d0;  // F(-1) - F(0) ≈ A  (symmetric)

        if (Math.abs(r1) < 1e-10) continue;  // no y variation at this testX, skip

        const ratio = r2 / r1;
        if (Math.abs(ratio - 4) > 0.5) return false;  // not ~y^2 scaling

        const symRatio = rm1 / r1;
        if (Math.abs(symRatio - 1) > 0.1) return false;  // not symmetric in y
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

  // Compile the inner expression once. We do NOT wrap with sqrt(max(0, ...))
  // because that would return 0 for out-of-domain x values (e.g. x > 1 for a
  // unit circle), producing a flat y=0 tail on the curve instead of a clean
  // endpoint. Instead we return null when the inner expression is negative,
  // which tells sampleCurve to break the segment at the natural domain boundary.
  const fxFnRaw = compileExpr(fxExpr);
  if (!fxFnRaw) return null;

  const topFn: EvalFn = (x: number) => {
    const v = fxFnRaw(x);
    if (v === null || v < 0) return null;   // outside domain → null, not 0
    return Math.sqrt(v);
  };
  const bottomFn: EvalFn = (x: number) => {
    const v = fxFnRaw(x);
    if (v === null || v < 0) return null;
    return -Math.sqrt(v);
  };

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

  // ── Confirm the y-coefficient is CONSTANT across x values ─────────────────
  // If yCoeff varies with x (e.g. y/x = 1 where coeff = 1/x), the solution
  // yCoeff_at_x1 is wrong for other x values → curve renders as y=const.
  // Test: recompute yCoeff at x=2 and x=3 and ensure they match x=1.
  for (const testX of [2, 3, 0.5]) {
    const fa = F(0, testX);
    const fb = F(1, testX);
    if (fa === null || fb === null) continue;
    const coeffAtX = fb - fa;
    if (!isFinite(coeffAtX)) return null;  // x/y type: coefficient is 1/x → non-finite at x=0
    // Allow 1% tolerance — tighter than before to reject x/y=1 style equations
    if (Math.abs(coeffAtX - yCoeff) > Math.abs(yCoeff) * 0.01 + 1e-8) return null;
  }

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

/**
 * tryYEvenPower
 * Handles equations where y appears only as y^n for even n ≥ 4 (e.g. y^4, y^6, y^8).
 * Strategy: same as tryYSquared but:
 *   - detects the power n numerically (checks scaling ratio matches 2^n)
 *   - solves for y^n = f(x), then returns y = ±f(x)^(1/n)
 *
 * Examples:
 *   y^4 = x^2 + 2   →  y = ±(x²+2)^(1/4)
 *   y^4 - x^2 = 1   →  y = ±(x²+1)^(1/4)
 */
function tryYEvenPower(s: string): CurveEvaluator[] | null {
  if (!s.includes('=')) return null;

  // Must contain y^n where n is an even integer ≥ 4
  const powerMatch = s.match(/y\s*\^\s*(\d+)/);
  if (!powerMatch) return null;
  const n = parseInt(powerMatch[1], 10);
  if (n < 4 || n % 2 !== 0) return null;   // y^2 handled by tryYSquared, odd powers unsupported

  const parts = s.split('=');
  if (parts.length !== 2) return null;
  const [lhs, rhs] = parts.map(p => p.trim());

  // Confirm y appears ONLY as y^n (check scaling: F(2)-F(0) / (F(1)-F(0)) ≈ 2^n)
  const expectedRatio = Math.pow(2, n);
  const checkPower = (): boolean => {
    try {
      for (const testX of [0.5, 1.5, 2.5]) {
        const diff = (yVal: number): number | null => {
          try {
            const lhsV = compile(lhs).evaluate({ x: testX, y: yVal });
            const rhsV = compile(rhs).evaluate({ x: testX, y: yVal });
            const v = lhsV - rhsV;
            return typeof v === 'number' && isFinite(v) ? v : null;
          } catch { return null; }
        };
        const d0 = diff(0);
        const d1 = diff(1);
        const d2 = diff(2);
        const dm1 = diff(-1);
        if (d0 === null || d1 === null || d2 === null || dm1 === null) continue;

        const r1  = d1 - d0;
        const r2  = d2 - d0;
        const rm1 = dm1 - d0;

        if (Math.abs(r1) < 1e-10) continue;

        const ratio = r2 / r1;
        if (Math.abs(ratio - expectedRatio) > expectedRatio * 0.1) return false;

        // Must be symmetric (even power)
        const symRatio = rm1 / r1;
        if (Math.abs(symRatio - 1) > 0.1) return false;
      }
      return true;
    } catch { return false; }
  };

  if (!checkPower()) return null;

  // Solve for y^n = f(x):  f(x) = (rhs - lhs_no_y) / y^n_coefficient
  const yPowerRegex = new RegExp(`y\\s*\\^\\s*${n}`, 'g');
  const lhsNoY    = lhs.replace(yPowerRegex, '0');
  const rhsStr    = `((${rhs}) - (${lhsNoY}))`;
  const coeffExpr = lhs.replace(yPowerRegex, '1') + ` - (${lhsNoY})`;

  const testCoeff = tryEval(coeffExpr, 1);
  if (testCoeff === null) return null;

  let fxExpr: string;
  if (Math.abs(testCoeff - 1) < 1e-6) {
    fxExpr = rhsStr;
  } else if (Math.abs(testCoeff + 1) < 1e-6) {
    fxExpr = `-1 * (${rhsStr})`;
  } else {
    fxExpr = `(${rhsStr}) / (${coeffExpr})`;
  }

  const testFx = tryEval(fxExpr, 1);
  if (testFx === null) return null;

  const fxFnRaw = compileExpr(fxExpr);
  if (!fxFnRaw) return null;

  const root = 1 / n;
  const snapRoot = (v: number): number => {
    const rooted = Math.pow(v, root);
    return Math.abs(rooted) < 1e-10 ? 0 : rooted;
  };
  const topFn: EvalFn = (x: number) => {
    const v = fxFnRaw(x);
    if (v === null || v < 0) return null;
    return snapRoot(v);
  };
  const bottomFn: EvalFn = (x: number) => {
    const v = fxFnRaw(x);
    if (v === null || v < 0) return null;
    return -snapRoot(v);
  };

  return [
    { fn: topFn,    label: `y = (${fxExpr})^(1/${n})` },
    { fn: bottomFn, label: `y = -(${fxExpr})^(1/${n})` },
  ];
}



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
  private residualCache = new Map<string, ResidualFn | null>();

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
    const s = normalise(raw.trim());
    if (this.cache.has(s)) return this.cache.get(s)!;

    const result =
      tryExplicit(s)      ??
      tryYSquared(s)      ??
      tryYEvenPower(s)    ??
      tryLinearY(s)       ??
      tryBare(s)          ??
      [];

    this.cache.set(s, result);
    return result;
  }

  getResidual(raw: string): ResidualFn | null {
    const s = normalise(raw.trim());
    if (this.residualCache.has(s)) return this.residualCache.get(s)!;

    let residualExpr: string;
    const explicitMatch = s.match(/^(?:y|f\s*\(x\))\s*=\s*(.+)$/i);
    if (explicitMatch) {
      residualExpr = `y - (${explicitMatch[1].trim()})`;
    } else if (!s.includes('=')) {
      residualExpr = `y - (${s})`;
    } else {
      const parts = s.split('=');
      if (parts.length !== 2) {
        this.residualCache.set(s, null);
        return null;
      }
      residualExpr = `((${parts[0].trim()})) - ((${parts[1].trim()}))`;
    }

    const residual = compileResidualExpr(residualExpr);
    this.residualCache.set(s, residual);
    return residual;
  }

  /**
   * canSolveExplicitly
   * Returns true if the equation can be handled by the fast analytical path
   * (explicit y=f(x), y² implicit, linear implicit, bare expression).
   * Returns false for equations that need marching squares (odd powers, etc.)
   */
  canSolveExplicitly(raw: string): boolean {
    const result = this.getEvaluators(raw);
    return result.length > 0;
  }

  /** Clear the evaluator cache (call when equations are all removed). */
  clearCache(): void {
    this.cache.clear();
    this.residualCache.clear();
  }
}

/** Safely compile a mathjs expression string into a residual f(x, y). */
function compileResidualExpr(expr: string): ResidualFn | null {
  try {
    const compiled = compile(expr);
    return (x: number, y: number): number | null => {
      try {
        const result = compiled.evaluate({ x, y, pi: Math.PI, e: Math.E });
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
