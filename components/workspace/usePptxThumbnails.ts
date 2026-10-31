"use client";

import { useEffect, useState } from "react";
import { readPptxMeta, type PptxMeta } from "@/lib/workspace/pptx";

export type PptxThumb = {
  html: string;
  index: number;
};

type PptxThumbnailState = {
  status: "loading" | "ready" | "error";
  meta: PptxMeta | null;
  thumbs: PptxThumb[];
  error?: string;
};

const RENDER_WIDTH = 960;
const DEFAULT_MAX_SLIDES = 6;

const INITIAL_STATE: PptxThumbnailState = {
  status: "loading",
  meta: null,
  thumbs: [],
};

/**
 * Build small, self-contained HTML snapshots of the first few slides for
 * chat preview cards. The heavy renderer (pptx-preview) is loaded lazily and
 * runs off-screen once; each snapshot is then scaled with CSS in the card.
 */
export function usePptxThumbnails(
  downloadUrl: string,
  maxSlides = DEFAULT_MAX_SLIDES,
): PptxThumbnailState {
  const [state, setState] = useState<PptxThumbnailState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let host: HTMLDivElement | null = null;
    let previewer: { destroy: () => void } | null = null;

    setState(INITIAL_STATE);

    const run = async () => {
      const res = await fetch(downloadUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(res.status === 404 ? "File not found" : `Could not load file (${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const meta = await readPptxMeta(buffer);
      if (meta.slideCount === 0) throw new Error("No slides found");
      if (cancelled) return;

      host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = [
        "position:absolute",
        "left:-10000px",
        "top:0",
        `width:${RENDER_WIDTH}px`,
        `height:${Math.round(RENDER_WIDTH * meta.aspectRatio)}px`,
        "overflow:hidden",
        "visibility:hidden",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(host);

      const { init } = await import("pptx-preview");
      if (cancelled) return;

      const instance = init(host, {
        width: RENDER_WIDTH,
        height: Math.round(RENDER_WIDTH * meta.aspectRatio),
        mode: "list",
      });
      previewer = instance;
      await instance.preview(buffer);
      if (cancelled) return;

      const slides = Array.from(
        host.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper"),
      ).slice(0, Math.max(1, maxSlides));

      const thumbs = slides.map((slide, index) => ({
        html: slide.outerHTML,
        index,
      }));

      if (thumbs.length === 0) throw new Error("No slides found");
      setState({ status: "ready", meta, thumbs });
    };

    run().catch((e) => {
      if (cancelled) return;
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: "error", meta: null, thumbs: [], error: message });
    }).finally(() => {
      try {
        previewer?.destroy();
      } catch {}
      host?.remove();
    });

    return () => {
      cancelled = true;
      try {
        previewer?.destroy();
      } catch {}
      host?.remove();
    };
  }, [downloadUrl, maxSlides]);

  return state;
}
