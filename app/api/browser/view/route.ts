import { validateBrowserUrl } from "@/lib/agent/browser/ssrf";
import { isValidPanelToken, recordPanelUrl } from "@/lib/browser/panel-urls";
import { SUBFRAME_PARAM, frameShimScript, rewriteNavigations } from "@/lib/browser/view-rewrite";
import { cookieHeaderFor, storeCookiesFromResponse } from "@/lib/browser/cookie-jar";
import {
  looksLikeBotWall,
  renderViaChrome,
  visibleTextLength,
} from "@/lib/browser/chrome-render";
import { JSDOM } from "jsdom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 5_000_000;

/**
 * Browser-like request headers so server-side fetches are not fingerprinted
 * as a script: real Chrome UA, document Accept, language, and fetch metadata.
 * Sites that key off UA (consent flows, mobile/desktop variants) serve real
 * content instead of bot walls. The UA string is a pinned, slightly older
 * Chrome — new enough to be accepted, stable enough to avoid churn.
 */
export function buildBrowserHeaders(
  extra?: Record<string, string>,
  acceptLanguage?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": acceptLanguage || "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    // Chromium CH hints: some WAFs (DataDome, Akamai) score their absence.
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Linux"',
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v;
  }
  return headers;
}

/**
 * Decode a fetched body respecting the charset: content-type header first,
 * then <meta charset=…> sniffing, falling back to UTF-8. The old code always
 * used UTF-8, garbling Shift_JIS / windows-1252 / ISO-8859 pages.
 */
