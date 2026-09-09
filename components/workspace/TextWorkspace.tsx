"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { saveDocumentContent, useDocument } from "./useDocument";

/** Inline markdown: **bold**, *italic*, `code`, [label](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyPrefix}-${k++}`} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={`${keyPrefix}-${k++}`}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={`${keyPrefix}-${k++}`} className="rounded bg-muted px-1 font-mono text-[13px]">{tok.slice(1, -1)}</code>);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) {
        out.push(<a key={`${keyPrefix}-${k++}`} href={lm[2]} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary underline">{lm[1]}</a>);
      } else {
        out.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render markdown source as formatted output (always rendered, never raw). */
type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; aligns: Array<"left" | "center" | "right">; rows: string[][] }
  | { kind: "para"; lines: string[] };

function splitTableRow(line: string): string[] {
  const t = line.trim().replace(/^\||\|$/g, "");
  return t.split("|").map((c) => c.trim());
}

function isDelimRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function parseAlign(cells: string[]): Array<"left" | "center" | "right"> {
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/**
 * Block tokenizer: headings, quotes, list items, and table rows ALWAYS
 * start a new block (agents often omit blank lines between them).
 */
export function tokenizeMarkdown(content: string): MdBlock[] {
  const lines = content.split("\n");
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "para", lines: para });
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", lines: q });
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim() && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const raw: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        raw.push(splitTableRow(lines[i]));
        i++;
      }
      if (raw.length >= 2 && isDelimRow(raw[1])) {
        flushPara();
        blocks.push({ kind: "table", header: raw[0], aligns: parseAlign(raw[1]), rows: raw.slice(2) });
      } else {
        for (const r of raw) para.push(`| ${r.join(" | ")} |`);
      }
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function renderMarkdown(content: string): ReactNode {
  const blocks = tokenizeMarkdown(content);
  return blocks.map((block, idx) => {
    const key = `b${idx}`;
    switch (block.kind) {
      case "heading": {
        const kids = renderInline(block.text, key);
        if (block.level === 1) return <h1 key={key} className="mt-6 mb-3 text-xl font-bold text-foreground">{kids}</h1>;
        if (block.level === 2) return <h2 key={key} className="mt-5 mb-2.5 text-lg font-bold text-foreground">{kids}</h2>;
        return <h3 key={key} className="mt-4 mb-2 text-[15px] font-bold text-foreground">{kids}</h3>;
      }
      case "quote":
        return (
          <blockquote key={key} className="mb-4 border-l-2 border-primary/50 pl-3 text-[15px] leading-7 text-foreground/80">
            {block.lines.map((l, i) => (
              <span key={i}>{renderInline(l, `${key}-q${i}`)}{i < block.lines.length - 1 && <br />}</span>
            ))}
          </blockquote>
        );
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={key} className={`mb-4 space-y-1 text-[15px] leading-7 text-foreground/90 ${block.ordered ? "list-decimal pl-6" : "list-disc pl-6"}`}>
            {block.items.map((item, i) => (
              <li key={i}>{renderInline(item, `${key}-li${i}`)}</li>
            ))}
          </List>
        );
      }
      case "table": {
        const colCount = Math.max(block.header.length, ...block.rows.map((r) => r.length));
        const cell = (r: string[], c: number) => r[c] ?? "";
        const align = (c: number) => block.aligns[c] ?? "left";
        return (
          <div key={key} className="mb-4 overflow-hidden rounded-lg border border-border/70">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {Array.from({ length: colCount }).map((_, c) => (
                      <th key={c} style={{ textAlign: align(c) }} className="px-4 py-2 font-medium text-foreground">
                        {renderInline(cell(block.header, c), `${key}-h${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((r, ri) => (
                    <tr key={ri} className="border-t border-border/50">
                      {Array.from({ length: colCount }).map((_, c) => (
                        <td key={c} style={{ textAlign: align(c) }} className="px-4 py-2 text-foreground/90">
                          {renderInline(cell(r, c), `${key}-r${ri}c${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      case "para":
        return (
          <p key={key} className="mb-4 text-[15px] leading-7 whitespace-pre-wrap text-foreground/90">
            {block.lines.map((l, i) => (
              <span key={i}>{renderInline(l, `${key}-l${i}`)}{i < block.lines.length - 1 && <br />}</span>
            ))}
          </p>
        );
    }
  });
}

export function TextWorkspace({ filePath }: { filePath: string; downloadUrl: string }) {
  const { data, loading, error, reload } = useDocument(filePath);
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  const content = useMemo(() => (data && "content" in data ? String(data.content) : ""), [data]);

  // Always editable, single whole-document editor: null = rendered view,
  // string = editing the entire document at once (never per-section).
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastQuoteAt = useRef(0);

  // Server reload (e.g. after the agent edits) exits editing.
  useEffect(() => {
    setDraft(null);
  }, [content]);

  const persist = async (value: string) => {
    if (value === content) {
      setDraft(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveDocumentContent(filePath, value);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1800);
      setDraft(null);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const quoteSelection = () => {
    if (draft !== null) return;
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    const idx = content.indexOf(sel.slice(0, 40));
    const startLine = idx >= 0 ? content.slice(0, idx).split("\n").length : 1;
    const endLine = startLine + sel.split("\n").length - 1;
    addSelection({ kind: "text", startLine, endLine, text: sel.slice(0, 3000) });
    lastQuoteAt.current = Date.now();
    window.getSelection()?.removeAllRanges();
  };

  const openEditor = () => {
    if (draft !== null) return;
    // A click right after quoting text is a selection gesture, not an edit.
    if (Date.now() - lastQuoteAt.current < 400) return;
    if (window.getSelection()?.toString()) return;
    setDraft(content);
  };

  const status = saving ? "Saving…" : saveError ? saveError : savedTick ? "Saved" : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-doc-scroll className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5" onMouseUp={quoteSelection}>
        {status && (
          <div className="sticky top-0 z-10 mx-auto mb-2 w-fit rounded-[26px] border border-[#e7e7e7] bg-white shadow-xl shadow-black/10">
            <div className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-tight leading-none ${saveError ? "text-red-600" : "text-[#1e4d2f]"}`}>
              {saving && <Loader2Icon className="size-3.5 animate-spin" />}
              {!saving && !saveError && <CheckIcon className="size-3.5 text-emerald-500" />}
              {status}
            </div>
          </div>
        )}
        {loading ? <p className="text-xs text-muted-foreground">Loading…</p>
        : error ? <p className="text-xs text-red-400">{error}</p>
        : draft !== null ? (
          <div className="mx-auto max-w-[580px]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void persist(draft)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.stopPropagation(); setDraft(null); }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void persist(draft); }
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              spellCheck={false}
              aria-label="Edit document"
              rows={Math.max(draft.split("\n").length + 1, 10)}
              placeholder="Start writing…"
              className="w-full resize-none overflow-hidden bg-transparent text-[15px] leading-7 whitespace-pre-wrap text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : content.trim() ? (
          <div className="mx-auto max-w-[580px] cursor-text rounded-md transition-colors hover:bg-muted/30" onClick={openEditor} title="Click to edit">
            {renderMarkdown(content)}
          </div>
        ) : (
          <div className="mx-auto max-w-[580px]">
            <button
              onClick={() => setDraft("")}
              className="w-full rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground/70 transition hover:border-ring/50 hover:text-foreground"
            >
              Empty document — click to start writing.
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
