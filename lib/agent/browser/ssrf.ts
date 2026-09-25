/**
 * SSRF + URL validation for server-side browser sessions.
 * Blocks private/internal targets, non-http(s) schemes, credentials in URL.
 */

const BLOCKED_HOST_SUFFIXES = [
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
];

const BLOCKED_EXACT_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 0) return true;
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (BLOCKED_EXACT_HOSTS.has(h)) return true;
  if (h === "[::1]" || h === "::1") return true;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".lan")) return true;
  for (const s of BLOCKED_HOST_SUFFIXES) {
    if (h === s || h.endsWith(`.${s}`)) return true;
  }
  if (isPrivateIPv4(h)) return true;
  // IPv6 loopback / unique-local / link-local (literal, without DNS lookup)
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1).toLowerCase();
    if (inner === "::1" || inner.startsWith("fc") || inner.startsWith("fd") || inner.startsWith("fe80")) return true;
  }
  return false;
}

export function validateBrowserUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== "string") return { ok: false, error: "URL is required" };
  let trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "URL is empty" };
  // Real-world widget/SSO/search URLs routinely exceed 2KB (long tokens,
  // merged form fields). Browsers accept 8K+; length is not an SSRF vector.
  if (trimmed.length > 8192) return { ok: false, error: "URL too long (max 8192 chars)" };
  // Allow bare domains: default to https
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: `Invalid URL: ${raw.slice(0, 120)}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `Blocked scheme "${u.protocol}" — only http(s) allowed` };
  }
  if (u.username || u.password) {
    return { ok: false, error: "URLs with credentials are blocked" };
  }
  if (isBlockedHostname(u.hostname)) {
    return { ok: false, error: `Blocked internal/private target: ${u.hostname}` };
  }
  // Block common cloud metadata IPs by literal
  if (u.hostname === "169.254.169.254" || u.hostname === "[fd00:ec2::254]") {
    return { ok: false, error: "Blocked cloud metadata endpoint" };
  }
  return { ok: true, url: u.toString() };
}

export function validateSearchQuery(q: string): { ok: true; query: string } | { ok: false; error: string } {
  if (!q || !q.trim()) return { ok: false, error: "Search query is required" };
  const query = q.trim().slice(0, 500);
  return { ok: true, query };
}