export function decodeBody(buf: Buffer, contentType: string): string {
  let label = "";
  try {
    const m = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType);
    if (m) label = m[1].trim().toLowerCase();
  } catch {}
  const tryDecode = (l: string): string | null => {
    try {
      return new TextDecoder(l, { fatal: false }).decode(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      );
    } catch {
      return null;
    }
  };
  if (label) {
    // Node normalizes windows-1252/latin1; map common aliases.
    if (label === "iso-8859-1" || label === "latin1") label = "windows-1252";
    const out = tryDecode(label);
    if (out !== null) return out;
  }
  // Sniff <meta charset> / <meta http-equiv content-type> in the first 4KB.
  try {
    const head = buf.subarray(0, 4096).toString("latin1");
    const meta =
      /<meta[^>]+charset\s*=\s*["']?([^"'\s/>;]+)/i.exec(head) ||
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"';\s]+)/i.exec(head);
    if (meta) {
      let ml = meta[1].trim().toLowerCase();
      if (ml === "iso-8859-1" || ml === "latin1") ml = "windows-1252";
      const out = tryDecode(ml);
      if (out !== null) return out;
    }
  } catch {}
  return buf.toString("utf-8");
}

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
 * Link rewriting: page links/forms are rewritten to route through this
 * proxy (with the caller's `panel` token preserved), so in-iframe link
 * clicks stay observable — every navigation is recorded for
 * /api/browser/panel-url polling. JS-driven navigations (location.href,
 * SPA routers) cannot be rewritten — documented limitation.
 *
 * Safety: the panel embeds this in a sandboxed iframe *without*
 * `allow-same-origin`, so proxied third-party scripts run in an opaque
 * origin and cannot reach the app. Responses are never cached.
 */
export async function GET(req: Request) {
  return serveProxied(req, undefined);
}

export async function POST(req: Request) {
  // Proxied HTML forms with method=POST submit here (their action was
  // rewritten to this route). Forward method + body to the real site.
  const contentType = req.headers.get("content-type") || "application/x-www-form-urlencoded";
  let body: ArrayBuffer | undefined;
  try {
    body = (await req.arrayBuffer()).slice(0, MAX_BYTES);
  } catch {
    body = undefined;
  }
  return serveProxied(req, body ? { body, contentType } : undefined);
}

async function serveProxied(req: Request, forward?: { body: ArrayBuffer; contentType: string }) {
  try {
    const params = new URL(req.url).searchParams;
    const raw = params.get("url") || "";
    const v = validateBrowserUrl(raw);
    if (!v.ok) {
      return new Response(errorPage(v.error), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const panelParam = params.get("panel") || "";
    const panel = isValidPanelToken(panelParam) ? panelParam : undefined;
    // Subframe loads (nested iframes/embeds, flagged sub=1 at rewrite time)
    // are served but NEVER panel-tracked: recording them would yank the
    // sidebar's main view onto a subframe page on the next poll.
    const isSubframe = params.get(SUBFRAME_PARAM) === "1";
    // Extra query params come from rewritten GET forms (their fields are
    // appended by the browser as the query). Merge them into the target —
    // except our own bookkeeping flags, which must not leak to the site.
    const extra = new URLSearchParams();
    for (const [k, val] of params) {
      if (k !== "url" && k !== "panel" && k !== SUBFRAME_PARAM) extra.append(k, val);
    }
    let target = v.url;
    const extraQuery = extra.toString();
    if (extraQuery) {
      target += (target.includes("?") ? "&" : "?") + extraQuery;
      // Safety: merged fields must not redirect the fetch elsewhere.
      try {
        if (new URL(target).origin !== new URL(v.url).origin) target = v.url;
      } catch {
        target = v.url;
      }
    }

    // Manual redirect loop (max 5, each hop SSRF-revalidated): auto-follow
    // would swallow intermediate Set-Cookie headers, breaking consent and
    // session flows. Cookies persist in the in-memory jar per domain.
    // The client's language is forwarded so geo-sites serve the right locale
    // instead of guessing from the datacenter IP.
    const clientLang = pickClientLanguage(req);
    let res: Response | null = null;
    let current = target;
    let method = forward ? "POST" : "GET";
    let body: ArrayBuffer | undefined = forward?.body;
    let bodyType: string | undefined = forward?.contentType;
    let fetchError: string | null = null;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const headers: Record<string, string> = buildBrowserHeaders(
          bodyType ? { "Content-Type": bodyType } : undefined,
          clientLang
        );
        // POST form forwards keep their referrer so CSRF-checked forms pass.
        if (forward && hop === 0) {
          try {
            headers["Referer"] = new URL(target).origin + "/";
          } catch {}
        }
        const cookies = cookieHeaderFor(current);
        if (cookies) headers["Cookie"] = cookies;
        const step: Response = await fetch(current, {
          method,
          headers,
          body: body,
          // Body must be explicitly allowed with a duplex hint on some runtimes.
          ...(body ? { duplex: "half" } : {}),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "manual",
        } as RequestInit);
        try {
          storeCookiesFromResponse(step, new URL(current).hostname);
        } catch {}
        // Any 3xx with a Location is a redirect (except 304 Not Modified,
        // which never occurs without conditional headers). The old code only
        // handled 301/302/303/307/308 and left 300/305/306 to fall through as
        // opaque failures.
        if (
          step.status >= 300 &&
          step.status < 400 &&
          step.status !== 304
        ) {
          const loc = step.headers.get("location");
          try {
            await step.body?.cancel().catch(() => {});
          } catch {}
          if (!loc) {
            res = step;
            break;
          }
          let next: string;
          try {
            next = new URL(loc, current).toString();
          } catch {
            res = step;
            break;
          }
          const chk = validateBrowserUrl(next);
          if (!chk.ok) {
            return new Response(errorPage(`Redirect blocked: ${chk.error}`), {
              status: 502,
              headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            });
          }
          current = chk.url;
          if (step.status === 303 || ((step.status === 301 || step.status === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
            bodyType = undefined;
          }
          continue;
        }
        res = step;
        break;
      }
      if (!res) {
        return new Response(errorPage("Too many redirects"), {
          status: 502,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Timeouts abort with a generic message — say so plainly so the panel
      // doesn't look like the site is down when it was just slow.
      fetchError =
        /timeout|timed out|abort/i.test(msg) && msg.length < 200
          ? `The site took too long to respond (over ${Math.round(FETCH_TIMEOUT_MS / 1000)}s).`
          : `Site unreachable: ${msg.slice(0, 140)}`;
      res = null;
    }
    // Fetch-level failure (DNS, timeout, refused): a real browser engine on
    // a full JS stack often still loads the page, so try the headless-Chrome
    // fallback before giving up — but only for GET. POST bodies cannot be
    // re-rendered with a GET-only dump-dom pass.
    if (!res && !forward) {
      const rendered = await tryChromeFallback(current, panel, isSubframe, req);
      if (rendered) return rendered;
      return new Response(errorPage(fetchError || "Site unreachable"), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (!res) {
      return new Response(errorPage(fetchError || "Site unreachable"), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    // HTTP errors (403/503/WAF): retry with a real browser engine before
    // surfacing a 502. Verified: Amazon 202-empty / NYT 403-captcha fail here
    // while headless Chromium renders Amazon fully.
    if (!res.ok) {
      if (!forward) {
        try {
          await res.body?.cancel().catch(() => {});
        } catch {}
        const rendered = await tryChromeFallback(current, panel, isSubframe, req);
        if (rendered) return rendered;
      }
      return new Response(
        blockedPage(
          `This site returned ${res.status} ${res.statusText || ""}`.trim(),
          current
        ),
        {
          status: 502,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    // Guard oversized bodies BEFORE buffering: slicing a 50MB body to 5MB
    // mid-tag used to produce broken pages. Fail loudly instead.
    const declaredLen = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BYTES) {
      try {
        await res.body?.cancel().catch(() => {});
      } catch {}
      return new Response(errorPage("This page is too large to preview here — open it outside the panel."), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const buf = Buffer.from((await res.arrayBuffer()).slice(0, MAX_BYTES));
    // Manual redirects: track the final URL ourselves (res.url is empty).
    const finalUrl = current;
    if (panel && !isSubframe) recordPanelUrl(panel, finalUrl);

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

    const html = decodeBody(buf, contentType);
    // Bot walls / empty responses: a real browser engine often passes where
    // fetch gets a challenge (Amazon 202-empty, Reddit puzzle, FB shells).
    // Try headless-Chrome rendering before showing a dead page.
    const textLen = visibleTextLength(html);
    if (looksLikeBotWall(html, textLen)) {
      if (!forward) {
        const rendered = await tryChromeFallback(finalUrl, panel, isSubframe, req);
        if (rendered) return rendered;
      }
      return new Response(blockedPage("This site refused to serve its content here", finalUrl), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const origin = new URL(req.url).origin;
    // Dead-end interstitials (verified: Google re-bounces every server-side
    // fetch — consent cookies included — because bot checks need a real
    // browser JS engine, which the proxy has not). Serve an honest fallback
    // with a working alternative instead of a dead page.
    let fallbackQuery = "";
    try {
      const tu = new URL(target);
      fallbackQuery = tu.searchParams.get("q") || tu.searchParams.get("p") || "";
    } catch {}
    const deadEnd = detectSearchDeadEnd(finalUrl, html, textLen, fallbackQuery);
    if (deadEnd) {
      return new Response(searchDeadEndPage(deadEnd, origin, panel), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "frame-ancestors 'self'",
        },
      });
    }

    // Absolute proxy prefix from our own origin: rewritten links share the
    // document with a <base> tag pointing at the real site, so relative
    // proxy paths would resolve against the TARGET's origin and escape.
    const out = processHtml(html, finalUrl, panel, `${origin}/api/browser/view?url=`, isSubframe);
    return new Response(out, {
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

/**
 * Forward the client's Accept-Language when sane, else default. Without this
 * the proxy's datacenter IP + missing language header makes geo-sites serve
 * the wrong locale (or an extra consent bounce) for every user.
 */
export function pickClientLanguage(req: Request): string {
  try {
    const raw = req.headers.get("accept-language") || "";
    if (!raw) return "en-US,en;q=0.9";
    // Keep only well-formed language ranges, cap length (header injection safe).
    const parts = raw
      .split(",")
      .map((p) => p.trim().slice(0, 20))
      .filter((p) => /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?(;q=0\.\d)?$/i.test(p))
      .slice(0, 6);
    if (parts.length === 0) return "en-US,en;q=0.9";
    return parts.join(", ").slice(0, 120);
  } catch {
    return "en-US,en;q=0.9";
  }
}

/**
 * Headless-Chrome fallback: render the URL with a real browser engine and
 * serve the post-JS DOM through the same rewrite pipeline. Used when fetch
 * gets a bot wall (Amazon 202-empty, Reddit puzzle, 403 captcha). Returns a
 * ready Response, or null when rendering also failed (caller shows the
 * honest blocked page instead).
 */
async function tryChromeFallback(
  url: string,
  panel: string | undefined,
  isSubframe: boolean,
  req: Request
): Promise<Response | null> {
  try {
    const v = validateBrowserUrl(url);
    if (!v.ok) return null;
    // Subframe renders (ads, embeds) never justify a ~8s Chrome pass — serve
    // the fetch result / blocked page instead and keep the main view fast.
    if (isSubframe) return null;
    const rendered = await renderViaChrome(v.url);
    if (!rendered) return null;
    const textLen = visibleTextLength(rendered.html);
    // Still a wall even with JS (e.g. NYT DataDome captcha needs a human):
    // don't serve a captcha frame as if it were content.
    if (looksLikeBotWall(rendered.html, textLen)) return null;
    if (textLen < 100) return null;
    const origin = new URL(req.url).origin;
    if (panel) recordPanelUrl(panel, rendered.finalUrl);
    const out = processHtml(
      rendered.html,
      rendered.finalUrl,
      panel,
      `${origin}/api/browser/view?url=`,
      false
    );
    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Qube-Render": "chrome-fallback",
      },
    });
  } catch (e) {
    console.warn(
      "[browser/view] chrome fallback failed:",
      (e instanceof Error ? e.message : String(e)).slice(0, 200)
    );
    return null;
  }
}

/**
 * Actionable blocked page (replaces the old one-line "refused to serve"):
 * names the cause, links the real page (opens outside the sandboxed panel),
 * and offers a one-click retry through the proxy.
 */
export function blockedPage(message: string, realUrl: string): string {
  const safeMsg = escapeHtml(message);
  const safeUrl = escapeAttr(realUrl);
  const display = escapeHtml(realUrl.length > 90 ? realUrl.slice(0, 90) + "…" : realUrl);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fafafa;color:#52525b;font:14px/1.5 system-ui,sans-serif"><div style="max-width:440px;text-align:center;padding:24px"><p style="font-size:15px;font-weight:600;color:#27272a;margin:0 0 8px">${safeMsg}</p><p style="margin:0 0 4px;word-break:break-all"><span style="font-family:ui-monospace,monospace;font-size:12px">${display}</span></p><p style="margin:0 0 16px">The live view tried a real browser render too. Some sites (CAPTCHAs, logins) still need you.</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 16px;border-radius:999px;background:#18181b;color:#fafafa;text-decoration:none;font-weight:600">Open original</a><a href="" onclick="event.preventDefault();location.reload()" style="display:inline-block;padding:8px 16px;border-radius:999px;border:1px solid #d4d4d8;color:#27272a;text-decoration:none;font-weight:600;background:#fff">Retry</a></div></div></body></html>`;
}

/** Strip page CSP, rewrite links through the proxy, pin <base> to the real site. */
export function processHtml(html: string, finalUrl: string, panel?: string, proxyPrefix = "/api/browser/view?url=", isSubframe = false): string {
  try {
    const dom = new JSDOM(html, { url: finalUrl });
    const doc = dom.window.document;
    // Drop page-level CSP meta tags (server CSP headers are already gone —
    // we never forward them — but an in-page tag would still apply).
    for (const meta of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
      if ((meta.getAttribute("http-equiv") || "").toLowerCase() === "content-security-policy") {
        meta.remove();
      }
    }
    // Keep in-iframe navigations inside the proxy (observable via panel-url).
    rewriteNavigations(doc, { pageUrl: finalUrl, proxyPrefix, panel, isSubframe });
    // Make relative asset/link URLs resolve against the real site. Base must
    // come first in <head> to apply to subsequent relative URLs.
    let head = doc.head;
    if (!head) {
      head = doc.createElement("head");
      doc.documentElement?.prepend(head);
    }
    const existingBase = head.querySelector("base[href]");
    if (existingBase) {
      existingBase.setAttribute("href", finalUrl);
      head.prepend(existingBase);
    } else {
      const base = doc.createElement("base");
      base.setAttribute("href", finalUrl);
      head.prepend(base);
    }
    // Runtime shim FIRST in head (before page scripts): catches iframes and
    // embeds the page creates later via JavaScript (sim players, etc.).
    const shim = doc.createElement("script");
    shim.textContent = frameShimScript(proxyPrefix, panel);
    head.prepend(shim);
    return dom.serialize();
  } catch {
    // Parsing failed — fall back to the raw page with a base tag prepended.
    const base = `<base href="${escapeAttr(finalUrl)}">`;
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
    }
    return `${base}${html}`;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SEARCH_DEAD_END_HOSTS = [/(^|\.)google\.[a-z.]+$/i, /(^|\.)bing\.com$/i, /(^|\.)search\.yahoo\.com$/i];

/**
 * Detect search pages that will never resolve server-side: bot-check
 * interstitials with almost no text, no result links, and no actionable
 * form (consent forms ARE actionable, so those still serve). Returns the
 * host + query so the fallback page can offer a working alternative.
 */
export function detectSearchDeadEnd(
  finalUrl: string,
  html: string,
  textLen: number,
  fallbackQuery = ""
): { host: string; query: string } | null {
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return null;
  }
  if (!SEARCH_DEAD_END_HOSTS.some((re) => re.test(u.hostname))) return null;
  if (textLen >= 800) return null;
  if (/<form[\s>]/i.test(html)) return null;
  if (/<a[^>]+href\s*=\s*["'][^"']*\/url\?/i.test(html)) return null;
  // Redirect chains (consent bounces) often drop the original q= — fall back
  // to the query the user actually asked for so the alternative still works.
  const query = u.searchParams.get("q") || u.searchParams.get("p") || fallbackQuery;
  return { host: u.hostname, query: query.slice(0, 300) };
}

/** Honest fallback for dead-end searches: say so, offer working results. */
export function searchDeadEndPage(dead: { host: string; query: string }, origin: string, panel?: string): string {
  const host = escapeHtml(dead.host);
  const query = escapeHtml(dead.query);
  const alt = dead.query
    ? `<a href="${escapeAttr(
        `${origin}/api/browser/view?url=${encodeURIComponent(`https://html.duckduckgo.com/html/?q=${dead.query}`)}` +
          (panel ? `&panel=${encodeURIComponent(panel)}` : "")
      )}" style="display:inline-block;margin-top:12px;padding:8px 16px;border-radius:999px;background:#18181b;color:#fafafa;text-decoration:none;font-weight:600">See results instead</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fafafa;color:#52525b;font:14px/1.5 system-ui,sans-serif"><div style="max-width:420px;text-align:center;padding:24px"><p style="font-size:15px;font-weight:600;color:#27272a;margin:0 0 8px">${host} won't show automated views${query ? ` for &ldquo;${query}&rdquo;` : ""}</p><p style="margin:0">That site blocks server-side fetching, so this panel can't render it. Ask the agent in chat — its web search works fine.</p>${alt}</div></body></html>`;
}

function errorPage(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="margin:0;display:flex;height:100vh;align-items:center;justify-content:center;background:#fafafa;color:#71717a;font:13px system-ui,sans-serif"><p>${safe}</p></body></html>`;
}
