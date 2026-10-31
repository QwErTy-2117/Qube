"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  Loader2Icon,
  PresentationIcon,
  SquareArrowOutUpRightIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { DownloadButton } from "@/components/assistant-ui/tools/download-button";
import { usePptxThumbnails } from "@/components/workspace/usePptxThumbnails";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { cn } from "@/lib/utils";

const RENDER_WIDTH = 960;
const GAP = 8;

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="aspect-video animate-pulse rounded-md bg-muted" />
          <div className="mx-auto h-2 w-8 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/**
 * Rich chat card for a .pptx deliverable: real slide thumbnails on top,
 * with a single Open action that launches the presentation popup. The
 * thumbnails are rendered once off-screen and cached as HTML snapshots,
 * so scrolling chat does not repeatedly parse the deck.
 */
export function PresentationFileCard({
  filename,
  filePath,
  downloadUrl,
}: {
  filename: string;
  filePath?: string;
  downloadUrl: string;
}) {
  const { status, meta, thumbs, error } = usePptxThumbnails(downloadUrl, 6);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setGridWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [status]);

  const open = (slide?: number) => {
    if (!filePath) return;
    openDocumentWorkspace({ filePath, filename, downloadUrl, kind: "slides", slide });
  };

  const columns = gridWidth >= 300 ? 3 : 2;
  const thumbWidth = gridWidth > 0 ? (gridWidth - GAP * (columns - 1)) / columns : 0;
  const slideLabel =
    status === "ready" && meta
      ? `${meta.slideCount} slide${meta.slideCount === 1 ? "" : "s"}`
      : "Presentation";

  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xs">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
          <PresentationIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground" title={filename}>
            {filename}
          </div>
          <div className="text-[11px] text-muted-foreground">{slideLabel} · PPTX</div>
        </div>
        <DownloadButton filename={filename} downloadUrl={downloadUrl} />
      </div>

      <div className="px-3.5 pt-2">
        {status === "loading" && <SkeletonGrid />}

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-foreground">Preview unavailable</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground" title={error}>
                Download the deck or open it to see the details.
              </p>
            </div>
          </div>
        )}

        {status === "ready" && meta && (
          <div
            ref={gridRef}
            className="grid"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP }}
          >
            {thumbs.map((thumb) => (
              <button
                key={thumb.index}
                type="button"
                onClick={() => open(thumb.index + 1)}
                aria-label={`Open ${filename} at slide ${thumb.index + 1}`}
                className="group flex min-w-0 flex-col gap-1 text-left"
              >
                <span
                  className="relative block w-full overflow-hidden rounded-md border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition group-hover:border-primary/40 group-hover:shadow-md"
                  style={{ aspectRatio: meta.width / meta.height }}
                >
                  <span
                    className="pointer-events-none absolute top-0 left-0 origin-top-left"
                    style={{
                      width: RENDER_WIDTH,
                      height: Math.round(RENDER_WIDTH * meta.aspectRatio),
                      transform: `scale(${thumbWidth > 0 ? thumbWidth / RENDER_WIDTH : 0})`,
                    }}
                    dangerouslySetInnerHTML={{ __html: thumb.html }}
                  />
                  <span className="absolute inset-0 rounded-md bg-black/0 transition group-hover:bg-black/[0.04]" />
                </span>
                <span className="truncate text-center text-[10px] font-medium text-muted-foreground transition group-hover:text-foreground">
                  Page {thumb.index + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border/50 px-2 py-1">
        <button
          type="button"
          onClick={() => open()}
          disabled={!filePath}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition",
            filePath
              ? "text-foreground hover:bg-accent hover:text-accent-foreground"
              : "cursor-not-allowed text-muted-foreground/60",
          )}
        >
          <SquareArrowOutUpRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Open presentation</span>
        </button>
        <span className="shrink-0 pr-2 text-[10px] tabular-nums text-muted-foreground">
          {status === "ready" && meta && meta.slideCount > thumbs.length
            ? `Showing ${thumbs.length} of ${meta.slideCount}`
            : ""}
        </span>
      </div>
    </div>
  );
}

/** Compact fallback used when a slide deck cannot be opened in the viewer. */
export function PresentationFileFallback({
  filename,
  downloadUrl,
  message,
}: {
  filename: string;
  downloadUrl: string;
  message?: string;
}) {
  return (
    <div className="w-full max-w-[440px] rounded-2xl border border-border/70 bg-background p-3 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
          <PresentationIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground" title={filename}>
            {filename}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{message || "Presentation"}</div>
        </div>
        <DownloadButton filename={filename} downloadUrl={downloadUrl} />
      </div>
    </div>
  );
}
