import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { resolvePathInWorkspace, relativePathInWorkspace } from "@/lib/middleware/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".json", ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".css", ".html", ".xml", ".yml", ".yaml", ".toml", ".sh", ".sql", ".csv", ".log"]);
const MAX_TEXT_BYTES = 1_000_000;

function kindFor(ext: string): "pdf" | "doc" | "sheet" | "slides" | "code" | "text" | "csv" | "unknown" {
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx" || ext === ".odt" || ext === ".rtf") return "doc";
  if (ext === ".xls" || ext === ".xlsx" || ext === ".ods") return "sheet";
  if (ext === ".csv") return "csv";
  if (ext === ".ppt" || ext === ".pptx" || ext === ".odp") return "slides";
  if ([".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".css", ".html", ".json", ".yml", ".yaml", ".toml", ".sh", ".sql"].includes(ext)) return "code";
  if ([".txt", ".md", ".markdown", ".log", ".xml"].includes(ext)) return "text";
  return "unknown";
}

async function extractDocxText(resolved: string, ext: string): Promise<string> {
  if (ext !== ".docx") throw new Error(`.${ext.slice(1)} needs conversion — ask the AI to convert it`);
  const buf = await readFile(resolved);
  if (buf.length > MAX_TEXT_BYTES * 5) throw new Error("Document too large to preview");
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  const text = (value || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No readable text found in document");
  return text;
}

async function extractPptxSlides(
  resolved: string,
  ext: string,
): Promise<Array<{ title: string; body: string }>> {
  if (ext !== ".pptx") throw new Error(`.${ext.slice(1)} needs conversion — ask the AI to convert it`);
  const buf = await readFile(resolved);
  if (buf.length > 25_000_000) throw new Error("Presentation too large to preview");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  // Presentation order comes from the slide ID list, not filenames.
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
    files.sort();
  }
  const slides: Array<{ title: string; body: string }> = [];
  for (const name of files.slice(0, 100)) {
    try {
      const xml = await zip.file(name)?.async("string");
      if (!xml) continue;
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
      if (texts.length === 0) continue;
      slides.push({ title: texts[0].slice(0, 200), body: texts.slice(1).join("\n").slice(0, 4000) });
    } catch {}
  }
  if (slides.length === 0) throw new Error("No readable slides found in presentation");
  return slides;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rel = url.searchParams.get("path") || "";
    if (!rel) return Response.json({ ok: false, error: "path required" }, { status: 400 });
    let resolved: string;
    try {
      resolved = resolvePathInWorkspace(rel);
    } catch (e) {
      return Response.json({ ok: false, error: "Path escapes workspace" }, { status: 403 });
    }
    const s = await stat(resolved).catch(() => null);
    if (!s || !s.isFile()) return Response.json({ ok: false, error: "File not found" }, { status: 404 });
    if (s.size > 25_000_000) return Response.json({ ok: false, error: "File too large to preview (25MB max)" }, { status: 413 });
    const ext = extname(resolved).toLowerCase();
    const kind = kindFor(ext);
    const relativePath = relativePathInWorkspace(resolved);
    const filename = relativePath.split("/").pop() || relativePath;

    if (kind === "sheet" || kind === "csv") {
      try {
        const buf = await readFile(resolved);
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "buffer" });
        const sheets = wb.SheetNames.slice(0, 20).map((name) => {
          const ws = wb.Sheets[name];
          const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
          const trimmed = rows.slice(0, 200).map((r) => (Array.isArray(r) ? r.slice(0, 26).map((c) => String(c ?? "").slice(0, 300)) : []));
          return { name, rowCount: rows.length, colCount: Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))), rows: trimmed };
        });
        return Response.json({ ok: true, kind, filename, relativePath, size: s.size, sheets });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ ok: false, error: `Spreadsheet parse failed: ${msg.slice(0, 300)}` }, { status: 422 });
      }
    }

    if (TEXT_EXTS.has(ext) || kind === "code" || kind === "text") {
      const buf = await readFile(resolved);
      if (buf.length > MAX_TEXT_BYTES) return Response.json({ ok: false, error: "Text file too large to preview (1MB max)" }, { status: 413 });
      const text = buf.toString("utf-8");
      const lines = text.split("\n");
      return Response.json({ ok: true, kind, filename, relativePath, size: s.size, lineCount: lines.length, content: text.slice(0, 200_000), truncated: text.length > 200_000 });
    }

    // Word documents: extract real text server-side so it renders.
    if (kind === "doc") {
      try {
        const text = await extractDocxText(resolved, ext);
        const lines = text.split("\n");
        return Response.json({ ok: true, kind, filename, relativePath, size: s.size, lineCount: lines.length, content: text.slice(0, 200_000), truncated: text.length > 200_000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ ok: false, error: `Document parse failed: ${msg.slice(0, 300)}` }, { status: 422 });
      }
    }

    // Presentations: extract per-slide text server-side so slides render.
    if (kind === "slides") {
      try {
        const slides = await extractPptxSlides(resolved, ext);
        return Response.json({ ok: true, kind, filename, relativePath, size: s.size, slides });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ ok: false, error: `Presentation parse failed: ${msg.slice(0, 300)}` }, { status: 422 });
      }
    }

    // Remaining binaries (e.g. pdf): preview via /api/files iframe + metadata.
    const encodePath = (p: string) => p.split("/").map((x) => encodeURIComponent(x)).join("/");
    const downloadUrl = `/api/files/${encodePath(relativePath)}`;
    return Response.json({ ok: true, kind, filename, relativePath, size: s.size, downloadUrl, note: "Binary preview — use Open to view, select text to quote, and Ask AI to modify via the agent." });
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

/** Direct in-popup editing for plain-text files (workspace-scoped). */
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

    // Spreadsheets: full grid round-trip (same view, inline cell edits).
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
        return Response.json({ ok: false, error: "This file type can't be edited directly — ask the AI" }, { status: 415 });
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const list = sheets.slice(0, 20);
      if (list.length === 0) return Response.json({ ok: false, error: "No sheets to save" }, { status: 400 });
      for (const [i, sh] of list.entries()) {
        const rows = Array.isArray(sh?.rows) ? sh.rows.slice(0, 500).map((r) => (Array.isArray(r) ? r.slice(0, 50).map((c) => String(c ?? "")) : [])) : [];
        const ws = XLSX.utils.aoa_to_sheet(rows);
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
        return Response.json({ ok: false, error: "This file type can't be edited directly — ask the AI" }, { status: 415 });
      }
      const paragraphs = (body as { paragraphs: unknown[] }).paragraphs.map((p) => String(p ?? ""));
      if (paragraphs.join("\n").length > 1_000_000) return Response.json({ ok: false, error: "Content too large (1MB max)" }, { status: 413 });
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const doc = new Document({
        sections: [{
          children: paragraphs.flatMap((p) => {
            const lines = p.split("\n");
            return lines.map((line, i) => new Paragraph({
              children: [new TextRun(line)],
              spacing: i === lines.length - 1 ? { after: 200 } : undefined,
            }));
          }),
        }],
      });
      const buf = await Packer.toBuffer(doc);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, buf);
      return Response.json({ ok: true });
    }

    if (content === null) return Response.json({ ok: false, error: "content required" }, { status: 400 });
    if (content.length > 1_000_000) return Response.json({ ok: false, error: "Content too large (1MB max)" }, { status: 413 });
    if (!EDITABLE_EXTS.has(ext.toLowerCase())) {
      return Response.json({ ok: false, error: "This file type can't be edited directly — ask the AI" }, { status: 415 });
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
