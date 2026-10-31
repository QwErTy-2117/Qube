/**
 * Read formulas straight out of an .xlsx zip.
 *
 * SheetJS drops cells that carry a formula but no cached value
 * (`<c r="D2"><f>B2*C2</f><v></v></c>`) — which is exactly what openpyxl and
 * Qube's own writer produce. Without this pass a spreadsheet written by the
 * agent would reopen with its formulas erased, so the raw XML is the source
 * of truth for formulas and SheetJS stays the source for values/formats.
 *
 * Shared formulas (`<f t="shared" si="0" ref="D2:D4">…`) are expanded by
 * translating the master formula per cell, respecting `$` anchors.
 */

import type JSZip from "jszip";
import { splitRef, translateFormula } from "./a1-refs";

export { splitRef, translateFormula };

export type SheetFormulas = Record<string, Record<string, string>>;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

type CellNode = { ref: string; xml: string };

function cellsInSheet(xml: string): CellNode[] {
  const cells: CellNode[] = [];
  const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    const attrs = m[1] || "";
    const ref = /\br="([A-Za-z]{1,3}\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    cells.push({ ref, xml: m[2] || "" });
  }
  return cells;
}

function formulaIn(cellXml: string): { text: string; sharedId?: string } | null {
  const m = /<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cellXml);
  if (!m) return null;
  const attrs = m[1] || "";
  const text = decodeXml(m[2] || "").trim();
  const sharedId = /\bt="shared"/.test(attrs) ? /\bsi="(\d+)"/.exec(attrs)?.[1] : undefined;
  if (!text && !sharedId) return null;
  return { text, sharedId };
}

/** Formulas keyed by sheet name → "row:col" (0-based) → "=FORMULA". */
export async function extractSheetFormulas(zip: JSZip): Promise<SheetFormulas> {
  const out: SheetFormulas = {};
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) return out;
  const workbookXml = await workbookFile.async("string");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  const relsXml = relsFile ? await relsFile.async("string") : "";

  // rId → worksheet path
  const targets = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(relsXml)) !== null) {
    const id = /\bId="([^"]+)"/.exec(rel[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel[1])?.[1];
    if (!id || !target) continue;
    const normalized = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    targets.set(id, normalized);
  }

  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sheet: RegExpExecArray | null;
  while ((sheet = sheetRe.exec(workbookXml)) !== null) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(sheet[1])?.[1] || "");
    const rid = /\br:id="([^"]+)"/.exec(sheet[1])?.[1];
    if (!name || !rid) continue;
    const path = targets.get(rid);
    const file = path ? zip.file(path) : null;
    if (!file) continue;
    const xml = await file.async("string");
    const found: Record<string, string> = {};
    const sharedMasters = new Map<string, { formula: string; row: number; col: number }>();
    for (const cell of cellsInSheet(xml)) {
      const parsed = formulaIn(cell.xml);
      const ref = splitRef(cell.ref);
      if (!parsed || !ref) continue;
      const key = `${ref.row}:${ref.col}`;
      if (parsed.sharedId && !parsed.text && sharedMasters.has(parsed.sharedId)) {
        const master = sharedMasters.get(parsed.sharedId)!;
        found[key] = `=${translateFormula(master.formula, ref.row - master.row, ref.col - master.col)}`;
        continue;
      }
      if (!parsed.text) continue;
      if (parsed.sharedId) sharedMasters.set(parsed.sharedId, { formula: parsed.text, row: ref.row, col: ref.col });
      found[key] = parsed.text.startsWith("=") ? parsed.text : `=${parsed.text}`;
    }
    if (Object.keys(found).length > 0) out[name] = found;
  }
  return out;
}
