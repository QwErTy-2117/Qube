/**
 * Foreground Pi tool integration tests.
 *
 * These exercise the real tool implementations (not mocks) for the three
 * properties the harness depends on during long runs:
 *   - shell timeouts are bounded and reported (not thrown),
 *   - oversized command output is spilled and pageable end-to-end,
 *   - read_file paginates instead of returning an unbounded file.
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "qube-tools-test-"));
const workspace = mkdtempSync(join(tmpdir(), "qube-tools-ws-"));
process.env.QUBE_DATA_DIR = dataDir;
process.env.WORKSPACE_PATH = workspace;

// Dynamic import: workspace.ts freezes WORKSPACE_PATH at module load, so the
// env vars above must be set before the module graph is evaluated.
let createPiTools: typeof import("@/lib/pi/tools").createPiTools;
before(async () => {
  ({ createPiTools } = await import("@/lib/pi/tools"));
});

function tools() {
  return createPiTools("test_thread", { includeAskUser: false, includeSubagents: false });
}

async function exec(name: string, input: Record<string, unknown>): Promise<any> {
  const t = (tools() as any)[name];
  assert.ok(t, `missing tool ${name}`);
  const out = await t.execute(input);
  return typeof out === "string" ? JSON.parse(out) : out;
}

describe("run_command bounds", () => {
  it("times out and reports instead of hanging", async () => {
    const parsed = await exec("run_command", { command: "sleep 5", timeoutMs: 1000 });
    assert.equal(parsed.timedOut, true);
    assert.notEqual(parsed.exitCode, 0);
    assert.match(String(parsed.error || ""), /Timeout after 1000ms/);
  });

  it("spills oversized output and pages it back with read_tool_output", async () => {
    const parsed = await exec("run_command", {
      command: `node -e "process.stdout.write('x'.repeat(20000))"`,
      timeoutMs: 30_000,
    });
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.stdout.length, 12_000);
    assert.ok(parsed.outputId);

    const first = await exec("read_tool_output", { id: parsed.outputId, maxChars: 30_000 });
    // The spill contains a small command header; all of it must be pageable.
    assert.ok(first.totalChars >= 20_000);
    assert.equal(first.content.length, first.totalChars);
    assert.equal(first.nextOffset, null);

    const middle = await exec("read_tool_output", { id: parsed.outputId, offset: 12_000, maxChars: 30_000 });
    assert.equal(middle.content.length, first.totalChars - 12_000);
    assert.equal(middle.eof, true);
  });

  it("rejects an invalid spill id without touching the filesystem", async () => {
    const parsed = await exec("read_tool_output", { id: "../escape" });
    assert.match(String(parsed.error || ""), /Invalid tool output id/);
  });
});

describe("read_file pagination", () => {
  it("returns a bounded page with nextOffset", async () => {
    mkdirSync(join(workspace, "src"), { recursive: true });
    const lines = Array.from({ length: 3_000 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(workspace, "src", "big.txt"), lines.join("\n"), "utf-8");

    const page = await exec("read_file", { path: "src/big.txt", offset: 100, limit: 10 });
    assert.equal(page.startLine, 100);
    assert.equal(page.endLine, 109);
    assert.equal(page.content.split("\n").length, 10);
    assert.equal(page.content.split("\n")[0], "line 100");
    assert.equal(page.nextOffset, 110);
    assert.equal(page.truncated, true);
    assert.equal(page.lineCount, 3_000);

    const last = await exec("read_file", { path: "src/big.txt", offset: 2_991, limit: 10 });
    assert.equal(last.endLine, 3_000);
    assert.equal(last.nextOffset, null);
    assert.equal(last.truncated, false);
  });
});
