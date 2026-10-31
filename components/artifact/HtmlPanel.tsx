"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { ArtifactError, ArtifactLoading } from "./states";

/**
 * HTML artifacts get a deliberately minimal side panel instead of the
 * standard popup: the rendered page, the panel, and an X in the bottom-left
 * corner. No URL bar, no navigation chrome.
 *
 * Security: the document is rendered in a sandboxed iframe WITHOUT
 * `allow-same-origin`, so it runs in an opaque origin and cannot touch the
 * app's DOM, cookies, localStorage or IPC bridge. A CSP inside the iframe
 * additionally blocks network requests and form submission/navigation.
 */

const CSP = [
  "default-src 'none'",
  "img-src data: blob: https: http:",
  "media-src data: blob: https: http:",
  "style-src 'unsafe-inline' https: http:",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "font-src data: https: http:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

function withSecurityHead(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

export function HtmlPanel() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const width = useWorkspaceStore((s) => s.width);
  const setWidth = useWorkspaceStore((s) => s.setWidth);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const reduceMotion = useReducedMotion();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const show = open && artifact?.kind === "html" && !!artifact.filePath;
  const filePath = artifact?.filePath || "";
  const srcDoc = useMemo(() => (html === null ? "" : withSecurityHead(html)), [html]);

  useEffect(() => {
    if (!show || !filePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    fetch(`/api/workspace/document?path=${encodeURIComponent(filePath)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json()) as { ok?: boolean; content?: string; error?: string };
        if (!r.ok || json.ok === false) throw new Error(json.error || `Load failed (${r.status})`);
        if (!cancelled) setHtml(json.content || "");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [show, filePath]);

  // Resize from the left edge, same interaction as the other side panels.
  useEffect(() => {
    const onDrag = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(d.startW + (d.startX - e.clientX));
    };
    const endDrag = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", endDrag);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);
    return () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", endDrag);
    };
  }, [setWidth]);

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.aside
          key="html-panel"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: "easeOut" }}
          style={{ width }}
          aria-label={`HTML artifact: ${artifact?.title || "page"}`}
          className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white shadow-[0_8px_32px_-12px_rgba(0,0,0,0.18)] dark:bg-neutral-950"
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              dragRef.current = { startX: e.clientX, startW: width };
              document.body.style.cursor = "ew-resize";
              document.body.style.userSelect = "none";
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize HTML panel"
            className="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize touch-none"
          >
            <div className="mx-auto mt-[45%] h-10 w-1 rounded-full bg-border/70 opacity-0 transition hover:opacity-100" />
          </div>

          <div className="relative min-h-0 flex-1">
            {loading && <ArtifactLoading label="Rendering page…" />}
            {!loading && error && (
              <ArtifactError title="Couldn’t open this HTML file" message={error} />
            )}
            {!loading && !error && html !== null && (
              <iframe
                title={artifact?.title || "HTML artifact"}
                srcDoc={srcDoc}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                referrerPolicy="no-referrer"
                className="h-full w-full border-0 bg-white"
              />
            )}
          </div>

          {/* The only control in this panel: close, bottom-left. */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-30">
            <button
              type="button"
              onClick={closeWorkspace}
              aria-label="Close HTML panel"
              className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-lg backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
