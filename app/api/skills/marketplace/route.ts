import { MARKETPLACE_SKILLS, MARKETPLACE_URLS, type MarketplaceSkill } from "@/lib/skills/marketplace";
import {
  searchLiveSkills,
  downloadSkillMd,
  splitSkillId,
  getLiveCatalog,
  auditHits,
  liveHitToRow,
} from "@/lib/skills/live-marketplace";

/**
 * Dynamic marketplace catalog.
 *
 * - No `q`: live skills.sh catalog (seed queries, cached 1h) + curated
 *   snapshot. Only safe entries: high/critical audit risks are excluded.
 * - `?q=`: live search + curated filter, merged and deduped.
 * - `?detail=owner/repo/slug`: full SKILL.md (description + instructions)
 *   for install preview of a live row.
 * - `?refresh=1`: bypass caches.
 *
 * Every live failure degrades to the curated offline snapshot
 * (`live: false` + `warning`), never an empty popup.
 */

function curatedRows(): MarketplaceSkill[] {
  return MARKETPLACE_SKILLS.map((s) => ({
    ...s,
    safety: { risk: "curated" as const },
  }));
}

function matchesQuery(s: MarketplaceSkill, q: string): boolean {
  return (
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.marketplace.toLowerCase().includes(q) ||
    (s.source || "").toLowerCase().includes(q)
  );
}

function dedupe(rows: MarketplaceSkill[]): MarketplaceSkill[] {
  // Prefer live rows (install counts, fresher metadata) over curated ones
  // with the same skill name.
  const byName = new Map<string, MarketplaceSkill>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) byName.set(key, r);
    else if (r.live && !prev.live) byName.set(key, r);
  }
  return [...byName.values()];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const refresh = url.searchParams.get("refresh") === "1";
    const detailId = (url.searchParams.get("detail") || "").trim();

    // Lazy full-body fetch for a live row (install preview).
    if (detailId) {
      const split = splitSkillId(detailId);
      if (!split) {
        return Response.json({ ok: false, error: "detail must be owner/repo/slug" }, { status: 400 });
      }
      try {
        const md = await downloadSkillMd(split.owner, split.repo, split.slug);
        return Response.json({
          ok: true,
          live: true,
          detail: {
            name: md.name || split.slug,
            description: md.description,
            instructions: md.instructions,
            files: md.files,
            marketplaceUrl: `https://skills.sh/${split.owner}/${split.repo}/${split.slug}`,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ ok: false, error: `Detail fetch failed: ${msg}` }, { status: 502 });
      }
    }

    const curated = curatedRows();
    let live: MarketplaceSkill[] = [];
    let liveOk = false;
    let warning: string | undefined;

    try {
      if (q) {
        const hits = await searchLiveSkills(q, 50);
        const risks = await auditHits(hits, 30);
        live = hits
          .map((h) => liveHitToRow(h, risks))
          .filter((r): r is MarketplaceSkill => r !== null);
      } else {
        const catalog = await getLiveCatalog(refresh);
        const risks = await auditHits(catalog.hits, 40);
        live = catalog.hits
          .map((h) => liveHitToRow(h, risks))
          .filter((r): r is MarketplaceSkill => r !== null);
        liveOk = catalog.live;
      }
      if (q) liveOk = true;
    } catch (e) {
      warning = e instanceof Error ? e.message : String(e);
      live = [];
      liveOk = false;
    }

    let skills = dedupe([...live, ...curated]);
    if (q) skills = skills.filter((s) => matchesQuery(s, q));
    // Safe first, then most-installed, then curated snapshot order.
    const riskOrder = (r?: string) =>
      r === "safe" || r === "curated" ? 0 : r === "medium" ? 1 : 2;
    skills.sort(
      (a, b) =>
        riskOrder(a.safety?.risk) - riskOrder(b.safety?.risk) ||
        (b.installs || 0) - (a.installs || 0),
    );

    return Response.json({
      skills,
      live: liveOk,
      ...(warning ? { warning } : {}),
      marketplaces: [
        { name: "skills.sh", url: MARKETPLACE_URLS["skills.sh"], kind: "package-manager", note: "Vercel registry — live catalog, Snyk/Socket-audited" },
        { name: "SkillsMP", url: MARKETPLACE_URLS["SkillsMP"], kind: "aggregator", note: "Largest catalog, 800k+ SKILL.md indexed from GitHub" },
        { name: "ClawHub", url: MARKETPLACE_URLS["ClawHub"], kind: "curated", note: "Human-reviewed OpenClaw registry, versioned" },
        { name: "Anthropic Official", url: MARKETPLACE_URLS["Anthropic Official"], kind: "reference", note: "Reference skills from Anthropic (pdf, docx, xlsx…)" },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
