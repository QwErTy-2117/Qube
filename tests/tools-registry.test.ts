/**
 * Tool registry regression tests.
 *
 * `createPiTools` is the only place the harness gets its file/shell tool
 * surface. A truncated edit once left `list_directory` returning a single
 * entry object instead of the listing, and left `dev_server` registered
 * after the `return` (so it never existed). Both are contract-level bugs
 * that type-checking cannot see, so they are locked here.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspace: string;
let tools: Record<string, any>;

before(async () => {
  workspace = mkdtempSync(join(tmpdir(), "qube-tools-"));
  process.env.WORKSPACE_PATH = workspace;
  process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-tools-data-"));
  const mod = await import("@/lib/pi/tools");
  // Headless like a subagent: no questions, no approval modals.
  tools = mod.createPiTools("test-thread", { includeAskUser: false }) as Record<string, any>;
});

after(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("tool registry", () => {
  it("registers the full workspace surface", () => {
    for (const name of [
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
      "list_directory",
      "run_command",
      "web_search",
      "web_fetch",
      "present_file",
      "dev_server",
      "dev_server_log",
    ]) {
      assert.ok(tools[name], `${name} is missing from createPiTools`);
    }
  });

  it("omits interactive-only tools in headless runs", () => {
    assert.equal(tools.ask_question, undefined);
    assert.ok(tools.TodoWrite, "TodoWrite should still be available");
  });
});

describe("list_directory", () => {
  it("returns the whole listing as JSON", async () => {
    mkdirSync(join(workspace, "docs"), { recursive: true });
    writeFileSync(join(workspace, "docs", "a.txt"), "hello");
    writeFileSync(join(workspace, "docs", "b.txt"), "world!");

    const raw = await tools.list_directory.execute({ path: "docs" });
    assert.equal(typeof raw, "string", "list_directory must return JSON text, not an object");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.totalItems, 2);
    assert.equal(parsed.truncated, false);
    assert.deepEqual(parsed.items.map((i: any) => i.name).sort(), ["a.txt", "b.txt"]);
    const file = parsed.items.find((i: any) => i.name === "b.txt");
    assert.equal(file.type, "file");
    assert.equal(file.size, 6);
    assert.ok(file.normalizedPath.endsWith("b.txt"));
  });

  it("reports a missing directory as a JSON error instead of throwing", async () => {
    const raw = await tools.list_directory.execute({ path: "nope" });
    const parsed = JSON.parse(raw);
    assert.ok(parsed.error);
  });
});

describe("run_command", () => {
  it("captures stdout and stderr", async () => {
    const raw = await tools.run_command.execute({ command: "echo qube-tools-test" });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.exitCode, 0);
    assert.match(parsed.stdout, /qube-tools-test/);
  });
});

describe("dev_server", () => {
  it("refuses non-local URLs", async () => {
    const raw = await tools.dev_server.execute({ command: "npm run dev", url: "https://example.com" });
    const parsed = JSON.parse(raw);
    assert.match(parsed.error, /localhost/i);
  });

  it("stops a server that was never started", async () => {
    const raw = await tools.dev_server.execute({ command: "npm run dev", url: "http://localhost:3010", stop: true });
    assert.equal(JSON.parse(raw).stopped, false);
  });

  it("reads an empty log for an unknown command", async () => {
    const raw = await tools.dev_server_log.execute({ command: "nothing ran" });
    assert.deepEqual(JSON.parse(raw).lines, []);
  });
});
