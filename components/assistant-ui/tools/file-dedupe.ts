"use client";

import { useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";

function parseToolResult(r: unknown): Record<string, unknown> | null {
  try {
    if (typeof r === "string") return JSON.parse(r) as Record<string, unknown>;
    if (r && typeof r === "object") return r as Record<string, unknown>;
  } catch {}
  return null;
}

/**
 * Normalize a file path for de-duplication across write_file / edit_file /
 * present_file / [file:] markers. Trims, strips leading ./ and trailing
 * whitespace. Comparison is exact on the normalized form — no basename
 * fallback, so distinct files with the same name in different folders
 * never collapse into one.
 */
export function normalizeFilePath(p: unknown): string {
  if (typeof p !== "string") return "";
  let s = p.trim();
  // Strip leading ./ segments (./docs/a.md -> docs/a.md)
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

/**
 * Collect the normalized paths of every successful present_file call in a
 * message's content array. present_file is the single source of truth for
 * file cards — write_file / edit_file cards and [file:] markdown cards for
 * the same path must defer to it so each deliverable renders exactly once,
 * at the present_file call site.
 */
export function collectPresentedPaths(
  content: unknown,
): Set<string> {
  const out = new Set<string>();
  const parts = (content || []) as Array<Record<string, unknown>>;
  if (!Array.isArray(parts)) return out;
  for (const p of parts) {
    if (!p || p.type !== "tool-call") continue;
    if ((p as { toolName?: unknown }).toolName !== "present_file") continue;
    const args = ((p as { args?: unknown }).args || {}) as Record<string, unknown>;
    const res = parseToolResult((p as { result?: unknown }).result);
    if (res && typeof (res as { error?: unknown }).error === "string") continue;
    const rel =
      (res && typeof res.relativePath === "string" && (res.relativePath as string)) ||
      (typeof args.path === "string" ? args.path : "");
    const key = normalizeFilePath(rel);
    if (key) out.add(key);
  }
  return out;
}

export type PresentedEntry = {
  key: string;
  filename: string;
  filePath?: string;
  downloadUrl: string;
};

function encodeRelPath(p: string): string {
  return p.split("/").map((s) => encodeURIComponent(s)).join("/");
}

function entryForPath(rawPath: string): PresentedEntry | null {
  const rel = rawPath.trim();
  if (!rel) return null;
  const filename = rel.split("/").pop() || rel;
  const isExternal = rel.startsWith("/") || rel.startsWith("~");
  const downloadUrl = isExternal
    ? `/api/external-files/${encodeRelPath(rel.replace(/^\//, "").replace(/^~\//, ""))}`
    : `/api/files/${encodeRelPath(rel)}`;
  return {
    key: normalizeFilePath(rel),
    filename,
    filePath: isExternal ? undefined : rel,
    downloadUrl,
  };
}

/**
 * Ordered, de-duplicated deliverable entries for the bottom file list:
 * walks message parts in order, collecting successful present_file calls
 * first-class plus an optional set of extra text refs (e.g. [file:]
 * markers the agent wrote instead of calling present_file). Each path
 * appears at most once.
 */
export function collectPresentedEntries(
  content: unknown,
  extraTextRefs?: string[],
): PresentedEntry[] {
  const out: PresentedEntry[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const e = entryForPath(raw);
    if (!e || !e.key || seen.has(e.key)) return;
    seen.add(e.key);
    out.push(e);
  };
  const parts = (content || []) as Array<Record<string, unknown>>;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (!p) continue;
      if (p.type === "tool-call") {
        if ((p as { toolName?: unknown }).toolName !== "present_file") continue;
        const args = ((p as { args?: unknown }).args || {}) as Record<string, unknown>;
        const res = parseToolResult((p as { result?: unknown }).result);
        if (res && typeof (res as { error?: unknown }).error === "string") continue;
        const rel =
          (res && typeof res.relativePath === "string" && (res.relativePath as string)) ||
          (typeof args.path === "string" ? args.path : "");
        if (rel) push(rel);
      }
    }
  }
  for (const ref of extraTextRefs || []) push(ref);
  return out;
}

/**
 * Hook: normalized paths presented via present_file in the current message.
 * Memoized on the content array identity.
 */
export function usePresentedPaths(): Set<string> {
  const content = useAuiState((s) => s.message.content);
  return useMemo(() => collectPresentedPaths(content), [content]);
}
