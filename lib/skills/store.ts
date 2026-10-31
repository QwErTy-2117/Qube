/**
 * Process-wide skill store.
 *
 * Reads bundled + user skills through the loader, caches them in memory, and
 * writes user/agent-created skills back as `SKILL.md` directories. The store
 * is the single entry point used by the harness, tools, API routes and the
 * settings UI — bundled and self-created skills share one implementation.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bundledSkills } from "./bundled";
import {
  deleteSkillDir,
  isSafeSkillDirName,
  loadSkills,
  skillRootDir,
  writeSkillToDisk,
  type SkillLoadError,
} from "./loader";
import {
  normalizeSkill,
  validateSkill,
} from "./registry";
import {
  colorForSkill,
  normalizeSkillSource,
  type SkillConfig,
} from "./types";

export type SkillStoreSnapshot = {
  skills: SkillConfig[];
  errors: SkillLoadError[];
  userDir: string;
};

function canonical(skill: Pick<SkillConfig, "description" | "instructions" | "allowedTools" | "disallowedTools">): string {
  return JSON.stringify([
    skill.description.trim(),
    skill.instructions.trim(),
    (skill.allowedTools || "").trim(),
    (skill.disallowedTools || "").trim(),
  ]);
}

class SkillStore {
  private skills: SkillConfig[] | null = null;
  private errors: SkillLoadError[] = [];

  private ensure(): SkillConfig[] {
    if (this.skills) return this.skills;
    const result = loadSkills({ migrate: true });
    this.skills = result.skills;
    this.errors = result.errors;
    const realErrors = result.errors.filter((e) => !/Duplicate skill/.test(e.error));
    if (realErrors.length > 0) {
      for (const e of realErrors) console.warn(`[SkillStore] Skipped ${e.source}: ${e.error}`);
    }
    return this.skills;
  }

  /** Force a re-read from disk (after external writes, upgrades, resets). */
  reload(): void {
    this.skills = null;
    this.errors = [];
  }

  snapshot(): SkillStoreSnapshot {
    this.ensure();
    return {
      skills: this.getAll(),
      errors: [...this.errors],
      userDir: skillRootDir(),
    };
  }

  getAll(): SkillConfig[] {
    return this.ensure().map((s) => ({ ...s }));
  }

  getByName(name: string): SkillConfig | null {
    const n = (name || "").trim().toLowerCase();
    if (!n) return null;
    const found = this.ensure().find((s) => s.name === n);
    return found ? { ...found } : null;
  }

  /**
   * Create or replace a skill. Bundled names become user overrides rather
   * than being destroyed, so a later upgrade can still restore the default.
   */
  upsert(
    input: Partial<SkillConfig> & { name: string },
  ): { ok: boolean; error?: string; skill?: SkillConfig } {
    this.ensure();
    const name = (input.name || "").trim().toLowerCase();
    const existing = this.getByName(name);
    if (input.isSystem) delete (input as { isSystem?: boolean }).isSystem;
    const bundled = bundledSkills().find((s) => s.name === name);

    const merged = normalizeSkill({
      ...(existing || {}),
      ...input,
      name,
      source: bundled ? "user" : normalizeSkillSource(input.source ?? existing?.source ?? "user"),
      isSystem: !!bundled,
      // Never let a caller claim a bundled skill's provenance.
      provenance:
        input.provenance ??
        existing?.provenance ??
        (bundled ? `User override of the bundled ${name} skill` : "Created in Qube"),
      installedAt: existing?.installedAt ?? Date.now(),
    });
    const err = validateSkill(merged);
    if (err) return { ok: false, error: err };

    // Identical to the bundled version → drop the override.
    if (bundled && canonical(merged) === canonical(bundled)) {
      deleteSkillDir(name);
      this.reload();
      return { ok: true, skill: this.getByName(name) ?? merged };
    }

    const written = writeSkillToDisk({ ...merged, source: "user", isSystem: false });
    if (!written.ok) return { ok: false, error: written.error };
    this.reload();
    return { ok: true, skill: this.getByName(name) ?? merged };
  }

  /**
   * Remove a user skill (or a user override of a bundled skill). Bundled
   * defaults always survive and reappear immediately.
   */
  remove(name: string): { ok: boolean; error?: string; restoredBundled?: boolean } {
    this.ensure();
    const n = (name || "").trim().toLowerCase();
    if (!isSafeSkillDirName(n)) return { ok: false, error: "Invalid skill name" };
    const bundled = bundledSkills().find((s) => s.name === n);
    const written = deleteSkillDir(n);
    if (!written.ok) return { ok: false, error: written.error };
    this.reload();
    if (bundled) return { ok: true, restoredBundled: true };
    if (!this.getByName(n)) return { ok: true };
    // The name also exists in the legacy materialized directory.
    return { ok: false, error: "Skill is provided by another source" };
  }

  /**
   * Bulk reconcile used by the settings UI (and by the legacy client that
   * POSTs the whole list). Writes only differences, removes user skills that
   * are no longer listed, and never deletes bundled defaults.
   */
  sync(incoming: SkillConfig[]): { ok: boolean; error?: string } {
    this.ensure();
    const bundled = new Map(bundledSkills().map((s) => [s.name, s]));
    const keep = new Set<string>();
    const planned: SkillConfig[] = [];

    for (const raw of incoming || []) {
      if (!raw || typeof raw.name !== "string") continue;
      const name = raw.name.trim().toLowerCase();
      if (!isSafeSkillDirName(name)) return { ok: false, error: `Invalid skill name "${raw.name}"` };
      const base = bundled.get(name);
      const isBundledShaped =
        !!base &&
        (raw.isSystem === true ||
          raw.source === "bundled" ||
          (raw.source as string) === "system" ||
          raw.source === undefined);
      const skill = normalizeSkill({
        ...(base || {}),
        ...raw,
        name,
        source: isBundledShaped ? "user" : normalizeSkillSource(raw.source),
        isSystem: !!base,
        installedAt: raw.installedAt || Date.now(),
      });
      // Validate everything the user can actually author.
      const err = validateSkill(skill);
      if (err) return { ok: false, error: `${name}: ${err}` };
      keep.add(name);
      if (base && canonical(skill) === canonical(base)) {
        planned.push({ ...base }); // pure bundled default, nothing on disk
        continue;
      }
      planned.push(skill);
    }

    // Write planned user skills.
    for (const skill of planned) {
      if (bundled.has(skill.name) && canonical(skill) === canonical(bundled.get(skill.name)!)) {
        deleteSkillDir(skill.name);
        continue;
      }
      const written = writeSkillToDisk({ ...skill, source: "user", isSystem: false });
      if (!written.ok) return { ok: false, error: `${skill.name}: ${written.error}` };
    }

    // Remove user skills that are no longer listed.
    const dir = skillRootDir();
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".") || keep.has(entry)) continue;
        if (!isSafeSkillDirName(entry)) continue;
        deleteSkillDir(entry);
      }
    }
    this.reload();
    return { ok: true };
  }

  /** Directory where user / agent-created skills live. */
  userDir(): string {
    return skillRootDir();
  }

  /** Full body for on-demand loading through the `skill` tool. */
  loadBody(name: string): { skill: SkillConfig; content: string } | null {
    const skill = this.getByName(name);
    if (!skill) return null;
    const files = skill.resources ?? [];
    const resources = files.length
      ? `\n\nFiles shipped with this skill (read them with read_file when referenced):\n${files
          .map((r) => `- ${join(skill.path || skill.name, r)}`)
          .join("\n")}`
      : "";
    return { skill, content: `${skill.instructions.trim()}${resources}` };
  }

  errorsFor(name: string): SkillLoadError[] {
    this.ensure();
    return this.errors.filter((e) => e.source.includes(`/${name}/`) || e.source.endsWith(name));
  }

  /** Hard reset: forget in-memory state (disk state is handled elsewhere). */
  resetForHardReset(): void {
    this.reload();
  }

  /** Backwards-compatible accessor used by older call sites. */
  colorFor(name: string): string {
    return this.getByName(name)?.color || colorForSkill(name);
  }
}

export const skillStore = new SkillStore();
