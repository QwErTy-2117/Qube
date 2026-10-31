"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactError, ArtifactLoading } from "../states";
import { htmlToBlocks, textToBlocks } from "@/lib/artifact/sanitize-html";

/**
 * Document viewer — rebuilt from scratch (the shared shell is untouched).
 *
 * Layout: A4-proportioned paper pages, real measured pagination, one zoom
 * control, a page indicator and nothing else. Editing happens through the
 * artifact composer: rebuilding a .docx from a textarea silently drops
 * styles, so the viewer never pretends to offer document editing.
 */

type Payload = {
  ok?: boolean;
  kind?: string;
  content?: string;
  html?: string;
  error?: string;
  warnings?: number;
};

/** A4 at 96 dpi, CSS pixels. */
const PAGE_W = 794;
const PAGE_H = 1123;
const PAD_X = 88;
const PAD_Y = 84;
const CONTENT_W = PAGE_W - PAD_X * 2;
const CONTENT_H = PAGE_H - PAD_Y * 2;
const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const MIN_PAGE_BREAK_SLACK = 2;

function distribute(heights: number[]): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (current.length > 0 && used + h > CONTENT_H + MIN_PAGE_BREAK_SLACK) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

export function DocumentViewer({ filePath }: { filePath: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState<string[][]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    setPageIndex(0);
    fetch(
      `/api/workspace/document?path=${encodeURIComponent(filePath)}&format=html`,
      { cache: "no-store" },
    )
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

  const blocks = useMemo(() => {
    if (!data) return [] as string[];
    if (typeof data.html === "string") return htmlToBlocks(data.html);
    return textToBlocks(data.content || "");
  }, [data]);

  // Measure each block once at the real page width, then paginate. Zoom is a
  // CSS transform, so pagination stays correct at every zoom level.
  useLayoutEffect(() => {
    if (blocks.length === 0) {
      setPages([]);
      return;
    }
    const host = measureRef.current;
    if (!host) return;
    host.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `width:${CONTENT_W}px;position:absolute;visibility:hidden;left:-10000px;top:0`;
    wrapper.className = "doc-page-content";
    host.appendChild(wrapper);
    const heights: number[] = [];
    for (const block of blocks) {
      const probe = document.createElement("div");
      probe.innerHTML = block;
      wrapper.appendChild(probe);
      heights.push(probe.getBoundingClientRect().height);
    }
    const indexPages = distribute(heights);
    setPages(indexPages.map((idxs) => idxs.map((i) => blocks[i])));
    setPageIndex(0);
  }, [blocks]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((v) => Math.abs(v - z) < 0.001);
      const next = idx < 0 ? 3 : Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir));
      return ZOOM_STEPS[next];
    });
  }, []);

  // Track the visible page for the indicator.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.pageIndex ?? "0");
        if (Number.isFinite(idx)) setPageIndex(idx);
      },
      { root, threshold: [0.25, 0.6] },
    );
    for (const el of pageRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  const goToPage = (index: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, index));
    const el = pageRefs.current[clamped];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPageIndex(clamped);
  };

  if (loading) return <ArtifactLoading label="Opening document…" />;
  if (error) return <ArtifactError title="Couldn’t open this document" message={error} />;
  if (blocks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-foreground">This document is empty</p>
          <p className="mt-1 text-xs text-muted-foreground">Ask Qube below to write the content.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Viewer toolbar: zoom + page navigation only. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          disabled={zoom <= ZOOM_STEPS[0]}
          aria-label="Zoom out"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <MinusIcon className="size-3.5" />
        </button>
        <span className="w-10 text-center text-[11px] font-medium tabular-nums text-neutral-600 dark:text-neutral-300">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(1)}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          aria-label="Zoom in"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <PlusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          aria-label="Reset zoom"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => goToPage(pageIndex - 1)}
          disabled={pageIndex <= 0}
          aria-label="Previous page"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <span className="min-w-[74px] text-center text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
          Page {pageIndex + 1} of {pages.length}
        </span>
        <button
          type="button"
          onClick={() => goToPage(pageIndex + 1)}
          disabled={pageIndex >= pages.length - 1}
          aria-label="Next page"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      </div>

      <div ref={scrollRef} data-artifact-scroll className="doc-scroll min-h-0 flex-1 overflow-auto px-4 py-5">
        <div className="mx-auto flex w-fit flex-col items-center gap-5">
          {pages.map((pageBlocks, p) => (
            <div
              key={p}
              ref={(el) => {
                pageRefs.current[p] = el;
              }}
              data-page-index={p}
              aria-label={`Page ${p + 1}`}
              className="doc-page shrink-0 overflow-hidden rounded-[2px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.14),0_8px_24px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.06] dark:ring-white/10"
              style={{
                width: PAGE_W,
                height: PAGE_H,
                padding: `${PAD_Y}px ${PAD_X}px`,
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
                // Reserve the scaled space so the stack scrolls correctly.
                marginBottom: PAGE_H * (zoom - 1),
              }}
            >
              <div
                className="doc-page-content"
                // Sanitized in htmlToBlocks / emitted by us in textToBlocks.
                dangerouslySetInnerHTML={{ __html: pageBlocks.join("") }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Hidden measuring surface: same typography as the pages. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-0 w-0 overflow-hidden" />

      <style>{`
.doc-page { font-family: Georgia, "Times New Roman", ui-serif, serif; color: #1f2328; }
.doc-page-content { font-size: 15.5px; line-height: 1.65; }
.doc-page-content h1 { font-size: 30px; line-height: 1.2; font-weight: 700; margin: 0 0 14px; letter-spacing: -0.01em; }
.doc-page-content h2 { font-size: 22px; line-height: 1.25; font-weight: 700; margin: 22px 0 10px; }
.doc-page-content h3 { font-size: 17.5px; line-height: 1.3; font-weight: 700; margin: 18px 0 8px; }
.doc-page-content h4, .doc-page-content h5, .doc-page-content h6 { font-size: 15.5px; font-weight: 700; margin: 14px 0 6px; }
.doc-page-content p { margin: 0 0 11px; }
.doc-page-content ul, .doc-page-content ol { margin: 0 0 12px; padding-left: 24px; }
.doc-page-content ul { list-style: disc; }
.doc-page-content ol { list-style: decimal; }
.doc-page-content li { margin: 0 0 4px; }
.doc-page-content table { width: 100%; border-collapse: collapse; margin: 4px 0 14px; font-size: 13.5px; font-family: ui-sans-serif, system-ui, sans-serif; }
.doc-page-content th, .doc-page-content td { border: 1px solid #d8dde3; padding: 6px 8px; text-align: left; vertical-align: top; }
.doc-page-content th { background: #f5f7f9; font-weight: 600; }
.doc-page-content blockquote { margin: 0 0 12px; padding-left: 14px; border-left: 3px solid #d8dde3; color: #4b5563; }
.doc-page-content pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.doc-page-content code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
.doc-page-content img { max-width: 100%; height: auto; }
.doc-page-content a { color: #1d4ed8; text-decoration: underline; }
.doc-page-content hr { border: 0; border-top: 1px solid #e3e7eb; margin: 16px 0; }
.dark .doc-page { background: #0b0b0c; color: #e7e9ec; }
.dark .doc-page-content th { background: #17181a; border-color: #2a2c30; }
.dark .doc-page-content td, .dark .doc-page-content blockquote { border-color: #2a2c30; }
.dark .doc-page-content blockquote { color: #a1a6ad; }
.dark .doc-page-content pre { background: #151619; }
.dark .doc-page-content a { color: #7aa2ff; }
.dark .doc-page-content hr { border-color: #2a2c30; }
.doc-scroll { scrollbar-color: #b9bfc7 transparent; scrollbar-width: thin; }
.dark .doc-scroll { scrollbar-color: #33373d transparent; }
`}</style>
    </div>
  );
}
