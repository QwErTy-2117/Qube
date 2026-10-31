"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { ArtifactError, ArtifactLoading } from "../states";

/**
 * Plain-text / Markdown viewer. Markdown is rendered (with GFM tables,
 * task lists and code) instead of showing raw source; plain text stays
 * monospace with preformatted whitespace. Read-only: edits go through the
 * artifact composer so the agent keeps the file consistent.
 */

type Payload = { ok?: boolean; content?: string; truncated?: boolean; error?: string };

export function TextViewer({ filePath, filename }: { filePath: string; filename: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isMarkdown = /\.(md|markdown)$/i.test(filename);

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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const lines = useMemo(() => (content.match(/\n/g)?.length ?? 0) + 1, [content]);

  if (loading) return <ArtifactLoading label="Opening file…" />;
  if (error) return <ArtifactError title="Couldn’t open this file" message={error} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {isMarkdown ? "Markdown" : "Text"} · {lines.toLocaleString()} lines
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div data-artifact-scroll className="text-scroll min-h-0 flex-1 overflow-auto">
        {content.trim() === "" ? (
          <p className="p-6 text-sm text-neutral-500 dark:text-neutral-400">This file is empty.</p>
        ) : isMarkdown ? (
          <article className="doc-markdown mx-auto max-w-[720px] px-8 py-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        ) : (
          <pre className="p-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">{content}</pre>
        )}
      </div>
      <style>{`
.doc-markdown { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14.5px; line-height: 1.7; }
.doc-markdown h1 { font-size: 26px; font-weight: 700; margin: 0 0 14px; line-height: 1.25; }
.doc-markdown h2 { font-size: 20px; font-weight: 700; margin: 26px 0 10px; }
.doc-markdown h3 { font-size: 16.5px; font-weight: 700; margin: 20px 0 8px; }
.doc-markdown p { margin: 0 0 12px; }
.doc-markdown ul, .doc-markdown ol { margin: 0 0 12px; padding-left: 22px; }
.doc-markdown ul { list-style: disc; }
.doc-markdown ol { list-style: decimal; }
.doc-markdown li { margin: 0 0 4px; }
.doc-markdown a { color: #2563eb; text-decoration: underline; }
.doc-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
.doc-markdown pre { background: #f6f8fa; padding: 12px 14px; border-radius: 8px; overflow-x: auto; margin: 0 0 14px; }
.doc-markdown pre code { background: transparent; padding: 0; }
.doc-markdown table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 13.5px; }
.doc-markdown th, .doc-markdown td { border: 1px solid #e5e7eb; padding: 6px 9px; text-align: left; }
.doc-markdown th { background: #f9fafb; font-weight: 600; }
.doc-markdown blockquote { border-left: 3px solid #d1d5db; margin: 0 0 14px; padding-left: 14px; color: #4b5563; }
.doc-markdown hr { border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0; }
.dark .doc-markdown a { color: #7aa2ff; }
.dark .doc-markdown code { background: #1a1b1e; }
.dark .doc-markdown pre { background: #121316; }
.dark .doc-markdown th, .dark .doc-markdown td { border-color: #2a2c30; }
.dark .doc-markdown th { background: #17181a; }
.dark .doc-markdown blockquote { border-color: #2f3237; color: #a1a6ad; }
.dark .doc-markdown hr { border-color: #2a2c30; }
.text-scroll { scrollbar-color: #c9ced6 transparent; scrollbar-width: thin; }
.dark .text-scroll { scrollbar-color: #33373d transparent; }
`}</style>
    </div>
  );
}
