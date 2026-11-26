/**
 * Bot-wall / human-check detection for the live browser.
 *
 * Qube cannot (and must not) solve a CAPTCHA or Cloudflare challenge on the
 * user's behalf. What it can do is notice the challenge immediately, stop the
 * agent from replaying clicks against a widget that is usually missing from
 * the accessibility snapshot, and hand control to the user in the Browser
 * panel. This module is the shared detector used by both browser paths.
 *
 * Keep the markers specific: a page that merely mentions "reCAPTCHA" in an
 * article must not be treated as a challenge. Cloudflare's interstitial and
 * reCAPTCHA's widget both have distinctive text.
 */

export type BotWallVendor =
  | "cloudflare"
  | "recaptcha"
  | "hcaptcha"
  | "datadome"
  | "awswaf"
  | "akamai"
  | "generic";

export type BotWall = {
  vendor: BotWallVendor;
  /** Human-readable vendor name for the handoff message. */
  label: string;
};

type Rule = {
  vendor: BotWallVendor;
  label: string;
  test: (text: string) => boolean;
};

const has = (text: string, re: RegExp) => re.test(text);
const both = (text: string, a: RegExp, b: RegExp) => a.test(text) && b.test(text);

const RULES: Rule[] = [
  {
    vendor: "cloudflare",
    label: "Cloudflare",
    // The interstitial title is "Just a moment..."; the body says
    // "Performing security verification" / "Verify you are human".
    test: (t) =>
      has(t, /just a moment\.{0,3}/i) ||
      has(t, /performing security verification/i) ||
      has(t, /checking your browser before accessing/i) ||
      has(t, /attention required!?\s*\|?\s*cloudflare/i) ||
      has(t, /cf-chl|challenge-platform|cf_chl_/i) ||
      both(t, /cloudflare/i, /verify you are human/i),
  },
  {
    vendor: "recaptcha",
    label: "reCAPTCHA",
    // Don't flag a page that only mentions reCAPTCHA; require widget text.
    test: (t) =>
      both(t, /recaptcha/i, /(i'?m not a robot|verify you are human|select all images|complete the (security )?check)/i),
  },
  {
    vendor: "hcaptcha",
    label: "hCaptcha",
    test: (t) => both(t, /hcaptcha/i, /(i am human|verify|challenge)/i),
  },
  {
    vendor: "datadome",
    label: "DataDome",
    test: (t) => has(t, /datadome|captcha-delivery\.com/i),
  },
  {
    vendor: "awswaf",
    label: "AWS WAF",
    test: (t) => has(t, /awswaf|gokuprops/i) || has(t, /verify you'?re not a robot/i),
  },
  {
    vendor: "akamai",
    label: "Akamai",
    test: (t) => has(t, /bm-verify/i) || both(t, /akamai/i, /(bot|challenge)/i),
  },
  {
    vendor: "generic",
    label: "human verification",
    test: (t) =>
      has(t, /complete the security check/i) ||
      has(t, /are you a robot\?/i) ||
      has(t, /human verification/i),
  },
];

/** Return the bot-wall vendor when `text` looks like a human-check page. */
export function detectBotWall(text: string): BotWall | null {
  const s = String(text || "").slice(0, 50_000);
  if (!s.trim()) return null;
  for (const rule of RULES) {
    try {
      if (rule.test(s)) return { vendor: rule.vendor, label: rule.label };
    } catch {}
  }
  return null;
}

/**
 * Appended to a browser tool result when a challenge is detected. The model
 * must stop retrying and hand off: Cloudflare Turnstile and reCAPTCHA usually
 * live in a cross-origin iframe or closed shadow root, so they are absent
 * from the accessibility snapshot and cannot be clicked by ref.
 */
export const BOT_CHECK_HINT =
  "BOT CHECK DETECTED: this page is showing a human-verification challenge. " +
  "The challenge widget is usually hidden from the snapshot, so ref clicks and repeated retries will fail. " +
  "Do NOT replay the same action. Ask the user to complete the check in the Browser panel " +
  "(call request_takeover with reason \"Complete the human check in the Browser panel\" if it is available), " +
  "wait for them to finish, then take a fresh snapshot and continue.";
