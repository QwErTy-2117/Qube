import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { resolvePathInWorkspace, relativePathInWorkspace } from "@/lib/middleware/workspace";
import { detectArtifactKind } from "@/lib/artifact/kinds";
import { parseDelimited } from "@/lib/artifact/delimited";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PREVIEW_BYTES = 25_000_000;
const MAX_TEXT_BYTES = 1_500_000;
const MAX_DOC_HTML_BYTES = 6_000_000;

async function extractDocxHtml(resolved: string): Promise<string> {
  const buf = await readFile(resolved);
  if (buf.length > MAX_PREVIEW_BYTES) throw new Error("Document too large to preview (25MB max)");
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const html = (value || "").slice(0, MAX_DOC_HTML_BYTES);
  if (!html.replace(/<[^>]+>/g, "").trim()) throw new Error("No readable text found in this document");
  return html;
}

async function extractDocxText(resolved: string): Promise<string> {
  const buf = await readFile(resolved);
  if (buf.length > MAX_PREVIEW_BYTES) throw new Error("Document too large to preview (25MB max)");
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  const text = (value || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No readable text found in this document");
  return text;
}

/** Presentation order comes from the slide ID list, not from filenames. */
async function extractPptxSlides(resolved: string): Promise<Array<{ title: string; body: string }>> {
  const buf = await readFile(resolved);
  if (buf.length > MAX_PREVIEW_BYTES) throw new Error("Presentation too large to preview (25MB max)");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const order: string[] = [];
  try {
    const presXml = await zip.file("ppt/presentation.xml")?.async("string");
    const ids = presXml?.match(/<p:sldId[^>]*r:id="([^"]+)"/g) || [];
    const relsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    for (const m of ids) {
      const rid = /r:id="([^"]+)"/.exec(m)?.[1];
      if (!rid || !relsXml) continue;
      const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(relsXml)?.[1];
      if (target) order.push(target.replace(/^slides\//, ""));
    }
  } catch {}
  let files = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (order.length > 0) {
    const ordered = order.map((n) => `ppt/slides/${n}`).filter((n) => files.includes(n));
    const rest = files.filter((n) => !ordered.includes(n)).sort();
    files = [...ordered, ...rest];
  } else {
    files.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  }
  const slides: Array<{ title: string; body: string }> = [];
  for (const name of files.slice(0, 200)) {
    try {
      const xml = await zip.file(name)?.async("string");
      if (!xml) continue;
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
      if (texts.length === 0) continue;
      slides.push({ title: texts[0].slice(0, 200), body: texts.slice(1).join("\n").slice(0, 4000) });
    } catch {}
  }
  if (slides.length === 0) throw new Error("No readable slides found in this presentation");
  return slides;
}

const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLS = 60;

