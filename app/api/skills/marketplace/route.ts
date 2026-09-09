import { MARKETPLACE_SKILLS, MARKETPLACE_URLS } from "@/lib/skills/marketplace";

/**
 * Curated marketplace catalog — static snapshot from the 3 best registries:
 * skills.sh (Vercel), SkillsMP, ClawHub (+ Anthropic Official reference).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    let skills = MARKETPLACE_SKILLS;
    if (q) {
      skills = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.marketplace.toLowerCase().includes(q)
      );
    }
    return Response.json({
      skills,
      marketplaces: [
        { name: "skills.sh", url: MARKETPLACE_URLS["skills.sh"], kind: "package-manager", note: "Vercel registry — npx skills add <name>, 30+ agents" },
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
