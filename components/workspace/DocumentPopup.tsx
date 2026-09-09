"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon, ArrowDownIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { DownloadButton } from "@/components/assistant-ui/tools/download-button";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { DocComposer } from "./DocComposer";

/**
 * Document editor popup: a centered glassy modal (overlay + blurred
 * translucent surfaces) hosting any document workspace, with a floating
 * scroll-to-bottom button and a floating AI composer.
 */
export function DocumentPopup() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [showBottom, setShowBottom] = useState(false);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  const show = open && artifact && artifact.kind !== "browser";

  const scrollRegion = useCallback((): HTMLElement | null => {
    try {
      return rootRef.current?.querySelector("[data-doc-scroll]") ?? null;
    } catch {
      return null;
    }
  }, []);

  // Track the document scroll region to toggle the scroll-to-bottom button.
  useEffect(() => {
    setShowBottom(false);
    if (!show) return;
    // Inner content mounts after this effect; observe on next frames.
    let el: HTMLElement | null = null;
    let raf = 0;
    const onScroll = () => {
      try {
        if (el) setShowBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
      } catch {}
    };
    const bind = () => {
      el = scrollRegion();
      if (!el) {
        raf = requestAnimationFrame(bind);
        return;
      }
      onScroll();
      el.addEventListener("scroll", onScroll, { passive: true });
    };
    raf = requestAnimationFrame(bind);
    return () => {
      cancelAnimationFrame(raf);
      try { el?.removeEventListener("scroll", onScroll); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id, show]);

  // Escape closes; lock background scroll while open.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWorkspace();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [show, closeWorkspace]);

  const scrollToBottom = () => {
    const el = scrollRegion();
    if (!el) return;
    try {
      el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
    } catch {
      el.scrollTop = el.scrollHeight;
    }
  };

  const dur = reduceMotion ? 0.01 : 0.22;

  return (
    <>
    <AnimatePresence>
      {show && artifact && (
        <motion.div
          key="doc-popup"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={artifact.title}
        >
          {/* Backdrop — clicking outside the popup closes it */}
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            aria-hidden="true"
            onMouseDown={(e) => { e.stopPropagation(); closeWorkspace(); }}
          />
          {/* Glass container */}
          <motion.div
            ref={rootRef}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: dur, ease: "easeOut" }}
            style={{ height: "min(720px, 92vh)" }}
            className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-2xl"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2.5">
              <button onClick={closeWorkspace} aria-label="Close document"
                className="rounded-full p-2 text-muted-foreground transition hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/10">
                <XIcon className="size-4" />
              </button>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{artifact.title}</span>
              {artifact.downloadUrl && (
                <DownloadButton filename={artifact.title} downloadUrl={artifact.downloadUrl} />
              )}
            </div>
            {/* Document body */}
            <div className="relative min-h-0 flex-1">
              <DocumentWorkspace key={artifact.id} artifact={artifact} />
              {/* Shimmer sweep while the agent is applying an edit */}
              {isRunning && <div className="doc-shimmer-veil" aria-hidden="true" />}
              {/* Floating scroll-to-bottom */}
              <AnimatePresence>
                {showBottom && (
                  <motion.button
                    key="to-bottom"
                    initial={{ opacity: 0, scale: 0.85, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85, y: 6 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    onClick={scrollToBottom}
                    aria-label="Scroll to bottom"
                    className="absolute bottom-24 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-popover/85 text-foreground shadow-lg backdrop-blur-xl transition hover:bg-popover"
                  >
                    <ArrowDownIcon className="size-4" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            {/* Floating composer */}
            <DocComposer artifact={artifact} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <style>{`[data-doc-scroll] { padding-bottom: 6rem; }
@keyframes doc-shimmer-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.doc-shimmer-veil { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
.doc-shimmer-veil::after { content: ""; position: absolute; inset-block: 0; inset-inline: -40%; background: linear-gradient(100deg, transparent 35%, rgba(148, 163, 184, 0.22) 50%, transparent 65%); animation: doc-shimmer-sweep 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .doc-shimmer-veil::after { animation: none; } }`}</style>
    </>
  );
}
