import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { SYSTEM_SKILLS } from "./system-skills";
import {
  normalizeSkill,
  validateSkill,
  type SkillConfig,
} from "./types";

function skillsFilePath(): string {
  return join(getDataDir(), ".memory", "skills.json");
}

class SkillStore {
  private skills: SkillConfig[] = [];
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    // Always start from system skills (can't be deleted)
    const byName = new Map<string, SkillConfig>();
    for (const s of SYSTEM_SKILLS) byName.set(s.name, { ...s });
    try {
      const file = skillsFilePath();
      if (existsSync(file)) {
        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);
        const arr: SkillConfig[] = Array.isArray(data?.skills)
          ? data.skills
          : Array.isArray(data)
            ? data
            : [];
        for (const s of arr) {
          if (!s || typeof s.name !== "string") continue;
          const name = s.name.trim().toLowerCase();
          // System skills always win on isSystem/source, but allow edited
          // description/instructions to persist (editable, not deletable).
          if (byName.has(name)) {
            const sys = byName.get(name)!;
            byName.set(name, {
              ...sys,
              description: s.description || sys.description,
              instructions: s.instructions || sys.instructions,
              allowedTools: s.allowedTools ?? sys.allowedTools,
              disallowedTools: s.disallowedTools ?? sys.disallowedTools,
              color: s.color || sys.color,
              updatedAt: s.updatedAt || Date.now(),
            });
          } else {
            byName.set(name, { ...s, name } as SkillConfig);
          }
        }
      }
    } catch (e) {
      console.error("[SkillStore] Failed to load:", e);
    }
    this.skills = Array.from(byName.values());
  }

  private persist() {
    try {
      const file = skillsFilePath();
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ skills: this.skills }, null, 2), "utf-8");
    } catch (e) {
      console.error("[SkillStore] Failed to write:", e);
    }
  }

  getAll(): SkillConfig[] {
    this.ensureInitialized();
    return this.skills.map((s) => ({ ...s }));
  }

  getByName(name: string): SkillConfig | null {
    this.ensureInitialized();
    const n = name.trim().toLowerCase();
    return this.skills.find((s) => s.name === n) ?? null;
  }

  /** Replace user (non-system) skills wholesale — used by /api/skills/sync. */
  sync(skills: SkillConfig[]): { ok: boolean; error?: string } {
    this.ensureInitialized();
    // Validate all non-system entries
    for (const s of skills) {
      if ((s as any).isSystem) continue;
      const err = validateSkill(s);
      if (err) return { ok: false, error: `${s.name || "?"}: ${err}` };
    }
    const normalized = new Map<string, SkillConfig>();
    // System skills always present
    for (const sys of SYSTEM_SKILLS) {
      const incoming = skills.find(
        (s) => s.name.trim().toLowerCase() === sys.name
      );
      normalized.set(sys.name, {
        ...sys,
        ...(incoming
          ? {
              description: incoming.description || sys.description,
              instructions: incoming.instructions || sys.instructions,
              allowedTools: incoming.allowedTools ?? sys.allowedTools,
              disallowedTools:
                incoming.disallowedTools ?? sys.disallowedTools,
              color: incoming.color || sys.color,
              updatedAt: Date.now(),
            }
          : {}),
      });
    }
    for (const s of skills) {
      const name = s.name.trim().toLowerCase();
      if (normalized.has(name)) continue;
      normalized.set(name, normalizeSkill({ ...s, name }));
    }
    this.skills = Array.from(normalized.values());
    this.persist();
    return { ok: true };
  }

  upsert(skill: Partial<SkillConfig> & { name: string }): { ok: boolean; error?: string; skill?: SkillConfig } {
    this.ensureInitialized();
    const err = validateSkill(skill);
    if (err) return { ok: false, error: err };
    const name = skill.name.trim().toLowerCase();
    const existing = this.skills.find((s) => s.name === name);
    if (existing?.isSystem) {
      // System: editable fields only, never delete/rename/source-change
      existing.description = skill.description!.trim();
      existing.instructions = skill.instructions!.trim();
      if (skill.allowedTools !== undefined) existing.allowedTools = skill.allowedTools || undefined;
      if (skill.disallowedTools !== undefined)
        existing.disallowedTools = skill.disallowedTools || undefined;
      if (skill.color) existing.color = skill.color;
      existing.updatedAt = Date.now();
      this.persist();
      return { ok: true, skill: { ...existing } };
    }
    if (existing) {
      Object.assign(existing, normalizeSkill({ ...existing, ...skill, name }));
      this.persist();
      return { ok: true, skill: { ...existing } };
    }
    const created = normalizeSkill({ ...skill, name, source: skill.source || "custom" });
    this.skills.push(created);
    this.persist();
    return { ok: true, skill: { ...created } };
  }

  remove(name: string): { ok: boolean; error?: string } {
    this.ensureInitialized();
    const n = name.trim().toLowerCase();
    const existing = this.skills.find((s) => s.name === n);
    if (!existing) return { ok: false, error: "Skill not found." };
    if (existing.isSystem || existing.source === "system")
      return { ok: false, error: "System skills can't be deleted." };
    this.skills = this.skills.filter((s) => s.name !== n);
    this.persist();
    return { ok: true };
  }
}

export const skillStore = new SkillStore();
