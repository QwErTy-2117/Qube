/**
 * Skill system tests.
 *
 * Covers discovery, precedence, malformed skills, self-created skill
 * persistence, bundled upgrade without data loss, metadata-only prompting,
 * on-demand body loading and path-traversal safety.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-skill-test-"));

import {
  parseSkillMd,
  renderSkillMd,
  resolveSkillPrecedence,
  rankSkillsByRelevance,
  skillPromptEntries,
  validateSkill,
} from "@/lib/skills/registry";
import { loadSkills, skillRootDir, readSkillResource } from "@/lib/skills/loader";
import { bundledSkills, BUNDLED_SKILLS } from "@/lib/skills/bundled";
import { buildSkillsPromptSection } from "@/lib/skills/prompt";
import { skillStore } from "@/lib/skills/store";

function writeUserSkill(name: string, description: string, body: string, extra = "") {
  const dir = join(skillRootDir(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}${extra}\n---\n\n${body}\n`,
    "utf-8",
  );
  return dir;
}

describe("bundled skills", () => {
  it("ships the document + software + design + authoring set", () => {
    const names = BUNDLED_SKILLS.map((s) => s.name).sort();
    assert.deepEqual(names, [
      "docx",
      "frontend-design",
      "pdf",
      "pptx",
      "skill-authoring",
      "software-delivery",
      "xlsx",
    ]);
  });

  it("replaced the legacy built-in skills", () => {
    const names = BUNDLED_SKILLS.map((s) => s.name);
    for (const legacy of ["research", "developing", "creating-documents", "trip-planning"]) {
      assert.ok(!names.includes(legacy), `legacy skill ${legacy} must be gone`);
    }
  });

  it("has valid, routable metadata and licence/provenance on every skill", () => {
    for (const skill of BUNDLED_SKILLS) {
      assert.equal(validateSkill(skill), null, `${skill.name} must be valid`);
      assert.match(skill.description, /use when|use whenever|use for/i, `${skill.name} description must say when to use it`);
      assert.ok(skill.instructions.length > 200, `${skill.name} must carry real instructions`);
      assert.ok(skill.license, `${skill.name} must record a licence`);
      assert.ok(skill.provenance, `${skill.name} must record provenance`);
      assert.equal(skill.source, "bundled");
      assert.equal(skill.isSystem, true);
    }
  });

  it("round-trips through SKILL.md", () => {
    const skill = bundledSkills()[0];
    const parsed = parseSkillMd(renderSkillMd(skill));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.frontmatter.name, skill.name);
    assert.equal(parsed.frontmatter.description, skill.description);
    assert.match(parsed.body, /Word documents/);
  });
});

describe("parsing and validation", () => {
  it("rejects a file without frontmatter instead of throwing", () => {
    const parsed = parseSkillMd("# Just a heading");
    assert.equal(parsed.ok, false);
  });

  it("rejects unterminated frontmatter", () => {
    assert.equal(parseSkillMd("---\nname: x\ndescription: y\n").ok, false);
  });

  it("parses block scalars and quoted values", () => {
    const parsed = parseSkillMd(
      '---\nname: sample\ndescription: >\n  Builds a thing. Use when\n  things need building.\nlicense: MIT\n---\nbody here',
    );
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.frontmatter.description, "Builds a thing. Use when things need building.");
    assert.equal(parsed.frontmatter.license, "MIT");
    assert.equal(parsed.body, "body here");
  });

  it("requires a when-to-use description", () => {
    assert.ok(validateSkill({ name: "x", description: "Thing", instructions: "Do it." }));
    assert.equal(
      validateSkill({
        name: "x",
        description: "Builds a quarterly board pack. Use when the user asks for a board pack.",
        instructions: "Do it.",
      }),
      null,
    );
  });

  it("rejects unsafe names", () => {
    assert.ok(validateSkill({ name: "Bad Name", description: "Does x. Use when y.", instructions: "z" }));
    assert.ok(validateSkill({ name: "../escape", description: "Does x. Use when y.", instructions: "z" }));
  });
});

describe("discovery", () => {
  beforeEach(() => {
    skillStore.reload();
  });

  it("loads bundled skills with no user directory present", () => {
    const { skills } = loadSkills({ migrate: false });
    const names = skills.map((s) => s.name);
    for (const name of ["docx", "pptx", "xlsx", "pdf"]) assert.ok(names.includes(name));
  });

  it("discovers a user skill from disk and exposes its path", () => {
    const dir = writeUserSkill("quarterly-report", "Builds the quarterly board pack. Use when a board pack is requested.", "# Steps\n1. Do it.");
    const { skills } = loadSkills({ migrate: false });
    const found = skills.find((s) => s.name === "quarterly-report");
    assert.ok(found, "user skill should be discovered");
    assert.equal(found?.path, dir);
    assert.equal(found?.source, "user");
  });

  it("reports a malformed skill without crashing", () => {
    const dir = join(skillRootDir(), "broken-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "no frontmatter here", "utf-8");
    const { skills, errors } = loadSkills({ migrate: false });
    assert.ok(!skills.some((s) => s.name === "broken-skill"));
    assert.ok(errors.some((e) => /broken-skill/.test(e.source)), "error should name the skill dir");
  });

  it("rejects a name/directory mismatch", () => {
    const dir = join(skillRootDir(), "wrong-dir");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: other-name\ndescription: Does a thing. Use when testing.\n---\nbody",
      "utf-8",
    );
    const { skills, errors } = loadSkills({ migrate: false });
    assert.ok(!skills.some((s) => s.name === "other-name"));
    assert.ok(errors.length > 0);
  });

  it("is deterministic across loads", () => {
    const a = loadSkills({ migrate: false }).skills.map((s) => s.name);
    const b = loadSkills({ migrate: false }).skills.map((s) => s.name);
    assert.deepEqual(a, b);
  });
});

describe("precedence and duplicates", () => {
  it("prefers a user skill over the bundled skill of the same name", () => {
    const user = { ...bundledSkills()[0], source: "user" as const, description: "User copy. Use when overriding." };
    const { skills, shadowed } = resolveSkillPrecedence([bundledSkills()[0], user]);
    const winner = skills.find((s) => s.name === user.name);
    assert.equal(winner?.source, "user");
    assert.ok(shadowed.some((s) => s.loser === "bundled"));
  });

  it("keeps bundled defaults available after an override is removed", () => {
    writeUserSkill("docx", "User override of docx. Use when testing overrides.", "# Override body");
    skillStore.reload();
    assert.equal(skillStore.getByName("docx")?.description.includes("User override"), true);
    const res = skillStore.remove("docx");
    assert.equal(res.ok, true);
    assert.equal(res.restoredBundled, true);
    assert.match(skillStore.getByName("docx")!.description, /Word documents/);
  });

  it("refuses to delete a bundled skill permanently", () => {
    skillStore.reload();
    const res = skillStore.remove("pdf");
    assert.equal(res.ok, true);
    assert.ok(skillStore.getByName("pdf"), "bundled pdf skill must still exist");
  });
});

describe("self-created skills", () => {
  beforeEach(() => skillStore.reload());

  it("creates a skill on disk and loads it on demand", () => {
    const res = skillStore.upsert({
      name: "expense-report",
      description: "Builds a monthly expense report from receipts. Use when receipts need totalling.",
      instructions: "# Expense report\n1. List receipts.\n2. Sum by category.\n3. Present the workbook.",
      source: "user",
    });
    assert.equal(res.ok, true, res.error ?? "upsert failed");
    const md = join(skillRootDir(), "expense-report", "SKILL.md");
    assert.ok(existsSync(md));
    assert.match(readFileSync(md, "utf-8"), /Expense report/);

    const body = skillStore.loadBody("expense-report");
    assert.ok(body);
    assert.match(body!.content, /Sum by category/);
  });

  it("persists across a store restart (fresh read from disk)", () => {
    skillStore.upsert({
      name: "restart-proof",
      description: "Verifies persistence. Use when testing restarts.",
      instructions: "# Persisted\nStill here.",
      source: "user",
    });
    skillStore.reload();
    assert.ok(skillStore.getByName("restart-proof"));
  });

  it("refuses near-duplicate creation via the agent tool", async () => {
    const { createSkillTools } = await import("@/lib/pi/skill-tools");
    const tools = createSkillTools();
    const res = await tools.manage_skill.execute(
      { action: "create", name: "pdf", description: "Dup. Use when duplicating.", instructions: "x" },
      {} as never,
    );
    assert.match(String(res), /already exists/);
  });

  it("creates skills through the agent tool and validates content", async () => {
    const { createSkillTools } = await import("@/lib/pi/skill-tools");
    const tools = createSkillTools();
    const created = await tools.manage_skill.execute(
      {
        action: "create",
        name: "weekly-review",
        description: "Runs a weekly review",
        instructions: "# Weekly review\n1. Gather notes.\n2. Summarize.",
        whenToUse: "the user asks for a weekly review",
      },
      {} as never,
    );
    assert.match(String(created), /"saved":true/);
    const loaded = await tools.skill.execute({ name: "weekly-review" }, {} as never);
    assert.match(String(loaded), /Gather notes/);
  });

  it("returns a helpful error for an unknown skill", async () => {
    const { createSkillTools } = await import("@/lib/pi/skill-tools");
    const res = await createSkillTools().skill.execute({ name: "nope" }, {} as never);
    assert.match(String(res), /No skill named/);
  });
});

describe("bundled upgrades", () => {
  it("does not delete user skills when bundled versions are reloaded", () => {
    writeUserSkill("my-custom-flow", "Runs my custom flow. Use when my flow is needed.", "# Flow");
    loadSkills({ migrate: false });
    const again = loadSkills({ migrate: false }).skills;
    assert.ok(again.some((s) => s.name === "my-custom-flow"));
    assert.ok(again.some((s) => s.name === "docx"));
  });

  it("syncs the settings list without writing bundled copies to disk", () => {
    skillStore.reload();
    const all = skillStore.getAll();
    const res = skillStore.sync(all);
    assert.equal(res.ok, true, res.error ?? "upsert failed");
    for (const bundled of BUNDLED_SKILLS) {
      assert.ok(!existsSync(join(skillRootDir(), bundled.name)), `${bundled.name} must not be shadowed by an identical copy`);
    }
  });
});

describe("prompt shaping", () => {
  it("includes operating rules and metadata only — never bodies", () => {
    const section = buildSkillsPromptSection(bundledSkills());
    assert.match(section, /skill\(name\)/);
    assert.match(section, /manage_skill/);
    assert.match(section, /docx:/);
    assert.doesNotMatch(section, /Word documents \(\.docx\)\n\nA \.docx is a ZIP/);
    assert.ok(section.length < 4000, "system prompt section must stay small");
  });

  it("caps the metadata list", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...bundledSkills()[0],
      name: `skill-${i}`,
      description: "Does a thing. Use when testing.",
    }));
    assert.equal(skillPromptEntries(many).length, 60);
  });

  it("ranks relevant skills and ignores irrelevant ones", () => {
    const skills = bundledSkills();
    const pptxHits = rankSkillsByRelevance(skills, "make me a slide deck presentation for the pitch");
    assert.equal(pptxHits[0]?.name, "pptx");
    const pdfHits = rankSkillsByRelevance(skills, "merge these pdfs and extract the text");
    assert.equal(pdfHits[0]?.name, "pdf");
    assert.deepEqual(rankSkillsByRelevance(skills, "what is the weather in Rome"), []);
  });
});

describe("resource safety", () => {
  it("does not read files outside the skill directory", () => {
    writeUserSkill("with-resources", "Has resources. Use when testing resources.", "# Res");
    mkdirSync(join(skillRootDir(), "with-resources", "scripts"), { recursive: true });
    writeFileSync(join(skillRootDir(), "with-resources", "scripts", "run.sh"), "echo hi", "utf-8");
    assert.equal(readSkillResource("with-resources", "scripts/run.sh"), "echo hi");
    assert.equal(readSkillResource("with-resources", "../../secret.txt"), null);
    assert.equal(readSkillResource("../outside", "x"), null);
  });
});
