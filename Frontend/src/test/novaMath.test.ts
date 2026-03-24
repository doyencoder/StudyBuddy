import { describe, expect, it } from "vitest";
import {
  extractGraphableEquations,
  looksGraphableEquation,
  normalizeEquationForNova,
} from "@/lib/novaMath";

describe("novaMath unicode normalization", () => {
  it("normalizes unicode operators and superscript powers", () => {
    const normalized = normalizeEquationForNova("3x² + 4xy − 5y² + 6x − 7y + 1 = 0");

    expect(normalized).toBe("3x^(2) + 4xy - 5y^(2) + 6x - 7y + 1 = 0");
  });

  it("treats unicode equations as graphable", () => {
    const graphable = looksGraphableEquation("3x² + 4xy − 5y² + 6x − 7y + 1 = 0");

    expect(graphable).toBe(true);
  });

  it("extracts and normalizes unicode equations from chat text", () => {
    const text = "Try this conic: 3x² + 4xy − 5y² + 6x − 7y + 1 = 0";

    expect(extractGraphableEquations(text)).toContain(
      "3x^(2) + 4xy - 5y^(2) + 6x - 7y + 1 = 0",
    );
  });
});
