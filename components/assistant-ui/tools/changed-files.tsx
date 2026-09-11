"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { extractFileRefsFromText } from "@/components/assistant-ui/md-file-ref";
import { DiffView } from "./diff-view";
import { cn } from "@/lib/utils";

type FileDiff = {
  oldText: string;
  newText: string;
};

type FileChange = {
  path: string;
  action: string;
  added: number;
  removed: number;
  deleted: boolean;
  diffs: FileDiff[];
};

type Row = { kind: "file"; change: FileChange };

function parseResult(r: unknown): Record<string, unknown> | null {
  try {
    if (typeof r === "string") return JSON.parse(r) as Record<string, unknown>;
    if (r && typeof r === "object") return r as Record<string, unknown>;
  } catch {}
  return null;
}

function countLines(t: unknown): number {
  return typeof t === "string" && t.length > 0 ? t.split("\n").length : 0;
}

function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf("/");
  if (i < 0) return { dir: "", base: path };
  return { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

function encodePath(p: string): string {
  return p.split("/").map((s) => encodeURIComponent(s)).join("/");
}

// Viewer popup is only for documents, spreadsheets and code.
// Images, PDFs, presentations, etc. are download-only.
const VIEWABLE = new Set([
  "doc", "docx", "odt", "rtf", "txt", "md", "markdown",
  "xls", "xlsx", "ods", "csv", "tsv",
  "json", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "yml", "yaml", "toml", "sh", "sql", "xml", "log",
]);

function isViewable(path: string): boolean {
  const base = path.split("/").pop() || path;
  const ext = base.split(".").pop()?.toLowerCase() || "";
  return VIEWABLE.has(ext);
}

/**
 * Compressed tool summary at the end of an assistant message: one row
 * per file the message created / edited / deleted (with diff counts).
 * Renders nothing while the message is still running, nothing when the
 * message touched no files, and nothing when the message presents
 * deliverables (the bottom PresentedFiles list owns the file UI then).
 * Clicking a file row expands its diff inline (scrollable past a height
 * cap); the open icon launches it in the document popup.
 */
export function ChangedFiles() {
  const content = useAuiState((s) => s.message.content);
  const messageStatus = useAuiState(
    (s) => (s.message as unknown as { status?: { type?: string } }).status?.type,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { rows, hasPresented } = useMemo(() => {
    const map = new Map<string, FileChange>();
    const rows: Row[] = [];
    const seen = new Set<string>();
    const presented = new Set<string>();
    const pushFile = (key: string) => {
      if (seen.has(key) || presented.has(key)) return;
      seen.add(key);
      const change = map.get(key);
      if (change) rows.push({ kind: "file", change });
    };
    const parts = ((content || []) as unknown) as Array<Record<string, unknown>>;
    // First pass: files the agent already showed in the bottom
    // PresentedFiles list — via present_file calls AND via [file:]/
    // present_file(...) markers written as text.
    for (const p of parts) {
      if (!p) continue;
      if (p.type === "text" && typeof (p as { text?: unknown }).text === "string") {
        for (const ref of extractFileRefsFromText((p as { text: string }).text)) presented.add(ref);
        continue;
      }
      if (p.type !== "tool-call" || typeof p.toolName !== "string") continue;
      if (p.toolName !== "present_file") continue;
      const args = (p.args || {}) as Record<string, unknown>;
      const res = parseResult(p.result);
      const rel =
        (typeof res?.relativePath === "string" && (res.relativePath as string)) ||
        (typeof args.path === "string" ? args.path.trim() : "");
      if (rel && !(res as Record<string, unknown> | null)?.error) presented.add(rel);
    }
    for (const p of parts) {
      if (!p || p.type !== "tool-call" || typeof p.toolName !== "string") continue;
      const args = (p.args || {}) as Record<string, unknown>;
      const res = parseResult(p.result);
      if (p.toolName === "write_file" || p.toolName === "edit_file") {
        const rawPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!rawPath) continue;
        const ok = p.toolName === "write_file" ? res?.status === "written" : res?.status === "edited";
        if (!ok) continue;
        const e = map.get(rawPath) ?? { path: rawPath, action: "Edit", added: 0, removed: 0, deleted: false, diffs: [] };
        e.added += p.toolName === "write_file" ? countLines(args.content) : countLines(args.newString);
        e.removed += p.toolName === "write_file" ? 0 : countLines(args.oldString);
        e.deleted = false;
        if (p.toolName === "write_file") {
          if (typeof args.content === "string" && args.content.length > 0) {
            e.diffs.push({ oldText: "", newText: args.content });
          }
        } else if (typeof args.oldString === "string" || typeof args.newString === "string") {
          e.diffs.push({
            oldText: typeof args.oldString === "string" ? args.oldString : "",
            newText: typeof args.newString === "string" ? args.newString : "",
          });
        }
        map.set(rawPath, e);
        pushFile(rawPath);
      } else if (p.toolName === "delete_file") {
        const rawPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!rawPath || res?.status !== "deleted") continue;
        map.set(rawPath, { path: rawPath, action: "Delete", added: 0, removed: 0, deleted: true, diffs: [] });
        pushFile(rawPath);
      }
      // NOTE: run_command rows intentionally omitted — this summary
      // lists edited files only, never the commands used.
    }
    return { rows, hasPresented: presented.size > 0 };
  }, [content]);

  // Only once the message has ended — never mid-stream — and only
  // when at least one edited file remains after de-duplication.
  // When the message presents deliverables, the slim PresentedFiles list
  // at the bottom owns the file UI (and the remaining rows would only be
  // intermediate builder scripts) — hide the summary to keep the bottom
  // clean.
  if (messageStatus === "running") return null;
  if (hasPresented) return null;
  if (rows.length === 0) return null;

  const shown = rows.map((r) => r.change);
  const totalAdded = shown.reduce((n, f) => n + f.added, 0);
  const totalRemoved = shown.reduce((n, f) => n + f.removed, 0);

  const openFile = (f: FileChange) => {
    if (f.deleted) return;
    // Workspace-relative paths open in the popup; absolute/external ones
    // can't be previewed, so do nothing for them here.
    if (f.path.startsWith("/") || f.path.startsWith("~")) return;
    // Only documents, spreadsheets and code get the viewer popup.
    // Images, PDFs, presentations, etc. are download-only.
    if (!isViewable(f.path)) return;
    const { base } = splitPath(f.path);
    openDocumentWorkspace({
      filePath: f.path,
      filename: base,
      downloadUrl: `/api/files/${encodePath(f.path)}`,
    });
  };

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="mt-2 mb-1">
      <div className="mb-1.5 flex items-baseline gap-2 px-1 text-sm">
        <span className="font-semibold text-foreground">
          {shown.length} Changed file{shown.length > 1 ? "s" : ""}
        </span>
        <span className="font-mono text-xs font-medium text-emerald-500">+{totalAdded}</span>
        <span className="font-mono text-xs font-medium text-red-500">-{totalRemoved}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="divide-y divide-border/50">
          {rows.map((row) => {
            const f = row.change;
            const { dir, base } = splitPath(f.path);
            const clickable = !f.deleted && !f.path.startsWith("/") && !f.path.startsWith("~") && isViewable(f.path);
            const hasDiff = !f.deleted && f.diffs.length > 0;
            const isOpen = expanded.has(f.path);
            return (
              <div key={f.path}>
                <div className="flex w-full items-center gap-1 px-3 py-2">
                  <button
                    onClick={() => (hasDiff ? toggle(f.path) : openFile(f))}
                    disabled={!hasDiff && !clickable}
                    title={hasDiff ? `${isOpen ? "Collapse" : "Expand"} diff for ${base}` : clickable ? `Open ${base}` : f.path}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm transition enabled:cursor-pointer enabled:hover:bg-accent/60 disabled:cursor-default"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                      <span className={f.deleted ? "text-muted-foreground line-through" : "text-foreground"}>{base}</span>
                      {dir && <span className="text-muted-foreground"> {dir}</span>}
                    </span>
                    {f.deleted ? (
                      <span className="shrink-0 text-xs font-medium text-red-500">deleted</span>
                    ) : (
                      <span className="flex min-w-[76px] shrink-0 items-center justify-end gap-2 font-mono text-xs">
                        {f.added > 0 && <span className="font-medium text-emerald-500">+{f.added}</span>}
                        {f.removed > 0 && <span className="font-medium text-red-500">-{f.removed}</span>}
                        {f.added === 0 && f.removed === 0 && <span className="text-muted-foreground">changed</span>}
                      </span>
                    )}
                    {hasDiff && (
                      <ChevronDownIcon
                        className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                      />
                    )}
                  </button>
                  {clickable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openFile(f);
                      }}
                      title={`Open ${base}`}
                      aria-label={`Open ${base}`}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <SquareArrowOutUpRightIcon className="size-3.5" />
                    </button>
                  )}
                </div>
                {hasDiff && isOpen && (
                  <div className="border-t border-border/50 px-2 py-2">
                    <div className="flex flex-col gap-2">
                      {f.diffs.map((d, i) => (
                        <DiffView
                          key={i}
                          oldContent={d.oldText}
                          newContent={d.newText}
                          className="max-h-[320px]"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
