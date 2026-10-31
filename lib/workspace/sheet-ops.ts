/**
 * Spreadsheet grid operations used by the sheet viewer.
 *
 * The viewer keeps cells as raw strings (formulas start with "=") and
 * evaluates them in the browser, so a formula typed by the user updates
 * dependent cells immediately — no server round-trip and no stale cached
 * value. Everything here is pure and unit-tested.
 */

import { evaluateFormula } from "./spreadsheet-formulas";
import { colName as colNameFromRefs, formatRef, mapA1Refs } from "./a1-refs";

export type SheetGrid = {
  name: string;
  rows: string[][];
};

export function colName(index: number): string {
  return colNameFromRefs(index);
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function rawCell(rows: string[][], row: number, col: number): string {
  const value = rows[row]?.[col];
  return value === undefined || value === null ? "" : String(value);
}

export function isFormula(value: string): boolean {
  return typeof value === "string" && value.startsWith("=") && value.length > 1;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
  }
  return String(value);
}

export type CellResolution = {
  /** What the cell shows (computed value, or raw text). */
  display: string;
  /** The formula without "=", when the cell is a formula. */
  formula?: string;
  error?: string;
};

/**
 * Resolve a cell for display, evaluating formulas recursively with cycle
 * protection. Never throws.
 */
export function resolveCell(
  rows: string[][],
  row: number,
  col: number,
  seen: Set<string> = new Set(),
): CellResolution {
  const raw = rawCell(rows, row, col);
  if (!isFormula(raw)) return { display: raw };
  const key = cellKey(row, col);
  if (seen.has(key)) return { display: "#CIRCULAR", formula: raw.slice(1), error: "circular" };
  if (seen.size > 120) return { display: "#DEPTH", formula: raw.slice(1), error: "depth" };
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  // An error inside a referenced cell must surface here too: silently
  // substituting 0 would show a plausible but wrong number.
  let nestedError: string | undefined;
  const value = evaluateFormula(raw, (r, c) => {
    const inner = resolveCell(rows, r, c, nextSeen);
    if (inner.error) {
      nestedError = nestedError === "circular" ? "circular" : inner.error;
      return 0;
    }
    if (inner.display === "") return "";
    const n = Number(inner.display);
    return Number.isFinite(n) && inner.display.trim() !== "" ? n : inner.display;
  });
  if (nestedError === "circular") return { display: "#CIRCULAR", formula: raw.slice(1), error: "circular" };
  if (nestedError) return { display: "#ERROR", formula: raw.slice(1), error: nestedError };
  if (value === null) return { display: "#ERROR", formula: raw.slice(1), error: "formula" };
  return { display: formatValue(value), formula: raw.slice(1) };
}

/** Display strings for a whole grid (used by exports/tests). */
export function evaluateGrid(rows: string[][]): string[][] {
  return rows.map((row, r) => row.map((_, c) => resolveCell(rows, r, c).display));
}

// ---------- structural edits (with A1 reference remapping) ----------

/** Shift A1 references inside a formula after rows/cols are inserted/removed. */
export function remapFormula(
  formula: string,
  change:
    | { kind: "insertRow"; at: number; count?: number }
    | { kind: "deleteRow"; at: number; count?: number }
    | { kind: "insertCol"; at: number; count?: number }
    | { kind: "deleteCol"; at: number; count?: number },
): string {
  const count = change.count ?? 1;
  return mapA1Refs(formula, (ref) => {
    let col = ref.col;
    let row = ref.row;
    switch (change.kind) {
      case "insertRow":
        if (row >= change.at) row += count;
        break;
      case "deleteRow":
        if (row >= change.at + count) row -= count;
        else if (row >= change.at) return "#REF!";
        break;
      case "insertCol":
        if (col >= change.at) col += count;
        break;
      case "deleteCol":
        if (col >= change.at + count) col -= count;
        else if (col >= change.at) return "#REF!";
        break;
    }
    if (row < 0 || col < 0) return "#REF!";
    return formatRef(col, row, ref.colAbs, ref.rowAbs);
  });
}

function mapFormulas(sheet: SheetGrid, fn: (formula: string) => string): string[][] {
  return sheet.rows.map((row) =>
    row.map((cell) => (isFormula(cell) ? fn(cell) : cell)),
  );
}

export function insertRow(sheet: SheetGrid, at: number): SheetGrid {
  const rows = sheet.rows.map((r) => [...r]);
  const width = Math.max(1, ...rows.map((r) => r.length));
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, Array.from({ length: width }, () => ""));
  return { ...sheet, rows: mapFormulas({ ...sheet, rows }, (f) => remapFormula(f, { kind: "insertRow", at })) };
}

export function deleteRow(sheet: SheetGrid, at: number): SheetGrid {
  if (sheet.rows.length === 0) return sheet;
  const rows = sheet.rows.map((r) => [...r]);
  rows.splice(Math.max(0, Math.min(at, rows.length - 1)), 1);
  return { ...sheet, rows: mapFormulas({ ...sheet, rows }, (f) => remapFormula(f, { kind: "deleteRow", at })) };
}

export function insertColumn(sheet: SheetGrid, at: number): SheetGrid {
  const rows = sheet.rows.map((row) => {
    const next = [...row];
    while (next.length < at) next.push("");
    next.splice(at, 0, "");
    return next;
  });
  return { ...sheet, rows: mapFormulas({ ...sheet, rows }, (f) => remapFormula(f, { kind: "insertCol", at })) };
}

export function deleteColumn(sheet: SheetGrid, at: number): SheetGrid {
  const rows = sheet.rows.map((row) => {
    const next = [...row];
    next.splice(at, 1);
    return next;
  });
  return { ...sheet, rows: mapFormulas({ ...sheet, rows }, (f) => remapFormula(f, { kind: "deleteCol", at })) };
}

/** Ensure a rectangular grid of at least `rows`×`cols` cells. */
export function padGrid(rows: string[][], minRows: number, minCols: number): string[][] {
  const out = rows.map((r) => [...r]);
  while (out.length < minRows) out.push([]);
  for (const row of out) {
    while (row.length < minCols) row.push("");
  }
  return out;
}

/** Serialize grids for the save endpoint (formulas stay formulas). */
export function toSavePayload(sheets: SheetGrid[]): Array<{ name: string; rows: string[][] }> {
  return sheets.map((s) => ({
    name: s.name,
    rows: s.rows.map((row) => row.map((cell) => String(cell ?? ""))),
  }));
}
