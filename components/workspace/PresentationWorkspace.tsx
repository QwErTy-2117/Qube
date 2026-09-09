"use client";

import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { useDocument } from "./useDocument";
import { cn } from "@/lib/utils";

type Slide = { id: string; title: string; body: string; notes: string };

export function PresentationWorkspace({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  const { data, loading, error } = useDocument(filePath);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);
  const slide = slides[current];
  void downloadUrl;

  // Real slide text extracted server-side.
  useEffect(() => {
    if (data && "slides" in data && Array.isArray(data.slides)) {
      setSlides(data.slides.map((sl, i) => ({ id: `s${i + 1}`, title: sl.title || "", body: sl.body || "", notes: "" })));
      setCurrent(0);
    }
  }, [data]);

  const quoteSlide = () => {
    if (!slide) return;
    const sel = window.getSelection()?.toString().trim();
    addSelection({ kind: "slides", slide: current + 1, text: sel || `${slide.title}\n${slide.body}`.slice(0, 2000) });
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Rendered slide */}
      <div data-doc-scroll className="min-h-0 flex-1 overflow-y-auto p-4 pb-2" onMouseUp={quoteSlide}>
        {loading ? <p className="p-2 text-xs text-muted-foreground">Loading slides…</p>
        : error ? <p className="p-2 text-xs text-red-400">{error}</p>
        : !slide ? <p className="text-xs italic text-muted-foreground">No slides.</p> : (
          <div className="mx-auto max-w-[460px] rounded-2xl border border-border/60 bg-gradient-to-b from-muted/40 to-background p-6 shadow-sm">
            {slide.title ? (
              <h2 className="mb-3 text-lg font-bold text-foreground">{slide.title}</h2>
            ) : (
              <p className="mb-3 text-lg font-bold text-muted-foreground/50">(untitled)</p>
            )}
            {slide.body ? (
              <p className="text-sm leading-6 whitespace-pre-wrap text-foreground/90">{slide.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">No content.</p>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground/60">Slide {current + 1} of {slides.length}</p>
          </div>
        )}
      </div>
      {/* Thumbnail strip */}
      {slides.length > 1 && (
        <div className="shrink-0 border-t border-border/40 px-3 pt-2 pb-24">
          <div className="flex gap-2 overflow-x-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrent(i)}
                title={s.title || `Slide ${i + 1}`}
                className={cn(
                  "w-28 shrink-0 rounded-xl border p-2 text-left transition",
                  i === current
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 bg-muted/20 hover:bg-accent"
                )}
              >
                <div className="mb-0.5 text-[10px] font-semibold text-muted-foreground">Slide {i + 1}</div>
                <div className="truncate text-[11px] font-medium text-foreground">{s.title || "(untitled)"}</div>
                <div className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">{s.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
