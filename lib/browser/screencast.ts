/**
 * Live interactive mirror of the managed Chromium for the app's Browser
 * side panel (/api/browser/frames SSE).
 *
 * - Video: Page.startScreencast over a CDP WebSocket (~20fps JPEG).
 * - Input: Input.dispatchMouseEvent / dispatchKeyEvent / insertText on
 *   the same session, driven by the panel (click, hover, wheel, typing).
 *   The agent drives the same page concurrently via MCP — both are just
 *   CDP input, so they compose.
 * - Follows the newest non-chrome page (agent opening tabs switches view).
 * - Runs only while someone watches. The browser itself is never closed
 *   automatically.
 */

import WebSocket from "ws";
import { getBrowserPort } from "./managed-chrome";

export type FrameMeta = { deviceWidth: number; deviceHeight: number };
export type FrameListener = (frame: { jpg: string; url: string; meta: FrameMeta | null }) => void;

const listeners = new Set<FrameListener>();
let currentUrl = "";
let currentMeta: FrameMeta | null = null;
let ws: WebSocket | null = null;
let wsTargetId: string | null = null;
let starting = false;
let msgId = 0;
let reattachTimer: ReturnType<typeof setTimeout> | null = null;
let followTimer: ReturnType<typeof setInterval> | null = null;
let framesDelivered = 0;
let lastFrameAt: number | null = null;
let lastPipeError: string | null = null;
let seenTargetIds = new Set<string>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Snapshot cadence when the screencast goes quiet (static pages). */
const SNAPSHOT_IDLE_MS = 2500;

/** Last real page seen — restored if the agent's tab vanishes. */
let lastHttpUrl = "";

function isRealUrl(url: string): boolean {
  return !!url && !/^(about:blank|chrome)/i.test(url);
}
let restoredUrl = "";

export function getFramesStats(): {
  watchers: number;
  framesDelivered: number;
  lastFrameAt: number | null;
  lastError: string | null;
} {
  return {
    watchers: listeners.size,
    framesDelivered,
    lastFrameAt,
    lastError: lastPipeError,
  };
}

function devtoolsHttp(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  return fetch(`http://127.0.0.1:${getBrowserPort()}${path}`, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(t)
  );
}

type PageTarget = { id: string; url: string; wsUrl: string };

async function listPageTargets(): Promise<PageTarget[]> {
  const res = await devtoolsHttp("/json/list");
  if (!res.ok) throw new Error(`DevTools list failed (${res.status})`);
  const targets = (await res.json()) as Array<{
    id: string;
    type: string;
    url: string;
    webSocketDebuggerUrl?: string;
  }>;
  return targets
    .filter((t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("chrome"))
    .map((t) => ({ id: t.id, url: t.url, wsUrl: t.webSocketDebuggerUrl as string }));
}

async function pickPageTarget(): Promise<PageTarget> {
  const pages = await listPageTargets();
  const best = rankTargets(pages);
  if (best) {
    pages.forEach((p) => seenTargetIds.add(p.id));
    return best;
  }
  try {
    await devtoolsHttp("/json/new?about:blank", { method: "PUT" });
  } catch {}
  await new Promise((r) => setTimeout(r, 800));
  const retry = await listPageTargets();
  const again = rankTargets(retry);
  if (!again) throw new Error("No page target in managed browser");
  retry.forEach((p) => seenTargetIds.add(p.id));
  return again;
}

/**
 * Rank page targets: a real http(s) page always beats about:blank —
 * the agent browses the web while our launcher idles on a blank tab.
 * Among equals, prefer the last listed (creation order).
 */
function rankTargets(pages: PageTarget[]): PageTarget | null {
  if (pages.length === 0) return null;
  const http = pages.filter((p) => /^https?:\/\//i.test(p.url));
  const pool = http.length > 0 ? http : pages;
  return pool[pool.length - 1];
}

function broadcast(jpg: string, url: string, meta: FrameMeta | null) {
  if (listeners.size === 0) return;
  for (const fn of listeners) {
    try {
      fn({ jpg, url, meta });
    } catch {}
  }
}

function teardown() {
  try {
    ws?.removeAllListeners();
    ws?.close();
  } catch {}
  ws = null;
  wsTargetId = null;
  if (followTimer) {
    clearInterval(followTimer);
    followTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Single snapshot over the live pipe (fallback when screencast idles). */
function captureOnce(): void {
  if (!ws || ws.readyState !== 1) return;
  const id = ++msgId;
  const onMsg = (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        try { ws?.off("message", onMsg); } catch {}
        if (typeof msg.result?.data === "string") {
          framesDelivered++;
          lastFrameAt = Date.now();
          lastPipeError = null;
          broadcast(msg.result.data, currentUrl, currentMeta);
        }
      }
    } catch {}
  };
  try {
    ws.on("message", onMsg);
    ws.send(
      JSON.stringify({
        id,
        method: "Page.captureScreenshot",
        params: { format: "jpeg", quality: 55, maxWidth: 1280, fromSurface: true },
      })
    );
    setTimeout(() => {
      try { ws?.off("message", onMsg); } catch {}
    }, 10000);
  } catch {}
}

/** Immediate refresh after user input (instant feedback). */
function poke(): void {
  captureOnce();
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (listeners.size === 0) return;
    // Screencast covers motion; snapshot only when the picture went stale
    // (static pages, throttled compositor) — the panel stays live.
    if (lastFrameAt === null || Date.now() - lastFrameAt > SNAPSHOT_IDLE_MS) {
      captureOnce();
    }
  }, 1000);
  try { (heartbeatTimer as unknown as { unref?: () => void }).unref?.(); } catch {}
}

