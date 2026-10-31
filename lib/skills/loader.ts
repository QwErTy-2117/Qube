/**
 * Filesystem discovery for skills.
 *
 * Layout (all under the Qube data directory):
 *
 *   <dataDir>/skills/<skill-name>/SKILL.md          ← user + agent-created
 *   <dataDir>/skills/<skill-name>/scripts/...       ← optional resources
 *
 * The bundled set is compiled into the app (lib/skills/bundled) so upgrades
 * ship with the build; it is never written to the user directory.
 *
 * Discovery is deterministic (sorted names, stable precedence) and never
 * throws: a malformed skill is reported and skipped so one bad directory
 * cannot break Qube.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { bundledSkills } from "./bundled";
import {
  normalizeSkill,
  parseSkillMd,
  renderSkillMd,
  resolveSkillPrecedence,
  validateSkill,
  type SkillFrontmatter,
} from "./registry";
import {
  SKILL_NAME_RE,
  normalizeSkillSource,
  type SkillConfig,
  type SkillSource,
} from "./types";

export type SkillLoadError = {
  /** Directory or file the problem came from. */
  source: string;
  /** Human-readable reason. */
  error: string;
};

export type SkillLoadResult = {
  skills: SkillConfig[];
  errors: SkillLoadError[];
  /** Where user-created skills are stored. */
  userDir: string;
};

export function skillRootDir(): string {
  return join(getDataDir(), "skills");
}

/** Legacy location previously used to materialize skills for reading. */
function legacyMaterializedDir(): string {
  return join(getDataDir(), ".agents", "skills");
}

function legacyJsonFile(): string {
  return join(getDataDir(), ".memory", "skills.json");
}

/** Reject names that could escape the skills directory. */
export function isSafeSkillDirName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

function listResourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (rel === "SKILL.md") continue;
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (rel.split("/").length < 4) walk(abs, rel);
      } else if (out.length < 200) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

function skillFromFile(
  file: string,
  dir: string,
  source: SkillSource,
  fallbackName: string,
): { skill?: SkillConfig; error?: string } {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (e) {
    return { error: `Cannot read SKILL.md: ${(e as Error).message}` };
  }
  if (raw.length > 400_000) return { error: "SKILL.md is too large (400KB max)" };
  const parsed = parseSkillMd(raw);
  if (!parsed.ok) return { error: parsed.error };

  const fm: SkillFrontmatter = parsed.frontmatter;
  const name = fm.name.trim().toLowerCase();
  if (name !== fallbackName) {
    // A directory/skill mismatch is a duplicate-name landmine — reject it.
    return { error: `Frontmatter name "${fm.name}" does not match directory "${fallbackName}"` };
  }
  const candidate = normalizeSkill({
    name,
    description: fm.description,
    instructions: parsed.body,
    allowedTools: fm.allowedTools,
    disallowedTools: fm.disallowedTools,
    userInvocable: fm.userInvocable,
    disableModelInvocation: fm.disableModelInvocation,
    license: fm.license,
    provenance: fm.provenance,
    version: fm.version,
    source,
    path: dir,
    resources: listResourceFiles(dir),
    isSystem: source === "bundled",
  });
  const err = validateSkill(candidate);
  if (err) return { error: err };
  return { skill: candidate };
}

function loadFromDir(root: string, source: SkillSource, errors: SkillLoadError[]): SkillConfig[] {
  if (!existsSync(root)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root).sort();
  } catch (e) {
    errors.push({ source: root, error: (e as Error).message });
    return [];
  }
  const out: SkillConfig[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (!isSafeSkillDirName(entry)) {
      errors.push({ source: dir, error: `Invalid skill directory name "${entry}"` });
      continue;
    }
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) {
      errors.push({ source: dir, error: "Missing SKILL.md" });
      continue;
    }
    const { skill, error } = skillFromFile(file, dir, source, entry);
    if (skill) out.push(skill);
    else if (error) errors.push({ source: file, error });
  }
  return out;
}

/**
 * One-time import of the legacy `.memory/skills.json` store into skill
 * directories. Bundled names are skipped (bundled content is the source of
 * truth after an upgrade); user entries keep their instructions.
 */