function readWorkbook(buffer: Buffer) {
  return import("xlsx").then(async (XLSX) => {
    const wb = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: true });
    // Agent scripts (openpyxl) write formulas WITHOUT cached values; fill them
    // in so the viewer and the CLI agree on what Excel would show.
    try {
      const { fillFormulaValues } = await import("@/lib/workspace/spreadsheet-formulas");
      for (const name of wb.SheetNames.slice(0, 20)) fillFormulaValues(wb.Sheets[name]);
    } catch {}
    const sheets = wb.SheetNames.slice(0, 20).map((name) => {
      const ws = wb.Sheets[name];
      const ref = ws["!ref"] || "A1";
      const range = XLSX.utils.decode_range(ref);
      const rowCount = Math.min(MAX_SHEET_ROWS, range.e.r + 1);
      const colCount = Math.min(MAX_SHEET_COLS, range.e.c + 1);
      const rows: string[][] = [];
      const formulas: Record<string, string> = {};
      for (let r = 0; r < rowCount; r++) {
        const row: string[] = [];
        for (let c = 0; c < colCount; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as
            | { v?: unknown; w?: string; f?: string; t?: string }
            | undefined;
          if (!cell) {
            row.push("");
            continue;
          }
          const formatted =
            cell.w !== undefined && cell.w !== ""
              ? String(cell.w)
              : cell.v === undefined || cell.v === null
                ? ""
                : String(cell.v);
          row.push(formatted.slice(0, 1000));
          if (typeof cell.f === "string" && cell.f && cell.f !== "undefined") {
            formulas[`${r}:${c}`] = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
          }
        }
        rows.push(row);
      }
      // Trim fully empty trailing rows so the grid does not look padded.
      while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === "")) rows.pop();
      return { name, rowCount: rows.length, colCount, rows, formulas };
    });
    // SheetJS silently drops formula cells that carry no cached value (what
    // openpyxl and Qube's own writer produce), so formulas are re-read from
    // the raw sheet XML and merged back in.
    try {
      const JSZip = (await import("jszip")).default;
      const { extractSheetFormulas } = await import("@/lib/workspace/xlsx-formulas");
      const zip = await JSZip.loadAsync(buffer);
      const extracted = await extractSheetFormulas(zip);
      for (const sheet of sheets) {
        const found = extracted[sheet.name];
        if (!found) continue;
        for (const [key, formula] of Object.entries(found)) {
          sheet.formulas[key] = formula;
        }
      }
    } catch {
      // Never fail a workbook over formula recovery.
    }
    return sheets;
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rel = url.searchParams.get("path") || "";
    const wantedFormat = url.searchParams.get("format");
    if (!rel) return Response.json({ ok: false, error: "path required" }, { status: 400 });

    let resolved: string;
    try {
      resolved = resolvePathInWorkspace(rel);
    } catch {
      return Response.json({ ok: false, error: "Path escapes workspace" }, { status: 403 });
    }
    const info = await stat(resolved).catch(() => null);
    if (!info || !info.isFile()) {
      return Response.json({ ok: false, error: "File not found" }, { status: 404 });
    }
    const ext = extname(resolved).toLowerCase();
    const kind = detectArtifactKind(resolved);
    const relativePath = relativePathInWorkspace(resolved);
    const filename = relativePath.split("/").pop() || relativePath;
    const encodePath = (p: string) => p.split("/").map((x) => encodeURIComponent(x)).join("/");
    const downloadUrl = `/api/files/${encodePath(relativePath)}`;
    const base = { ok: true, kind, filename, relativePath, size: info.size, downloadUrl };

    if (kind === "sheet") {
      if (info.size > MAX_PREVIEW_BYTES) {
        return Response.json({ ok: false, error: "Spreadsheet too large to preview (25MB max)" }, { status: 413 });
      }
      try {
        const buf = await readFile(resolved);
        if (ext === ".csv" || ext === ".tsv") {
          const delimiter = ext === ".tsv" ? "\t" : ",";
          const text = buf.toString("utf-8");
          const rows = parseDelimited(text, delimiter).slice(0, MAX_SHEET_ROWS);
          const colCount = Math.max(1, ...rows.map((r) => r.length));
          return Response.json({
            ...base,
            sheets: [{ name: filename.replace(/\.[^.]+$/, "") || "Sheet1", rowCount: rows.length, colCount, rows, formulas: {} }],
          });
        }
        const sheets = await readWorkbook(buf);
        return Response.json({ ...base, sheets });
      } catch (e) {
        return Response.json(
          { ok: false, error: `Spreadsheet parse failed: ${(e as Error).message.slice(0, 300)}` },
          { status: 422 },
        );
      }
    }

    if (kind === "slides") {
      try {
        const slides = await extractPptxSlides(resolved);
        return Response.json({ ...base, slides, note: "Rendered with the presentation viewer." });
      } catch (e) {
        return Response.json(
          { ok: false, error: `Presentation parse failed: ${(e as Error).message.slice(0, 300)}` },
          { status: 422 },
        );
      }
    }

    if (kind === "doc" && (ext === ".docx" || ext === ".dotx")) {
      if (wantedFormat === "html") {
        try {
          const html = await extractDocxHtml(resolved);
          return Response.json({ ...base, html });
        } catch (e) {
          return Response.json(
            { ok: false, error: `Document parse failed: ${(e as Error).message.slice(0, 300)}` },
            { status: 422 },
          );
        }
      }
      try {
        const content = await extractDocxText(resolved);
        return Response.json({ ...base, content: content.slice(0, 400_000), lineCount: content.split("\n").length });
      } catch (e) {
        return Response.json(
          { ok: false, error: `Document parse failed: ${(e as Error).message.slice(0, 300)}` },
          { status: 422 },
        );
      }
    }

    if (kind === "doc" && [".doc", ".odt", ".rtf"].includes(ext)) {
      return Response.json(
        {
          ok: false,
          error: `Legacy .${ext.slice(1)} files can’t be read directly. Ask Qube to convert this file to .docx first.`,
        },
        { status: 422 },
      );
    }

    if (kind === "html") {
      if (info.size > 2_000_000) {
        return Response.json({ ok: false, error: "HTML file too large to preview (2MB max)" }, { status: 413 });
      }
      const content = (await readFile(resolved)).toString("utf-8");
      return Response.json({ ...base, content });
    }

    if (kind === "pdf") {
      return Response.json(base);
    }

    // code / text / markdown
    if (info.size > MAX_TEXT_BYTES) {
      return Response.json({ ok: false, error: "File too large to preview (1.5MB max)" }, { status: 413 });
    }
    const buf = await readFile(resolved);
    const text = buf.toString("utf-8");
    return Response.json({
      ...base,
      content: text.slice(0, 500_000),
      lineCount: text.split("\n").length,
      truncated: text.length > 500_000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspace/document] failed:", msg.slice(0, 300));
    return Response.json({ ok: false, error: "Document load failed" }, { status: 500 });
  }
}

