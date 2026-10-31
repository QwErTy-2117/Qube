/**
 * Pure skill registry helpers: parsing, validation, serialization,
 * precedence and prompt metadata shaping.
 *
 * No filesystem access here on purpose — everything is deterministic and
 * unit-testable. `loader.ts` owns disk I/O.
 */

import {
  SKILL_BODY_MAX_LINES,
  SKILL_DESC_MAX,
  SKILL_NAME_MAX,
  SKILL_NAME_RE,
  colorForSkill,
  normalizeSkillName,
  normalizeSkillSource,
  type SkillConfig,
  type SkillSource,
} from "./types";

export type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string;
  disallowedTools?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  version?: string;
  provenance?: string;
  /** Unknown keys are preserved so third-party SKILL.md files round-trip. */
  extra: Record<string, string | boolean>;
};

export type ParsedSkill =
  | { ok: true; frontmatter: SkillFrontmatter; body: string }
  | { ok: false; error: string };

const KNOWN_KEYS = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "allowedTools",
  "disallowed-tools",
  "disallowedTools",
  "user-invocable",
  "userInvocable",
  "disable-model-invocation",
  "disableModelInvocation",
  "version",
  "provenance",
  "metadata",
]);

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function toBool(value: string): boolean | undefined {
  const v = unquote(value).toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/**
 * Parse a SKILL.md document. Tolerant of the common YAML subset used by
 * Agent Skills (single-line scalars, quoted values, `|` / `>` block
 * scalars, comments) and explicit about what it rejects. Never throws.
 */
export function parseSkillMd(raw: string): ParsedSkill {
  const text = (raw || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { ok: false, error: "SKILL.md must start with YAML frontmatter (---)" };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { ok: false, error: "Unterminated YAML frontmatter" };

  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").trim();
  const fields: Record<string, string> = {};
  const extra: Record<string, string | boolean> = {};

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      // Folded/continuation line: append to the previous key.
      const lastKey = Object.keys(fields).pop();
      if (lastKey) fields[lastKey] = `${fields[lastKey]} ${line.trim()}`.trim();
      continue;
    }
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return { ok: false, error: `Invalid frontmatter line: ${line.slice(0, 80)}` };
    const key = m[1];
    let value = m[2];
    if (value === "|" || value === ">" || /^[|>][+-]?$/.test(value)) {
      // Block scalar: consume indented following lines.
      const block: string[] = [];
      while (i + 1 < fmLines.length && (/^\s/.test(fmLines[i + 1]) || fmLines[i + 1].trim() === "")) {
        block.push(fmLines[++i].replace(/^\s{1,4}/, ""));
      }
      const joined = value.startsWith(">")
        ? block.join(" ").replace(/\s+/g, " ")
        : block.join("\n");
      value = joined.trim();
    }
    if (!KNOWN_KEYS.has(key)) {
      extra[key] = value.trim();
      continue;
    }
    fields[key] = value;
  }

  const name = unquote(fields.name || "");
  const description = unquote(fields.description || "");
  if (!name) return { ok: false, error: "Frontmatter is missing `name`" };
  if (!description) return { ok: false, error: "Frontmatter is missing `description`" };

  return {
    ok: true,
    frontmatter: {
      name,
      description,
      license: fields.license ? unquote(fields.license) : undefined,
      allowedTools: fields["allowed-tools"] ?? fields.allowedTools,
      disallowedTools: fields["disallowed-tools"] ?? fields.disallowedTools,
      userInvocable: toBool(fields["user-invocable"] ?? fields.userInvocable ?? ""),
      disableModelInvocation: toBool(
        fields["disable-model-invocation"] ?? fields.disableModelInvocation ?? "",
      ),
      version: fields.version ? unquote(fields.version) : undefined,
      provenance: fields.provenance ? unquote(fields.provenance) : undefined,
      extra,
    },
    body,
  };
}

/** Validate metadata + body. Returns a human-readable error or null. */
export function validateSkill(input: Partial<SkillConfig>): string | null {
  const name = (input.name || "").trim();
  if (!name) return "Skill name is required.";
  if (name.length > SKILL_NAME_MAX) return `Skill name must be ≤${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_RE.test(name))
    return "Skill name must be lowercase letters, numbers and single hyphens (e.g. pdf-reports).";
  const desc = (input.description || "").trim();
  if (!desc) return "Skill description is required.";
  if (desc.length > SKILL_DESC_MAX)
    return `Skill description must be ≤${SKILL_DESC_MAX} characters.`;
  if (!/\b(use|when|for)\b/i.test(desc) && desc.split(/\s+/).length < 8)
    return "Skill description must state what the skill does AND when to use it (e.g. \"Does X. Use when Y.\").";
  const instructions = (input.instructions || "").trim();
  if (!instructions) return "Skill instructions are required.";
  if (instructions.split("\n").length > SKILL_BODY_MAX_LINES)
    return `Keep SKILL.md under ${SKILL_BODY_MAX_LINES} lines — move details into resource files.`;
  return null;
}

export function normalizeSkill(
  input: Partial<SkillConfig> & { name: string },
): SkillConfig {
  const now = Date.now();
  const name = normalizeSkillName(input.name);
  return {
    id: input.id || `${name}_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    description: (input.description || "").trim(),
    instructions: (input.instructions || "").trim(),
    allowedTools: (input.allowedTools || "").trim() || undefined,
    disallowedTools: (input.disallowedTools || "").trim() || undefined,
    userInvocable: input.userInvocable !== false,
    disableModelInvocation: input.disableModelInvocation === true,
    license: input.license,
    provenance: input.provenance,
    color: input.color || colorForSkill(name),
    source: normalizeSkillSource(input.source),
    marketplace: input.marketplace,
    version: input.version || "1.0.0",
    installedAt: input.installedAt || now,
    updatedAt: now,
    isSystem: input.isSystem === true,
    path: input.path,
    resources: input.resources,
  };
}

