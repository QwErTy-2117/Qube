/**
 * Safety — filtering/redaction before persistence (§26).
 *
 * Rules:
 * - Never persist credentials, secrets, API keys, tokens, payment data.
 * - Never infer sensitive personal characteristics from ordinary behavior.
 * - Never expose private info in notifications without authorization.
 *
 * This module is deliberately deterministic (regex + heuristics) so it works
 * without a model and can be unit-tested. It runs on EVERY memory/skill write
 * path (voicemem-core add/update, upsert, skill learner).
 */

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-(live|test)-[A-Za-z0-9]{8,}\b/i, label: "api-key" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/, label: "api-key" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/i, label: "slack-token" },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/, label: "github-token" },
  { re: /\bgho_[A-Za-z0-9]{20,}\b/, label: "github-token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i, label: "github-token" },
  { re: /\bAIza[0-9A-Za-z_-]{20,}\b/, label: "google-api-key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "aws-key" },
  { re: /\baws_secret\b.{0,20}[A-Za-z0-9/+=]{30,}/i, label: "aws-secret" },
  { re: /\bbearer\s+[A-Za-z0-9\-._~+/=]{12,}\b/i, label: "bearer-token" },
  { re: /\bapikey\s*[:=]\s*[A-Za-z0-9\-._]{8,}\b/i, label: "api-key" },
  { re: /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9\-._]{12,}["']?/i, label: "api-key" },
  { re: /\bpassword\s*[:=]\s*["']?[^"'\s]{4,}["']?/i, label: "password" },
  { re: /\bpasswd\s*[:=]\s*\S+/i, label: "password" },
  { re: /\bsecret\s*[:=]\s*["']?[^"'\s]{4,}["']?/i, label: "secret" },
  { re: /\bclient_secret\s*[:=]\s*\S+/i, label: "client-secret" },
  { re: /\brefresh_token\s*[:=]\s*\S+/i, label: "refresh-token" },
  { re: /\baccess_token\s*[:=]\s*\S+/i, label: "access-token" },
  { re: /\b-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\b/, label: "private-key" },
  { re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, label: "card-number-candidate" },
  { re: /\bcvv?\s*[:=]?\s*\d{3,4}\b/i, label: "cvv" },
];

const SENSITIVE_INFERENCE_PATTERNS: RegExp[] = [
  /\b(sexual orientation|religion|religious|political (party|views|affiliation)|health condition|medical|diagnos(is|ed)|disability|ethnicity|race|genetic)\b/i,
];

export type SafetyCheck = {
  ok: boolean;
  reason?: string;
  redacted?: string;
};

/** True when content looks like it contains persistable secrets. */
export function containsSecret(content: string): boolean {
  if (!content) return false;
  return SECRET_PATTERNS.some(({ re }) => re.test(content));
}

export function secretLabel(content: string): string | null {
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(content)) return label;
  }
  return null;
}

/** Redact secrets for logging/telemetry (never log raw secrets). */
export function redactSecrets(content: string): string {
  let out = content;
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

/**
 * Gate before persistence. Returns { ok:false } when the content must NOT
 * be stored. Card-number candidates are only blocked when paired with
 * CVV/expiry signals to avoid false positives on order numbers.
 */
export function checkPersistable(content: string): SafetyCheck {
  if (!content || !content.trim()) return { ok: false, reason: "empty" };
  const label = secretLabel(content);
  if (label) {
    if (label === "card-number-candidate") {
      const hasCvv = /\bcvv?\b/i.test(content) || /\bexpir/i.test(content);
      if (!hasCvv) return { ok: true };
    }
    return { ok: false, reason: `blocked sensitive material (${label})`, redacted: redactSecrets(content) };
  }
  return { ok: true };
}

/** Guard against inferring sensitive personal characteristics. */
export function isSensitiveInference(content: string): boolean {
  return SENSITIVE_INFERENCE_PATTERNS.some((re) => re.test(content));
}

/** Category allow-list for persistence — unknown categories map to general. */
const ALLOWED_CATEGORIES = new Set([
  "personal",
  "preference",
  "project",
  "technology",
  "decision",
  "pattern",
  "constraint",
  "goal",
  "general",
]);

export function sanitizeCategory(category: string): string {
  const c = (category || "").trim().toLowerCase() || "general";
  return ALLOWED_CATEGORIES.has(c) ? c : "general";
}
