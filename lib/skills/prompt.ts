/**
 * Harness injection for skills — progressive disclosure à la Claude Code.
 * Only name + description are always in context; full instructions are
 * included for installed skills (capped per skill to bound context).
 * Model auto-applies a skill when its description matches the request,
 * or the user invokes it manually with `/name`.
 */

import type { SkillConfig } from "./types";

const MAX_BODY_CHARS = 2200;

function truncateBody(body: string): string {
  const t = body.trim();
  if (t.length <= MAX_BODY_CHARS) return t;
  return t.slice(0, MAX_BODY_CHARS).trimEnd() + "\n…(truncated — full SKILL.md in settings)";
}

export function buildSkillsPromptSection(skills: SkillConfig[]): string {
  const usable = (skills || []).filter((s) => s.name && s.description);
  if (usable.length === 0) return "";
  const auto = usable.filter((s) => s.disableModelInvocation !== true);
  const manualOnly = usable.filter((s) => s.disableModelInvocation === true);

  const fmt = (s: SkillConfig): string => {
    const flags: string[] = [];
    if (s.disableModelInvocation) flags.push("manual-only, invoke with /" + s.name);
    else if (s.userInvocable === false) flags.push("background knowledge, auto-apply silently");
    if (s.allowedTools) flags.push(`preferred tools: ${s.allowedTools}`);
    if (s.disallowedTools) flags.push(`avoid: ${s.disallowedTools}`);
    const head = `- /${s.name}: ${s.description.trim()}${flags.length ? ` [${flags.join("; ")}]` : ""}`;
    return `${head}\n${truncateBody(s.instructions)}`;
  };

  const parts: string[] = [];
  parts.push(`## Skills (${usable.length} installed — Claude Code SKILL.md format)`);
  parts.push(
    `Skills are reusable playbooks. Auto-apply one when its description matches the request; the user can also invoke one manually with /name (arrives as a :skill[name] badge in the message text — treat it exactly like /name). When a skill applies, follow its instructions exactly (they override generic defaults). Keep the response grounded in real tool results.`
  );
  if (auto.length > 0) {
    parts.push(`### Auto-applicable`);
    parts.push(auto.map(fmt).join("\n\n"));
  }
  if (manualOnly.length > 0) {
    parts.push(`### Manual-only (only when user types /name)`);
    parts.push(manualOnly.map((s) => `- /${s.name}: ${s.description.trim()}`).join("\n"));
  }
  return parts.join("\n\n");
}

/** Enforce per-skill allowed/disallowed tools for the current turn. */
export function filterToolsBySkills(
  tools: Record<string, any>,
  skills: SkillConfig[],
  activeSkillNames?: string[]
): Record<string, any> {
  if (!activeSkillNames || activeSkillNames.length === 0) return tools;
  const active = skills.filter((s) => activeSkillNames.includes(s.name));
  if (active.length === 0) return tools;
  let out = { ...tools };
  for (const s of active) {
    if (s.disallowedTools) {
      const banned = s.disallowedTools
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      for (const b of banned) {
        // Support prefix match (e.g. "browser" bans browser_*)
        for (const key of Object.keys(out)) {
          if (key === b || key.startsWith(b + "_") || key.startsWith(b)) {
            // Exact or prefix — be conservative: exact + prefix-with-underscore
            if (key === b || key.startsWith(b.replace(/\*$/, ""))) delete out[key];
          }
        }
      }
    }
  }
  return out;
}

export function skillTokenHint(skills: SkillConfig[]): string {
  if (!skills || skills.length === 0) return "no skills installed";
  return skills.map((s) => `/${s.name}`).join(", ");
}
