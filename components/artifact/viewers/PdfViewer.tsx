"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MaximizeIcon,
  SearchIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactError, ArtifactLoading } from "../states";

/**
 * PDF viewer built on pdf.js (Apache-2.0).
 *
 * Supports: real page rendering, continuous scrolling, page navigation,
 * zoom, fit width / fit page, text selection through the text layer, and a
 * page-level search. Only controls that work with pdf.js are exposed.
 * Pages render lazily and are released when far off-screen so large
 * documents stay usable.
 */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};
type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
};
type PdfjsModule = {
  getDocument: (opts: { data: ArrayBuffer; isEvalSupported?: boolean; standardFontDataUrl?: string; cMapUrl?: string; cMapPacked?: boolean }) => { promise: Promise<PdfDoc>; destroy: () => Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
  TextLayer: new (opts: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) => { render: () => Promise<void>; cancel?: () => void };
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const GAP = 18;

function PdfPageView({
  doc,
  pageIndex,
  scale,
  textLayerReady,
  searchTerm,
  registerRef,
}: {
  doc: PdfDoc;
  pageIndex: number;
  scale: number;
  textLayerReady: boolean;
  searchTerm: string;
  registerRef: (index: number, el: HTMLDivElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const renderedRef = useRef<string>("");
  const taskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "600px 0px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Measure the page (cheap) as soon as it is visible so the scroll height is
  // correct before/without rendering the canvas.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void doc.getPage(pageIndex + 1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ w: viewport.width, h: viewport.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, scale, visible]);

  // Render the canvas + text layer only when visible and the scale changed.
  useEffect(() => {
    if (!visible || !size) return;
    const key = `${pageIndex}:${scale.toFixed(3)}`;
    if (renderedRef.current === key) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    renderedRef.current = key;

    void (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const task = page.render({
          canvasContext: ctx,
          viewport,
          // pdf.js applies the device pixel ratio itself when the canvas is
          // sized with it, so tell it about the transform exactly once.
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        } as never);
        taskRef.current = task;
        await task.promise;
        if (cancelled) return;
        if (textLayerReady && textRef.current) {
          textRef.current.replaceChildren();
          const textContent = await page.getTextContent();
          const Ctor = (window as unknown as {
            __qubePdfTextLayer: new (o: {
              textContentSource: unknown;
              container: HTMLElement;
              viewport: unknown;
            }) => { render: () => Promise<void> };
          }).__qubePdfTextLayer;
          if (Ctor) {
            const textLayer = new Ctor({
              textContentSource: textContent,
              container: textRef.current,
              viewport,
            });
            await textLayer.render();
            highlight(textRef.current, searchTerm);
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "RenderingCancelledException") {
          console.warn("[pdf] page render failed", e);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        taskRef.current?.cancel();
      } catch {
        /* rendering already finished */
      }
    };
  }, [visible, size, pageIndex, scale, doc, textLayerReady, searchTerm]);

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        registerRef(pageIndex, el);
      }}
      data-page-index={pageIndex}
      className="pdf-page relative shrink-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.16),0_10px_30px_-16px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.06] dark:ring-white/10"
      style={{ width: size?.w ?? 620, height: size?.h ?? 800 }}
    >
      <canvas ref={canvasRef} role="img" aria-label={`Page ${pageIndex + 1}`} className="block" />
      <div ref={textRef} className="textLayer" />
      {!size && (
        <div className="absolute inset-0 flex items-center justify-center bg-white">
          <Loader2Icon className="size-4 animate-spin text-neutral-400" />
        </div>
      )}
    </div>
  );
}

function highlight(container: HTMLElement, term: string) {
  if (!term) return;
  const lower = term.toLowerCase();
  for (const span of Array.from(container.querySelectorAll("span"))) {
    if ((span.textContent || "").toLowerCase().includes(lower)) span.classList.add("pdf-hit");
  }
}

export function PdfViewer({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const [pdfjs, setPdfjs] = useState<PdfjsModule | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page" | "manual">("width");
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchPages, setSearchPages] = useState<number[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Load pdf.js in the browser only (it touches DOM globals at import time).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = (await import("pdfjs-dist")) as unknown as PdfjsModule;
        mod.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";
        (window as unknown as { __qubePdfTextLayer: unknown }).__qubePdfTextLayer = mod.TextLayer;
        if (!cancelled) setPdfjs(mod);
      } catch (e) {
        if (!cancelled) {
          setError(`PDF engine failed to load: ${(e as Error).message}`);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pdfjs) return;
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setLoading(true);
    setError(null);
    setDoc(null);
    setNumPages(0);
    void (async () => {
      try {
        const res = await fetch(downloadUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "File not found" : `Could not load PDF (${res.status})`);
        const data = await res.arrayBuffer();
        if (data.byteLength === 0) throw new Error("The PDF is empty");
        const loadingTask = pdfjs.getDocument({
          data,
          isEvalSupported: false,
          standardFontDataUrl: "/pdf/standard_fonts/",
          cMapUrl: "/pdf/cmaps/",
          cMapPacked: true,
        });
        task = loadingTask;
        const loaded = await loadingTask.promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        setBaseSize({ w: viewport.width, h: viewport.height });
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPage(1);
      } catch (e) {
        if (cancelled) return;
        const message = (e as Error)?.message || String(e);
        setError(
          /password/i.test(message)
            ? "This PDF is password-protected. Ask Qube to unlock it with the password you provide."
            : message.slice(0, 300),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
    };
  }, [pdfjs, downloadUrl, filePath]);

  const fitScale = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !baseSize) return 1;
    const widthScale = (el.clientWidth - 48) / baseSize.w;
    if (fitMode === "page") {
      const heightScale = (el.clientHeight - 48) / baseSize.h;
      return Math.max(0.2, Math.min(widthScale, heightScale));
    }
    return Math.max(0.2, widthScale);
  }, [baseSize, fitMode]);

  useEffect(() => {
    if (fitMode === "manual" || !baseSize) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setZoom(fitScale());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitMode, baseSize, fitScale]);

  // Track the current page while scrolling.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !doc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const idx = Number((best.target as HTMLElement).dataset.pageIndex ?? "0");
        if (Number.isFinite(idx)) setPage(idx + 1);
      },
      { root, threshold: [0.3, 0.7] },
    );
    for (const el of pageRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [doc, numPages, zoom]);

  const goToPage = useCallback(
    (target: number) => {
      const clamped = Math.max(1, Math.min(numPages, target));
      const el = pageRefs.current[clamped - 1];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setPage(clamped);
      }
    },
    [numPages],
  );

  const zoomBy = (dir: 1 | -1) => {
    setFitMode("manual");
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((v) => Math.abs(v - z) < 0.01);
      const next = idx < 0 ? 2 : Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir));
      return ZOOM_STEPS[next];
    });
  };

  const runSearch = useCallback(
    async (term: string) => {
      const needle = term.trim().toLowerCase();
      if (!doc || !needle) {
        setSearchPages([]);
        return;
      }
      const hits: number[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        try {
          const text = await (await doc.getPage(i)).getTextContent();
          const joined = text.items.map((item) => item.str || "").join(" ").toLowerCase();
          if (joined.includes(needle)) hits.push(i);
        } catch {
          /* skip unreadable pages */
        }
      }
      setSearchPages(hits);
      setSearchIndex(0);
      if (hits.length > 0) goToPage(hits[0]);
    },
    [doc, goToPage],
  );

  const registerRef = useCallback((index: number, el: HTMLDivElement | null) => {
    pageRefs.current[index] = el;
  }, []);

  const pages = useMemo(() => Array.from({ length: numPages }, (_, i) => i), [numPages]);

  if (error) {
    return (
      <ArtifactError
        title="Couldn’t open this PDF"
        message={error}
        action={
          <a
            href={downloadUrl}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Download instead
          </a>
        }
      />
    );
  }
  if (loading || !doc) return <ArtifactLoading label="Rendering PDF…" />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-200/70 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-300/70 bg-white px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="tool-btn disabled:opacity-30"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <div className="flex items-center gap-1 text-[11px]">
          <input
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1 && n <= numPages) setPage(n);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                goToPage(Number((e.target as HTMLInputElement).value));
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Page number"
            className="w-9 rounded border border-neutral-300 bg-white px-1 py-0.5 text-center tabular-nums outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <span className="text-neutral-500 dark:text-neutral-400">/ {numPages}</span>
        </div>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={page >= numPages}
          aria-label="Next page"
          className="tool-btn disabled:opacity-30"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" />

        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out" className="tool-btn">
          <ZoomOutIcon className="size-4" />
        </button>
        <span className="w-10 text-center text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in" className="tool-btn">
          <ZoomInIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setFitMode("width")}
          aria-pressed={fitMode === "width"}
          className={cn("rounded px-2 py-1 text-[11px] font-medium", fitMode === "width" ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-white" : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900")}
        >
          Fit width
        </button>
        <button
          type="button"
          onClick={() => setFitMode("page")}
          aria-pressed={fitMode === "page"}
          className={cn("flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium", fitMode === "page" ? "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-white" : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900")}
        >
          <MaximizeIcon className="size-3" /> Fit page
        </button>

        <span className="flex-1" />

        {searchOpen ? (
          <div className="flex items-center gap-1 rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700">
            <SearchIcon className="size-3.5 text-neutral-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (searchPages.length > 0) {
                    const next = (searchIndex + 1) % searchPages.length;
                    setSearchIndex(next);
                    goToPage(searchPages[next]);
                  } else {
                    void runSearch(searchTerm);
                  }
                }
                if (e.key === "Escape") setSearchOpen(false);
              }}
              placeholder="Find in PDF…"
              aria-label="Find in PDF"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="w-32 bg-transparent text-[11px] outline-none dark:text-neutral-100"
            />
            {searchTerm && (
              <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                {searchPages.length > 0 ? `${searchIndex + 1}/${searchPages.length}` : "0/0"}
              </span>
            )}
            <button
              onClick={() => setSearchOpen(false)}
              aria-label="Close search"
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSearchOpen(true)} aria-label="Find in PDF" className="tool-btn">
            <SearchIcon className="size-4" />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        data-artifact-scroll
        className="pdf-scroll min-h-0 flex-1 overflow-auto px-4 py-4"
      >
        <div className="mx-auto flex w-fit flex-col items-center" style={{ gap: GAP }}>
          {pages.map((i) => (
            <PdfPageView
              key={i}
              doc={doc}
              pageIndex={i}
              scale={zoom}
              textLayerReady
              searchTerm={searchTerm.trim().toLowerCase()}
              registerRef={registerRef}
            />
          ))}
        </div>
      </div>

      <style>{`
.pdf-page { --scale-factor: ${zoom.toFixed(4)}; }
.tool-btn { display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; color:#64748b; }
.tool-btn:hover { background:#f1f5f9; color:#0f172a; }
.dark .tool-btn { color:#94a3b8; }
.dark .tool-btn:hover { background:#171717; color:#fff; }
.textLayer { position:absolute; text-align:initial; inset:0; overflow:clip; opacity:1; line-height:1; -webkit-text-size-adjust:none; text-size-adjust:none; forced-color-adjust:none; transform-origin:0 0; }
.textLayer span, .textLayer br { color:transparent; position:absolute; white-space:pre; cursor:text; transform-origin:0% 0%; }
.textLayer ::selection { background: rgba(37, 99, 235, 0.28); }
.textLayer .pdf-hit { background: rgba(250, 204, 21, 0.45); border-radius:2px; }
.pdf-scroll { scrollbar-color:#a8b0b9 transparent; scrollbar-width:thin; }
.dark .pdf-scroll { scrollbar-color:#33373d transparent; }
.pdf-scroll::-webkit-scrollbar { width:11px; height:11px; }
.pdf-scroll::-webkit-scrollbar-track { background: transparent; }
.pdf-scroll::-webkit-scrollbar-thumb { background:#c2c8cf; border-radius:999px; }
.dark .pdf-scroll::-webkit-scrollbar-thumb { background:#2b313b; }
`}</style>
    </div>
  );
}
