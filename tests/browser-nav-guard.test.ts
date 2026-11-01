/**
 * MCP browser URL gates: navigate / open_tab / download reject dangerous
 * targets BEFORE touching CDP, so these tests need no browser — only the
 * stdio server process.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/browser-nav-guard.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = join(HERE, "..", "lib", "browser", "auto-mcp", "server.mjs");

function startServer(): { proc: ChildProcess; call: (method: string, params: unknown) => Promise<any>; stop: () => void } {
  const proc = spawn(process.execPath, [SERVER_MJS], { stdio: ["pipe", "pipe", "pipe"] });
  let id = 0;
  const pending = new Map<number, (msg: any) => void>();
  let buf = "";
  proc.stdout!.on("data", (c: Buffer) => {
    buf += c.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    }
  });
  const call = (method: string, params: unknown): Promise<any> => {
    const cur = ++id;
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: cur, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(cur); reject(new Error(`mcp ${method} timeout`)); }, 15000);
      pending.set(cur, (msg) => {
        clearTimeout(t);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
    });
  };
  return { proc, call, stop: () => { try { proc.kill("SIGKILL"); } catch {} } };
}

describe("mcp browser url gates (no browser needed)", () => {
  it("rejects metadata, scheme, and credential URLs on navigate/open_tab/download", async () => {
    const { proc, call, stop } = startServer();
    try {
      await call("initialize", {});
      for (const tool of ["navigate", "open_tab", "download"]) {
        for (const url of [
          "http://169.254.169.254/latest/meta-data/",
          "http://metadata.google.internal/computeMetadata/v1/",
          "file:///etc/passwd",
          "javascript:alert(1)",
          "https://user:pass@example.com/",
        ]) {
          const args = tool === "download" ? { url } : { url };
          const res = (await call("tools/call", { name: tool, arguments: args })) as {
            content?: Array<{ text?: string }>;
            isError?: boolean;
          };
          assert.equal(res.isError, true, `${tool} ${url} should fail`);
          const text = (res.content || []).map((c) => c.text || "").join(" ");
          assert.match(text, /Blocked|valid url|credentials|metadata|Invalid URL/i, `${tool} ${url}: ${text.slice(0, 160)}`);
        }
      }
    } finally {
      stop();
    }
    void proc;
  });

  it("still lists tools (gate did not break the server)", async () => {
    const { call, stop } = startServer();
    try {
      await call("initialize", {});
      const list = (await call("tools/list", {})) as { tools: Array<{ name: string }> };
      for (const name of ["navigate", "open_tab", "download", "tabs", "act"]) {
        assert.ok(list.tools.some((t) => t.name === name), `missing tool ${name}`);
      }
    } finally {
      stop();
    }
  });
});
