/**
 * Skills — Claude Code compatible SKILL.md model.
 *
 * A skill is a directory with SKILL.md (YAML frontmatter + markdown body).
 * Only `name` + `description` stay in context; the body loads on invocation
 * (manual `/name` or automatic when the description matches the request).
 *
 * This file defines the persisted shape. See:
 * - system-skills.ts for the 3 built-in non-deletable skills
 * - marketplace.ts for the curated catalog from the 3 best marketplaces
 *   (skills.sh by Vercel, SkillsMP, ClawHub + Anthropic official)
 * - prompt.ts for harness injection (progressive disclosure)
 */

export type SkillSource = "system" | "custom" | "marketplace";

export interface SkillConfig {
  id: string;
  /** lowercase letters, numbers, hyphens only, max 64. Matches directory name. */
  name: string;
  /** What it does + when to use it ("does X. Use when Y."). Model routing logic. */
  description: string;
  /** Markdown body of SKILL.md — procedures, examples, edge cases. Keep <500 lines. */
  instructions: string;
  /** Claude Code `allowed-tools` — space/comma separated, pre-approved for the invoking turn. */
  allowedTools?: string;
  /** Claude Code `disallowed-tools` — removed from pool while skill is active. */
  disallowedTools?: string;
  /** false hides from `/` menu (background knowledge only). Default true. */
  userInvocable?: boolean;
  /** true = manual `/name` only, never auto-loaded (also not preloaded into subagents). Default false. */
  disableModelInvocation?: boolean;
  /** Badge color in Advanced settings (hex or tailwind-safe hex). */
  color?: string;
  source: SkillSource;
  /** Which marketplace this came from, if any. */
  marketplace?: string;
  version?: string;
  installedAt: number;
  updatedAt: number;
  /** System skills can't be deleted. */
  isSystem?: boolean;
}

export const SKILL_NAME_RE = /^[a-z0-9-]+$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESC_MAX = 1024;

const PALETTE = [
  "#5E6AD2",
  "#0E9F6E",
  "#C27803",
  "#1C64F2",
  "#E02424",
  "#7E3AF2",
  "#047857",
  "#9333EA",
  "#DB2777",
  "#0284C7",
  "#CA8A04",
  "#059669",
];

export function colorForSkill(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function validateSkill(input: Partial<SkillConfig>): string | null {
  const name = (input.name || "").trim();
  if (!name) return "Skill name is required.";
  if (name.length > SKILL_NAME_MAX) return `Skill name must be ≤${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_RE.test(name))
    return "Skill name must be lowercase letters, numbers, and hyphens only.";
  const desc = (input.description || "").trim();
  if (!desc) return "Skill description is required.";
  if (desc.length > SKILL_DESC_MAX)
    return `Skill description must be ≤${SKILL_DESC_MAX} characters.`;
  const instructions = (input.instructions || "").trim();
  if (!instructions) return "Skill instructions are required.";
  if (instructions.split("\n").length > 500)
    return "Keep SKILL.md under 500 lines — move details to references.";
  return null;
}

export function normalizeSkill(input: Partial<SkillConfig> & { name: string }): SkillConfig {
  const now = Date.now();
  return {
    id:
      input.id ||
      `${input.name}_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim().toLowerCase(),
    description: (input.description || "").trim(),
    instructions: (input.instructions || "").trim(),
    allowedTools: (input.allowedTools || "").trim() || undefined,
    disallowedTools: (input.disallowedTools || "").trim() || undefined,
    userInvocable: input.userInvocable !== false,
    disableModelInvocation: input.disableModelInvocation === true,
    color: input.color || colorForSkill(input.name),
    source: input.source || "custom",
    marketplace: input.marketplace,
    version: input.version || "1.0.0",
    installedAt: input.installedAt || now,
    updatedAt: now,
    isSystem: input.isSystem === true,
  };
}

/** Render a Claude Code compatible SKILL.md file for export/debugging. */
export function toSkillMd(skill: SkillConfig): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${skill.name}`);
  // Escape description quotes
  const desc = skill.description.replace(/\n/g, " ").trim();
  lines.push(`description: ${desc}`);
  if (skill.allowedTools) lines.push(`allowed-tools: ${skill.allowedTools}`);
  if (skill.disallowedTools) lines.push(`disallowed-tools: ${skill.disallowedTools}`);
  if (skill.userInvocable === false) lines.push(`user-invocable: false`);
  if (skill.disableModelInvocation === true)
    lines.push(`disable-model-invocation: true`);
  lines.push("---");
  lines.push("");
  lines.push(skill.instructions.trim() + "\n");
  return lines.join("\n");
}
