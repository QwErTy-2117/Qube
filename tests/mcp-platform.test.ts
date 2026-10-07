/**
 * Regression tests for "browser use MCP fails to start" on Windows
 * production: @ai-sdk/mcp spawns with `shell: false`, so bare `node` and
 * npm shims (.CMD/.BAT) fail with ENOENT unless normalized. These pin the
 * Windows-only branches of normalizeMcpServerForPlatform via its injected
 * `platform` parameter (runnable on any OS).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeMcpServerForPlatform } from "@/lib/pi/mcp";

const WIN_NODE = "C:\\Users\\runner\\Temp\\qube-sidecar\\node-bin\\node.exe";
const WIN_SCRIPT = "C:\\Users\\runner\\Temp\\qube-sidecar\\lib\\browser\\auto-mcp\\server.mjs";

describe("normalizeMcpServerForPlatform (windows)", () => {
  it("leaves the absolute bundled node.exe + script untouched", () => {
    const out = normalizeMcpServerForPlatform(
      { id: "qube-browser-use", name: "Browser Use", command: WIN_NODE, args: [WIN_SCRIPT], env: {} },
      "win32",
    );
    assert.equal(out.command, WIN_NODE);
    assert.deepEqual(out.args, [WIN_SCRIPT]);
  });

  it("wraps bare npx shims in cmd.exe so they resolve without a shell", () => {
    const out = normalizeMcpServerForPlatform(
      { id: "x", name: "X", command: "npx", args: ["-y", "mcp"], env: {} },
      "win32",
    );
    assert.equal(out.command, process.env.ComSpec || "cmd.exe");
    assert.deepEqual(out.args, ["/d", "/s", "/c", "npx -y mcp"]);
  });

  it("wraps explicit .cmd shims in cmd.exe", () => {
    const out = normalizeMcpServerForPlatform(
      { id: "x", name: "X", command: "C:\\tools\\obu.cmd", args: ["mcp"], env: {} },
      "win32",
    );
    assert.equal(out.command, process.env.ComSpec || "cmd.exe");
    assert.ok(out.args[3].includes("obu.cmd"));
  });

  it("resolves bare node to the absolute running binary", () => {
    const out = normalizeMcpServerForPlatform(
      { id: "x", name: "X", command: "node", args: ["mcp"], env: {} },
      "win32",
    );
    assert.equal(out.command, process.execPath);
  });

  it("leaves non-windows platforms untouched", () => {
    const srv = { id: "x", name: "X", command: "npx", args: ["-y", "mcp"], env: {} };
    const out = normalizeMcpServerForPlatform(srv, "linux");
    assert.equal(out.command, "npx");
    assert.deepEqual(out.args, ["-y", "mcp"]);
  });
});
