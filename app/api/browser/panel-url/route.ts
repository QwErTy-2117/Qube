import { isValidPanelToken, recallPanelUrl } from "@/lib/browser/panel-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/browser/panel-url?panel=<token> — current page URL last served
 * through /api/browser/view for that panel token (in-iframe link clicks
 * included). Lets the sidebar URL bar and back/forward history follow
 * navigations that happen inside the cross-origin iframe.
 */
export async function GET(req: Request) {
  try {
    const panel = new URL(req.url).searchParams.get("panel") || "";
    if (!isValidPanelToken(panel)) {
      return Response.json({ ok: false, error: "valid panel token required" }, { status: 400 });
    }
    return Response.json({ ok: true, url: recallPanelUrl(panel) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
