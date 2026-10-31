/**
 * Spreadsheet formula behaviour.
 *
 * These tests exercise the actual evaluation path used by the sheet viewer
 * (raw formula strings in a grid), not just visual rendering: entry,
 * references, ranges, recalculation after an edit, circular references and
 * persistence payloads.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  colName,
  deleteColumn,
  deleteRow,
  evaluateGrid,
  insertColumn,
  insertRow,
  isFormula,
  padGrid,
  rawCell,
  remapFormula,
  resolveCell,
  toSavePayload,
  type SheetGrid,
} from "@/lib/workspace/sheet-ops";
import { evaluateFormula } from "@/lib/workspace/spreadsheet-formulas";

function gridOf(rows: string[][]): string[][] {
  return padGrid(rows, 4, 4);
}

describe("formula evaluation", () => {
  it("computes arithmetic, references and ranges", () => {
    const rows = gridOf([
      ["Item", "Qty", "Price", "Total"],
      ["Apples", "2", "3.5", "=B2*C2"],
      ["Pears", "4", "2", "=B3*C3"],
      ["Sum", "", "", "=SUM(D2:D3)"],
    ]);
    assert.equal(resolveCell(rows, 1, 3).display, "7");
    assert.equal(resolveCell(rows, 2, 3).display, "8");
    assert.equal(resolveCell(rows, 3, 3).display, "15");
  });

  it("recalculates dependent cells after an edit", () => {
    const rows = gridOf([
      ["Item", "Qty", "Price", "Total"],
      ["Apples", "2", "3.5", "=B2*C2"],
      ["Sum", "", "", "=SUM(D2:D2)"],
    ]);
    assert.equal(resolveCell(rows, 2, 3).display, "7");
    const edited = rows.map((r) => [...r]);
    edited[1][1] = "10"; // change quantity
    assert.equal(resolveCell(edited, 1, 3).display, "35");
    assert.equal(resolveCell(edited, 2, 3).display, "35");
  });

  it("supports absolute references and text/logic functions", () => {
    const rows = gridOf([
      ["A", "B"],
      ["5", "=IF(A2>3,\"big\",\"small\")"],
      ["", "=CONCAT(\"x\", A2)"],
    ]);
    assert.equal(resolveCell(rows, 1, 1).display, "big");
    assert.equal(resolveCell(rows, 2, 1).display, "x5");
    assert.equal(evaluateFormula("SUM($A$2:$A$2)", () => 5), 5);
  });

  it("reports circular references instead of hanging", () => {
    const rows = gridOf([["=B1", "=A1"]]);
    const a = resolveCell(rows, 0, 0);
    assert.equal(a.display, "#CIRCULAR");
    assert.ok(a.error);
  });

  it("reports unknown formulas as errors without throwing", () => {
    const rows = gridOf([["=NOPE(1)"]]);
    const res = resolveCell(rows, 0, 0);
    assert.equal(res.display, "#ERROR");
    assert.equal(res.formula, "NOPE(1)");
  });

  it("distinguishes formulas from text starting with =", () => {
    assert.equal(isFormula("=SUM(A1:A2)"), true);
    assert.equal(isFormula("="), false);
    assert.equal(isFormula("total"), false);
  });

  it("evaluates whole grids for export", () => {
    const rows = gridOf([["1", "2", "=A1+B1"]]);
    assert.deepEqual(evaluateGrid(rows)[0].slice(0, 3), ["1", "2", "3"]);
  });
});

describe("column naming", () => {
  it("handles multi-letter columns", () => {
    assert.equal(colName(0), "A");
    assert.equal(colName(25), "Z");
    assert.equal(colName(26), "AA");
    assert.equal(colName(701), "ZZ");
  });
});

describe("structural edits", () => {
  const sheet: SheetGrid = {
    name: "Sheet1",
    rows: gridOf([
      ["Item", "Qty", "Total"],
      ["Apples", "2", "=B2*2"],
      ["Sum", "", "=SUM(C2:C2)"],
    ]),
  };

  it("inserts a row and shifts references", () => {
    const next = insertRow(sheet, 1);
    assert.equal(next.rows[1].every((c) => c === ""), true);
    assert.equal(rawCell(next.rows, 2, 0), "Apples");
    assert.equal(rawCell(next.rows, 2, 2), "=B3*2");
    assert.equal(rawCell(next.rows, 3, 2), "=SUM(C3:C3)");
  });

  it("deletes a row and invalidates references to it", () => {
    // Excel semantics: a reference to a deleted row becomes #REF!, while
    // references to rows further down shift up.
    const next = deleteRow(sheet, 1);
    assert.equal(rawCell(next.rows, 1, 0), "Sum");
    assert.equal(rawCell(next.rows, 1, 2), "=SUM(#REF!:#REF!)");

    const below = {
      name: "Sheet1",
      rows: gridOf([
        ["1"],
        ["2"],
        ["=A1+A3"],
      ]),
    };
    assert.equal(rawCell(deleteRow(below, 1).rows, 1, 0), "=A1+A2");
  });

  it("inserts and deletes columns", () => {
    const inserted = insertColumn(sheet, 1);
    assert.equal(rawCell(inserted.rows, 0, 1), "");
    // The whole row shifts right, and the formula follows its column.
    assert.equal(rawCell(inserted.rows, 1, 3), "=C2*2");
    const deleted = deleteColumn(sheet, 1);
    assert.equal(rawCell(deleted.rows, 0, 1), "Total");
    // B2 is the deleted column, so the reference is now invalid.
    assert.equal(rawCell(deleted.rows, 1, 1), "=#REF!*2");
  });

  it("remaps formulas to #REF! when a referenced row is removed", () => {
    assert.equal(remapFormula("=A1+A2", { kind: "deleteRow", at: 0 }), "=#REF!+A1");
    assert.equal(remapFormula("=SUM(A1:A5)", { kind: "insertRow", at: 2 }), "=SUM(A1:A6)");
    assert.equal(remapFormula("=B2", { kind: "insertCol", at: 0 }), "=C2");
  });
});

describe("persistence payload", () => {
  it("keeps formulas as formulas for multiple sheets", () => {
    const payload = toSavePayload([
      { name: "Q1", rows: [["a", "=SUM(B1:B2)"]] },
      { name: "Q2", rows: [["b", "1"]] },
    ]);
    assert.equal(payload.length, 2);
    assert.equal(payload[0].name, "Q1");
    assert.equal(payload[0].rows[0][1], "=SUM(B1:B2)");
    assert.equal(payload[1].name, "Q2");
  });

  it("pads grids without mutating the input", () => {
    const rows = [["a"]];
    const padded = padGrid(rows, 3, 2);
    assert.equal(padded.length, 3);
    assert.equal(padded[0].length, 2);
    assert.equal(rows[0].length, 1);
  });
});
