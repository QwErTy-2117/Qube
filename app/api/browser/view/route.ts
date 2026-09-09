import { validateBrowserUrl } from "@/lib/agent/browser/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 12000;
const MAX_BYTES = 5_000_000;

/**
 * Live-view proxy for the embedded browser panel.
 *
 * Fetches the requested page server-side (SSRF-gated) and re-serves it
 * from our own origin *without* the target's framing protections
 * (X-Frame-Options / CSP frame-ancestors are simply not forwarded), so
 * the actual live website renders inside the panel instead of refusing
 * to embed.
 *
 * What is preserved: the site's real HTML, CSS, images and scripts —
 * the browser engine renders the genuine page, not a reconstruction.
 * Relative asset URLs keep working via an injected `<base>` tag.
 *
 * Safety: the panel embeds this in a sandboxed iframe *without*
 * `allow-same-origin`, so proxied third-party scripts run in an opaque
 * origin and cannot reach the app. Responses are never cached.
 */
export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get("url") || "";
    const v = validateBrowserUrl(raw);
    if (!v.ok) {
      return new Response(errorPage(v.error), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    let res: Response;
    try {
      res = await fetch(v.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Qube BrowserWorkspace; live view)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(errorPage(`Site unreachable: ${msg.slice(0, 140)}`), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (!res.ok) {
      return new Response(errorPage(`Site returned ${res.status} ${res.statusText}`), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const contentType = res.headers.get("content-type") || "";
    const buf = Buffer.from((await res.arrayBuffer()).slice(0, MAX_BYTES));
    const finalUrl = res.url || v.url;

    // Non-HTML passes through untouched (images, PDFs render natively).
    // Framing protections are still stripped since we set our own headers.
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": contentType.split(";")[0] || "application/octet-stream",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "frame-ancestors 'self'",
        },
      });
    }

    let html = buf.toString("utf-8");
    // Bot walls / empty responses: surface a message instead of a blank page.
    const textLen = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
    if (textLen < 60) {
      return new Response(errorPage("This site refused to serve its content here — open it outside the panel."), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    // Drop page-level CSP meta tags (server CSP headers are already gone —
    // we never forward them — but an in-page tag would still apply).
    html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, "");
    // Make relative asset/link URLs resolve against the real site.
    const base = `<base href="${escapeAttr(finalUrl)}">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
    } else {
      html = `${base}${html}`;
    }

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // Only our own panel may embed this view.
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[browser/view] failed:", msg.slice(0, 300));
    return new Response(errorPage("Live view failed to load"), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function errorPage(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="margin:0;display:flex;height:100vh;align-items:center;justify-content:center;background:#fafafa;color:#71717a;font:13px system-ui,sans-serif"><p>${safe}</p></body></html>`;
}