const EDITABLE_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".js", ".ts", ".tsx", ".jsx",
  ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".css", ".html",
  ".xml", ".yml", ".yaml", ".toml", ".sh", ".sql", ".csv", ".log",
]);

/** Direct in-popup editing for plain-text files and spreadsheet grids. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rel = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : null;
    if (!rel) return Response.json({ ok: false, error: "path required" }, { status: 400 });
    let resolved: string;
    try {
      resolved = resolvePathInWorkspace(rel);
    } catch {
      return Response.json({ ok: false, error: "Path escapes workspace" }, { status: 403 });
    }
    const { extname: extOf, dirname } = await import("node:path");
    const ext = extOf(resolved).toLowerCase();
    const { mkdir, writeFile } = await import("node:fs/promises");

    // Spreadsheets: full grid round-trip (formulas persist as formulas).
    if (Array.isArray((body as { sheets?: unknown }).sheets)) {
      const sheets = (body as { sheets: Array<{ name?: string; rows?: unknown[][] }> }).sheets;
      if (ext === ".csv") {
        const first = sheets[0];
        const rows = Array.isArray(first?.rows) ? first.rows : [];
        const esc = (c: unknown) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const text = rows.map((r) => (Array.isArray(r) ? r : []).map(esc).join(",")).join("\n");
        if (text.length > 5_000_000) return Response.json({ ok: false, error: "Content too large" }, { status: 413 });
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, text, "utf-8");
        return Response.json({ ok: true });
      }
      if (ext !== ".xls" && ext !== ".xlsx") {
        return Response.json({ ok: false, error: "This file type can’t be edited directly — ask the AI" }, { status: 415 });
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const list = sheets.slice(0, 20);
      if (list.length === 0) return Response.json({ ok: false, error: "No sheets to save" }, { status: 400 });
      for (const [i, sh] of list.entries()) {
        const rows = Array.isArray(sh?.rows)
          ? sh.rows.slice(0, 5000).map((r) => (Array.isArray(r) ? r.slice(0, 60).map((c) => String(c ?? "")) : []))
          : [];
        // Drop trailing empty rows so the saved file stays tidy.
        while (rows.length > 0 && (rows[rows.length - 1] as string[]).every((c) => c === "")) rows.pop();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        for (const key of Object.keys(ws)) {
          if (key.startsWith("!")) continue;
          const cell = (ws as Record<string, { v?: unknown; f?: string; t?: string }>)[key];
          if (cell && typeof cell.v === "string" && cell.v.startsWith("=") && cell.v.length > 1) {
            (ws as Record<string, unknown>)[key] = { t: "n", f: cell.v.slice(1) };
          }
        }
        XLSX.utils.book_append_sheet(wb, ws, String(sh?.name || `Sheet${i + 1}`).slice(0, 31));
      }
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      if (buf.length > 25_000_000) return Response.json({ ok: false, error: "Content too large" }, { status: 413 });
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, buf);
      return Response.json({ ok: true });
    }

    // Word documents: paragraph round-trip (text preserved, styling reset).
    if (Array.isArray((body as { paragraphs?: unknown }).paragraphs)) {
      if (ext !== ".docx") {
        return Response.json({ ok: false, error: "This file type can’t be edited directly — ask the AI" }, { status: 415 });
      }
      const paragraphs = (body as { paragraphs: unknown[] }).paragraphs.map((p) => String(p ?? ""));
      if (paragraphs.join("\n").length > 1_000_000) {
        return Response.json({ ok: false, error: "Content too large (1MB max)" }, { status: 413 });
      }
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const doc = new Document({
        sections: [
          {
            children: paragraphs.flatMap((p) => {
              const lines = p.split("\n");
              return lines.map((line, i) => new Paragraph({
                children: [new TextRun(line)],
                spacing: i === lines.length - 1 ? { after: 200 } : undefined,
              }));
            }),
          },
        ],
      });
      const buf = await Packer.toBuffer(doc);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, buf);
      return Response.json({ ok: true });
    }

    if (content === null) return Response.json({ ok: false, error: "content required" }, { status: 400 });
    if (content.length > 1_000_000) {
      return Response.json({ ok: false, error: "Content too large (1MB max)" }, { status: 413 });
    }
    if (!EDITABLE_EXTS.has(ext)) {
      return Response.json({ ok: false, error: "This file type can’t be edited directly — ask the AI" }, { status: 415 });
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspace/document] save failed:", msg.slice(0, 300));
    return Response.json({ ok: false, error: "Save failed" }, { status: 500 });
  }
}
