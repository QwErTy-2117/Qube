"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ArtifactShell — the ONE outer window shared by every file popup.
 *
 * Responsibilities (and nothing else): overlay + container shape, radius,
 * header with close control, spacing, theme, transition, focus handling,
 * body sizing and the loading shimmer. File-specific viewers render their
 * own toolbars and content inside `children`; the shell must never learn
 * about PDFs, slides or cells.
 */

export type ArtifactShellSize = "document" | "wide" | "media" | "compact";

const SIZES: Record<ArtifactShellSize, { maxWidth: string; height: string }> = {
  compact: { maxWidth: "max-w-3xl", height: "min(680px, 90vh)" },
  document: { maxWidth: "max-w-4xl", height: "min(760px, 92vh)" },
  wide: { maxWidth: "max-w-5xl", height: "min(820px, 93vh)" },
  media: { maxWidth: "max-w-[1120px]", height: "min(860px, 94vh)" },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ArtifactShell({
  open,
  title,
  icon,
  badge,
  onClose,
  download,
  size = "document",
  running = false,
  children,
  footer,
  className,
  ariaLabel,
}: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  onClose: () => void;
  download?: ReactNode;
  size?: ArtifactShellSize;
  /** Show the "agent is editing" shimmer veil over the content. */
  running?: boolean;
  children: ReactNode;
  /** Overlay region at the bottom (composer, quotes) owned by the popup. */
  footer?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dims = SIZES[size];
  const dur = reduceMotion ? 0.01 : 0.2;

  const close = useCallback(() => onClose(), [onClose]);

  // Escape closes (unless a viewer element is fullscreen), Tab stays inside,
  // and focus returns to whatever opened the popup.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the dialog for screen readers and keyboard users.
    const raf = requestAnimationFrame(() => {
      const target =
        rootRef.current?.querySelector<HTMLElement>("[data-artifact-focus]") ??
        contentRef.current ??
        rootRef.current;
      target?.focus?.({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="artifact-shell"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel || title}
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            aria-hidden="true"
            onMouseDown={(e) => {
              e.stopPropagation();
              close();
            }}
          />
          <motion.div
            ref={rootRef}
            initial={{ opacity: 0, scale: 0.965, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.975, y: 10 }}
            transition={{ duration: dur, ease: "easeOut" }}
            style={{ height: dims.height }}
            className={cn(
              "relative flex w-full flex-col overflow-hidden rounded-[26px] border border-border bg-background text-foreground shadow-2xl",
              dims.maxWidth,
              className,
            )}
          >
            {/* Header — identical for every artifact type. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-2.5">
              <button
                onClick={close}
                aria-label={`Close ${title}`}
                data-artifact-focus
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-black/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none dark:hover:bg-white/10"
              >
                <XIcon className="size-4" />
              </button>
              {icon && <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={title}>
                {title}
              </span>
              {badge}
              {download && <span className="flex shrink-0 items-center">{download}</span>}
            </div>

            {/* Viewer area — file-specific UI lives entirely in here. */}
            <div ref={contentRef} className="relative min-h-0 flex-1 bg-background" tabIndex={-1}>
              {children}
              {running && <div className="artifact-shimmer-veil" aria-hidden="true" />}
            </div>

            {footer}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Shared inline styles for the session sweep (kept next to the shell). */
export function ArtifactShellStyles() {
  return (
    <style>{`
@keyframes artifact-shimmer-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.artifact-shimmer-veil { position: absolute; inset: 0; z-index: 20; overflow: hidden; pointer-events: none; }
.artifact-shimmer-veil::after { content: ""; position: absolute; inset-block: 0; inset-inline: -40%; background: linear-gradient(100deg, transparent 35%, rgba(148, 163, 184, 0.18) 50%, transparent 65%); animation: artifact-shimmer-sweep 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .artifact-shimmer-veil::after { animation: none; } }
`}</style>
  );
}
