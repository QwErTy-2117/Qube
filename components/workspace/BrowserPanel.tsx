"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { XIcon, GlobeIcon, AlertTriangleIcon, RotateCwIcon, ArrowUpIcon, ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useWorkspaceStore } from "@/lib/workspace/store";

type Health = {
  browser?: { running: boolean; listening: boolean; pid: number; port: number };
  frames?: { watchers: number; framesDelivered: number; lastFrameAt: number | null; lastError: string | null };
} | null;

/**
 * Browser side panel: the REAL live page in a sandboxed iframe, served
 * through /api/browser/view (framing protections stripped server-side), so
 * there is no screenshot-stream lag — clicks, scroll and typing are native.
 * The screenshot stream (/api/browser/frames) still runs underneath for URL
 * sync with the agent's shared browser. The window is never closed
 * automatically; only the X button (or app shutdown) ends the session.
 * A Retry control recovers a wedged browser.
 */
export function BrowserPanel() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const width = useWorkspaceStore((s) => s.width);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const setWidth = useWorkspaceStore((s) => s.setWidth);
  const reduceMotion = useReducedMotion();
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
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
  // liveUrl mirror for change-checks without re-rendering on every frame.
  const liveUrlRef = useRef("");
  const liveRef = useRef(true);
  // While the user types in the URL bar, stream updates must NOT overwrite it.
  const editingUrlRef = useRef(false);
  const show = open && artifact?.kind === "browser";
  const [navUrl, setNavUrl] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  // The URL actually rendered in the iframe view. Follows committed
  // navigations (user Go / agent browser) — never keystrokes.
  const [viewUrl, setViewUrl] = useState("");
  // URL the iframe has actually finished loading (vs its current src).
  const [loadedSrc, setLoadedSrc] = useState("");
  const loadedSrcRef = useRef(loadedSrc);
  loadedSrcRef.current = loadedSrc;
  // Opaque per-mount token so the proxy can attribute in-iframe link clicks
  // to this panel for /api/browser/panel-url polling.
  const panelIdRef = useRef<string>("");
  if (!panelIdRef.current) {
    try {
      panelIdRef.current = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    } catch {
      panelIdRef.current = `panel${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    }
  }
  // Last polled panel URL — tells fresh navigations apart from stale polls.
  const lastPollRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const viewUrlRef = useRef(viewUrl);
  viewUrlRef.current = viewUrl;

  const noteActivity = () => {
    lastActivityRef.current = Date.now();
    if (!liveRef.current) {
      liveRef.current = true;
      setLive(true);
    }
  };

  const setLiveUrlIfChanged = (url: string) => {
    if (url && url !== liveUrlRef.current) {
      liveUrlRef.current = url;
      setLiveUrl(url);
      // Keep the bar AND the fast view in sync when the user is NOT typing.
      if (!editingUrlRef.current) {
        setNavUrl(url);
        if (url !== viewUrlRef.current) {
          viewUrlRef.current = url;
          setViewUrl(url);
          pushTravel(url);
        }
      }
    }
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
  // State is only touched on change so the watchdog itself never re-renders.
  useEffect(() => {
    if (!show) return;
    lastActivityRef.current = Date.now();
    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const shouldBeLive = idleMs < 10000;
      if (shouldBeLive !== liveRef.current) {
        liveRef.current = shouldBeLive;
        setLive(shouldBeLive);
      }
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
      const markLive = () => {
        noteActivity();
        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
          setError(null);
          setHealth(null);
        }
      };
      es.addEventListener("frame", (ev) => {
        try {
          // Fast-only view: frame images are ignored (the iframe IS the
          // view). Only the URL is used, to follow the agent's browser.
          // Frame URLs can lag behind navigation — never let them overwrite
          // what the user is typing, and only re-render on actual change.
          const data = JSON.parse((ev as MessageEvent).data) as { url?: string };
          if (typeof data.url === "string" && data.url) {
            setLiveUrlIfChanged(data.url);
            markLive();
          }
        } catch {}
      });
      es.addEventListener("url", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { url?: string };
          if (typeof data.url === "string" && data.url) {
            setLiveUrlIfChanged(data.url);
            markLive();
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

  // Committed-navigation history for back/forward. Kept in a ref (not
  // state) so the SSE handler and the panel-url poller — both long-lived
  // closures — always see fresh values; `travelTick` re-renders for the
  // button disabled-states.
  const travelRef = useRef<{ entries: string[]; idx: number }>({ entries: [], idx: -1 });
  const [travelTick, setTravelTick] = useState(0);
  void travelTick;
  const travel = travelRef.current;

  const pushTravel = (url: string) => {
    const t = travelRef.current;
    if (t.entries[t.idx] === url) return;
    const entries = [...t.entries.slice(0, t.idx + 1), url];
    travelRef.current = { entries, idx: entries.length - 1 };
    setTravelTick((x) => x + 1);
  };

  const commitNavigate = async (target?: string, pushHist = true) => {
    const v = (target ?? navUrl).trim();
    if (!v || navigating) return;
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    editingUrlRef.current = false;
    setNavigating(true);
    setNavError(null);
    setNavUrl(url);
    liveUrlRef.current = url;
    setLiveUrl(url);
    // Drive the fast view immediately — don't wait for the stream round-trip.
    // (The loading overlay is derived from loadedSrc vs src, so no reset needed.)
    viewUrlRef.current = url;
    setViewUrl(url);
    if (pushHist) pushTravel(url);
    try {
      const res = await fetch("/api/browser/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "navigate", url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && data.error)) {
        throw new Error((data && data.error) || `Navigation failed (${res.status})`);
      }
      urlInputRef.current?.blur();
    } catch (e) {
      // Keep the typed URL so the user can retry; show why it failed.
      editingUrlRef.current = true;
      setNavError(e instanceof Error ? e.message : String(e));
    } finally {
      setNavigating(false);
    }
  };

  const goBack = () => {
    const t = travelRef.current;
    if (t.idx <= 0 || navigating) return;
    travelRef.current = { entries: t.entries, idx: t.idx - 1 };
    setTravelTick((x) => x + 1);
    void commitNavigate(t.entries[t.idx - 1], false);
  };

  const goForward = () => {
    const t = travelRef.current;
    if (t.idx >= t.entries.length - 1 || navigating) return;
    travelRef.current = { entries: t.entries, idx: t.idx + 1 };
    setTravelTick((x) => x + 1);
    void commitNavigate(t.entries[t.idx + 1], false);
  };

  const dur = reduceMotion ? 0.01 : 0.22;
  const showDiagnostics = !hasFrame && !viewUrl && (error || health);
  const proxySrc = viewUrl
    ? `/api/browser/view?url=${encodeURIComponent(viewUrl)}&panel=${panelIdRef.current}`
    : "";

  // Follow in-iframe link clicks: the proxy records every navigation under
  // our panel token (links/forms are rewritten to route through it). Poll
  // for the current page URL and adopt it into the bar + travel history.
  // Guards: skip while typing, while the view is still settling on a
  // committed URL, and ignore already-seen (stale) poll values.
  useEffect(() => {
    if (!show) return;
    const t = setInterval(async () => {
      try {
        if (editingUrlRef.current) return;
        if (loadedSrcRef.current !== viewUrlRef.current) return;
        const res = await fetch(`/api/browser/panel-url?panel=${panelIdRef.current}`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { url?: string | null } | null;
        const url = typeof data?.url === "string" ? data.url : null;
        if (!url || url === lastPollRef.current) return;
        lastPollRef.current = url;
        if (url !== viewUrlRef.current) {
          viewUrlRef.current = url;
          setViewUrl(url);
          setNavUrl(url);
          pushTravel(url);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

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

          {/* Live view — the REAL page in a sandboxed iframe (native clicks,
              scroll, typing — zero screenshot lag). */}
          <div
            ref={containerRef}
            className="relative min-h-0 flex-1 overflow-hidden bg-white"
          >
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
            ) : !hasFrame && !viewUrl ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <GlobeIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground/80">Waiting for the browser…</p>
                <p className="max-w-[260px] text-xs text-muted-foreground">Ask the agent to browse and the live window appears here — you can also type a URL above and click around.</p>
              </div>
            ) : (
              <div className="absolute inset-0 bg-white">
                <iframe
                  key={proxySrc}
                  src={proxySrc}
                  title={liveUrl || viewUrl || "Live browser"}
                  sandbox="allow-scripts allow-forms allow-popups allow-downloads"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 h-full w-full border-0 bg-white"
                  onLoad={() => setLoadedSrc(proxySrc)}
                />
                {loadedSrc !== proxySrc && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white">
                    <p className="text-xs text-muted-foreground">
                      {navigating ? "Navigating…" : "Loading page…"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Bottom bar — back/forward + single rounded typing container (Go centered inside, outer buttons same height, all rounded) */}
          <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
            <button
              onClick={goBack}
              disabled={travel.idx <= 0 || navigating}
              title="Go back"
              aria-label="Go back"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/50 bg-muted/60 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
            >
              <ArrowLeftIcon className="size-4" />
            </button>
            <button
              onClick={goForward}
              disabled={travel.idx >= travel.entries.length - 1 || navigating}
              title="Go forward"
              aria-label="Go forward"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/50 bg-muted/60 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
            >
              <ArrowRightIcon className="size-4" />
            </button>
            <div className={`flex h-8 flex-1 items-center gap-2 rounded-full bg-muted/60 pl-3 pr-1 border transition-colors ${navError ? "border-red-500/60 focus-within:bg-background" : "border-border/50 focus-within:border-border focus-within:bg-background"}`}>
              <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={urlInputRef}
                value={navUrl}
                onChange={(e) => {
                  setNavUrl(e.target.value);
                  if (navError) setNavError(null);
                }}
                onFocus={() => {
                  editingUrlRef.current = true;
                }}
                onBlur={() => {
                  // Stop shielding the bar once the user leaves it; if they
                  // typed nothing new, fall back to the viewed page URL.
                  editingUrlRef.current = false;
                  if (!navUrl.trim() && viewUrlRef.current) setNavUrl(viewUrlRef.current);
                }}
                onKeyDown={(e) => {
                  // Never let URL-bar keys bubble to the page handler above.
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitNavigate();
                  } else if (e.key === "Escape") {
                    // Abandon the edit and restore the viewed URL.
                    editingUrlRef.current = false;
                    if (viewUrlRef.current) setNavUrl(viewUrlRef.current);
                    urlInputRef.current?.blur();
                  }
                }}
                placeholder={viewUrl || liveUrl || "https://"}
                title={navError || viewUrl || liveUrl || undefined}
                aria-label="Browser URL"
                className="min-w-0 flex-1 bg-transparent text-[13px] leading-none outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => void commitNavigate()}
                disabled={navigating || !navUrl.trim()}
                aria-label="Go"
                title={navError || "Go to URL"}
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <ArrowUpIcon className={`size-3.5 ${navigating ? "animate-pulse" : ""}`} />
              </button>
            </div>
            <button onClick={closeWorkspace} aria-label="Close browser panel"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/60 text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <XIcon className="size-4" />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
