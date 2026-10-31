"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { isPptxFile, readPptxMeta, type PptxMeta } from "@/lib/workspace/pptx";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { cn } from "@/lib/utils";

type PptxPreviewer = ReturnType<(typeof import("pptx-preview"))["init"]>;

const BASE_WIDTH = 1600;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const STAGE_PAD_X = 56;
const STAGE_PAD_TOP = 28;
const STAGE_PAD_BOTTOM = 112;

const TOOL_BUTTON =
  "flex size-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function PresentationWorkspace({
  filePath,
  downloadUrl,
  initialSlide,
}: {
  filePath: string;
  downloadUrl: string;
  initialSlide?: number;
}) {
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewer | null>(null);
  const initialSlideRef = useRef(initialSlide);
  initialSlideRef.current = initialSlide;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<PptxMeta | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit");
  const [manualZoom, setManualZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Refresh the rendered deck after the agent finishes writing to the file.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!wasRunning.current || isRunning) {
      wasRunning.current = isRunning;
      return;
    }
    wasRunning.current = isRunning;
    const timer = setTimeout(() => setReloadToken((v) => v + 1), 700);
    return () => clearTimeout(timer);
  }, [isRunning]);

  // Track the available stage area so "Fit" responds to the popup size and
  // to fullscreen. The canvas itself is rendered once at a fixed 1600px width
  // and then CSS-scaled, which keeps text crisp and makes zoom instant.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let instance: PptxPreviewer | null = null;
    const el = canvasRef.current;
    if (!el) return;

    if (!isPptxFile(filePath)) {
      setStatus("error");
      setError("Only .pptx presentations can be previewed here. Download this file to open it in PowerPoint.");
      return;
    }

    const host = document.createElement("div");
    host.style.cssText = "width:100%;height:100%";
    el.replaceChildren(host);
    try {
      previewerRef.current?.destroy();
    } catch {}
    previewerRef.current = null;
    setStatus("loading");
    setError("");
    setSlideCount(0);
    setCurrent(0);
    setZoomMode("fit");

    (async () => {
      const res = await fetch(downloadUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(res.status === 404 ? "File not found" : `Could not load presentation (${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const nextMeta = await readPptxMeta(buffer);
      if (nextMeta.slideCount === 0) throw new Error("No slides found in this presentation");
      if (cancelled) return;

      const height = Math.round(BASE_WIDTH * nextMeta.aspectRatio);
      const { init } = await import("pptx-preview");
      if (cancelled) return;

      instance = init(host, { width: BASE_WIDTH, height, mode: "slide" });
      previewerRef.current = instance;
      await instance.preview(buffer);
      if (cancelled) return;

      // Our toolbar owns the controls; remove the library's own buttons.
      host
        .querySelectorAll(".pptx-preview-wrapper-next, .pptx-preview-wrapper-pagination")
        .forEach((node) => node.remove());

      const total = instance.slideCount || nextMeta.slideCount;
      const target = clamp((initialSlideRef.current ?? 1) - 1, 0, Math.max(0, total - 1));
      if (target > 0) instance.renderSingleSlide(target);

      setMeta(nextMeta);
      setSlideCount(total);
      setCurrent(target);
      setStatus("ready");
    })().catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    });

    return () => {
      cancelled = true;
      try {
        instance?.destroy();
      } catch {}
      if (previewerRef.current === instance) previewerRef.current = null;
      host.remove();
    };
  }, [downloadUrl, filePath, reloadToken]);

  // Clicking a different thumbnail in the chat updates the artifact without
  // remounting the popup, so honour a changed initialSlide in place.
  const lastInitialSlide = useRef(initialSlide);
  useEffect(() => {
    if (initialSlide === undefined || initialSlide === lastInitialSlide.current) return;
    lastInitialSlide.current = initialSlide;
    if (status !== "ready" || slideCount === 0) return;
    const target = clamp(initialSlide - 1, 0, slideCount - 1);
    if (target === current) return;
    try {
      previewerRef.current?.renderSingleSlide(target);
      setCurrent(target);
    } catch {}
  }, [initialSlide, status, slideCount, current]);

  const slideHeight = meta ? Math.round(BASE_WIDTH * meta.aspectRatio) : Math.round(BASE_WIDTH * 0.5625);
  const fitScale = meta && stageSize.width > 0 && stageSize.height > 0
    ? Math.min(
        Math.max(0.1, (stageSize.width - STAGE_PAD_X * 2) / BASE_WIDTH),
        Math.max(0.1, (stageSize.height - STAGE_PAD_TOP - STAGE_PAD_BOTTOM) / slideHeight),
      )
    : 0.8;
  const scale = zoomMode === "fit" ? fitScale : manualZoom;

  const goTo = useCallback(
    (index: number) => {
      if (status !== "ready" || slideCount === 0) return;
      const next = clamp(index, 0, slideCount - 1);
      if (next === current) return;
      try {
        previewerRef.current?.renderSingleSlide(next);
        setCurrent(next);
      } catch {}
    },
    [status, slideCount, current],
  );

  const zoomIn = useCallback(() => {
    setZoomMode("manual");
    setManualZoom((prev) => {
      const base = zoomMode === "fit" ? fitScale : prev;
      return clamp(base + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    });
  }, [zoomMode, fitScale]);

  const zoomOut = useCallback(() => {
    setZoomMode("manual");
    setManualZoom((prev) => {
      const base = zoomMode === "fit" ? fitScale : prev;
      return clamp(base - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
    });
  }, [zoomMode, fitScale]);

  const resetZoom = useCallback(() => setZoomMode("fit"), []);

  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          goTo(current - 1);
          break;
        case "ArrowRight":
          event.preventDefault();
          goTo(current + 1);
          break;
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(slideCount - 1);
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomIn();
          break;
        case "-":
        case "_":
          event.preventDefault();
          zoomOut();
          break;
        case "0":
        case "f":
        case "F":
          event.preventDefault();
          resetZoom();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, current, goTo, slideCount, zoomIn, zoomOut, resetZoom]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await root.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked in some embedded webviews; keep the normal viewer.
    }
  };

  const quoteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection) return;
    addSelection({ kind: "slides", slide: current + 1, text: selection.slice(0, 2000) });
    window.getSelection()?.removeAllRanges();
  };

  const filename = filePath.split("/").pop() || "presentation";

  return (
    <div
      ref={rootRef}
      data-pptx-root=""
      data-fullscreen={isFullscreen ? "true" : undefined}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
    >
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/60 px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={() => goTo(current - 1)}
          disabled={status !== "ready" || current <= 0}
          className={TOOL_BUTTON}
          aria-label="Previous slide"
          title="Previous slide (←)"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="min-w-[58px] text-center text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{status === "ready" ? current + 1 : "–"}</span>
          <span> / {slideCount || "–"}</span>
        </span>
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          disabled={status !== "ready" || current >= slideCount - 1}
          className={TOOL_BUTTON}
          aria-label="Next slide"
          title="Next slide (→)"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        <span className="mx-1.5 h-4 w-px bg-border" aria-hidden="true" />

        <button
          type="button"
          onClick={zoomOut}
          disabled={status !== "ready"}
          className={TOOL_BUTTON}
          aria-label="Zoom out"
          title="Zoom out (−)"
        >
          <MinusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          disabled={status !== "ready"}
          className="min-w-[44px] rounded-lg px-1 py-1 text-[11px] font-medium tabular-nums text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-30"
          aria-label="Fit slide to window"
          title="Fit to window (0)"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={status !== "ready"}
          className={TOOL_BUTTON}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <PlusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          disabled={status !== "ready"}
          className={cn(
            "ml-0.5 hidden items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition sm:flex",
            zoomMode === "fit"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title="Fit to window (0)"
        >
          <ScanIcon className="size-3.5" />
          Fit
        </button>

        <span className="flex-1" />

        <button
          type="button"
          onClick={toggleFullscreen}
          className={TOOL_BUTTON}
          aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
        >
          {isFullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
        </button>
      </div>

      <div
        ref={stageRef}
        data-doc-scroll
        onMouseUp={quoteSelection}
        style={{ paddingBottom: 0 }}
        className="relative min-h-0 flex-1 overflow-auto bg-[#17181b]"
      >
        {status !== "error" && (
          <div className="flex min-h-full w-max min-w-full p-6" style={{ paddingBottom: STAGE_PAD_BOTTOM }}>
            <div
              className="relative m-auto shrink-0 ring-1 ring-white/10 shadow-[0_28px_80px_-24px_rgba(0,0,0,0.9)]"
              style={{ width: BASE_WIDTH * scale, height: slideHeight * scale }}
            >
              <div
                ref={canvasRef}
                data-pptx-canvas=""
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: BASE_WIDTH,
                  height: slideHeight,
                  transform: `scale(${scale})`,
                  opacity: status === "ready" ? 1 : 0,
                }}
              />
            </div>
          </div>
        )}

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs text-white/65 backdrop-blur">
              <Loader2Icon className="size-3.5 animate-spin" />
              Rendering slides…
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-white">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-white/75">
              <TriangleAlertIcon className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Couldn’t preview this presentation</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-white/55">{error}</p>
            </div>
            <a
              href={downloadUrl}
              download={filename}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-950 transition hover:bg-white/90"
            >
              Download to view
            </a>
          </div>
        )}
      </div>

      <style>{`
[data-pptx-root][data-fullscreen="true"] { width: 100vw; height: 100vh; background: var(--background); }
[data-pptx-canvas] .pptx-preview-wrapper {
  background: transparent !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
}
[data-pptx-canvas] .pptx-preview-slide-wrapper { margin: 0 !important; }
[data-pptx-canvas] .pptx-preview-wrapper-next,
[data-pptx-canvas] .pptx-preview-wrapper-pagination { display: none !important; }
`}</style>
    </div>
  );
}