function scheduleReattach() {
  if (reattachTimer || listeners.size === 0) return;
  reattachTimer = setTimeout(() => {
    reattachTimer = null;
    if (listeners.size > 0) void ensurePipe();
  }, 2000);
}

function sendInput(payload: Record<string, unknown>): void {
  try {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ id: ++msgId, ...payload }));
    }
  } catch {}
}

/** Request/response call over the live pipe (null on any failure). */
function callMethod<T = any>(method: string, params?: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) {
      resolve(null);
      return;
    }
    const id = ++msgId;
    const timer = setTimeout(() => {
      try { ws?.off("message", onMsg); } catch {}
      resolve(null);
    }, 8000);
    const onMsg = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          try { ws?.off("message", onMsg); } catch {}
          resolve((msg.result ?? null) as T | null);
        }
      } catch {}
    };
    try {
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Keep viewport metrics fresh so panel clicks map correctly. */
async function refreshViewport(): Promise<void> {
  try {
    const res = await callMethod<{
      layoutViewport?: { clientWidth?: number; clientHeight?: number };
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
    }>("Page.getLayoutMetrics");
    const vp = res?.layoutViewport ?? res?.cssVisualViewport;
    if (vp && typeof vp.clientWidth === "number" && vp.clientWidth > 0) {
      currentMeta = {
        deviceWidth: vp.clientWidth,
        deviceHeight: typeof vp.clientHeight === "number" ? vp.clientHeight : 0,
      };
    }
  } catch {}
}

/** Panel input → page. Coordinates are in page CSS pixels. */
export function panelMouseMove(x: number, y: number): void {
  sendInput({ method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: Math.round(x), y: Math.round(y) } });
}

export function panelClick(x: number, y: number, button: "left" | "middle" | "right" = "left"): void {
  const r = { x: Math.round(x), y: Math.round(y), button, clickCount: 1 };
  sendInput({ method: "Input.dispatchMouseEvent", params: { ...r, type: "mousePressed" } });
  sendInput({ method: "Input.dispatchMouseEvent", params: { ...r, type: "mouseReleased" } });
  setTimeout(poke, 350);
}

export function panelWheel(x: number, y: number, deltaX: number, deltaY: number): void {
  sendInput({
    method: "Input.dispatchMouseEvent",
    params: { type: "mouseWheel", x: Math.round(x), y: Math.round(y), deltaX: Math.round(deltaX), deltaY: Math.round(deltaY) },
  });
  setTimeout(poke, 350);
}

const SPECIAL_KEYS: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
};

export function panelKey(key: string): void {
  if (key.length === 1) {
    sendInput({ method: "Input.insertText", params: { text: key } });
    return;
  }
  const spec = SPECIAL_KEYS[key];
  if (!spec) return;
  const base = { ...spec, text: key === "Enter" ? "\r" : undefined };
  sendInput({ method: "Input.dispatchKeyEvent", params: { ...base, type: "keyDown" } });
  sendInput({ method: "Input.dispatchKeyEvent", params: { ...base, type: "keyUp" } });
  setTimeout(poke, 350);
}

