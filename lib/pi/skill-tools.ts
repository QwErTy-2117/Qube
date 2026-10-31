/**
 * Skill tools.
 *
 * `skill`        — load a skill's SKILL.md body on demand (progressive
 *                  disclosure: the body never sits in the system prompt).
 * `manage_skill` — create / update / deprecate / list self-authored skills
 *                  through the same store bundled skills use.
 *
 * Both are pure store clients, so they behave identically in chat,
 * subagents and background tasks.
 */

import { tool } from "ai";
import { z } from "zod";
import { normalizeSkillName, type SkillConfig } from "@/lib/skills/types";

const MAX_BODY_CHARS = 24_000;

function summarize(skill: SkillConfig) {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    version: skill.version,
    license: skill.license,
    path: skill.path,
  };
}

export function createSkillTools(): Record<string, any> {
  const skill = tool({
    description:
      "Load a skill's instructions by name before doing the specialized work it covers. Pass the exact name from the available-skills list. Returns the SKILL.md body (and the paths of any files shipped with it). If several skills are needed, call this once per skill. Do not load a skill you are not going to follow.",
    inputSchema: z.object({
      name: z.string().describe("Skill name, e.g. \"docx\" or \"frontend-design\""),
    }),
    execute: async ({ name }: { name: string }) => {
      try {
        const { skillStore } = await import("@/lib/skills/store");
        const normalized = normalizeSkillName(name);
        const found = skillStore.loadBody(normalized);
        if (!found) {
          const available = skillStore
            .getAll()
            .filter((s) => s.disableModelInvocation !== true)
            .map((s) => s.name);
          return JSON.stringify({
            error: `No skill named "${name}"`,
            available,
            hint: "Use an exact name from the available skills list, or proceed without a skill.",
          });
        }
        const body = found.content;
        return JSON.stringify({
          name: found.skill.name,
          description: found.skill.description,
          instructions:
            body.length > MAX_BODY_CHARS
              ? `${body.slice(0, MAX_BODY_CHARS).trimEnd()}\n\n…(truncated — read the full SKILL.md at ${found.skill.path || found.skill.name}/SKILL.md)`
              : body,
          ...(found.skill.resources?.length ? { resources: found.skill.resources } : {}),
          note: "Follow these instructions for the current task unless they conflict with system, security or permission rules.",
        });
      } catch (e) {
        return JSON.stringify({ error: (e as Error)?.message || String(e) });
      }
    },
  });

  const manage_skill = tool({
    description:
      "Create, update, deprecate, delete or list reusable skills (procedures, not facts). " +
      "Use when a workflow genuinely repeats and no adequate skill exists — prefer updating an existing skill over creating a near-duplicate. " +
      "A skill is stored as SKILL.md in Qube's skills directory and loads on demand afterwards; it is never injected into the prompt permanently. " +
      "Rules: generalize (no single URL, dataset, date or personal data), state what it does AND when to use it, keep the body under ~200 lines, never include secrets. " +
      "Actions: list, get, create, update, deprecate, delete.",
    inputSchema: z.object({
      action: z.enum(["list", "get", "create", "update", "deprecate", "delete"]).describe("Skill action"),
      name: z.string().optional().describe("Skill name (lowercase-hyphens)"),
      description: z.string().optional().describe("What it does + when to use it (one or two sentences)"),
      instructions: z.string().optional().describe("The SKILL.md body: steps, checks, rules"),
      whenToUse: z.string().optional().describe("Trigger sentence folded into the description when description lacks it"),
      license: z.string().optional().describe("Licence of the skill content (default: Original Qube content)"),
    }),
    execute: async (args: any) => {
      const { skillStore } = await import("@/lib/skills/store");
      try {
        if (args.action === "list") {
          return JSON.stringify({
            skills: skillStore.getAll().map(summarize),
            userDir: skillStore.userDir(),
          });
        }
        const name = normalizeSkillName(String(args.name || ""));
        if (!name) return JSON.stringify({ error: "name is required" });
        if (args.action === "get") {
          const found = skillStore.loadBody(name);
          if (!found) return JSON.stringify({ error: `No skill named "${name}"` });
          return JSON.stringify({ skill: summarize(found.skill), instructions: found.content.slice(0, 8000) });
        }
        const existing = skillStore.getByName(name);
        if (args.action === "delete") {
          if (existing?.source === "bundled" && !existing.path) {
            return JSON.stringify({ error: "Bundled skills cannot be deleted — update it with a user override instead." });
          }
          const res = skillStore.remove(name);
          if (!res.ok) return JSON.stringify({ error: res.error });
          return JSON.stringify({ deleted: name, restoredBundled: !!res.restoredBundled });
        }
        if (args.action === "deprecate") {
          if (!existing) return JSON.stringify({ error: `No skill named "${name}"` });
          if (existing.source === "bundled") {
            return JSON.stringify({
              error: "Bundled skills are maintained with Qube. Create a corrected user skill with the same name to override it.",
            });
          }
          const res = skillStore.upsert({
            ...existing,
            description: `${existing.description.replace(/\s*\[deprecated\][\s\S]*$/i, "")} [deprecated: no longer applies]`,
            instructions: `${existing.instructions}\n\n## Deprecated\nThis skill is deprecated. Do not load or follow it; it is kept only for history.`,
            disableModelInvocation: true,
            source: "user",
          });
          if (!res.ok) return JSON.stringify({ error: res.error });
          return JSON.stringify({ deprecated: name });
        }

        // create / update
        if (args.action === "create" && existing) {
          return JSON.stringify({
            error: `Skill "${name}" already exists (${existing.source}). Update it instead of duplicating it.`,
            existing: summarize(existing),
          });
        }
        if (args.action === "update" && !existing) {
          return JSON.stringify({ error: `No skill named "${name}" to update. Use action "create".` });
        }
        const description =
          String(args.description || "").trim() ||
          existing?.description ||
          (args.whenToUse ? `${String(args.whenToUse).trim()}.` : "");
        const whenToUse = String(args.whenToUse || "").trim();
        const finalDescription =
          whenToUse && !/use when|use for|when /i.test(description)
            ? `${description}${description.endsWith(".") ? "" : "."} Use when ${whenToUse}.`
            : description;
        const instructions = String(args.instructions || existing?.instructions || "").trim();
        if (!instructions) {
          return JSON.stringify({ error: "instructions are required (the SKILL.md body)" });
        }
        const res = skillStore.upsert({
          ...existing,
          name,
          description: finalDescription,
          instructions,
          license: args.license || existing?.license || "Original Qube content (Apache-2.0)",
          provenance: existing?.provenance || "Created by Qube for this user",
          source: "user",
          version: existing && args.action === "update" ? bumpVersion(existing.version) : "1.0.0",
          disableModelInvocation: existing?.disableModelInvocation ?? false,
        });
        if (!res.ok) return JSON.stringify({ error: res.error });
        return JSON.stringify({
          saved: true,
          action: args.action,
          skill: res.skill ? summarize(res.skill) : { name },
          note: "Available immediately: load it with the `skill` tool next time this workflow recurs.",
        });
      } catch (e) {
        return JSON.stringify({ error: (e as Error)?.message || String(e) });
      }
    },
  });

  return { skill, manage_skill };
}

function bumpVersion(version?: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version || "");
  if (!m) return "1.0.1";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
