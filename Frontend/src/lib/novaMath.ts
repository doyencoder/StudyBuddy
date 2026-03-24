const FUNCTION_NAMES = [
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "ln",
  "log",
  "exp",
  "sqrt",
  "abs",
  "arcsin",
  "arccos",
  "arctan",
  "sign",
] as const;

const ALLOWED_SYMBOLS = new Set<string>([
  "x",
  "y",
  "f",
  "pi",
  "e",
  "atan2",
  ...FUNCTION_NAMES,
]);

const POLAR_ALLOWED_SYMBOLS = new Set<string>([
  "r",
  "theta",
  "pi",
  "e",
  ...FUNCTION_NAMES,
]);

const SUPERSCRIPT_CHAR_MAP: Record<string, string> = {};

// Use unicode escapes so the source remains ASCII-only while still matching
// superscript glyphs from copied chat text.
SUPERSCRIPT_CHAR_MAP["\u2070"] = "0";
SUPERSCRIPT_CHAR_MAP["\u00B9"] = "1";
SUPERSCRIPT_CHAR_MAP["\u00B2"] = "2";
SUPERSCRIPT_CHAR_MAP["\u00B3"] = "3";
SUPERSCRIPT_CHAR_MAP["\u2074"] = "4";
SUPERSCRIPT_CHAR_MAP["\u2075"] = "5";
SUPERSCRIPT_CHAR_MAP["\u2076"] = "6";
SUPERSCRIPT_CHAR_MAP["\u2077"] = "7";
SUPERSCRIPT_CHAR_MAP["\u2078"] = "8";
SUPERSCRIPT_CHAR_MAP["\u2079"] = "9";
SUPERSCRIPT_CHAR_MAP["\u207A"] = "+";
SUPERSCRIPT_CHAR_MAP["\u207B"] = "-";

function decodeSuperscriptToken(token: string): string {
  const mapped = Array.from(token)
    .map((char) => SUPERSCRIPT_CHAR_MAP[char] ?? "")
    .join("");

  if (!mapped) return token;
  if (/^[+-]?\d+$/.test(mapped)) return mapped;
  return token;
}

function normalizeUnicodeMathSymbols(text: string): string {
  let s = text
    .replace(/[\u2212\u2013\u2014\uFE63]/g, "-")
    .replace(/[\u00D7\u2715\u2716\u00B7\u22C5\u2219]/g, "*")
    .replace(/[\u00F7\u2215\u2044]/g, "/")
    .replace(/[\uFF1D]/g, "=")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=");

  // Convert compact superscript powers often emitted by model text, e.g. x^2, y^-1.
  s = s.replace(/([A-Za-z0-9)\]])([\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079\u207A\u207B]+)/g, (_, base, superscript) => {
    const decoded = decodeSuperscriptToken(superscript);
    return `${base}^(${decoded})`;
  });

  return s;
}

export function normalizeEscapedMathDelimiters(text: string): string {
  return text
    .replace(/\\{2,}(?=[()\[\]])/g, "\\")
    .replace(/\\\s+\(/g, "\\(")
    .replace(/\\\s+\[/g, "\\[")
    .replace(/\\\s+\)/g, "\\)")
    .replace(/\\\s+\]/g, "\\]");
}

export function latexToMathjs(latex: string): string {
  let s = latex.trim();

  s = s.replace(/\\class\{[^}]*\}\{[^}]*\}/g, "");

  for (let i = 0; i < 5; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }

  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\sqrt\s+/g, "sqrt");

  s = s.replace(/\\left\(/g, "(").replace(/\\right\)/g, ")");
  s = s.replace(/\\left\[/g, "[").replace(/\\right\]/g, "]");
  s = s.replace(/\\left\|/g, "abs(").replace(/\\right\|/g, ")");

  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");

  for (const fn of FUNCTION_NAMES) {
    s = s.replace(new RegExp(`\\\\${fn}\\b`, "g"), fn);
  }

  for (const fn of FUNCTION_NAMES) {
    s = s.replace(
      new RegExp(`\\b${fn}\\s+([a-zA-Z0-9_]+|\\([^)]*\\))`, "g"),
      `${fn}($1)`,
    );
  }

  s = s
    .replace(/\\pi\b/g, "pi")
    .replace(/\\theta\b/g, "theta")
    .replace(/\\alpha\b/g, "alpha")
    .replace(/\\beta\b/g, "beta")
    .replace(/\\gamma\b/g, "gamma")
    .replace(/\\delta\b/g, "delta")
    .replace(/\\epsilon\b/g, "epsilon")
    .replace(/\\lambda\b/g, "lambda")
    .replace(/\\mu\b/g, "mu")
    .replace(/\\omega\b/g, "omega")
    .replace(/\\phi\b/g, "phi")
    .replace(/\\sigma\b/g, "sigma")
    .replace(/\\infty\b/g, "infinity");

  s = s.replace(/\\cdot\s*/g, "*").replace(/\\times\s*/g, "*");
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function unwrapMathDelimiters(text: string): string {
  return text
    .replace(/^\\\(([\s\S]+)\\\)$/g, "$1")
    .replace(/^\\\[([\s\S]+)\\\]$/g, "$1")
    .replace(/^\$\$([\s\S]+)\$\$$/g, "$1")
    .replace(/^\$([\s\S]+)\$$/g, "$1");
}

