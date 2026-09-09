"use client";

import { useState } from "react";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { useDocument } from "./useDocument";

export function PdfWorkspace({ filePath, downloadUrl }: { filePath: string; downloadUrl: string }) {
  const { loading, error } = useDocument(filePath);
  const addSelection = useWorkspaceStore((s) => s.addSelection);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);

  const quoteSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    addSelection({ kind: "pdf", page, text: sel.slice(0, 2000) });
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2 text-xs">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Prev</button>
        <span className="font-medium text-foreground/80">Page {page}</span>
        <button onClick={() => setPage((p) => p + 1)} className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Next</button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => setZoom((z) => Math.max(50, z - 10))} aria-label="Zoom out" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><ZoomOutIcon className="size-3.5" /></button>
        <span className="w-10 text-center text-muted-foreground">{zoom}%</span>
        <button onClick={() => setZoom((z) => Math.min(200, z + 10))} aria-label="Zoom in" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><ZoomInIcon className="size-3.5" /></button>
      </div>
      <div data-doc-scroll className="min-h-0 flex-1 overflow-hidden bg-muted/20" onMouseUp={quoteSelection}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading PDF…</div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium">Couldn’t load preview</p>
            <p className="max-w-[280px] text-xs text-muted-foreground">{error}</p>
            <a href={downloadUrl} download className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Download instead</a>
          </div>
        ) : (
          <iframe src={`${downloadUrl}?inline=1#page=${page}&zoom=${zoom}`} title="PDF preview" className="h-full w-full bg-white" />
        )}
      </div>
    </div>
  );
}
