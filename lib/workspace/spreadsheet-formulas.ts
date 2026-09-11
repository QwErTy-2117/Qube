/**
 * Minimal Excel formula evaluator for spreadsheet previews.
 *
 * Why this exists: agent scripts (openpyxl) write formulas WITHOUT cached
 * values — openpyxl never computes them — and the SheetJS reader used by
 * the preview only surfaces cached values. So `=SUM(C2:C5)` showed as a
 * blank cell even though Excel/LibreOffice compute it fine on open. This
 * module fills in those missing values server-side so the popup preview
 * matches what Excel shows.
 *
 * Scope is deliberately small: arithmetic, comparisons, cell/range refs
 * (incl. $ absolutes), and the common aggregation/math/text/logic
 * functions agents actually emit. Anything unsupported evaluates to blank
 * (never throws to callers — errors are contained per cell).
 */

export type CellGetter = (row: number, col: number) => unknown;

type Value = number | string | boolean | null;

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toDisplayNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.trim()))) {
    return Number(v.trim());
  }
  return null;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "" || t === "false") return false;
    if (t === "true") return true;
    return true;
  }
  return false;
}

function fmt(n: number): number {
  // Kill float dust (0.1+0.2) so previews show clean numbers.
  return Math.abs(n) < 1e-12 ? 0 : Number(n.toFixed(10));
}

export function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/;

export function parseCellRef(ref: string): { row: number; col: number } | null {
  // Tolerate an optional Sheet! prefix (evaluation stays on one grid).
  const bang = ref.lastIndexOf("!");
  const body = bang >= 0 ? ref.slice(bang + 1).replace(/^'(.*)'$/, "$1") : ref;
  const m = CELL_RE.exec(body.trim());
  if (!m) return null;
  const col = colLettersToIndex(m[1]);
  const row = parseInt(m[2], 10) - 1;
  if (col < 0 || row < 0 || col > 16383 || row > 1048575) return null;
  return { row, col };
}

function rangeCells(a: string, b: string): Array<{ row: number; col: number }> | null {
  const p = parseCellRef(a);
  const q = parseCellRef(b);
  if (!p || !q) return null;
  const cells: Array<{ row: number; col: number }> = [];
  const r1 = Math.min(p.row, q.row);
  const r2 = Math.max(p.row, q.row);
  const c1 = Math.min(p.col, q.col);
  const c2 = Math.max(p.col, q.col);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > 100000) return null;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cells.push({ row: r, col: c });
  return cells;
}

function flattenArgs(args: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(a);
  }
  return out;
}

