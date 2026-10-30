"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangleIcon,
  KeyboardIcon,
  Loader2Icon,
  MonitorIcon,
  MousePointer2Icon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { useAuiState } from "@assistant-ui/react";

import { useWorkspaceStore } from "@/lib/workspace/store";
import type { CuaActionEvent, CuaFrameMeta } from "@/lib/cua/types";
import {
  impactsAt,
  isPressed,
  planActionAnimation,
  planSpeed,
  sampleCursor,
  type CursorAnimation,
  type CursorImpact,
  type Point,
} from "@/lib/computer-use/visualization/timeline";

type Box = { left: number; top: number; width: number; height: number };

type StatusInfo = {
  kind: CuaActionEvent["kind"];
  tool: string;
  ok: boolean;
  app?: string;
  windowTitle?: string;
  key?: string;
  text?: string;
  direction?: string;
  amount?: number;
  error?: string;
  at: number;
};

type ImpactView = {
  id: string;
  kind: CursorImpact["kind"];
  x?: number;
  y?: number;
  label?: string;
  direction?: string;
  amount?: number;
};

function labelFor(event: CuaActionEvent): string {
  switch (event.kind) {
    case "click":
      return "Clicking";
    case "double_click":
      return "Double-clicking";
    case "right_click":
      return "Right-clicking";
    case "scroll":
      return `Scrolling ${event.direction ?? "down"}`;
    case "drag":
      return "Dragging";
    case "type":
      return "Typing";
    case "key":
      return event.keys?.length ? `Pressing ${event.keys.join("+")}` : "Pressing a key";
    case "observe":
      return "Looking at the screen";
    case "window":
      return "Switching windows";
    case "launch":
      return "Opening an app";
    case "clipboard":
      return "Using the clipboard";
    default:
      return "Working";
  }
}

/**
 * Computer panel — the live, real CUA Driver desktop view.
 *
 * It renders the exact delivered screenshot from the last observation and
 * mirrors each real action event with an eased cursor, press squish, ripple,
 * typed-text keycap, scroll bob and drag line. Coordinates are never
 * invented: events without a grounded x/y are shown only in the status line.
 */