export function normalizeEquationForNova(raw: string): string {
  let s = normalizeEscapedMathDelimiters(raw.trim());
  s = normalizeUnicodeMathSymbols(s);
  s = unwrapMathDelimiters(s).trim();
  s = s
    .replace(/\u03c0/gi, "pi")
    .replace(/\u03b8/gi, "theta")
    .replace(/\u03b4/gi, "delta");

  if (/[\\{}]/.test(s)) {
    s = latexToMathjs(s);
  }

  s = s
    .replace(/\^\(\((\d+)\)\s*\/\s*\((\d+)\)\)/g, "^($1/$2)")
    .replace(/\(\((\d+)\)\s*\/\s*\((\d+)\)\)/g, "($1/$2)")
    .replace(/\s+/g, " ")
    .replace(/[;:,]+$/g, "")
    .replace(/\.$/g, "")
    .trim();

  return s;
}

function simplifyNumericPowers(expr: string): string {
  return expr.replace(
    /\b(\d+(?:\.\d+)?)\s*\^\s*(\d+)\b/g,
    (_, base, exponent) => String(Number(base) ** Number(exponent)),
  );
}

export function canonicalEquationKey(raw: string): string {
  let s = normalizeEquationForNova(raw);
  s = simplifyNumericPowers(s);

  for (let pass = 0; pass < 4; pass++) {
    const next = s
      .replace(/\(\s*([xy](?:\^\([^()]+\)|\^\d+)?)\s*\)/g, "$1")
      .replace(/\(\s*(-?\d+(?:\.\d+)?)\s*\)/g, "$1")
      .replace(/\(\s*([xy](?:\^\([^()]+\)|\^\d+)?)\s*\)\s*\/\s*(\d+(?:\.\d+)?)/g, "$1/$2")
      .replace(/(\d+(?:\.\d+)?)\s*\/\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g, "$1/$2")
      .replace(/\(\s*([xy](?:\^\([^()]+\)|\^\d+)?)\s*\)\s*\/\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g, "$1/$2")
      .replace(/\s+/g, "");
    if (next === s) break;
    s = next;
  }

  return s;
}

function hasUnsupportedSymbols(expr: string, allowedSymbols: Set<string> = ALLOWED_SYMBOLS): boolean {
  const words = expr.match(/[A-Za-z_]+/g) ?? [];
  return words.some((word) => !allowedSymbols.has(word.toLowerCase()));
}

function normalizeImplicitProductsForValidation(expr: string): string {
  return expr
    .replace(/(\d)([xy])/gi, "$1*$2")
    .replace(/\b([xy])([xy])\b/gi, "$1*$2")
    .replace(/([xy])\(/gi, "$1*(")
    .replace(/(\))([xy])/gi, "$1*$2");
}

export function looksGraphableEquation(raw: string): boolean {
  const s = normalizeImplicitProductsForValidation(normalizeEquationForNova(raw));
  if (!s || s.length > 180) return false;
  const hasCartesianVars = /[xy]/i.test(s);
  const hasPolarVars = /\br\b/i.test(s) && /\btheta\b/i.test(s) && !hasCartesianVars;

  if (!hasCartesianVars && !hasPolarVars) return false;
  if (hasCartesianVars && hasUnsupportedSymbols(s)) return false;
  if (hasPolarVars && hasUnsupportedSymbols(s, POLAR_ALLOWED_SYMBOLS)) return false;

  if (/[<>]=?|=/.test(s)) {
    return /^[0-9A-Za-z_+\-*/^=().<>\s]+$/.test(s);
  }

  return false;
}

export function extractGraphableEquations(text: string): string[] {
  const matches = new Map<string, string>();
  const normalizedText = normalizeEscapedMathDelimiters(text);
  const searchableText = normalizedText.replace(/```[\s\S]*?```/g, "");

  const addCandidate = (candidate: string) => {
    const normalized = normalizeEquationForNova(candidate);
    if (!looksGraphableEquation(normalized)) return;
    const key = canonicalEquationKey(normalized);
    const existing = matches.get(key);
    if (!existing || normalized.length < existing.length) {
      matches.set(key, normalized);
    }
  };

  const latexPattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\r\n]+?)\$/g;
  let latexMatch: RegExpExecArray | null;
  while ((latexMatch = latexPattern.exec(searchableText)) !== null) {
    const candidate = latexMatch.slice(1).find(Boolean);
    if (candidate) addCandidate(candidate);
  }

  for (const rawLine of searchableText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^PLOT:\s*/i.test(trimmed) || trimmed.startsWith("```")) continue;

    const line = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/^[-*]\s+/, "")
      .trim();

    const explicitMatches = line.match(/(?:y|f\(x\))\s*=\s*[^;\n]{2,140}/gi) ?? [];
    explicitMatches.forEach(addCandidate);

    if (!/[=<>]/.test(line) || !/[xyr]/i.test(line)) continue;

    const equationStart = line.search(/(?:\d+\s*[xyr]|f\(x\)|\\frac|(?<![A-Za-z])[xyr](?![A-Za-z])|\()/i);
    if (equationStart >= 0) {
      addCandidate(line.slice(equationStart));
    }
  }

  return Array.from(matches.values()).slice(0, 6);
}
