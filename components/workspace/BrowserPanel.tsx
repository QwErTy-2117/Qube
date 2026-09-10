"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon, GlobeIcon, AlertTriangleIcon, RotateCwIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";

type Health = {
  browser?: { running: boolean; listening: boolean; pid: number; port: number };
  frames?: { watchers: number; framesDelivered: number; lastFrameAt: number | null; lastError: string | null };
} | null;

const MIN_FRAME_LEN = 1000;

async function openInBrowser(url: string): Promise<void> {
  if (!url || !/^https?:\/\//i.test(url)) return;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Browser side panel: mirrors the live headed Chromium window the agent
 * drives (frames via /api/browser/frames). Read-only view — the agent
 * does the clicking. The window is never closed automatically; only the
 * X button (or app shutdown) ends the session. A Retry control recovers
 * a wedged browser without touching anything else.
 */
export function BrowserPanel() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const width = useWorkspaceStore((s) => s.width);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const setWidth = useWorkspaceStore((s) => s.setWidth);
  const reduceMotion = useReducedMotion();
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [liveUrl, setLiveUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>(null);
  const [restarting, setRestarting] = useState(false);
  const [esKey, setEsKey] = useState(0);
  const [live, setLive] = useState(true);
  const hasFrameRef = useRef(false);
  const lastActivityRef = useRef(0);
  const lastReconnectRef = useRef(0);
  const show = open && artifact?.kind === "browser";

  const noteActivity = () => {
    lastActivityRef.current = Date.now();
    setLive(true);
  };

  const onDrag = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(d.startW + (d.startX - e.clientX));
  }, [setWidth]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", endDrag);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onDrag]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: useWorkspaceStore.getState().width };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [onDrag, endDrag]);

  useEffect(() => () => {
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", endDrag);
  }, [onDrag, endDrag]);

  // Freshness watchdog: if nothing (frame or URL tick) arrives for a
  // while, force a stream reconnect — a wedged pipe otherwise freezes the
  // panel on a stale screenshot with no indication. At most once per 15s.
  useEffect(() => {
    if (!show) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      setLive(idleMs < 10000);
      if (idleMs > 15000 && Date.now() - lastReconnectRef.current > 15000) {
        lastReconnectRef.current = Date.now();
        setEsKey((k) => k + 1);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [show, esKey]);

  // Stream live frames while the panel is visible.
  useEffect(() => {
    if (!show) return;
    let es: EventSource | null = null;
    let closed = false;
    hasFrameRef.current = false;
    setError(null);
    setHealth(null);
    try {
      es = new EventSource("/api/browser/frames");
      es.addEventListener("frame", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { jpg?: string; url?: string };
          if (typeof data.url === "string" && data.url) {
            setLiveUrl(data.url);
            noteActivity();
          }
          // Ignore trivial/empty captures — only real frames clear waiting UI.
          if (typeof data.jpg === "string" && data.jpg.length >= MIN_FRAME_LEN) {
            noteActivity();
            setImg(`data:image/jpeg;base64,${data.jpg}`);
            if (!hasFrameRef.current) {
              hasFrameRef.current = true;
              setHasFrame(true);
              setError(null);
              setHealth(null);
            }
          }
        } catch {}
      });
      es.addEventListener("url", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { url?: string };
          if (typeof data.url === "string" && data.url) {
            setLiveUrl(data.url);
            noteActivity();
          }
        } catch {}
      });
      es.addEventListener("error", (ev) => {
        try {
          const data = JSON.parse(((ev as MessageEvent).data as string) || "{}") as { message?: string };
          if (data?.message && !closed) setError(data.message);
        } catch {}
      });
      es.onerror = () => {
        if (closed) return;
        // Connection dropped before any frame: fetch health NOW so the
        // panel shows the reason (+ Retry) instead of hanging on "Connecting…".
        if (!hasFrameRef.current) {
          setError((prev) => prev ?? "Connecting to the browser…");
          fetch("/api/browser/health", { cache: "no-store" })
            .then((r) => r.json().catch(() => null))
            .then((data) => {
              if (closed || hasFrameRef.current) return;
              if (data) {
                setHealth(data);
                const b = (data as Health)?.browser;
                const f = (data as Health)?.frames;
                if (b && (!b.running || !b.listening)) {
                  setError(
                    !b.running
                      ? "The browser process isn't running."
                      : "The browser is running but its control endpoint isn't answering."
                  );
                } else if (f?.lastError) {
                  setError(f.lastError);
                }
              } else {
                setError("Lost connection to the browser view.");
              }
            })
            .catch(() => {
              if (!closed && !hasFrameRef.current) setError("Lost connection to the browser view.");
            });
        }
      };
      // Starvation watchdog: no real frame within 8s → fetch health so the
      // panel shows the actual reason (not a black void) + a Retry button.
      const starve = setTimeout(async () => {
        if (closed || hasFrameRef.current) return;
        try {
          const res = await fetch("/api/browser/health", { cache: "no-store" });
          const data = (await res.json().catch(() => null)) as Health;
          if (!closed && !hasFrameRef.current) setHealth(data);
        } catch {}
      }, 8000);
      return () => {
        closed = true;
        clearTimeout(starve);
        try { es?.close(); } catch {}
        es = null;
      };
    } catch {
      setError("Could not open the live view.");
    }
    return () => {
      closed = true;
      try { es?.close(); } catch {}
      es = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, esKey]);

  const handleRetry = async () => {
    setRestarting(true);
    setHealth(null);
    try {
      await fetch("/api/browser/restart", { method: "POST" });
    } catch {}
    setRestarting(false);
    // Reconnect the stream; a fresh frame clears the diagnostics.
    setEsKey((k) => k + 1);
  };

  const dur = reduceMotion ? 0.01 : 0.22;
  const showDiagnostics = !hasFrame && (error || health);

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.aside
          key="browser-panel"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          transition={{ duration: dur, ease: "easeOut" }}
          style={{ width }}
          className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-[0_8px_32px_-12px_rgba(0,0,0,0.18)]"
        >
          {/* Resizer */}
          <div onMouseDown={startDrag} role="separator" aria-orientation="vertical" aria-label="Resize browser panel"
            className="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize touch-none">
            <div className="mx-auto mt-[45%] h-10 w-1 rounded-full bg-border/70 opacity-0 transition hover:opacity-100" />
          </div>
          {/* Header (no tabs — browser only) */}
          <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
            <span
              title={live ? "Live view" : "View may be stale — reconnecting"}
              aria-label={live ? "Live view" : "View may be stale"}
              className={`size-1.5 shrink-0 rounded-full transition-colors ${live ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`}
            />
            <span className="truncate text-[13px] font-semibold text-foreground">
              {liveUrl || "Browser"}
            </span>
            <span className="flex-1" />
            <button
              onClick={() => void openInBrowser(liveUrl)}
              disabled={!/^https?:\/\//i.test(liveUrl)}
              title={liveUrl ? `Open ${liveUrl} in browser` : "Open in browser"}
              aria-label="Open in browser"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
            >
              <SquareArrowOutUpRightIcon className="size-4" />
            </button>
            <button onClick={closeWorkspace} aria-label="Close browser panel"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <XIcon className="size-4" />
            </button>
          </div>
          {/* Live view */}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black/90">
            {showDiagnostics ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertTriangleIcon className="size-8 text-muted-foreground/40" />
                <p className="max-w-[280px] truncate font-mono text-xs text-muted-foreground">
                  {liveUrl || "Browser view unavailable"}
                </p>
                <p className="max-w-[300px] text-sm font-medium text-foreground/80">
                  {error ||
                    (health?.browser && !health.browser.running
                      ? "The browser process isn't running."
                      : health?.browser && !health.browser.listening
                        ? "The browser is running but its control endpoint isn't answering."
                        : health?.frames?.lastError ||
                          "The browser isn't sending frames yet.")}
                </p>
                {health?.browser && (
                  <p className="max-w-[300px] font-mono text-[11px] leading-relaxed text-muted-foreground">
                    process: {health.browser.running ? `running (pid ${health.browser.pid})` : "not running"} ·{" "}
                    endpoint: {health.browser.listening ? "listening" : "not listening"} ·{" "}
                    frames: {health.frames?.framesDelivered ?? 0}
                  </p>
                )}
                <button
                  onClick={handleRetry}
                  disabled={restarting}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  <RotateCwIcon className={`size-3.5 ${restarting ? "animate-spin" : ""}`} />
                  {restarting ? "Restarting…" : "Retry"}
                </button>
              </div>
            ) : !hasFrame || !img ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <GlobeIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground/80">Waiting for the browser…</p>
                <p className="max-w-[260px] text-xs text-muted-foreground">Ask the agent to browse and the live window appears here.</p>
              </div>
            ) : (
              <div className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt={liveUrl || "Live browser"} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
