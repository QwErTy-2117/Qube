/**
 * Live marketplace catalog — dynamic complement to the curated offline
 * snapshot in ./marketplace.ts.
 *
 * Sources (all credential-free):
 * - skills.sh public search: GET https://skills.sh/api/search?q=&limit=
 *   → { skills: [{ id: "owner/repo/slug", skillId, name, installs, source }] }
 * - skills.sh download: GET https://skills.sh/api/download/{owner}/{repo}/{slug}
 *   → { files: [{ path, contents }] } (SKILL.md has name/description frontmatter)
 * - Security audits (Snyk/Socket/etc. via add-skill): GET
 *   https://add-skill.vercel.sh/audit?source={owner/repo}&skills={slug,…}
 *   → { slug: { ath/socket/snyk/zeroleaks: { risk, alerts?, score? } } }
 *
 * Safety policy: worst-risk critical/high entries are EXCLUDED ("not safe").
 * medium → amber "review" badge, safe/low → green "safe", no audit data →
 * gray "unaudited". Curated snapshot entries are hand-reviewed ("curated").
 *
 * All network access is bounded (timeouts, concurrency caps) and cached on
 * disk (1h catalog, 24h audits). Every failure falls back to curated-only.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import type { MarketplaceSkill } from "./marketplace";

const UA = { "User-Agent": "Qube-skills/1.0 (+local-first catalog cache)" };
const FETCH_TIMEOUT_MS = 10_000;
const CATALOG_TTL_MS = 60 * 60 * 1000;
const AUDIT_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "skills-marketplace-cache.json";

export type SafetyRisk = "safe" | "medium" | "unaudited" | "curated";

/** Excluded means high/critical — not safe to show. */
export type AuditVerdict = SafetyRisk | "excluded";

export type LiveMarketplaceSkill = MarketplaceSkill;

type SearchHit = {
  id: string;
  skillId: string;
  name: string;
  installs?: number;
  source: string;
};

async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function limited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  return new Promise((resolve) => {
    const out: R[] = new Array(items.length) as R[];
    let next = 0;
    let done = 0;
    if (items.length === 0) return resolve(out);
    const run = () => {
      const i = next++;
      if (i >= items.length) return;
      fn(items[i])
        .then((r) => {
          out[i] = r;
        })
        .catch(() => {
          out[i] = undefined as unknown as R;
        })
        .finally(() => {
          done++;
          if (done >= items.length) return resolve(out);
          run();
        });
    };
    for (let k = 0; k < Math.min(concurrency, items.length); k++) run();
  });
}

// ---------- Frontmatter ----------

