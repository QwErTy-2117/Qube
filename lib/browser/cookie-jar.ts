/**
 * Minimal per-domain cookie jar for /api/browser/view.
 *
 * Server-side fetches start cookieless, so multi-step flows (consent
 * bounces like Google's ucbcb, search sessions, login-lite) never complete:
 * every request re-bounces. This jar persists cookies in memory (never to
 * disk) so proxied page loads behave like one continuous browser session.
 *
 * Rules: Domain-suffixed sharing (sub.example.com sees .example.com),
 * Secure cookies only over https, expired cookies purged on read, hard caps
 * so one site can't flood memory. Cross-site leaks are refused (a Set-Cookie
 * for an unrelated Domain is dropped).
 */

export type JarEntry = { value: string; secure: boolean; expiresAt: number };

const MAX_JAR_DOMAINS = 100;
const MAX_JAR_COOKIES = 50;

const jar = new Map<string, Map<string, JarEntry>>();

function normalizeDomain(host: string, domainAttr?: string): string | null {
  const h = host.toLowerCase();
  if (!domainAttr) return h;
  let d = domainAttr.trim().toLowerCase();
  if (d.startsWith(".")) d = d.slice(1);
  if (!d) return null;
  if (h === d || h.endsWith(`.${d}`)) return d;
  return null;
}

function evictOldest<K, V>(m: Map<K, V>): void {
  const oldest = m.keys().next().value as K | undefined;
  if (oldest !== undefined) m.delete(oldest);
}

/** Store cookies from a fetch Response for future requests to the host. */
export function storeCookiesFromResponse(res: Response, requestHost: string): void {
  try {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const raw: string[] = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
    for (const sc of raw) {
      const semi = sc.indexOf(";");
      const pair = semi === -1 ? sc : sc.slice(0, semi);
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || /[\s;,]/.test(name)) continue;
      let domainAttr: string | undefined;
      let expiresAt = Infinity;
      let secure = false;
      for (const part of sc.split(";").slice(1)) {
        const kv = part.indexOf("=");
        const key = (kv === -1 ? part : part.slice(0, kv)).trim().toLowerCase();
        const val = kv === -1 ? "" : part.slice(kv + 1).trim();
        if (key === "domain") domainAttr = val;
        else if (key === "secure") secure = true;
        else if (key === "max-age") {
          const n = Number(val);
          if (Number.isFinite(n)) expiresAt = n <= 0 ? 0 : Date.now() + n * 1000;
        } else if (key === "expires") {
          const t = Date.parse(val);
          if (!Number.isNaN(t)) expiresAt = t;
        }
      }
      const domain = normalizeDomain(requestHost, domainAttr);
      if (!domain) continue;
      let bucket = jar.get(domain);
      if (!bucket) {
        if (jar.size >= MAX_JAR_DOMAINS) evictOldest(jar);
        bucket = new Map();
        jar.set(domain, bucket);
      }
      if (expiresAt <= Date.now()) {
        bucket.delete(name);
        continue;
      }
      if (bucket.size >= MAX_JAR_COOKIES && !bucket.has(name)) evictOldest(bucket);
      bucket.set(name, { value, secure, expiresAt });
    }
  } catch {}
}

/** Build a Cookie header for an outgoing fetch, or undefined when empty. */
export function cookieHeaderFor(targetUrl: string): string | undefined {
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase();
    const isHttps = u.protocol === "https:";
    const parts: string[] = [];
    for (const [domain, bucket] of jar) {
      if (host !== domain && !host.endsWith(`.${domain}`)) continue;
      for (const [name, e] of bucket) {
        if (e.expiresAt <= Date.now()) {
          bucket.delete(name);
          continue;
        }
        if (e.secure && !isHttps) continue;
        parts.push(`${name}=${e.value}`);
      }
    }
    return parts.length ? parts.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

/** Test hook: reset the jar. */
export function clearCookieJar(): void {
  jar.clear();
}