export function ComputerPanel() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const width = useWorkspaceStore((s) => s.width);
  const setWidth = useWorkspaceStore((s) => s.setWidth);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const reduceMotion = useReducedMotion();
  const show = open && artifact?.kind === "computer";
  const threadId = useAuiState(
    (s) =>
      ((s.threadListItem as unknown as { remoteId?: string })?.remoteId ??
        (s.threads as unknown as { mainThreadId?: string })?.mainThreadId ??
        (s.thread as unknown as { id?: string })?.id ??
        "") as string,
  );

  const [frame, setFrame] = useState<CuaFrameMeta | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [connected, setConnected] = useState<"connecting" | "live" | "offline">("connecting");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [press, setPress] = useState(false);
  const [trail, setTrail] = useState<Point[]>([]);
  const [impact, setImpact] = useState<ImpactView | null>(null);
  const [dragLine, setDragLine] = useState<{ from: Point; to: Point } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [imageError, setImageError] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<CuaFrameMeta | null>(null);
  const cursorRef = useRef<Point | null>(null);
  const queueRef = useRef<CuaActionEvent[]>([]);
  const animRef = useRef<{ anim: CursorAnimation; started: number; fired: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEventIdRef = useRef(0);
  const handleActionRef = useRef<(event: CuaActionEvent) => void>(() => {});
  const startNextRef = useRef<() => void>(() => {});
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const frameUrl = frame
    ? `/api/computer-use/frame?threadId=${encodeURIComponent(frame.threadId)}&v=${frame.version}`
    : "";

  // Keep the latest frame available synchronously so an action message that
  // arrives in the same SSE tick still knows the frame scope/dimensions.
  const applyFrame = useCallback((next: CuaFrameMeta) => {
    const prev = frameRef.current;
    if (
      prev &&
      (prev.scope !== next.scope || prev.width !== next.width || prev.height !== next.height)
    ) {
      // Coordinates from a different scope or screenshot size are not valid
      // on this image. Drop the old mirror rather than drawing a fake point.
      queueRef.current = [];
      animRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      cursorRef.current = null;
      setCursor(null);
      setTrail([]);
    }
    frameRef.current = next;
    setFrame(next);
    setImageError(false);
  }, []);

  const applyStatus = useCallback((event: CuaActionEvent) => {
    setStatus({
      kind: event.kind,
      tool: event.tool,
      ok: event.ok,
      app: event.app,
      windowTitle: event.windowTitle,
      key: event.keys?.length ? event.keys.join("+") : event.key,
      text: event.text,
      direction: event.direction,
      amount: event.amount,
      error: event.error,
      at: event.at,
    });
  }, []);

  const pointToStage = useCallback(
    (point: Point | null): Point | null => {
      const f = frameRef.current;
      const b = box;
      if (!point || !f || !b || !f.width || !f.height) return null;
      return {
        x: b.left + (point.x / f.width) * b.width,
        y: b.top + (point.y / f.height) * b.height,
      };
    },
    [box],
  );

  const clearFxSoon = useCallback((ms = 720) => {
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      setImpact(null);
      setDragLine(null);
      clearTimerRef.current = null;
    }, ms);
  }, []);

  const fireImpact = useCallback(
    (anim: CursorAnimation, impact: CursorImpact, index: number) => {
      const id = `${anim.id}:${index}`;
      setImpact({
        id,
        kind: impact.kind,
        x: impact.x,
        y: impact.y,
        label: impact.label,
        direction: impact.direction,
        amount: impact.amount,
      });
      if (impact.kind === "drag") {
        const from = { x: anim.event.fromX ?? impact.x ?? 0, y: anim.event.fromY ?? impact.y ?? 0 };
        const to = { x: anim.event.toX ?? impact.x ?? 0, y: anim.event.toY ?? impact.y ?? 0 };
        setDragLine({ from, to });
      }
      clearFxSoon(impact.kind === "scroll" ? 900 : 720);
    },
    [clearFxSoon],
  );

  // Animation queue. Actions are queued and played at a speed that catches up
  // when several real actions arrive together — the mirror never slows CUA.
  startNextRef.current = () => {
    if (animRef.current) return;
    const event = queueRef.current.shift();
    if (!event) return;
    const f = frameRef.current;
    if (!f) {
      startNextRef.current();
      return;
    }
    const anim = planActionAnimation(event, cursorRef.current, {
      speed: planSpeed(queueRef.current.length),
    });
    if (!anim) {
      startNextRef.current();
      return;
    }
    animRef.current = { anim, started: performance.now(), fired: 0 };
    let lastTrail = 0;
    const tick = (now: number) => {
      const state = animRef.current;
      if (!state || state.anim.id !== anim.id) return;
      const elapsed = now - state.started;
      const point = sampleCursor(anim, elapsed);
      if (point && (point.x !== cursorRef.current?.x || point.y !== cursorRef.current?.y)) {
        cursorRef.current = point;
        setCursor(point);
        if (now - lastTrail > 48) {
          lastTrail = now;
          setTrail((prev) => [...prev.slice(-6), point]);
        }
      }
      setPress(isPressed(anim, elapsed));
      const due = impactsAt(anim, elapsed);
      while (state.fired < due.length) {
        fireImpact(anim, due[state.fired], state.fired);
        state.fired++;
      }
      if (elapsed < anim.totalDuration) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (anim.target) {
        cursorRef.current = { ...anim.target };
        setCursor({ ...anim.target });
      }
      setPress(false);
      animRef.current = null;
      rafRef.current = null;
      window.setTimeout(() => setTrail([]), 320);
      if (queueRef.current.length > 0) {
        window.setTimeout(() => startNextRef.current(), 40);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  handleActionRef.current = (event: CuaActionEvent) => {
    applyStatus(event);
    if (!event.ok) {
      // Failed actions never animate. Keep the real cursor where it was.
      return;
    }
    const f = frameRef.current;
    const positional =
      event.x !== undefined ||
      event.y !== undefined ||
      event.fromX !== undefined ||
      event.toX !== undefined;
    if (positional) {
      if (!f) return;
      if (event.scope && f.scope && event.scope !== f.scope) return;
      if (
        f.width &&
        f.height &&
        event.frameWidth &&
        event.frameHeight &&
        (Math.abs(event.frameWidth - f.width) > 1 || Math.abs(event.frameHeight - f.height) > 1)
      ) {
        return;
      }
    }
    queueRef.current.push(event);
    startNextRef.current();
  };

  // SSE stream for the active thread.
  useEffect(() => {
    if (!show) return;
    setConnected("connecting");
    // A different thread has a different event id space and screenshot.
    // Reset the mirror so old coordinates can never leak onto a new desktop.
    lastEventIdRef.current = 0;
    queueRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    animRef.current = null;
    cursorRef.current = null;
    frameRef.current = null;
    setFrame(null);
    setCursor(null);
    setTrail([]);
    setStatus(null);
    setImpact(null);
    setDragLine(null);
    setBox(null);
    setImageError(false);
    let source: EventSource | null = null;
    try {
      const qs = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
      source = new EventSource(`/api/computer-use/stream${qs}`);
    } catch {
      setConnected("offline");
      return;
    }
    const onSnapshot = (raw: MessageEvent) => {
      try {
        const data = JSON.parse(String(raw.data || "{}"));
        if (data.frame) applyFrame(data.frame);
        if (typeof data.lastEventId === "number") {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, data.lastEventId);
        }
        const latest = data.latest as CuaActionEvent | null;
        if (latest) {
          applyStatus(latest);
          const f = frameRef.current;
          if (
            latest.ok &&
            latest.x !== undefined &&
            latest.y !== undefined &&
            f &&
            (!latest.scope || !f.scope || latest.scope === f.scope)
          ) {
            // Replay the final position immediately — never a long animation
            // of actions that happened while the panel was closed.
            cursorRef.current = { x: latest.x, y: latest.y };
            setCursor({ x: latest.x, y: latest.y });
            setTrail([]);
          }
        }
      } catch {}
    };
    const onFrame = (raw: MessageEvent) => {
      try {
        applyFrame(JSON.parse(String(raw.data || "{}")) as CuaFrameMeta);
      } catch {}
    };
    const onAction = (raw: MessageEvent) => {
      try {
        const event = JSON.parse(String(raw.data || "{}")) as CuaActionEvent;
        if (!event || typeof event.id !== "number" || event.id <= lastEventIdRef.current) return;
        lastEventIdRef.current = event.id;
        handleActionRef.current(event);
      } catch {}
    };
    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.addEventListener("frame", onFrame as EventListener);
    source.addEventListener("action", onAction as EventListener);
    source.addEventListener("ready", () => setConnected("live"));
    source.onerror = () => setConnected("offline");
    return () => {
      try {
        source?.close();
      } catch {}
      queueRef.current = [];
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      animRef.current = null;
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, [show, threadId, applyFrame, applyStatus]);

  // Fit the real screenshot inside the stage without distortion.
  useEffect(() => {
    if (!show) return;
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const f = frameRef.current;
      if (!f || !f.width || !f.height) {
        setBox(null);
        return;
      }
      const aw = el.clientWidth;
      const ah = el.clientHeight;
      if (aw <= 0 || ah <= 0) return;
      const scale = Math.min(aw / f.width, ah / f.height);
      setBox({
        left: (aw - f.width * scale) / 2,
        top: (ah - f.height * scale) / 2,
        width: f.width * scale,
        height: f.height * scale,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [show, frame?.width, frame?.height]);

  useEffect(() => {
    if (!show) {
      setFrame(null);
      frameRef.current = null;
      setStatus(null);
      setCursor(null);
      cursorRef.current = null;
      setTrail([]);
      setImpact(null);
      setDragLine(null);
      setBox(null);
    }
  }, [show]);

  // Panel resize.
  const onDrag = useCallback(
    (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setWidth(d.startW + (d.startX - e.clientX));
    },
    [setWidth],
  );
  const endDrag = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", endDrag);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onDrag]);
  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: useWorkspaceStore.getState().width };
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", endDrag);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag, endDrag],
  );
  useEffect(
    () => () => {
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", endDrag);
    },
    [onDrag, endDrag],
  );

  const cursorStage = pointToStage(cursor);
  const impactStage = pointToStage(
    impact && impact.x !== undefined && impact.y !== undefined
      ? { x: impact.x, y: impact.y }
      : null,
  );
  const dragFrom = pointToStage(dragLine?.from ?? null);
  const dragTo = pointToStage(dragLine?.to ?? null);
  const appName = status?.app || frame?.app || "Computer";
  const windowTitle = status?.windowTitle || frame?.windowTitle || "";

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.aside
          key="computer-panel"
          initial={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : 48 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
          style={{ width }}
          className="relative flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-[0_8px_32px_-12px_rgba(0,0,0,0.18)]"
        >
          <div
            onMouseDown={startDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize computer panel"
            className="absolute top-0 bottom-0 left-0 z-30 w-2 cursor-ew-resize touch-none"
          >
            <div className="mx-auto mt-[45%] h-10 w-1 rounded-full bg-border/70 opacity-0 transition hover:opacity-100" />
          </div>

          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
            <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight">
                {appName}
              </div>
              {windowTitle && (
                <div className="truncate text-[10px] leading-tight text-muted-foreground">
                  {windowTitle}
                </div>
              )}
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                connected === "live"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : connected === "offline"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }`}
              title={connected === "live" ? "Live CUA event stream" : connected === "offline" ? "Reconnecting" : "Connecting"}
            >
              {connected === "live" ? (
                <span className="size-1.5 rounded-full bg-emerald-500" />
              ) : connected === "offline" ? (
                <WifiOffIcon className="size-2.5" />
              ) : (
                <Loader2Icon className="size-2.5 animate-spin" />
              )}
              {connected === "live" ? "live" : connected === "offline" ? "offline" : "…"}
            </span>
            <button
              onClick={() => closeTab("computer:session")}
              aria-label="Close computer panel"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/60 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>

          {status?.error && (
            <div className="flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-300">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-3">{status.error}</span>
            </div>
          )}

          <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#0b0d12]">
            {frame && box ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frameUrl}
                  alt={`${appName}${windowTitle ? ` — ${windowTitle}` : ""}`}
                  draggable={false}
                  onError={(event) => {
                    // Ignore a stale in-flight request for an older frame
                    // version; only the current URL failing is meaningful.
                    if (event.currentTarget.src.includes(`v=${frame.version}`)) {
                      setImageError(true);
                    }
                  }}
                  className="pointer-events-none absolute select-none object-contain"
                  style={{
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    opacity: imageError ? 0 : 1,
                    transition: "opacity 160ms ease",
                  }}
                />
                {imageError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                    <AlertTriangleIcon className="size-7 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-white/80">Screenshot unavailable</p>
                    <p className="max-w-[260px] text-xs text-white/50">
                      The action events are still live; the next real observation will restore the view.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                {connected === "offline" ? (
                  <WifiOffIcon className="size-8 text-white/30" />
                ) : (
                  <MonitorIcon className="size-8 text-white/30" />
                )}
                <p className="text-sm font-medium text-white/80">
                  {connected === "offline" ? "Reconnecting to the computer…" : "Waiting for the agent…"}
                </p>
                <p className="max-w-[270px] text-xs text-white/45">
                  When the agent uses your computer, its real screen and actions appear here.
                </p>
              </div>
            )}

            {/* Drag path */}
            {dragFrom && dragTo && (
              <svg className="pointer-events-none absolute inset-0 size-full">
                <line
                  x1={dragFrom.x}
                  y1={dragFrom.y}
                  x2={dragTo.x}
                  y2={dragTo.y}
                  stroke="var(--primary)"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  opacity="0.8"
                />
              </svg>
            )}

            {/* Trail */}
            {trail.map((point, index) => {
              const p = pointToStage(point);
              if (!p) return null;
              return (
                <span
                  key={`${index}-${Math.round(point.x)}-${Math.round(point.y)}`}
                  className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
                  style={{ left: p.x, top: p.y, opacity: 0.06 + index * 0.07 }}
                />
              );
            })}

            {/* Cursor */}
            {cursorStage && (
              <div
                className="pointer-events-none absolute z-10"
                style={{
                  left: cursorStage.x,
                  top: cursorStage.y,
                  transform: `translate(-2px, -2px) scale(${press ? 0.86 : 1})`,
                  transformOrigin: "2px 2px",
                  transition: "transform 80ms ease-out",
                }}
              >
                <span
                  className="absolute -left-3.5 -top-3.5 size-7 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, color-mix(in srgb, var(--primary) 34%, transparent) 0%, transparent 70%)",
                  }}
                />
                <svg width="26" height="26" viewBox="0 0 24 24" className="relative drop-shadow-[0_2px_3px_rgba(0,0,0,.45)]">
                  <path
                    d="M2.2 2.2 L2.2 19.4 L7.2 14.9 L10.6 21.6 L13.6 20.1 L10.2 13.4 L17.6 13.4 Z"
                    fill="var(--primary)"
                    stroke="white"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}

            {/* Impact effects */}
            {impact && impactStage && impact.kind !== "key" && impact.kind !== "type" && (
              <span
                key={impact.id}
                className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                  impact.kind === "scroll" ? "cua-scroll-bob" : "cua-ripple"
                }`}
                style={{
                  left: impactStage.x,
                  top: impactStage.y,
                  width: impact.kind === "scroll" ? 28 : 22,
                  height: impact.kind === "scroll" ? 28 : 22,
                  borderColor:
                    impact.kind === "right_click"
                      ? "#f59e0b"
                      : impact.kind === "drag"
                        ? "#8b5cf6"
                        : "var(--primary)",
                  boxShadow: "0 0 12px color-mix(in srgb, var(--primary) 45%, transparent)",
                }}
              />
            )}

            {/* Key / typing badge */}
            {impact && impactStage && (impact.kind === "key" || impact.kind === "type") && (
              <div
                key={impact.id}
                className="cua-key-pop pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+16px)] rounded-full border border-white/15 bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur"
                style={{ left: impactStage.x, top: impactStage.y }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <KeyboardIcon className="size-3" />
                  <span className="max-w-[180px] truncate">{impact.label || "key"}</span>
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <MousePointer2Icon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {status ? (
                <>
                  {status.ok ? labelFor(status as unknown as CuaActionEvent) : "Action failed"}
                  {status.key ? ` · ${status.key}` : ""}
                  {status.direction ? ` · ${status.direction}` : ""}
                  {status.text && status.kind === "type"
                    ? ` · “${status.text.slice(0, 32)}”`
                    : ""}
                </>
              ) : (
                "Live view from CUA Driver"
              )}
            </span>
            {cursor && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums">
                {Math.round(cursor.x)},{Math.round(cursor.y)}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
              CUA
            </span>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
