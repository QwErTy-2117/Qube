/**
 * Skill behavior for the model.
 *
 * The system prompt only ever contains:
 *   1. a short operating instruction (always), and
 *   2. the metadata list (name + one-line description) of available skills.
 *
 * Bodies live on disk and are loaded on demand through the `skill` tool, so a
 * large skill library costs a few hundred tokens instead of thousands.
 */

import { skillPromptEntries } from "./registry";
import type { SkillConfig } from "./types";

/**
 * High-priority operational rules. Deliberately free of implementation
 * details: the model needs to know *how to behave*, not how skills are
 * stored.
 */
export function buildSkillsOperatingInstructions(): string {
  return `## Skills — discover, load, reuse
Skills are reusable procedures with a name and a description. The list below is metadata only; the instructions arrive when you load a skill with the \`skill\` tool.

- Before substantial or specialized work, check whether a listed skill covers the task and load it with \`skill(name)\` when it materially improves the result.
- Do not load skills mechanically. Unrelated or marginal matches waste the turn; if nothing applies, just do the work.
- When a skill is active, follow its instructions, unless they conflict with higher-priority system, security or permission rules — those always win.
- If a recurring workflow keeps costing extra steps and no adequate skill exists, create one with \`manage_skill\` (action "create"). It must be generalizable, scoped, documented (what it does + when to use it) and stored through the normal skill system — never pasted permanently into the prompt.
- Prefer improving an existing relevant skill over creating a near-duplicate, and delete or deprecate skills that have become wrong.`;
}

export function formatSkillList(skills: SkillConfig[]): string {
  const entries = skillPromptEntries(skills);
  if (entries.length === 0) {
    return "## Available skills\nNo skills are installed. Create one with `manage_skill` when a procedure is worth reusing.";
  }
  const lines = entries.map((s) => `- ${s.name}: ${s.description}`);
  return `## Available skills (${entries.length})\n${lines.join("\n")}`;
}

/**
 * Section appended to the main system prompt. Kept intentionally small:
 * operating rules + metadata only.
 */
export function buildSkillsPromptSection(skills: SkillConfig[]): string {
  return `${buildSkillsOperatingInstructions()}\n\n${formatSkillList(skills)}`;
}

/** Compact hint used by subagents (which get a fresh context). */
export function skillTokenHint(skills: SkillConfig[]): string {
  if (!skills || skills.length === 0) return "no skills installed";
  return skills
    .filter((s) => s.disableModelInvocation !== true)
    .map((s) => `/skill:${s.name}`)
    .join(", ");
}

/** Enforce per-skill disallowed tools for the current turn. */
export function filterToolsBySkills(
  tools: Record<string, any>,
  skills: SkillConfig[],
  activeSkillNames?: string[]
): Record<string, any> {
  if (!activeSkillNames || activeSkillNames.length === 0) return tools;
  const active = skills.filter((s) => activeSkillNames.includes(s.name));
  if (active.length === 0) return tools;
  const out: Record<string, any> = { ...tools };
  for (const s of active) {
    if (!s.disallowedTools) continue;
    const banned = s.disallowedTools
      .split(/[,\s]+/)
      .map((t) => t.trim().replace(/\*$/, ""))
      .filter(Boolean);
    for (const b of banned) {
      for (const key of Object.keys(out)) {
        if (key === b || key.startsWith(b + "_")) delete out[key];
      }
    }
  }
  return out;
}