export function parseSkillMd(contents: string): { name: string; description: string; instructions: string } {
  const text = String(contents || "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  let name = "";
  let description = "";
  let body = text;
  if (fm) {
    body = text.slice(fm[0].length);
    const get = (key: string): string => {
      const m = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(fm[1]);
      if (!m) return "";
      return m[1].replace(/^["']|["']$/g, "").trim();
    };
    name = get("name");
    description = get("description");
  }
  // Fallback: first H1 as description seed when frontmatter is missing.
  if (!description) {
    const h1 = /^#\s+(.+?)\s*$/m.exec(body)?.[1]?.trim() || "";
    description = h1.slice(0, 300);
  }
  return { name, description, instructions: body.trim().slice(0, 20_000) };
}

// ---------- Search / download ----------

export async function searchLiveSkills(query: string, limit = 50): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${Math.max(1, Math.min(200, limit))}`;
  const data = await fetchJson(url);
  const skills = Array.isArray(data?.skills) ? data.skills : [];
  return skills
    .filter((s: any) => s && typeof s.id === "string" && typeof s.skillId === "string")
    .map((s: any) => ({
      id: s.id as string,
      skillId: s.skillId as string,
      name: typeof s.name === "string" && s.name ? s.name : (s.skillId as string),
      installs: typeof s.installs === "number" ? s.installs : undefined,
      source: typeof s.source === "string" ? s.source : "",
    }));
}

export async function downloadSkillMd(
  owner: string,
  repo: string,
  slug: string,
): Promise<{ name: string; description: string; instructions: string; files: string[] }> {
  const url = `https://skills.sh/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`;
  const data = await fetchJson(url, 15_000);
  const files: Array<{ path?: string; contents?: string }> = Array.isArray(data?.files) ? data.files : [];
  const skillFile =
    files.find((f) => (f.path || "").toUpperCase() === "SKILL.MD") || files[0];
  if (!skillFile?.contents) throw new Error("No SKILL.md in download");
  const parsed = parseSkillMd(skillFile.contents);
  return {
    name: parsed.name || slug,
    description: parsed.description,
    instructions: parsed.instructions,
    files: files.map((f) => f.path || "").filter(Boolean),
  };
}

export function splitSkillId(id: string): { owner: string; repo: string; slug: string } | null {
  const parts = String(id || "").split("/");
  if (parts.length < 3) return null;
  const owner = parts[0];
  const slug = parts[parts.length - 1];
  const repo = parts.slice(1, -1).join("/");
  if (!owner || !repo || !slug) return null;
  return { owner, repo, slug };
}

// ---------- Audits → safety ----------

const SEVERITY: Record<string, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  unknown: 2,
  high: 3,
  critical: 4,
};

export function worstRisk(risks: Array<string | undefined>): AuditVerdict {
  let worst = 0;
  let seen = false;
  for (const r of risks) {
    if (!r) continue;
    seen = true;
    const v = SEVERITY[String(r).toLowerCase()] ?? 2;
    if (v > worst) worst = v;
  }
  if (!seen) return "unaudited";
  if (worst <= 1) return "safe";
  if (worst === 2) return "medium";
  return "excluded";
}

/** high/critical → excluded. Returns map slug → {risk, alerts}. */
export async function auditSource(source: string, slugs: string[]): Promise<Record<string, { risk: SafetyRisk; alerts?: number }>> {
  const out: Record<string, { risk: SafetyRisk; alerts?: number }> = {};
  if (!source || slugs.length === 0) return out;
  const url = `https://add-skill.vercel.sh/audit?source=${encodeURIComponent(source)}&skills=${slugs.map(encodeURIComponent).join(",")}`;
  const data = await fetchJson(url, 12_000);
  for (const slug of slugs) {
    const entry = (data as any)?.[slug];
    if (!entry || typeof entry !== "object") {
      out[slug] = { risk: "unaudited" };
      continue;
    }
    const risks: string[] = [];
    let alerts = 0;
    for (const scanner of ["ath", "socket", "snyk", "zeroleaks"]) {
      const s = (entry as any)[scanner];
      if (s && typeof s.risk === "string") risks.push(s.risk);
      if (s && typeof s.alerts === "number") alerts += s.alerts;
    }
    const risk = worstRisk(risks);
    if (risk === "excluded") continue; // high/critical: not safe, hidden
    out[slug] = { risk, alerts: alerts || undefined };
  }
  return out;
}

// ---------- Disk cache ----------

type CacheShape = {
  at?: number;
  catalog?: SearchHit[];
  audits?: Record<string, { at: number; risks: Record<string, { risk: SafetyRisk; alerts?: number }> }>;
};

function cachePath(): string {
  return join(getDataDir(), ".memory", CACHE_FILE);
}

function readCache(): CacheShape {
  try {
    const p = cachePath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8")) as CacheShape;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    const dir = join(getDataDir(), ".memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache), "utf-8");
  } catch {}
}

// ---------- Live catalog ----------

const SEED_QUERIES = ["code", "pdf", "research", "design", "data", "review", "email", "video"];

function slugKey(source: string, slug: string): string {
  return `${source}/${slug}`.toLowerCase();
}