export function migrateLegacySkillJson(errors: SkillLoadError[] = []): number {
  const file = legacyJsonFile();
  if (!existsSync(file)) return 0;
  let imported = 0;
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    const arr: unknown[] = Array.isArray((data as { skills?: unknown[] })?.skills)
      ? (data as { skills: unknown[] }).skills
      : Array.isArray(data)
        ? (data as unknown[])
        : [];
    const bundledNames = new Set(bundledSkills().map((s) => s.name));
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      if (typeof raw.name !== "string" || bundledNames.has(raw.name)) continue;
      const skill = normalizeSkill({
        name: raw.name,
        description: typeof raw.description === "string" ? raw.description : "",
        instructions: typeof raw.instructions === "string" ? raw.instructions : "",
        allowedTools: typeof raw.allowedTools === "string" ? raw.allowedTools : undefined,
        disallowedTools: typeof raw.disallowedTools === "string" ? raw.disallowedTools : undefined,
        userInvocable: raw.userInvocable !== false,
        disableModelInvocation: raw.disableModelInvocation === true,
        source: normalizeSkillSource(raw.source),
        version: typeof raw.version === "string" ? raw.version : "1.0.0",
        provenance: "Imported from the legacy skills.json store",
      });
      if (validateSkill(skill)) continue;
      const res = writeSkillToDisk(skill);
      if (res.ok) imported += 1;
      else errors.push({ source: file, error: `${skill.name}: ${res.error}` });
    }
    // Keep the old file as a forgotten backup instead of deleting user data.
    renameSync(file, `${file}.migrated-${Date.now()}`);
  } catch (e) {
    errors.push({ source: file, error: `Legacy import failed: ${(e as Error).message}` });
  }
  return imported;
}

/**
 * Load every skill: bundled first, then user directories, then the legacy
 * materialized directory, resolved through the precedence rules.
 */
export function loadSkills(opts?: { migrate?: boolean }): SkillLoadResult {
  const errors: SkillLoadError[] = [];
  const userDir = skillRootDir();
  if (opts?.migrate !== false) {
    try {
      migrateLegacySkillJson(errors);
    } catch (e) {
      errors.push({ source: legacyJsonFile(), error: (e as Error).message });
    }
  }
  const all: SkillConfig[] = [
    ...bundledSkills(),
    ...loadFromDir(userDir, "user", errors),
    ...loadFromDir(legacyMaterializedDir(), "user", errors),
  ];
  const { skills, shadowed } = resolveSkillPrecedence(all);
  for (const s of shadowed) {
    if (s.loser === "bundled") continue; // expected when a user override exists
    errors.push({
      source: userDir,
      error: `Duplicate skill "${s.name}" — kept the ${s.by} copy`,
    });
  }
  return { skills, errors, userDir };
}

/** Absolute path of a skill directory (validated). */
export function skillDirFor(name: string): string {
  if (!isSafeSkillDirName(name)) throw new Error(`Invalid skill name "${name}"`);
  const root = resolve(skillRootDir());
  const dir = resolve(join(root, name));
  if (dir !== join(root, name) || !dir.startsWith(root + sep)) {
    throw new Error(`Invalid skill name "${name}"`);
  }
  return dir;
}

export type WriteSkillResult = { ok: boolean; error?: string; path?: string };

/** Write (or update) a user skill as `<name>/SKILL.md`, atomically. */
export function writeSkillToDisk(skill: SkillConfig): WriteSkillResult {
  const err = validateSkill(skill);
  if (err) return { ok: false, error: err };
  let dir: string;
  try {
    dir = skillDirFor(skill.name);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "SKILL.md");
    const tmp = join(dir, `.SKILL.md.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, renderSkillMd(skill), "utf-8");
    renameSync(tmp, target);
    return { ok: true, path: dir };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Remove a user skill directory. Bundled skills are untouched by design. */
export function deleteSkillDir(name: string): WriteSkillResult {
  let dir: string;
  try {
    dir = skillDirFor(name);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!existsSync(dir)) return { ok: true };
  try {
    rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Read a resource file that belongs to a skill (path-traversal safe). */
export function readSkillResource(name: string, relativePath: string): string | null {
  let dir: string;
  try {
    dir = skillDirFor(name);
  } catch {
    return null;
  }
  const target = resolve(join(dir, relativePath));
  if (!target.startsWith(dir + sep)) return null;
  try {
    if (statSync(target).size > 1_000_000) return null;
    return readFileSync(target, "utf-8");
  } catch {
    return null;
  }
}
