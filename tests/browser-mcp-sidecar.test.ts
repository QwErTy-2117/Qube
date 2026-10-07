/**
 * Regression test for "browser use MCP fails to start" in the Windows
 * production build.
 *
 * Production runs the Next server from a sidecar copy (cwd = sidecar root,
 * node = <sidecar>/node-bin/node(.exe)) — NOT the repo root. This test
 * rebuilds that layout in a temp dir (script + `ws` + node binary), chdirs
 * into it, and runs the REAL startup path: resolve command/args → spawn
 * via @ai-sdk/mcp stdio transport → tools/list. If the bundle is missing
 * the script or `ws`, or path resolution breaks, tools fail to load here
 * exactly as they do in production.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SIDECAR = join(tmpdir(), `qube-mcp-sidecar-test-${process.pid}`);
const SCRIPT_REL = join("lib", "browser", "auto-mcp", "server.mjs");

function stageSidecarLayout() {
  rmSync(SIDECAR, { recursive: true, force: true });
  mkdirSync(join(SIDECAR, "lib", "browser", "auto-mcp"), { recursive: true });
  mkdirSync(join(SIDECAR, "node_modules"), { recursive: true });
  mkdirSync(join(SIDECAR, "node-bin"), { recursive: true });
  // Same files scripts/build-sidecar.js must ship (it fails the build if absent).
  cpSync(join(root, SCRIPT_REL), join(SIDECAR, SCRIPT_REL));
  cpSync(join(root, "node_modules", "ws"), join(SIDECAR, "node_modules", "ws"), { recursive: true });
  // Stand in for the bundled runtime. Deliberately a 0-byte placeholder, NOT
  // a copy of process.execPath: nothing under test executes it (spawn uses
  // the real binary; resolution only joins dirname(execPath)), and copying
  // ~100MB through Windows Defender on every CI run would be pure waste.
  writeFileSync(join(SIDECAR, "node-bin", process.platform === "win32" ? "node.exe" : "node"), "");
}

describe("browser-mcp production sidecar layout", () => {
  let savedCwd = "";
  before(() => {
    stageSidecarLayout();
    savedCwd = process.cwd();
    process.chdir(SIDECAR);
  });
  after(() => {
    try {
      process.chdir(savedCwd);
    } catch {}
    // Best-effort: on Windows a just-exited MCP child can briefly hold a
    // file lock; teardown must never fail green tests over that flake.
    // Staging starts with a force rmSync, so leftovers are cleaned next run.
    try {
      rmSync(SIDECAR, { recursive: true, force: true });
    } catch {}
  });

  it("resolves the MCP script inside the sidecar dir", async () => {
    const { resolveMcpScriptPath } = await import("@/lib/pi/browser-mcp");
    const p = resolveMcpScriptPath();
    assert.ok(existsSync(p), `resolved script must exist, got ${p}`);
    assert.equal(p, join(SIDECAR, SCRIPT_REL));
  });

  it("built-in server starts and lists tools from sidecar cwd", async () => {
    const { getBuiltInMcpServers } = await import("@/lib/pi/browser-mcp");
    const servers = getBuiltInMcpServers();
    assert.equal(servers.length, 1);
    assert.ok(existsSync(servers[0].args[0]), `script exists at ${servers[0].args[0]}`);
    const { getMcpToolsForServers, closeMcpClients } = await import("@/lib/pi/mcp");
    const { tools, clients, errors } = await getMcpToolsForServers(servers);
    try {
      assert.deepEqual(errors, [], `expected no load errors, got ${JSON.stringify(errors)}`);
      assert.ok(Object.keys(tools).length > 5, `expected browser tools, got ${Object.keys(tools).length}`);
    } finally {
      await closeMcpClients(clients);
    }
  });

  it("falls back to the bundled-node location when cwd is wrong", async () => {
    // Windows service launches can leave cwd outside the sidecar copy
    // (e.g. System32). Resolution must then find the script via the
    // bundled node binary at <sidecar>/node-bin/node(.exe).
    const { resolveMcpScriptPath } = await import("@/lib/pi/browser-mcp");
    const nodeBin = join(SIDECAR, "node-bin", process.platform === "win32" ? "node.exe" : "node");
    const p = resolveMcpScriptPath(join(tmpdir(), "qube-mcp-bogus-cwd"), nodeBin);
    assert.equal(p, join(SIDECAR, SCRIPT_REL));
  });

  it("returns an actionable cwd-based path when the script is missing everywhere", async () => {
    const { resolveMcpScriptPath } = await import("@/lib/pi/browser-mcp");
    const bogusCwd = join(tmpdir(), "qube-mcp-bogus-cwd");
    const p = resolveMcpScriptPath(bogusCwd, join(tmpdir(), "qube-mcp-bogus-node"));
    assert.equal(p, join(bogusCwd, SCRIPT_REL));
  });
});
