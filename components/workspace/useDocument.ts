"use client";

import { useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

export type DocPayload =
  | { ok: true; kind: string; filename: string; relativePath: string; size: number; content: string; lineCount: number; truncated?: boolean }
  | { ok: true; kind: string; filename: string; relativePath: string; size: number; sheets: Array<{ name: string; rowCount: number; colCount: number; rows: string[][] }> }
  | { ok: true; kind: string; filename: string; relativePath: string; size: number; slides: Array<{ title: string; body: string }> }
  | { ok: true; kind: string; filename: string; relativePath: string; size: number; downloadUrl: string; note?: string }
  | { ok: false; error: string };

export function useDocument(filePath: string | undefined) {
  const [data, setData] = useState<DocPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const dataRef = useRef<DocPayload | null>(null);
  dataRef.current = data;

  // Live refresh: when the agent finishes a run, the file may have been
  // edited — refetch so edits appear without closing/reopening the popup.
  // A short delay lets file writes flush; existing content stays visible
  // (no loading flash) while refreshing in the background.
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !isRunning && filePath) {
      const t = setTimeout(() => setVersion((v) => v + 1), 700);
      wasRunning.current = false;
      return () => clearTimeout(t);
    }
    wasRunning.current = isRunning;
  }, [isRunning, filePath]);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    if (!dataRef.current) setLoading(true);
    setError(null);
    fetch(`/api/workspace/document?path=${encodeURIComponent(filePath)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as DocPayload;
        if (!r.ok || (j as { ok: boolean }).ok === false) throw new Error((j as { error?: string }).error || `Load failed (${r.status})`);
        if (!cancelled) { setData(j); setError(null); setLoading(false); }
      })
      .catch((e) => {
        if (cancelled) return;
        // Background refresh failures keep stale content instead of an error screen.
        if (!dataRef.current) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [filePath, version]);

  return { data, loading, error, reload: () => setVersion((v) => v + 1) };
}

/** Direct save for plain-text files (workspace-scoped, server-validated). */
export async function saveDocumentContent(path: string, content: string): Promise<void> {
  const res = await fetch("/api/workspace/document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error((data as { error?: string }).error || `Save failed (${res.status})`);
  }
}
