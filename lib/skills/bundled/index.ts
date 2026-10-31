/**
 * Bundled skill set shipped with Qube.
 *
 * Deliberately small and high-value: document formats the app can render
 * (docx / pptx / xlsx / pdf), software delivery, frontend design and skill
 * authoring. Every entry is original Qube content — see docs/skills.md for
 * the provenance and licence audit of the Anthropic Skills repository.
 *
 * To upgrade a bundled skill: edit it here, bump `version`, and the store
 * will refresh the bundled copy on next load without touching user-created
 * skills (user skills win on name conflicts).
 */

import type { SkillConfig } from "../types";
import { DOCX_SKILL } from "./docx";
import { PDF_SKILL } from "./pdf";
import { PPTX_SKILL } from "./pptx";
import { XLSX_SKILL } from "./xlsx";
import { SOFTWARE_DELIVERY_SKILL } from "./software-delivery";
import { FRONTEND_DESIGN_SKILL } from "./frontend-design";
import { SKILL_AUTHORING_SKILL } from "./skill-authoring";

export const BUNDLED_SKILLS: readonly SkillConfig[] = [
  DOCX_SKILL,
  PPTX_SKILL,
  XLSX_SKILL,
  PDF_SKILL,
  SOFTWARE_DELIVERY_SKILL,
  FRONTEND_DESIGN_SKILL,
  SKILL_AUTHORING_SKILL,
];

export const BUNDLED_SKILL_NAMES: readonly string[] = BUNDLED_SKILLS.map((s) => s.name);

/** Fresh copy stamped with the current time (bundled skills are immutable). */
export function bundledSkills(now = Date.now()): SkillConfig[] {
  return BUNDLED_SKILLS.map((s) => ({
    ...s,
    installedAt: now,
    updatedAt: now,
    isSystem: true,
    source: "bundled" as const,
  }));
}
