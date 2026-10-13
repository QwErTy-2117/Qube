import { defineExtension, section } from "@earendil-works/pi-durable";
import type { SkillConfig } from "@/lib/skills/types";

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
