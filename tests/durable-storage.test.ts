/**
 * Durable storage singleton test.
 * Run: npx tsx --test tests/durable-storage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-durable-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable storage singleton", () => {
  it("opens SQLite and resumes same root across reopen", async () => {
    const h1 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root1 = await h1.root(BACKGROUND_CONTEXT);
    const id1 = root1.id;
    await closeDurableHarness(BACKGROUND_CONTEXT);
    const h2 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root2 = await h2.root(BACKGROUND_CONTEXT);
    assert.equal(root2.id, id1);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });

  it("resolves workspace tools and skills sections on the root agent", async () => {
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h.root(BACKGROUND_CONTEXT);
    const agent = await root.agent(BACKGROUND_CONTEXT);
    const extNames = agent.extensions.map((e) => e.name);
    assert.ok(extNames.includes("workspace"), `extensions: ${extNames.join(",")}`);
    assert.ok(extNames.includes("skills"), `extensions: ${extNames.join(",")}`);
    assert.ok(extNames.includes("memory"), `extensions: ${extNames.join(",")}`);
    assert.ok(extNames.includes("goals"), `extensions: ${extNames.join(",")}`);
    const toolNames = agent.tools.map((t) => t.name);
    assert.ok(toolNames.includes("read_file"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("read_memory"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("save_memory"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("TodoWrite"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("web_search"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("web_fetch"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("edit_file"), `tools: ${toolNames.join(",")}`);
    assert.ok(toolNames.includes("list_directory"), `tools: ${toolNames.join(",")}`);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
