/**
 * Kernel end-to-end: the REAL perceive → act → verify → recover pipeline
 * against a live headless Chrome.
 *
 * Unlike the unit tests (fake probes), this drives:
 * - real page effects via the real auto-mcp browser server (same CDP shapes
 *   as production: navigate / snapshot / act with stale-ref healing),
 * - the real observer probe (observePage: text-hash fingerprint, dialog,
 *   console/network hooks) pointed at the same Chrome,
 * - the real kernel executor (describe → repeat-guard → permission →
 *   verify → recover → log → checkpoint).
 *
 * Skips cleanly when no Chrome binary is found (same policy as
 * browser-act-e2e). Spawns its own ephemeral Chrome + profile; never
 * touches the dev's managed browser on 9222.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { observePage, resolveRefLabel, type ObserverCdp } from "../lib/computer-use/observer";
import { applyKernel } from "../lib/computer-use/executor";
import { StateTracker } from "../lib/computer-use/state";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = join(HERE, "..", "lib", "browser", "auto-mcp", "server.mjs");

function findChromeBinary(): string | null {
  const home = process.env.HOME || tmpdir();
  const list: string[] = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  list.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  );
  try {
    const cache = join(home, ".cache", "ms-playwright");
    for (const e of readdirSync(cache)) {
      if (!e.startsWith("chromium-") || e.includes("headless")) continue;
      list.push(join(cache, e, "chrome-linux", "chrome"));
    }
  } catch {}
  for (const p of list) {
    try {
      if (p && existsSync(p)) return p;
    } catch {}
  }
  return null;
}

let cdpId = 1;
function cdpCall(wsUrl: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 8000 });
    let done = false;
    const id = cdpId++ % 100000;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { ws.close(); } catch {} reject(new Error(`CDP ${method} timeout`)); }
    }, 10000);
    ws.on("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timer);
          done = true;
          try { ws.close(); } catch {}
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.on("error", (e: unknown) => {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    });
  });
}

async function evalIsolated(wsUrl: string, expression: string): Promise<any> {
  try {
    const ctx = await cdpCall(wsUrl, "Page.createIsolatedWorld", { worldName: "qube_e2e", grantUniversalAccess: false });
    const contextId = (ctx as any)?.executionContextId;
    if (contextId) {
      const r = await cdpCall(wsUrl, "Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
      return r?.result?.value;
    }
  } catch {}
  const r = await cdpCall(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
}

function ephemeralCdp(cdpPort: number): ObserverCdp {
  return {
    getPageTarget: async () => {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const targets = (await res.json()) as Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>;
      const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const http = pages.filter((p) => /^https?:\/\//i.test(p.url));
      const best = (http.length ? http : pages).pop();
      return best ? { webSocketDebuggerUrl: best.webSocketDebuggerUrl } : null;
    },
    cdpCall,
    evalIsolated,
  };
}

type McpResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

function mcpClient(proc: ChildProcess) {
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
  async function call(method: string, params: unknown, timeoutMs = 90000): Promise<any> {
    const cur = ++id;
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: cur, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(cur); reject(new Error(`mcp ${method} timeout`)); }, timeoutMs);
      pending.set(cur, (msg) => {
        clearTimeout(t);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
    });
  }
  async function tool(name: string, args: unknown): Promise<string> {
    const r = (await call("tools/call", { name, arguments: args })) as McpResult;
    const text = (r.content || []).map((c) => c.text || "").join("\n");
    if (r.isError) throw new Error(`tool ${name} failed: ${text.slice(0, 500)}`);
    return text;
  }
  return { call, tool };
}

function refFor(tree: string, needle: string): string {
  for (const line of tree.split("\n")) {
    if (line.toLowerCase().includes(needle.toLowerCase())) {
      const m = line.match(/\[(e\d+)\]/);
      if (m) return m[1];
    }
  }
  throw new Error(`no ref for "${needle}" in snapshot tree:\n${tree.slice(0, 800)}`);
}

describe("kernel e2e: real perceive-act-verify-recover loop", () => {
  it("navigates, clicks, verifies change, checkpoints, and blocks repeats", async () => {
    const binary = findChromeBinary();
    if (!binary) {
      console.warn("SKIP kernel-e2e: no Chrome/Chromium binary found");
      return;
    }

    const server: Server = createServer((req, res) => {
      const u = new URL(req.url || "/", "http://local");
      if (u.pathname === "/a") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          `<!doctype html><html><head><title>Page A</title></head><body><h1>Page A</h1><a href="/b">Go to page B</a></body></html>`,
        );
        return;
      }
      if (u.pathname === "/b") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          `<!doctype html><html><head><title>Page B</title></head><body><h1>Page B</h1><div id="state">BEFORE</div><button id="flip">Flip text</button><script>document.getElementById("flip").onclick=function(){document.getElementById("state").textContent="AFTER";};</script></body></html>`,
        );
        return;
      }
      res.writeHead(404).end("nope");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    const profile = mkdtempSync(join(tmpdir(), "qube-kernel-e2e-"));
    let chrome: ChildProcess | null = null;
    let cdpPort = 0;
    for (let i = 0; i < 5; i++) {
      const tryPort = 19411 + Math.floor(Math.random() * 80);
      const proc = spawn(binary, [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--no-first-run", "--no-default-browser-check",
        `--remote-debugging-port=${tryPort}`, `--user-data-dir=${profile}`,
        "--window-size=1280,900", "about:blank",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let ready = false;
      for (let k = 0; k < 40; k++) {
        try {
          const r = await fetch(`http://127.0.0.1:${tryPort}/json/version`);
          if (r.ok) { ready = true; break; }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      if (ready) { chrome = proc; cdpPort = tryPort; break; }
      try { proc.kill("SIGKILL"); } catch {}
    }
    assert.ok(chrome, "headless Chrome did not start");

    const mcp = spawn(process.execPath, [SERVER_MJS, "--cdp-endpoint", `http://127.0.0.1:${cdpPort}`], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = mcpClient(mcp);
    const cdp = ephemeralCdp(cdpPort);

    try {
      await client.call("initialize", {});
      StateTracker.resetForTests();

      const tools: Record<string, any> = {
        browser_navigate: {
          description: "t", inputSchema: {},
          execute: async (args: any) => {
            const t = await client.tool("navigate", { url: String(args?.url || "") });
            return JSON.stringify({ url: String(args?.url || ""), title: "", note: t.slice(0, 200) });
          },
        },
        browser_snapshot: {
          description: "t", inputSchema: {},
          execute: async () => {
            const text = await client.tool("snapshot", {});
            const m = text.match(/^URL:\s*(\S+)/m);
            return JSON.stringify({ url: m ? m[1] : "", tree: text });
          },
        },
        browser_act: {
          description: "t", inputSchema: {},
          execute: async (args: any) => {
            try {
              const t = await client.tool("act", { actions: (args as any)?.actions });
              return JSON.stringify({ ok: true, completed: ((args as any)?.actions || []).length, note: t.slice(0, 200) });
            } catch (e) {
              return JSON.stringify({ error: String((e as Error)?.message || e).slice(0, 500) });
            }
          },
        },
      };
      const wrapped = applyKernel(tools, {
        threadId: "kernel-e2e",
        interactive: true,
        probePage: () => observePage(cdp),
        resolveLabel: (ref) => resolveRefLabel(cdp, ref),
      });
      const run = (name: string, args: unknown) => (wrapped[name] as any).execute(args) as Promise<string>;

      // 1. Navigate to page A → verified with a real pre/post fingerprint diff.
      const navRaw = await run("browser_navigate", { url: `${base}/a` });
      const nav = JSON.parse(navRaw);
      assert.equal(nav._kernel.verdict, "verified", `navigate not verified: ${navRaw.slice(0, 400)}`);
      assert.equal(nav._kernel.changed, true);

      // 2. Snapshot → observe passthrough (no _kernel noise on clean reads).
      const snapRaw = await run("browser_snapshot", {});
      const snap = JSON.parse(snapRaw);
      assert.ok(snap.tree.includes("Go to page B"), `link missing:\n${snap.tree.slice(0, 400)}`);
      assert.equal(snap._kernel, undefined);
      const linkRef = refFor(snap.tree, "Go to page B");

      // 3. Click the link → verified page change to /b + navigation checkpoint.
      const actRaw = await run("browser_act", { actions: [{ kind: "click", ref: linkRef }] });
      const act = JSON.parse(actRaw);
      assert.equal(act._kernel.verdict, "verified", `click not verified: ${actRaw.slice(0, 500)}`);
      const state = StateTracker.forThread("kernel-e2e");
      assert.ok(state.checkpoints.some((c) => c.label.includes("/b")), `no /b checkpoint: ${JSON.stringify(state.checkpoints)}`);

      // 4. In-page change without navigation: flip text → textHash diff verifies.
      const snap2 = JSON.parse(await run("browser_snapshot", {}));
      const flipRef = refFor(snap2.tree, "Flip text");
      const flipRaw = await run("browser_act", { actions: [{ kind: "click", ref: flipRef }] });
      const flip = JSON.parse(flipRaw);
      assert.equal(flip._kernel.verdict, "verified", `flip not verified: ${flipRaw.slice(0, 500)}`);
      assert.ok((flip._kernel.signals || []).includes("text_changed"), `no text_changed signal: ${flipRaw.slice(0, 400)}`);

      // 5. Bogus ref twice → failed with recovery hint; third identical → blocked.
      const bad = { actions: [{ kind: "click", ref: "e999" }] };
      const f1 = JSON.parse(await run("browser_act", bad));
      assert.equal(f1._kernel.verdict, "failed", `bogus ref should fail: ${JSON.stringify(f1).slice(0, 300)}`);
      assert.ok((f1._kernel.hints || []).length > 0, "failed action should carry a recovery hint");
      await run("browser_act", bad);
      const f3 = JSON.parse(await run("browser_act", bad));
      assert.equal(f3.blocked, "repeat_failure", `third repeat should block: ${JSON.stringify(f3).slice(0, 300)}`);

      StateTracker.resetForTests();
    } finally {
      try { mcp.kill("SIGTERM"); } catch {}
      try { chrome?.kill("SIGKILL"); } catch {}
      await new Promise<void>((r) => server.close(() => r()));
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  });
});
