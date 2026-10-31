/**
 * Skills — an Agent Skills compatible model (SKILL.md).
 *
 * A skill is a self-contained directory with a `SKILL.md` file: YAML-ish
 * frontmatter (`name`, `description`, optional tool hints) plus a Markdown
 * body that is only loaded when the skill is actually used.
 *
 * Design rules (see docs/skills.md):
 * - Only `name` + `description` live in the model context by default.
 * - The body is loaded on demand through the `skill` tool (or `/name`).
 * - Bundled skills ship with Qube and can be upgraded; user/agent-created
 *   skills live in the data directory and always win on name conflicts.
 * - Nothing about skills is stored in the system prompt beyond the metadata
 *   list, so the prompt stays small.
 *
 * Pure helpers live in `registry.ts`; filesystem discovery lives in
 * `loader.ts`; the process-wide instance is in `store.ts`.
 */

export type SkillSource = "bundled" | "user" | "marketplace";

export interface SkillConfig {
  id: string;
  /** lowercase letters, numbers, hyphens only, max 64. Matches directory name. */
  name: string;
  /** What it does + when to use it ("does X. Use when Y."). Routing logic. */
  description: string;
  /** Markdown body of SKILL.md — loaded on demand, never preloaded. */
  instructions: string;
  /** Claude Code `allowed-tools` — preferred tools while this skill is active. */
  allowedTools?: string;
  /** Claude Code `disallowed-tools` — removed from the pool while active. */
  disallowedTools?: string;
  /** false hides from `/` menu (background knowledge only). Default true. */
  userInvocable?: boolean;
  /** true = manual `/name` only, never model-selected. Default false. */
  disableModelInvocation?: boolean;
  /** SPDX identifier of the skill content itself (not the Qube app). */
  license?: string;
  /** Human-readable provenance: where the content came from. */
  provenance?: string;
  /** Badge color in Advanced settings. */
  color?: string;
  source: SkillSource;
  /** Which marketplace this came from, if any. */
  marketplace?: string;
  version?: string;
  installedAt: number;
  updatedAt: number;
  /** Bundled skills can't be deleted (they can be overridden by the user). */
  isSystem?: boolean;
  /** Absolute directory containing SKILL.md, when loaded from disk. */
  path?: string;
  /** Optional resource files shipped with the skill (scripts, references). */
  resources?: string[];
}

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESC_MAX = 1024;
export const SKILL_BODY_MAX_LINES = 500;

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

/** Normalize a user/agent supplied name into the skill-name grammar. */
export function normalizeSkillName(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX);
}

/** Legacy persisted values ("system"/"custom") map onto the new sources. */
export function normalizeSkillSource(value: unknown): SkillSource {
  if (value === "system") return "bundled";
  if (value === "custom") return "user";
  if (value === "bundled" || value === "user" || value === "marketplace") return value;
  return "user";
}
