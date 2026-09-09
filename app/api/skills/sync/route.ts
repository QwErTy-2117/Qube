import { skillStore } from "@/lib/skills/store";
import { validateSkill, type SkillConfig } from "@/lib/skills/types";

export async function GET() {
  try {
    const skills = skillStore.getAll();
    return Response.json({ skills });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Bulk sync (from settings UI)
    if (Array.isArray(body.skills)) {
      const skills = body.skills as SkillConfig[];
      for (const s of skills) {
        if (!(s as any).isSystem && (s as any).source !== "system") {
          const err = validateSkill(s);
          if (err)
            return Response.json(
              { ok: false, error: `${s.name || "?"}: ${err}` },
              { status: 400 }
            );
        }
      }
      const res = skillStore.sync(skills);
      if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
      console.log(`[skills-sync] Synced ${skills.length} skills`);
      return Response.json({ ok: true, skills: skillStore.getAll() });
    }
    // Single upsert
    if (body.skill) {
      const res = skillStore.upsert(body.skill);
      if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
      return Response.json({ ok: true, skill: res.skill });
    }
    // Single delete
    if (body.action === "delete" && typeof body.name === "string") {
      const res = skillStore.remove(body.name);
      if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
      return Response.json({ ok: true, skills: skillStore.getAll() });
    }
    return Response.json({ ok: false, error: "Provide {skills[]} or {skill} or {action:'delete',name}" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
