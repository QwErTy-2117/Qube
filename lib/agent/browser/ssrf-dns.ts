/**
 * SSRF-safe web fetch ported from Rakazo web-ssrf.ts (elie222/rakazo).
 *
 * - Only http(s), no credentials in URL
 * - Hostname blocklist (localhost, .local, .internal, metadata endpoints)
 * - DNS resolution + private-address rejection (IPv4 + IPv6)
 * - Redirect chain re-validated per hop (max 5, no cross-origin header leak)
 * - Response size cap (default 5MB) + timeout (default 15s)
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
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

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    if (isPrivateIPv4(ip)) return true;
    // 0.0.0.0, 100.64/10 carrier-grade, 192.0.0.0/24, 192.88.99, 198.18/15 benchmark, 203.0.113/24, multicast/reserved
    if (/^(0\.|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.|192\.0\.|198\.(1[89]|2\d)\.|203\.0\.113\.|22[4-9]\.|23\d\.)/.test(ip)) return true;
    const first = Number(ip.split(".")[0]);
    if (first >= 224) return true;
    return false;
  }
  if (v === 6) {
    const n = ip.toLowerCase();
    if (n === "::1" || n === "::") return true;
    if (n.startsWith("fc") || n.startsWith("fd")) return true; // unique-local
    if (n.startsWith("fe80")) return true; // link-local
    if (n.startsWith("ff")) return true; // multicast
    if (n.includes("169.254.")) return true; // v4-mapped link-local
    return false;
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (h === "metadata.google.internal" || h === "metadata.goog" || h === "metadata.google.com" || h === "instance-data") return true;
  if (h === "[::1]" || h === "::1") return true;
  if (isIP(h.replace(/^\[|\]$/g, "")) !== 0) return isPrivateAddress(h.replace(/^\[|\]$/g, ""));
  return false;
}

export async function assertSafeWebUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http: and https: URLs are allowed");
  if (url.username || url.password) throw new Error("URL must not contain credentials");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) throw new Error("URL targets a private or internal host");
  let addrs: Array<{ address: string }> = [];
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("URL host could not be resolved");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("URL resolves to a private address");
  }
  return url;
}

/** Result/char budgets (Rakazo web-limits.ts parity; Qube keeps its own defaults). */
export const DEFAULT_WEB_SEARCH_MAX_RESULTS = 6;
export const MAX_WEB_SEARCH_RESULTS = 10;
export const DEFAULT_WEB_FETCH_MAX_CHARS = 8_000;
export const MAX_WEB_FETCH_MAX_CHARS = 50_000;
export const MIN_WEB_FETCH_MAX_CHARS = 100;

/** Clamp model-requested result counts (Rakazo web-limits.ts parity). */
export function clampMaxResults(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WEB_SEARCH_MAX_RESULTS;
  return Math.min(MAX_WEB_SEARCH_RESULTS, Math.max(1, Math.floor(n)));
}

/** Clamp model-requested fetch char budgets (Rakazo web-limits.ts parity). */
export function clampMaxChars(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WEB_FETCH_MAX_CHARS;
  return Math.min(MAX_WEB_FETCH_MAX_CHARS, Math.max(MIN_WEB_FETCH_MAX_CHARS, Math.floor(n)));
}

/** Fetch text with redirect + size + timeout guards (Rakazo followRedirects parity). */
export async function fetchSafeWebText(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number; userAgent?: string; signal?: AbortSignal },
): Promise<{ url: string; body: string; contentType: string | null }> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertSafeWebUrl(current);
    const res = await fetch(validated.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": opts?.userAgent ?? "Qube/1.0 (+https://github.com/QwErTy-2117/Qube)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch {}
      if (!loc) throw new Error("Redirect missing Location header");
      if (hop === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(loc, validated.href).href;
      continue;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch {}
      throw new Error(`Request failed: HTTP ${res.status}`);
    }
    const len = res.headers.get("content-length");
    if (len && Number(len) > maxBytes) {
      try { await res.body?.cancel(); } catch {}
      throw new Error("Response is too large");
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("Response is too large");
    return { url: validated.href, body: new TextDecoder().decode(buf), contentType: res.headers.get("content-type") };
  }
  throw new Error("Too many redirects");
}
