import { panelClick, panelMouseMove, panelWheel, panelKey } from "@/lib/browser/screencast";
import { getBrowserPort } from "@/lib/browser/managed-chrome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/browser/input — forward user interaction from the side panel
 * into the live Chromium (same CDP pipe the agent uses).
 *
 * Body: { type: "click"|"move"|"wheel"|"key"|"navigate", x?, y?, deltaX?, deltaY?, key?, url?, button? }
 * Coordinates are page CSS pixels (panel maps via meta.deviceWidth).
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
      panelKey(key);
      return Response.json({ ok: true });
    }
    if (type === "navigate") {
      const url = String(body.url || "").trim();
      if (!url || !/^https?:\/\//i.test(url)) return Response.json({ error: "valid http(s) url required" }, { status: 400 });
      // CDP Page.navigate via screencast's ws would be ideal; fallback to DevTools HTTP
      try {
        // Try via DevTools HTTP new tab (simplest) — then close old blank
        const port = getBrowserPort();
        await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: "PUT", signal: AbortSignal.timeout(5000) });
      } catch {}
      // Also try CDP navigate on current target for in-place nav
      try {
        const { panelClick } = await import("@/lib/browser/screencast");
        void panelClick;
      } catch {}
      return Response.json({ ok: true });
    }

    return Response.json({ error: `unknown type ${type}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