export async function getLiveCatalog(forceRefresh = false): Promise<{ hits: SearchHit[]; live: boolean }> {
  if (!forceRefresh) {
    const cached = readCache();
    if (cached.at && Date.now() - cached.at < CATALOG_TTL_MS && Array.isArray(cached.catalog) && cached.catalog.length > 0) {
      return { hits: cached.catalog, live: true };
    }
  }
  const batches = await limited(SEED_QUERIES, 4, (q) =>
    searchLiveSkills(q, 25).catch(() => [] as SearchHit[]),
  );
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const batch of batches) {
    for (const h of batch || []) {
      const key = slugKey(h.source, h.skillId);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
  }
  hits.sort((a, b) => (b.installs || 0) - (a.installs || 0));
  const capped = hits.slice(0, 150);
  if (capped.length > 0) {
    const cache = readCache();
    cache.at = Date.now();
    cache.catalog = capped;
    writeCache(cache);
  }
  return { hits: capped, live: capped.length > 0 };
}

/** Audits for the given hits (grouped by source, cached 24h). Mutates nothing; returns slug-keyed risks. */
export async function auditHits(hits: SearchHit[], maxSkills = 30): Promise<Record<string, { risk: SafetyRisk; alerts?: number }>> {
  const top = [...hits]
    .sort((a, b) => (b.installs || 0) - (a.installs || 0))
    .slice(0, Math.max(0, maxSkills));
  const bySource = new Map<string, string[]>();
  for (const h of top) {
    if (!h.source || !h.skillId) continue;
    const list = bySource.get(h.source) || [];
    if (!list.includes(h.skillId)) list.push(h.skillId);
    bySource.set(h.source, list);
  }
  const cache = readCache();
  const audits = cache.audits || {};
  const stale = (at?: number) => !at || Date.now() - at > AUDIT_TTL_MS;
  const sources = [...bySource.keys()];
  const fresh = await limited(sources, 6, async (source) => {
    const hit = audits[source];
    if (hit && !stale(hit.at)) return { source, risks: hit.risks };
    try {
      const risks = await auditSource(source, bySource.get(source) || []);
      return { source, risks, fresh: true as const };
    } catch {
      return { source, risks: {} as Record<string, { risk: SafetyRisk; alerts?: number }> };
    }
  });
  const merged: Record<string, { risk: SafetyRisk; alerts?: number }> = {};
  for (const f of fresh) {
    if (!f) continue;
    if ((f as any).fresh) {
      audits[f.source] = { at: Date.now(), risks: f.risks };
    }
    for (const [slug, r] of Object.entries(f.risks)) {
      merged[slugKey(f.source, slug)] = r;
    }
  }
  cache.audits = audits;
  writeCache(cache);
  return merged;
}

// ---------- Row assembly ----------

function sanitizeName(name: string, fallback: string): string {
  const clean = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return clean || fallback;
}

export function liveHitToRow(
  hit: SearchHit,
  risks: Record<string, { risk: SafetyRisk; alerts?: number }>,
): LiveMarketplaceSkill | null {
  const split = splitSkillId(hit.id);
  const source = hit.source || (split ? `${split.owner}/${split.repo}` : "");
  const slug = hit.skillId;
  const key = slugKey(source, slug);
  const safety = risks[key] || { risk: "unaudited" as SafetyRisk };
  if ((safety.risk as string) === "excluded") return null; // not safe
  return {
    slug: `${source.replace(/\//g, "--")}/${slug}`.toLowerCase(),
    name: sanitizeName(hit.name || slug, slug.toLowerCase()),
    description: "",
    instructions: "",
    marketplace: "skills.sh",
    marketplaceUrl: split ? `https://skills.sh/${split.owner}/${split.repo}/${split.slug}` : "https://skills.sh",
    version: "live",
    installs: hit.installs,
    live: true,
    safety: { risk: safety.risk, alerts: safety.alerts },
    source,
    detailId: hit.id,
  };
}
