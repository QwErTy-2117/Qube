/**
 * Project-instruction loader tests: discovery order, .qube/rules, framing,
 * byte budget, truncation and cache invalidation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearProjectInstructionsCache,
  loadProjectInstructions,
  PROJECT_INSTRUCTIONS_BUDGET_BYTES,
} from "@/lib/pi/project-instructions";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "qube-project-instructions-"));
}

describe("loadProjectInstructions", () => {
  beforeEach(() => {
    clearProjectInstructionsCache();
  });

  it("returns nothing for a workspace without instruction files", async () => {
    const root = workspace();
    const res = await loadProjectInstructions(root);
    assert.equal(res.block, "");
    assert.deepEqual(res.files, []);
  });

  it("loads AGENTS.md, CLAUDE.md and .qube/rules in deterministic order", async () => {
    const root = workspace();
    await writeFile(join(root, "AGENTS.md"), "# Agent rules\nUse tabs.", "utf-8");
    await writeFile(join(root, "CLAUDE.md"), "Claude guidance.", "utf-8");
    await mkdir(join(root, ".qube", "rules"), { recursive: true });
    await writeFile(join(root, ".qube", "rules", "b.md"), "Rule B", "utf-8");
    await writeFile(join(root, ".qube", "rules", "a.md"), "Rule A", "utf-8");
    await writeFile(join(root, ".qube", "rules", "ignore.txt"), "not markdown", "utf-8");

    const res = await loadProjectInstructions(root);
    assert.deepEqual(res.files, ["AGENTS.md", "CLAUDE.md", ".qube/rules/a.md", ".qube/rules/b.md"]);
    assert.ok(res.block.includes("Use tabs."));
    assert.ok(res.block.includes("Claude guidance."));
    assert.ok(res.block.includes("Rule A"));
    assert.ok(!res.block.includes("not markdown"));
    // Untrusted project context, clearly framed.
    assert.ok(res.block.includes("Project instructions"));
    assert.ok(res.block.includes("never override"));
    assert.ok(res.block.includes('<project_instructions source="AGENTS.md">'));
  });

  it("skips empty files and tolerates unreadable rules directories", async () => {
    const root = workspace();
    await writeFile(join(root, "AGENTS.md"), "   \n", "utf-8");
    await writeFile(join(root, "QUBE.md"), "real guidance", "utf-8");
    const res = await loadProjectInstructions(root);
    assert.deepEqual(res.files, ["QUBE.md"]);
    assert.ok(res.block.includes("real guidance"));
  });

  it("caps huge files and the total block at the byte budget", async () => {
    const root = workspace();
    await writeFile(join(root, "AGENTS.md"), "a".repeat(100_000), "utf-8");
    await writeFile(join(root, "CLAUDE.md"), "b".repeat(100_000), "utf-8");

    const res = await loadProjectInstructions(root, { budgetBytes: 2_048 });
    assert.ok(res.block.length <= 2_048, `block was ${res.block.length} chars`);
    assert.ok(res.block.includes("truncated"));
    assert.ok(res.files.length >= 1);
  });

  it("defaults to the documented 32 KiB budget", () => {
    assert.equal(PROJECT_INSTRUCTIONS_BUDGET_BYTES, 32 * 1024);
  });

  it("invalidates the cache when files change", async () => {
    const root = workspace();
    await writeFile(join(root, "AGENTS.md"), "first version", "utf-8");
    const first = await loadProjectInstructions(root);
    assert.ok(first.block.includes("first version"));

    // Same size, different content still changes mtime/size signature only
    // when mtime moves; adding a new file is the deterministic case.
    await mkdir(join(root, ".qube", "rules"), { recursive: true });
    await writeFile(join(root, ".qube", "rules", "new.md"), "second version", "utf-8");
    const second = await loadProjectInstructions(root);
    assert.ok(second.block.includes("first version"));
    assert.ok(second.block.includes("second version"));
    assert.ok(second.files.includes(".qube/rules/new.md"));

    // force rebuild returns the same deterministic block.
    const forced = await loadProjectInstructions(root, { force: true });
    assert.equal(forced.block, second.block);
  });
});
