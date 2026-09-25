import { validateBrowserUrl } from "@/lib/agent/browser/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reachability probe for the embedded browser panel.
 *
 * The panel renders pages through /api/browser/view, which re-serves
 * the live site without its framing protections — so X-Frame-Options /
 * frame-ancestors never block embedding here. This endpoint only checks
 * that the live site is reachable (headers only; nothing extracted).
 */
export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("url") || "";
    const v = validateBrowserUrl(raw);
    if (!v.ok) return Response.json({ ok: false, error: v.error }, { status: 400 });

    // Fetch a small prefix of the live page: reachable + serving real
    // content means the panel can render it (framing protections are
    // stripped by /api/browser/view, so XFO/CSP are not checked here).
    // Browser-like headers so the probe isn't fingerprinted as a script.
    // Note: bot-walled pages (Amazon, Reddit, NYT) fail this fetch probe but
    // still render via the view route's headless-Chrome fallback — so a
    // "false" here means "needs JS rendering", not "unrenderable".
    try {
      const res = await fetch(v.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          Range: "bytes=0-32767",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const partial = await res.text().catch(() => "");
      try { await res.body?.cancel().catch(() => {}); } catch {}
      if (!res.ok && res.status !== 206) {
        return Response.json({ ok: true, frameable: false, reason: `Site returned ${res.status}` });
      }
      const textLen = partial
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ").trim().length;
      if (textLen < 60) {
        return Response.json({ ok: true, frameable: false, reason: "This site refused automated access — open it outside the panel" });
      }
      return Response.json({ ok: true, frameable: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ ok: true, frameable: false, reason: `Site unreachable: ${msg.slice(0, 120)}` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[browser/frame-check] failed:", msg.slice(0, 300));
    return Response.json({ ok: false, error: "Frame check failed" }, { status: 500 });
  }
}