async function ensurePipe(): Promise<void> {
  if (starting) return;
  if (listeners.size === 0) return;
  if (ws && ws.readyState === 1 && wsTargetId) return;
  starting = true;
  try {
    teardown();
    const target = await pickPageTarget();
    currentUrl = target.url;
    if (isRealUrl(currentUrl)) {
      lastHttpUrl = currentUrl;
      restoredUrl = "";
    }
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(target.wsUrl, { handshakeTimeout: 8000 });
      socket.on("open", () => {
        ws = socket;
        wsTargetId = target.id;
        socket.on("message", (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.method === "Page.screencastFrame" && msg.params) {
              // sessionId is a TOP-LEVEL CDP field — wrong shape stalls frames.
              if (typeof msg.sessionId === "string" && msg.sessionId) {
                try {
                  socket.send(
                    JSON.stringify({ id: ++msgId, method: "Page.screencastFrameAck", params: {}, sessionId: msg.sessionId })
                  );
                } catch {}
              }
              const meta = msg.params.metadata as { deviceWidth?: number; deviceHeight?: number } | undefined;
              if (meta && typeof meta.deviceWidth === "number") {
                currentMeta = { deviceWidth: meta.deviceWidth, deviceHeight: meta.deviceHeight ?? 0 };
              }
              if (typeof msg.params.data === "string") {
                framesDelivered++;
                lastFrameAt = Date.now();
                lastPipeError = null;
                broadcast(msg.params.data, currentUrl, currentMeta);
              }
            }
          } catch {}
        });
        socket.on("close", () => {
          if (ws === socket) {
            ws = null;
            wsTargetId = null;
          }
          scheduleReattach();
        });
        socket.on("error", () => {
          try { socket.close(); } catch {}
        });
        // Live video, not snapshots.
        try {
          socket.send(
            JSON.stringify({
              id: ++msgId,
              method: "Page.startScreencast",
              params: { format: "jpeg", quality: 60, maxWidth: 1440, everyNthFrame: 2 },
            })
          );
        } catch {}
        resolve();
      });
      socket.on("error", (e: Error) => {
        try { socket.removeAllListeners(); } catch {}
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
    // Follow tab switches / navigations while watched.
    startHeartbeat();
    if (followTimer) clearInterval(followTimer);
    followTimer = setInterval(() => {
      void (async () => {
        try {
          const pages = await listPageTargets();
          pages.forEach((p) => seenTargetIds.add(p.id));
          const current = pages.find((p) => p.id === wsTargetId);
          if (current && current.url !== currentUrl) {
            currentUrl = current.url;
            if (isRealUrl(currentUrl)) {
              lastHttpUrl = currentUrl;
              restoredUrl = "";
            }
            broadcast("", currentUrl, currentMeta);
          }
          // Viewport metrics keep panel input mapping exact.
          if (current) void refreshViewport();
          // Re-evaluate the best view every poll: an http(s) page always
          // wins over about:blank, so a wrong initial attach self-heals.
          const best = rankTargets(pages);
          const shouldSwitch =
            best &&
            best.id !== wsTargetId &&
            (best.url !== currentUrl || !current) &&
            (/^https?:\/\//i.test(best.url) || !current);
          if (shouldSwitch) {
            // Target closed, agent opened a new tab, or we sat on blank.
            ws = null;
            wsTargetId = null;
            if (followTimer) {
              clearInterval(followTimer);
              followTimer = null;
            }
            await ensurePipe();
            return;
          }
          // The agent's tab vanished (MCP disconnect closes it) leaving
          // only the launcher's blank tab: resurrect the last real page
          // so the view stays where the work happened.
          const anyHttp = pages.some((p) => /^https?:\/\//i.test(p.url));
          if (!anyHttp && lastHttpUrl && restoredUrl !== lastHttpUrl && wsTargetId) {
            restoredUrl = lastHttpUrl;
            try {
              if (ws && ws.readyState === 1) {
                ws.send(
                  JSON.stringify({ id: ++msgId, method: "Page.navigate", params: { url: lastHttpUrl } })
                );
              }
            } catch {}
          }
        } catch {}
      })();
    }, 2000);
    try { (followTimer as unknown as { unref?: () => void }).unref?.(); } catch {}
  } catch (e) {
    teardown();
    lastPipeError = (e as Error)?.message || String(e);
    console.warn("[frames] pipe failed, will retry while watched:", lastPipeError);
    scheduleReattach();
  } finally {
    starting = false;
  }
}

/** Called when the managed browser (re)launches — reattach if watched. */
export function noteBrowserReady(): void {
  restoredUrl = "";
  if (listeners.size > 0) void ensurePipe();
}

export function subscribeFrames(fn: FrameListener): () => void {
  listeners.add(fn);
  void ensurePipe();
  try {
    if (currentUrl) fn({ jpg: "", url: currentUrl, meta: currentMeta });
  } catch {}
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      if (reattachTimer) {
        clearTimeout(reattachTimer);
        reattachTimer = null;
      }
      seenTargetIds = new Set<string>();
      // Stop streaming but LEAVE the browser window alone.
      try {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ id: ++msgId, method: "Page.stopScreencast", params: {} }));
        }
      } catch {}
      teardown();
    }
  };
}

export function subscriberCount(): number {
  return listeners.size;
}
