/**
 * Spreadsheet formula evaluator tests.
 *
 * Run: npx tsx --test tests/spreadsheet-formulas.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFormula,
  fillFormulaValues,
  parseCellRef,
  colLettersToIndex,
} from "@/lib/workspace/spreadsheet-formulas";

function grid(cells: Record<string, number | string | boolean>): (r: number, c: number) => unknown {
  const addr = (r: number, c: number): string => {
    let s = "";
    let n = c;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `${s}${r + 1}`;
  };
  return (r, c) => cells[addr(r, c)] ?? null;
}

describe("cell refs", () => {
  it("parses A1, absolutes, and sheet prefixes", () => {
    assert.deepEqual(parseCellRef("A1"), { row: 0, col: 0 });
    assert.deepEqual(parseCellRef("$C$5"), { row: 4, col: 2 });
    assert.deepEqual(parseCellRef("Budget!D10"), { row: 9, col: 3 });
    assert.equal(parseCellRef("nope"), null);
  });

  it("converts column letters", () => {
    assert.equal(colLettersToIndex("A"), 0);
    assert.equal(colLettersToIndex("Z"), 25);
    assert.equal(colLettersToIndex("AA"), 26);
  });
});

describe("evaluateFormula basics", () => {
  const get = grid({ A1: 2, A2: 3, B1: "hi", B2: "", C1: true });

  it("arithmetic and precedence", () => {
    assert.equal(evaluateFormula("1+2*3", get), 7);
    assert.equal(evaluateFormula("(1+2)*3", get), 9);
    assert.equal(evaluateFormula("2^3", get), 8);
    assert.equal(evaluateFormula("10%", get), 0.1);
    assert.equal(evaluateFormula("-A1+10", get), 8);
  });

  it("cell refs and ranges", () => {
    assert.equal(evaluateFormula("A1+A2", get), 5);
    assert.equal(evaluateFormula("SUM(A1:A2)", get), 5);
    assert.equal(evaluateFormula("SUM($A$1:$A$2)", get), 5);
  });

  it("aggregations ignore text", () => {
    assert.equal(evaluateFormula("SUM(A1:B1)", get), 2);
    assert.equal(evaluateFormula("AVERAGE(A1:A2)", get), 2.5);
    assert.equal(evaluateFormula("MIN(A1:A2)", get), 2);
    assert.equal(evaluateFormula("MAX(A1:A2)", get), 3);
    assert.equal(evaluateFormula("COUNT(A1:B2)", get), 2);
    assert.equal(evaluateFormula("COUNTA(A1:B2)", get), 3);
  });

  it("comparisons, concat, logic", () => {
    assert.equal(evaluateFormula("A1>A2", get), false);
    assert.equal(evaluateFormula("A1<>A2", get), true);
    assert.equal(evaluateFormula('B1&"!"', get), "hi!");
    assert.equal(evaluateFormula("IF(A1>1,10,20)", get), 10);
    assert.equal(evaluateFormula("AND(A1=2,A2=3)", get), true);
    assert.equal(evaluateFormula("OR(A1=9,A2=3)", get), true);
    assert.equal(evaluateFormula("NOT(A1=9)", get), true);
  });

  it("math and text functions", () => {
    assert.equal(evaluateFormula("ABS(-4)", get), 4);
    assert.equal(evaluateFormula("ROUND(2.675,2)", get), 2.68);
    assert.equal(evaluateFormula("MOD(10,3)", get), 1);
    assert.equal(evaluateFormula("LEN(B1)", get), 2);
    assert.equal(evaluateFormula("UPPER(B1)", get), "HI");
    assert.equal(evaluateFormula('CONCAT(B1,"-","x")', get), "hi-x");
  });

  it("returns null for unsupported or broken input", () => {
    assert.equal(evaluateFormula("XLOOKUP(1,2,3)", get), null);
    assert.equal(evaluateFormula("1/0", get), null);
    assert.equal(evaluateFormula("", get), null);
    assert.equal(evaluateFormula("SUM(", get), null);
  });

  it("handles the budget totals case", () => {
    const budget = grid({ C2: 500, C3: 200, C4: 300, C5: 1000, D2: 450, D3: 200, D4: 100, D5: 0 });
    assert.equal(evaluateFormula("SUM(C2:C5)", budget), 2000);
    assert.equal(evaluateFormula("SUM(D2:D5)", budget), 750);
  });
});

describe("fillFormulaValues", () => {
  it("fills missing cached values, keeps existing ones", () => {
    const ws: Record<string, any> = {
      A1: { t: "n", v: 2 },
      A2: { t: "n", v: 3 },
      A3: { t: "n", f: "SUM(A1:A2)" },
      A4: { t: "n", f: "SUM(A1:A2)", v: 999 },
      "!ref": "A1:A4",
    };
    fillFormulaValues(ws);
    assert.equal(ws.A3.v, 5);
    assert.equal(ws.A3.t, "n");
    assert.equal(ws.A4.v, 999);
  });

  it("resolves chained formulas and survives cycles", () => {
    const ws: Record<string, any> = {
      A1: { t: "n", v: 10 },
      A2: { t: "n", f: "A1*2" },
      A3: { t: "n", f: "A2+5" },
      B1: { t: "n", f: "B2+1" },
      B2: { t: "n", f: "B1+1" },
      C1: { t: "n", f: "NOPE(1)" },
    };
    fillFormulaValues(ws);
    assert.equal(ws.A2.v, 20);
    assert.equal(ws.A3.v, 25);
    assert.equal(ws.C1.v, undefined);
  });
});
