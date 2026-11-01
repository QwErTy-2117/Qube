/**
 * Headless-Chrome fallback renderer for /api/browser/view.
 *
 * Server-side `fetch()` can never render JS-heavy or bot-guarded sites:
 * Amazon answers 202 with an empty body, Reddit/Facebook serve JS shells
 * with almost no text, NYT answers 403 with a DataDome captcha. A real
 * browser engine with JS passes most of these (verified: headless Chromium
 * renders Amazon's full homepage while fetch gets 0 bytes).
 *
 * This module renders a URL with an isolated, ephemeral headless Chromium
 * (`--dump-dom --virtual-time-budget --incognito`) — NOT the shared managed
 * browser, so proxy renders never steal the screencast view or disturb the
 * agent's tabs. Incognito gives a clean context per render without a fresh
 * --user-data-dir (which hangs headless Chromium in minimal containers).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { findChromeBinary } from "./managed-chrome";

export type ChromeRenderResult = {
  html: string;
  /** Dump-dom always reflects the requested URL after client-side redirects. */
  finalUrl: string;
};

const DEFAULT_BUDGET_MS = 8000;
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_HTML_BYTES = 5_000_000;

/**
 * Render a URL with headless Chromium and return its post-JS DOM.
 * Returns null when Chrome is unavailable, times out, or produces no HTML.
 * Never throws — callers fall back to the fetch path / error page.
 */
export async function renderViaChrome(
  url: string,
  opts?: { budgetMs?: number; timeoutMs?: number }
): Promise<ChromeRenderResult | null> {
  const budgetMs = Math.min(
    Math.max(opts?.budgetMs ?? DEFAULT_BUDGET_MS, 2000),
    15000
  );
  const timeoutMs = Math.min(
    Math.max(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 8000),
    45000
  );

  let binary: string | null = null;
  try {
    binary = findChromeBinary();
  } catch {
    binary = null;
  }
  if (!binary || !existsSync(binary)) return null;

  // Isolation without a fresh --user-data-dir: fresh dirs hang headless
  // Chromium in minimal containers (SingletonLock / first-run init never
  // completes), while the default profile works instantly. --incognito gives
  // a clean ephemeral context per render without touching the shared
  // managed-browser profile (which lives under getDataDir(), not the
  // default location) and without disturbing its tabs/screencast.
  const html = await new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      proc = spawn(
        binary as string,
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-features=Translate",
          "--incognito",
          `--virtual-time-budget=${budgetMs}`,
          "--dump-dom",
          url,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch {
      done(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc?.kill("SIGKILL");
      } catch {}
      done(null);
    }, timeoutMs);
    // Unref so a hung render never holds the server open.
    try {
      (timer as unknown as { unref?: () => void }).unref?.();
    } catch {}

    const chunks: Buffer[] = [];
    let total = 0;
    proc.stdout?.on("data", (c: Buffer) => {
      total += c.length;
      // Cap memory: keep first MAX bytes (head holds the document).
      if (total <= MAX_HTML_BYTES + 65536) chunks.push(c);
    });
    proc.stderr?.on("data", () => {
      // Chrome logs DBus/GPU noise on stderr — ignore.
    });
    proc.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        const out = Buffer.concat(chunks).toString("utf-8");
        if (!out || !/<html/i.test(out)) {
          done(null);
          return;
        }
        done(out.length > MAX_HTML_BYTES ? out.slice(0, MAX_HTML_BYTES) : out);
      } catch {
        done(null);
      }
    });
  });

  if (!html) return null;
  return { html, finalUrl: url };
}

/** Visible-text length (scripts/styles/tags stripped) — same metric as the view route. */
export function visibleTextLength(html: string): number {
  try {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim().length;
  } catch {
    return 0;
  }
}

/**
 * True when HTML looks like a bot wall / JS challenge rather than content:
 * Akamai BM verify, AWS WAF (Amazon), DataDome/captcha-delivery (NYT),
 * Cloudflare challenge, Reddit's JS puzzle, or an (almost) empty shell that
 * only boots JS. Verified against live fetches: Amazon serves an AWS WAF
 * page with 157 chars of "verify you're not a robot" text (no bm-verify
 * marker), Reddit a 6-char puzzle, NYT a captcha-delivery 403.
 */
export function looksLikeBotWall(html: string, textLen: number): boolean {
  const h = html.slice(0, 30000).toLowerCase();
  if (
    h.includes("bm-verify") ||
    h.includes("captcha-delivery.com") ||
    h.includes("datadome") ||
    h.includes("cf-challenge") ||
    h.includes("cf_chl_") ||
    h.includes("just a moment") ||
    h.includes("verify you are human") ||
    h.includes("please enable js and disable any ad blocker") ||
    h.includes("nameditem(\"solution\")") ||
    h.includes('name="solution"') ||
    h.includes("triggerinterstitialchallenge") ||
    // AWS WAF (Amazon 202 challenge): gokuProps + challenge.js + container.
    h.includes("awswaf") ||
    h.includes("gokuprops") ||
    h.includes("awswafintegration") ||
    h.includes("challenge-container")
  ) {
    return true;
  }
  // Generic JS-required robot gate with almost no other content: the WAF
  // text alone ("verify you're not a robot ... Enable JavaScript") is ~157
  // chars. Legit articles with a noscript banner have thousands of chars, so
  // requiring short text keeps this precise.
  if (
    textLen < 400 &&
    h.includes("not a robot") &&
    h.includes("javascript")
  ) {
    return true;
  }
  // Empty shell: virtually no text but a real document that only boots JS.
  // (Example.com has ~139 chars of real text — well above this line.)
  if (textLen < 60) return true;
  return false;
}