function numbersOnly(vals: unknown[]): number[] {
  const out: number[] = [];
  for (const v of vals) {
    const n = toDisplayNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
}

// ---------- Parser ----------

class Parser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly getCell: CellGetter,
  ) {}

  parse(): unknown {
    const v = this.parseComparison();
    this.skipWs();
    if (this.pos < this.src.length) throw new Error("trailing input");
    return v;
  }

  private peek(): string {
    return this.src[this.pos] ?? "";
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private match(re: RegExp): RegExpExecArray | null {
    this.skipWs();
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m && m.index === this.pos) {
      this.pos += m[0].length;
      return m;
    }
    return null;
  }

  private parseComparison(): unknown {
    let left = this.parseConcat();
    for (;;) {
      const m = this.match(/(<=|>=|<>|=|<|>)/y);
      if (!m) return left;
      const right = this.parseConcat();
      left = compareValues(m[1], left, right);
    }
  }

  private parseConcat(): unknown {
    let left = this.parseAdditive();
    for (;;) {
      const m = this.match(/&/y);
      if (!m) return left;
      const right = this.parseAdditive();
      left = `${stringify(left)}${stringify(right)}`;
    }
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    for (;;) {
      const m = this.match(/(\+|-)/y);
      if (!m) return left;
      const right = this.parseMultiplicative();
      left = fmt(m[1] === "+" ? toNumber(left) + toNumber(right) : toNumber(left) - toNumber(right));
    }
  }

  private parseMultiplicative(): unknown {
    let left = this.parsePower();
    for (;;) {
      const m = this.match(/(\*|\/)/y);
      if (!m) return left;
      const right = this.parsePower();
      if (m[1] === "*") left = fmt(toNumber(left) * toNumber(right));
      else {
        const d = toNumber(right);
        if (d === 0) throw new Error("div0");
        left = fmt(toNumber(left) / d);
      }
    }
  }

  private parsePower(): unknown {
    const base = this.parseUnary();
    if (this.match(/\^/y)) {
      const exp = this.parsePower();
      return fmt(Math.pow(toNumber(base), toNumber(exp)));
    }
    return base;
  }

  private parseUnary(): unknown {
    if (this.match(/\+/y)) return this.parseUnary();
    if (this.match(/-/y)) return fmt(-toNumber(this.parseUnary()));
    let v = this.parsePrimary();
    while (this.match(/%/y)) v = fmt(toNumber(v) / 100);
    return v;
  }

  private parsePrimary(): unknown {
    this.skipWs();
    const ch = this.peek();
    if (ch === "(") {
      this.pos++;
      const v = this.parseComparison();
      this.skipWs();
      if (this.peek() !== ")") throw new Error("missing )");
      this.pos++;
      return v;
    }
    if (ch === '"') {
      this.pos++;
      let s = "";
      while (this.pos < this.src.length) {
        const c = this.src[this.pos++];
        if (c === '"') {
          if (this.src[this.pos] === '"') {
            s += '"';
            this.pos++;
          } else break;
        } else s += c;
      }
      return s;
    }
    const num = this.match(/(\d+(\.\d+)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/y);
    if (num) return Number(num[1]);
    // Identifier: function call, boolean literal, cell ref, or range.
    const id = this.match(/('([^']|'')+'!?[\w$.]*|[\$A-Za-z_][\w$.]*!?)/y);
    if (!id) throw new Error(`unexpected '${ch}'`);
    let name = id[1];
    this.skipWs();
    if (this.peek() === "(") {
      this.pos++;
      const args = this.parseArgList();
      return callFunction(normalizeFnName(name), args);
    }
    const upper = name.toUpperCase().replace(/^_XLFN\./, "");
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
    // Cell ref or A1:B2 range.
    const saved = this.pos;
    this.skipWs();
    if (this.peek() === ":") {
      this.pos++;
      const id2 = this.match(/(\$?[A-Za-z]{1,3}\$?[0-9]+)/y);
      if (!id2) throw new Error("bad range");
      const cells = rangeCells(name, id2[1]);
      if (!cells) throw new Error("bad range");
      return cells.map(({ row, col }) => this.getCell(row, col));
    }
    this.pos = saved;
    const ref = parseCellRef(name);
    if (!ref) throw new Error(`unknown name '${name}'`);
    return this.getCell(ref.row, ref.col);
  }

  private parseArgList(): unknown[] {
    const args: unknown[] = [];
    this.skipWs();
    if (this.peek() === ")") {
      this.pos++;
      return args;
    }
    for (;;) {
      args.push(this.parseComparison());
      this.skipWs();
      const c = this.peek();
      if (c === ",") {
        this.pos++;
        continue;
      }
      // Excel also allows ; as list separator in some locales.
      if (c === ";") {
        this.pos++;
        continue;
      }
      if (c === ")") {
        this.pos++;
        return args;
      }
      throw new Error("bad arg list");
    }
  }
}

