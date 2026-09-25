import { panelClick, panelMouseMove, panelWheel, panelKey, panelType } from "@/lib/browser/screencast";
import { getBrowserPort } from "@/lib/browser/managed-chrome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/browser/input — forward user interaction from the side panel
 * into the live Chromium (same CDP pipe the agent uses).
 *
 * Body: { type: "click"|"move"|"wheel"|"key"|"type"|"navigate", x?, y?, deltaX?, deltaY?, key?, text?, url?, button?, modifiers? }
 * Coordinates are page CSS pixels (panel maps via meta.deviceWidth/Height).
 */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type as string;

    if (type === "click") {
      const x = Number(body.x), y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Response.json({ error: "x,y required" }, { status: 400 });
      panelClick(x, y, body.button || "left");
      return Response.json({ ok: true });
    }
    if (type === "move") {
      const x = Number(body.x), y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Response.json({ error: "x,y required" }, { status: 400 });
      panelMouseMove(x, y);
      return Response.json({ ok: true });
    }
    if (type === "wheel") {
      const x = Number(body.x ?? 0), y = Number(body.y ?? 0);
      panelWheel(x, y, Number(body.deltaX || 0), Number(body.deltaY || 0));
      return Response.json({ ok: true });
    }
    if (type === "key") {
      const key = String(body.key || "");
      if (!key) return Response.json({ error: "key required" }, { status: 400 });
      const modifiers = Array.isArray(body.modifiers) ? body.modifiers.map(String) : undefined;
      panelKey(key, modifiers);
      return Response.json({ ok: true });
    }
    if (type === "type") {
      const text = String(body.text || "");
      if (!text) return Response.json({ error: "text required" }, { status: 400 });
      panelType(text);
      return Response.json({ ok: true });
    }
    if (type === "navigate") {
      const url = String(body.url || "").trim();
      if (!url || !/^https?:\/\//i.test(url)) return Response.json({ error: "valid http(s) url required" }, { status: 400 });
      // In-place navigate on the current page target (no tab spam). Wait for
      // the matching CDP response so failures reach the panel UI instead of
      // silently leaving the user on the old page.
      try {
        const port = getBrowserPort();
        const listRes = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
        if (!listRes.ok) return Response.json({ error: `browser list failed (${listRes.status})` }, { status: 502 });
        const targets = (await listRes.json()) as Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>;
        const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
        const http = pages.filter((t) => /^https?:\/\//i.test(t.url));
        const current = (http.length ? http : pages).pop();
        if (!current?.webSocketDebuggerUrl) {
          // No live target at all: open a fresh tab so the user still lands
          // on the page instead of staring at the old one.
          const put = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
          if (!put.ok) return Response.json({ error: `browser is not answering (port ${port})` }, { status: 502 });
          return Response.json({ ok: true });
        }
        const { default: WebSocket } = await import("ws");
        const navError = await new Promise<string | null>((resolve) => {
          const ws = new WebSocket(current.webSocketDebuggerUrl!, { handshakeTimeout: 5000 });
          const timer = setTimeout(() => { try { ws.close(); } catch {} resolve("navigation timed out"); }, 8000);
          ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } })));
          ws.on("message", (raw: Buffer) => {
            try {
              const msg = JSON.parse(raw.toString());
              // Ignore unrelated CDP events — only the navigate reply counts.
              if (msg.id !== 1) return;
              clearTimeout(timer);
              try { ws.close(); } catch {}
              resolve(msg.error?.message ? String(msg.error.message) : null);
            } catch {}
          });
          ws.on("error", (e: Error) => { clearTimeout(timer); try { ws.close(); } catch {} resolve(e.message || "CDP error"); });
        });
        if (navError) return Response.json({ error: navError }, { status: 502 });
        return Response.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ error: msg || "navigation failed" }, { status: 500 });
      }
    }

    return Response.json({ error: `unknown type ${type}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
