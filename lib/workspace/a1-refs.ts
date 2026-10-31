/**
 * A1 reference parsing and rewriting — one implementation shared by the
 * sheet editor (structural edits remap references) and the xlsx reader
 * (shared formulas are translated per cell).
 *
 * The tokenizer is deliberately conservative: `LOG10(` is a function call,
 * `Sheet1!A1` is a sheet-qualified reference, and a reference may not be
 * glued to a preceding identifier. Both call sites used to get this wrong.
 */

export const A1_REF = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;

export type A1Ref = {
  /** The whole matched token, e.g. "$B$2". */
  match: string;
  colAbs: boolean;
  rowAbs: boolean;
  /** 0-based. */
  col: number;
  /** 0-based. */
  row: number;
  /** Offset of the token inside the formula. */
  offset: number;
};

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colName(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function splitRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec((ref || "").trim());
  if (!m) return null;
  const row = parseInt(m[2], 10) - 1;
  const col = colIndex(m[1]);
  if (!Number.isFinite(row) || row < 0 || col < 0) return null;
  return { row, col };
}

export function formatRef(col: number, row: number, colAbs = false, rowAbs = false): string {
  return `${colAbs ? "$" : ""}${colName(col)}${rowAbs ? "$" : ""}${row + 1}`;
}

function isRefLike(formula: string, offset: number, match: string): boolean {
  if (formula[offset + match.length] === "(") return false; // function name
  if (offset > 0 && /[A-Za-z0-9_.!]/.test(formula[offset - 1])) return false; // Sheet1!A1, $A$1 handled by match
  return true;
}

/** Visit every real A1 reference in a formula. */
export function forEachA1Ref(formula: string, visit: (ref: A1Ref) => void): void {
  A1_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = A1_REF.exec(formula)) !== null) {
    const [match, colAbs, letters, rowAbs, digits] = m;
    if (!isRefLike(formula, m.index, match)) continue;
    const row = parseInt(digits, 10) - 1;
    const col = colIndex(letters);
    if (!Number.isFinite(row) || row < 0 || col < 0) continue;
    visit({ match, colAbs: !!colAbs, rowAbs: !!rowAbs, col, row, offset: m.index });
  }
}

/** Rewrite references; returning null keeps the original token. */
export function mapA1Refs(formula: string, map: (ref: A1Ref) => string | null): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  forEachA1Ref(formula, (ref) => {
    const replacement = map(ref);
    if (replacement === null || replacement === ref.match) return;
    edits.push({ start: ref.offset, end: ref.offset + ref.match.length, text: replacement });
  });
  if (edits.length === 0) return formula;
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    out += formula.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + formula.slice(cursor);
}

/** Shift the relative references in a formula by (dRow, dCol). */
export function translateFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  return mapA1Refs(formula, (ref) => {
    const row = ref.rowAbs ? ref.row : ref.row + dRow;
    const col = ref.colAbs ? ref.col : ref.col + dCol;
    if (row < 0 || col < 0) return null;
    return formatRef(col, row, ref.colAbs, ref.rowAbs);
  });
}