function normalizeFnName(name: string): string {
  return name.toUpperCase().replace(/^_XLFN\./, "");
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

function compareValues(op: string, left: unknown, right: unknown): boolean {
  // Excel-ish: numbers compare numerically, otherwise case-insensitive text.
  if (typeof left === "boolean") left = left ? 1 : 0;
  if (typeof right === "boolean") right = right ? 1 : 0;
  let cmp: number;
  if (typeof left === "number" && typeof right === "number") {
    cmp = left < right ? -1 : left > right ? 1 : 0;
  } else {
    const a = stringify(left).toLowerCase();
    const b = stringify(right).toLowerCase();
    cmp = a < b ? -1 : a > b ? 1 : 0;
  }
  switch (op) {
    case "=": return cmp === 0;
    case "<>": return cmp !== 0;
    case "<": return cmp < 0;
    case ">": return cmp > 0;
    case "<=": return cmp <= 0;
    case ">=": return cmp >= 0;
    default: return false;
  }
}

function callFunction(name: string, args: unknown[]): unknown {
  const flat = flattenArgs(args);
  switch (name) {
    case "SUM": return fmt(numbersOnly(flat).reduce((a, b) => a + b, 0));
    case "PRODUCT": {
      const ns = numbersOnly(flat);
      return ns.length ? fmt(ns.reduce((a, b) => a * b, 1)) : 0;
    }
    case "AVERAGE":
    case "AVG": {
      const ns = numbersOnly(flat);
      if (ns.length === 0) throw new Error("div0");
      return fmt(ns.reduce((a, b) => a + b, 0) / ns.length);
    }
    case "MIN": {
      const ns = numbersOnly(flat);
      return ns.length ? Math.min(...ns) : 0;
    }
    case "MAX": {
      const ns = numbersOnly(flat);
      return ns.length ? Math.max(...ns) : 0;
    }
    case "COUNT": return numbersOnly(flat).length;
    case "COUNTA":
      return flat.filter((v) => v !== null && v !== undefined && !(typeof v === "string" && v === "")).length;
    case "COUNTBLANK":
      return flat.filter((v) => v === null || v === undefined || (typeof v === "string" && v === "")).length;
    case "ABS": return Math.abs(toNumber(args[0]));
    case "INT": return Math.floor(toNumber(args[0]));
    case "ROUND": {
      const digits = args.length > 1 ? Math.trunc(toNumber(args[1])) : 0;
      const f = Math.pow(10, digits);
      return fmt(Math.round(toNumber(args[0]) * f) / f);
    }
    case "MOD": {
      const d = toNumber(args[1]);
      if (d === 0) throw new Error("div0");
      return fmt(toNumber(args[0]) % d);
    }
    case "SQRT": return fmt(Math.sqrt(toNumber(args[0])));
    case "POWER": return fmt(Math.pow(toNumber(args[0]), toNumber(args[1])));
    case "IF": return truthy(args[0]) ? (args[1] ?? 0) : (args[2] ?? 0);
    case "AND": return flat.every(truthy);
    case "OR": return flat.some(truthy);
    case "NOT": return !truthy(args[0]);
    case "LEN": return stringify(args[0]).length;
    case "UPPER": return stringify(args[0]).toUpperCase();
    case "LOWER": return stringify(args[0]).toLowerCase();
    case "TRIM": return stringify(args[0]).trim().replace(/\s+/g, " ");
    case "CONCAT":
    case "CONCATENATE": return flat.map(stringify).join("");
    case "TODAY": {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    case "NOW": {
      const d = new Date();
      return d.toISOString().slice(0, 16).replace("T", " ");
    }
    default: throw new Error(`unsupported ${name}`);
  }
}

/**
 * Evaluate one formula string (without leading `=`) against a cell getter.
 * Returns a number/string/boolean, or null when it can't be computed.
 */
export function evaluateFormula(expr: string, getCell: CellGetter): Value {
  try {
    let src = String(expr ?? "").trim();
    if (src.startsWith("=")) src = src.slice(1);
    if (!src) return null;
    const v = new Parser(src, getCell).parse() as Value;
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    if (Array.isArray(v)) return null;
    return (v ?? null) as Value;
  } catch {
    return null;
  }
}

function cellType(v: Value): string {
  if (typeof v === "number") return "n";
  if (typeof v === "boolean") return "b";
  return "s";
}

/**
 * Walk a SheetJS worksheet and fill cached values for formula cells that
 * lack them (openpyxl-written files). Cells that already have a cached
 * value, and formulas that fail/cycle, are left untouched. Mutates `ws`.
 */
export function fillFormulaValues(ws: Record<string, any>): void {
  if (!ws || typeof ws !== "object") return;
  const resolving = new Set<string>();

  const rawOf = (row: number, col: number): unknown => {
    const addr = cellAddr(row, col);
    const c = ws[addr];
    if (!c || typeof c !== "object") return null;
    if (c.f !== undefined && c.f !== null && String(c.f) !== "") {
      if (resolving.has(addr)) return null;
      if (c.v === undefined || c.v === null || c.v === "") {
        resolving.add(addr);
        try {
          const v = evaluateFormula(String(c.f), rawOf);
          if (v !== null && !Array.isArray(v)) {
            c.v = v;
            c.t = cellType(v);
          }
        } catch {
          // leave blank
        } finally {
          resolving.delete(addr);
        }
      }
    }
    const v = c.v;
    return v === undefined ? null : v;
  };

  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) continue;
    const c = ws[key] as { f?: unknown; v?: unknown; t?: string } | null;
    if (!c || typeof c !== "object") continue;
    if (c.f === undefined || c.f === null || String(c.f) === "") continue;
    if (c.v !== undefined && c.v !== null && c.v !== "") continue;
    try {
      const v = evaluateFormula(String(c.f), rawOf);
      if (v !== null && !Array.isArray(v)) {
        c.v = v;
        c.t = cellType(v);
      }
    } catch {
      // leave the cell blank rather than failing the whole sheet
    }
  }
}

function cellAddr(row: number, col: number): string {
  let s = "";
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s}${row + 1}`;
}
