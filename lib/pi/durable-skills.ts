import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { getDataDir } from "@/lib/data-dir";
import { toSkillMd, type SkillConfig } from "@/lib/skills/types";

export type SkillRef = Pick<SkillConfig, "name" | "description"> & { path: string };

export function renderSkillsSection(skills: SkillRef[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- /skill:${s.name}: ${s.description} [path: ${s.path}]`);
  return `## Skills (${skills.length} installed)\nSkills are playbooks. Load one with read_file(path + "/SKILL.md") when its description matches, or via /skill:name.\n${lines.join("\n")}`;
}

export function buildSkillsExtension(refs: SkillRef[]) {
  return defineExtension({
    name: "skills",
    sections: [section("skills", () => renderSkillsSection(refs) || undefined)],
  });
}

/**
 * Materialize skillStore skills as SKILL.md files on disk (Agent Skills
 * portable form) so the model can lazy-load bodies via read_file, and
 * return refs with real paths for the skills section.
 */
export function materializeSkills(skills?: SkillConfig[], baseDir?: string): SkillRef[] {
  const list = skills ?? loadSkillConfigs();
  const dir = baseDir ?? join(getDataDir(), ".agents", "skills");
  const refs: SkillRef[] = [];
  for (const s of list) {
    if (!s?.name || !s?.description) continue;
    const skillDir = join(dir, s.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), toSkillMd(s), "utf-8");
    refs.push({ name: s.name, description: s.description, path: skillDir });
  }
  return refs;
}

function loadSkillConfigs(): SkillConfig[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { skillStore } = require("@/lib/skills/store") as typeof import("@/lib/skills/store");
    return skillStore.getAll();
  } catch {
    return [];
  }
}
