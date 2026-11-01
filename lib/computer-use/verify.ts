import type { PageFingerprint, Verification } from "./types";

export interface RawResult { ok: boolean; errorText: string; uncertain?: boolean }

export function parseResult(out: unknown): RawResult {
  try {
    if (out == null) return { ok: true, errorText: "" };
    if (typeof out === "string") {
      const t = out.trim();
      if (/^error:/i.test(t)) return { ok: false, errorText: t.slice(0, 300) };
      if (/operation not permitted/i.test(t)) return { ok: false, errorText: t.slice(0, 300) };
      try {
        const p = JSON.parse(t);
        if (p && typeof p === "object") {
          const err = (p as any).error;
          if (err) return { ok: false, errorText: String(err).slice(0, 300) };
          if ((p as any).ok === false) return { ok: false, errorText: String((p as any).error || (p as any).message || "action failed").slice(0, 300) };
          if ((p as any).exitCode !== undefined && Number((p as any).exitCode) !== 0) return { ok: false, errorText: String((p as any).stderr || `exit ${(p as any).exitCode}`).slice(0, 300) };
          return { ok: true, errorText: "", uncertain: !!(p as any).uncertain };
        }
      } catch {}
      if (/"error"\s*:\s*true/.test(t)) return { ok: false, errorText: t.slice(0, 300) };
      return { ok: true, errorText: "" };
    }
    if (typeof out === "object") {
      const o = out as any;
      if (o.isError === true) {
        const text = Array.isArray(o.content) ? o.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim() : "";
        return { ok: false, errorText: (text || "tool error").slice(0, 300) };
      }
      if (typeof o.error === "string" && o.error) return { ok: false, errorText: o.error.slice(0, 300) };
      if (o.ok === false) return { ok: false, errorText: String(o.error || o.message || "action failed").slice(0, 300) };
      return { ok: true, errorText: "", uncertain: !!o.uncertain };
    }
    return { ok: true, errorText: "" };
  } catch { return { ok: true, errorText: "" }; }
}

const STALE_RE = /stale ref|unknown ref|element is gone|vanished mid-action|re-render/i;
const DISABLED_RE = /disabled|not clickable|not interactable|obscured|intercepted/i;
const NAVFAIL_RE = /timeout|net::|ERR_|DNS|connection refused|not attached|no live browser|navigation failed|404\b/i;
const CRASH_RE = /target closed|session closed|browser.*(crash|disconnect|unreachable)|ECONNREFUSED|socket hang up|websocket.*clos/i;
const AUTHWALL_RE = /sign in|log ?in|password|2fa|two-?factor|verify.*identity/i;
const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|verify you are human|i am not a robot|challenge/i;

export function verifyResult(raw: RawResult, pre: PageFingerprint | null, post: PageFingerprint | null, kind: string): Verification {
  const signals: string[] = [];
  if (!raw.ok) {
    if (STALE_RE.test(raw.errorText)) signals.push("stale_ref");
    else if (CRASH_RE.test(raw.errorText)) signals.push("crash");
    else if (DISABLED_RE.test(raw.errorText)) signals.push("disabled");
    else if (NAVFAIL_RE.test(raw.errorText)) signals.push("nav_failed");
    else signals.push("error_text");
    return { verdict: "failed", changed: false, signals };
  }
  if (kind === "observe" || kind === "meta") return { verdict: "verified", changed: false, signals };
  if (!post) return { verdict: "unknown", changed: false, signals };
  if (CAPTCHA_RE.test(`${post.title} ${post.url}`)) signals.push("captcha");
  else if (AUTHWALL_RE.test(`${post.title}`)) signals.push("auth_wall");
  if (post.dialog && !(pre && pre.dialog)) signals.push("new_dialog");
  if (!pre) return { verdict: "unknown", changed: false, signals };
  const urlChanged = pre.url !== post.url;
  const textChanged = pre.textHash !== post.textHash;
  const focusChanged = (pre.focus || null) !== (post.focus || null);
  const formChanged = (pre.formHash ?? null) !== (post.formHash ?? null);
  const scrolled = (pre.scrollY ?? null) !== (post.scrollY ?? null);
  if (urlChanged) signals.push("url_changed");
  if (textChanged) signals.push("text_changed");
  if (focusChanged) signals.push("focus_changed");
  if (formChanged) signals.push("form_changed");
  if (scrolled) signals.push("scrolled");
  const changed = urlChanged || textChanged || focusChanged || formChanged || scrolled || signals.includes("new_dialog");
  if (signals.includes("captcha") || signals.includes("auth_wall")) return { verdict: "failed", changed, signals };
  if (changed) return { verdict: "verified", changed: true, signals };
  return { verdict: "no_effect", changed: false, signals };
}
