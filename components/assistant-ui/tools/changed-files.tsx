"use client";

import { useMemo } from "react";
import { ChevronRightIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { extractFileRefsFromText } from "@/components/assistant-ui/md-file-ref";

type FileChange = {
  path: string;
  action: string;
  added: number;
  removed: number;
  deleted: boolean;
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

/**
 * Compressed tool summary at the end of an assistant message: one row
 * per file the message created / edited / deleted (with diff counts).
 * Renders nothing while the message is still running, nothing when the
 * message touched no files, and skips files the agent already presented
 * inline with present_file (no duplicates — shown exactly once).
 * Clicking a file row opens it in the document popup.
 */
export function ChangedFiles() {
  const content = useAuiState((s) => s.message.content);
  const messageStatus = useAuiState(
    (s) => (s.message as unknown as { status?: { type?: string } }).status?.type,
  );

  const { rows } = useMemo(() => {
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
    // First pass: files the agent already showed inline — via present_file
    // calls AND via [file:]/present_file(...) markers written as text
    // (rendered inline as cards by remarkFileRefs).
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
        const e = map.get(rawPath) ?? { path: rawPath, action: "Edit", added: 0, removed: 0, deleted: false };
        e.added += p.toolName === "write_file" ? countLines(args.content) : countLines(args.newString);
        e.removed += p.toolName === "write_file" ? 0 : countLines(args.oldString);
        e.deleted = false;
        map.set(rawPath, e);
        pushFile(rawPath);
      } else if (p.toolName === "delete_file") {
        const rawPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!rawPath || res?.status !== "deleted") continue;
        map.set(rawPath, { path: rawPath, action: "Delete", added: 0, removed: 0, deleted: true });
        pushFile(rawPath);
      }
      // NOTE: run_command rows intentionally omitted — this summary
      // lists edited files only, never the commands used.
    }
    return { rows };
  }, [content]);

  // Only once the message has ended — never mid-stream — and only
  // when at least one edited file remains after de-duplication.
  if (messageStatus === "running") return null;
  if (rows.length === 0) return null;

  const shown = rows.map((r) => r.change);
  const totalAdded = shown.reduce((n, f) => n + f.added, 0);
  const totalRemoved = shown.reduce((n, f) => n + f.removed, 0);

  const openFile = (f: FileChange) => {
    if (f.deleted) return;
    // Workspace-relative paths open in the popup; absolute/external ones
    // can't be previewed, so do nothing for them here.
    if (f.path.startsWith("/") || f.path.startsWith("~")) return;
    const { base } = splitPath(f.path);
    openDocumentWorkspace({
      filePath: f.path,
      filename: base,
      downloadUrl: `/api/files/${encodePath(f.path)}`,
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
            const clickable = !f.deleted && !f.path.startsWith("/") && !f.path.startsWith("~");
            return (
              <button
                key={f.path}
                onClick={() => openFile(f)}
                disabled={!clickable}
                title={clickable ? `Open ${base}` : f.path}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition enabled:cursor-pointer enabled:hover:bg-accent/60 disabled:cursor-default"
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
                {clickable && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
