"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { detectLanguageFromContent, formatBytes, MAX_PREVIEW_CHARS } from "@/lib/artifact/kinds";
import { ArtifactError, ArtifactLoading } from "../states";

/**
 * Source-code viewer: syntax highlighting, line numbers, copy, and readable
 * scrolling on a white (light) / black (dark) surface. Read-only by design —
 * edits go through Qube so formatting and context stay correct.
 */

const ShikiHighlighter = dynamic(() => import("react-shiki/web").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
      <Loader2Icon className="size-3.5 animate-spin" /> Highlighting…
    </div>
  ),
});

type Payload = {
  ok?: boolean;
  content?: string;
  lineCount?: number;
  size?: number;
  truncated?: boolean;
  error?: string;
};

/** Above this size highlighting costs more than it helps. */
const HIGHLIGHT_LIMIT = 220_000;

export function CodeViewer({ filePath, filename }: { filePath: string; filename: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workspace/document?path=${encodeURIComponent(filePath)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as Payload;
        if (!r.ok || json.ok === false) throw new Error(json.error || `Load failed (${r.status})`);
        if (!cancelled) setData(json);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const content = data?.content ?? "";
  const preview = useMemo(
    () => (content.length > MAX_PREVIEW_CHARS ? content.slice(0, MAX_PREVIEW_CHARS) : content),
    [content],
  );
  const language = useMemo(
    () => detectLanguageFromContent(filename, preview.slice(0, 4000)),
    [filename, preview],
  );
  const lines = useMemo(() => (preview.match(/\n/g)?.length ?? 0) + 1, [preview]);
  const gutter = useMemo(
    () => Array.from({ length: lines }, (_, i) => i + 1).join("\n"),
    [lines],
  );
  const shouldHighlight = preview.length <= HIGHLIGHT_LIMIT && language !== "text";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can be blocked — the footer still states the size */
    }
  };

  if (loading) return <ArtifactLoading label="Loading source file…" />;
  if (error) return <ArtifactError title="Couldn’t read this file" message={error} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
      {/* Viewer toolbar — file-specific, not part of the shared shell. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200/80 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-black">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[10px] font-medium text-neutral-600 uppercase dark:bg-neutral-900 dark:text-neutral-400">
          {language}
        </span>
        <span className="text-[11px] text-neutral-500 tabular-nums dark:text-neutral-400">
          {lines.toLocaleString()} lines
          {data?.size ? ` · ${formatBytes(data.size)}` : ""}
        </span>
        <span className="flex-1" />
        {(data?.truncated || content.length > MAX_PREVIEW_CHARS) && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">Large file — showing the first {MAX_PREVIEW_CHARS.toLocaleString()} characters</span>
        )}
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
          aria-label="Copy file contents"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div
        data-artifact-scroll
        className="code-surface min-h-0 flex-1 overflow-auto bg-white text-[13px] leading-[1.55] dark:bg-black"
      >
        {preview.trim() === "" ? (
          <p className="p-6 text-sm text-neutral-500 dark:text-neutral-400">This file is empty.</p>
        ) : shouldHighlight ? (
          <ShikiHighlighter
            language={language}
            theme={{ light: "github-light", dark: "github-dark" }}
            defaultColor="light-dark()"
            showLineNumbers
            addDefaultStyles={false}
            className="code-surface min-w-full bg-white! text-[13px] dark:bg-black!"
          >
            {preview}
          </ShikiHighlighter>
        ) : (
          // Large file (or unknown language): skip the grammar but keep line
          // numbers, so reading a 100k-line log still works.
          <div className="flex min-w-full">
            <pre
              aria-hidden="true"
              className="shrink-0 border-r border-neutral-200/80 bg-neutral-50 px-2 py-3 text-right font-mono text-[13px] leading-[1.55] text-neutral-400 select-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-500"
            >
              {gutter}
            </pre>
            <pre className="min-w-0 flex-1 px-3 py-3 font-mono text-[13px] leading-[1.55] whitespace-pre">
              <code>{preview}</code>
            </pre>
          </div>
        )}
      </div>

      <style>{`
/* Keep the editor surface pure white / pure black in both themes, including
   shiki's own wrappers, scrollbars and the line-number gutter. */
.code-surface, .code-surface pre, .code-surface code, .code-surface > div {
  background-color: #ffffff !important;
  color: #1f2328;
}
.dark .code-surface, .dark .code-surface pre, .dark .code-surface code, .dark .code-surface > div {
  background-color: #000000 !important;
  color: #e6edf3;
}
.code-surface { scrollbar-color: #c9ced6 transparent; scrollbar-width: thin; }
.dark .code-surface { scrollbar-color: #2a2f3a #000000; scrollbar-width: thin; }
.code-surface::-webkit-scrollbar { width: 10px; height: 10px; }
.code-surface::-webkit-scrollbar-track { background: #ffffff; }
.dark .code-surface::-webkit-scrollbar-track { background: #000000; }
.code-surface::-webkit-scrollbar-thumb { background: #d4d8de; border-radius: 999px; border: 2px solid #ffffff; }
.dark .code-surface::-webkit-scrollbar-thumb { background: #2b313b; border: 2px solid #000000; border-radius: 999px; }
.code-surface pre { padding: 12px 0 !important; margin: 0 !important; }
.code-surface code { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace) !important; }
`}</style>
    </div>
  );
}