function yamlScalar(value: string): string {
  const v = value.replace(/\s+/g, " ").trim();
  // Quote only when the value could break naive YAML parsers.
  if (/[:#\n"'\\]/.test(v) || v.startsWith("-") || v === "") return JSON.stringify(v);
  return v;
}

/** Serialize a skill into SKILL.md (the portable Agent Skills form). */
export function renderSkillMd(skill: SkillConfig): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${yamlScalar(skill.description)}`);
  if (skill.license) lines.push(`license: ${yamlScalar(skill.license)}`);
  if (skill.allowedTools) lines.push(`allowed-tools: ${yamlScalar(skill.allowedTools)}`);
  if (skill.disallowedTools) lines.push(`disallowed-tools: ${yamlScalar(skill.disallowedTools)}`);
  if (skill.userInvocable === false) lines.push("user-invocable: false");
  if (skill.disableModelInvocation === true) lines.push("disable-model-invocation: true");
  if (skill.version) lines.push(`version: ${yamlScalar(skill.version)}`);
  if (skill.provenance) lines.push(`provenance: ${yamlScalar(skill.provenance)}`);
  lines.push("---");
  lines.push("");
  lines.push(skill.instructions.trim());
  lines.push("");
  return lines.join("\n");
}

/**
 * Deterministic precedence when several sources provide the same name:
 * user (agent-created / edited) > marketplace > bundled.
 * Bundled skills stay available when a user skill of the same name is
 * removed, which is what "reset to default" should do.
 */
export const SOURCE_PRECEDENCE: Record<SkillSource, number> = {
  user: 3,
  marketplace: 2,
  bundled: 1,
};

export function resolveSkillPrecedence(skills: SkillConfig[]): {
  skills: SkillConfig[];
  shadowed: Array<{ name: string; by: SkillSource; loser: SkillSource }>;
} {
  const byName = new Map<string, SkillConfig>();
  const shadowed: Array<{ name: string; by: SkillSource; loser: SkillSource }> = [];
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing) {
      byName.set(skill.name, skill);
      continue;
    }
    const winner =
      SOURCE_PRECEDENCE[skill.source] > SOURCE_PRECEDENCE[existing.source] ? skill : existing;
    const loser = winner === skill ? existing : skill;
    byName.set(skill.name, winner);
    shadowed.push({ name: skill.name, by: winner.source, loser: loser.source });
  }
  return {
    skills: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    shadowed,
  };
}

export type SkillPromptEntry = { name: string; description: string };

/**
 * The only skill data that goes into the system prompt: name + description,
 * capped so a large skill library cannot bloat the prompt.
 */
export function skillPromptEntries(
  skills: SkillConfig[],
  opts?: { maxSkills?: number; maxDescriptionChars?: number },
): SkillPromptEntry[] {
  const maxSkills = opts?.maxSkills ?? 60;
  const maxChars = opts?.maxDescriptionChars ?? 320;
  return skills
    .filter((s) => s.name && s.description && s.disableModelInvocation !== true)
    .slice(0, maxSkills)
    .map((s) => ({
      name: s.name,
      description:
        s.description.length > maxChars
          ? `${s.description.slice(0, maxChars).trimEnd()}…`
          : s.description,
    }));
}

/**
 * Cheap, deterministic relevance hint used by the UI/tests and as a
 * fallback when a model does not call the `skill` tool. Not a substitute
 * for the model's own judgment — it only surfaces candidates.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "use",
  "using", "make", "made", "please", "want", "need", "some", "your", "you",
  "about", "then", "than", "have", "has", "are", "was", "were", "will", "can",
]);

export function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export function rankSkillsByRelevance(skills: SkillConfig[], query: string, limit = 3): SkillConfig[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];
  const scored = skills
    .filter((s) => s.disableModelInvocation !== true)
    .map((skill) => {
      const nameTerms = new Set(tokenize(skill.name.replace(/-/g, " ")));
      const descTerms = new Set(tokenize(skill.description));
      let score = 0;
      for (const t of terms) {
        if (nameTerms.has(t)) score += 3;
        if (descTerms.has(t)) score += 1;
      }
      return { skill, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return scored.slice(0, limit).map((x) => x.skill);
}
