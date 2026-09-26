import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = join(HERE, "..", "lib", "browser", "auto-mcp", "server.mjs");

// Mirror of managed-chrome candidate lookup (sync, test-local).
function findChromeBinary(): string | null {
  const home = process.env.HOME || tmpdir();
  const list: string[] = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  list.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome"
  );
  try {
    const cache = join(home, ".cache", "ms-playwright");
    for (const e of readdirSync(cache)) {
      if (!e.startsWith("chromium-") || e.includes("headless")) continue;
      list.push(join(cache, e, "chrome-linux", "chrome"));
      list.push(join(cache, e, "chrome-linux64", "chrome"));
    }
  } catch {}
  for (const p of list) {
    try {
      if (p && existsSync(p)) return p;
    } catch {}
  }
  return null;
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
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
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
      const t = setTimeout(() => {
        pending.delete(cur);
        reject(new Error(`mcp ${method} timeout`));
      }, timeoutMs);
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

describe("browser act e2e: Amazon-style continuous re-render", () => {
  it("clicks a rotating product link and Add to Cart without model round-trips", async () => {
    const binary = findChromeBinary();
    if (!binary) {
      console.warn("SKIP browser-act-e2e: no Chrome/Chromium binary found");
      return;
    }

    // Fixture store mimicking Amazon: search page re-renders every 350ms
    // (wiping data-qube-ref attrs, rotating ?qid= tokens AND prices, so both
    // names and hrefs drift between snapshot and click).
    const cart: string[] = [];
    const server = createServer((req, res) => {
      const u = new URL(req.url || "/", "http://local");
      if (u.pathname === "/" || u.pathname === "/s") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html><head><title>Test Store Search</title></head><body>
<h1>Results for "keyboard"</h1>
<div id="results"></div>
<script>
let qid = 0;
function render(){
  qid++;
  const price = (10 + (qid % 5)) + ".99";
  document.getElementById("results").innerHTML = [
    {asin:"B001AAAA01", name:"Keyboard Alpha"},
    {asin:"B002BBBB02", name:"Keyboard Beta"},
    {asin:"B003CCCC03", name:"Keyboard Gamma"}
  ].map(p => '<div class="item"><a href="/dp/'+p.asin+'?psc=1&qid='+qid+'&sr=1-1">'+p.name+' $'+price+'</a></div>').join("");
}
render();
setInterval(render, 350);
</script>
</body></html>`);
        return;
      }
      const dp = u.pathname.match(/^\/dp\/([A-Za-z0-9]{10})/);
      if (dp) {
        const asin = dp[1];
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html><head><title>Product ${asin}</title></head><body>
<h1>Product ${asin}</h1><div id="buy"></div>
<script>
function render(){ document.getElementById("buy").innerHTML = '<button id="add">Add to Cart</button>'; document.getElementById("add").onclick = function(){ fetch("/cart/add?asin=${asin}",{method:"POST"}).then(function(){ location.href="/cart"; }); }; }
render();
setInterval(render, 400);
</script>
</body></html>`);
        return;
      }
      if (u.pathname === "/cart/add" && req.method === "POST") {
        const asin = u.searchParams.get("asin") || "";
        if (asin && !cart.includes(asin)) cart.push(asin);
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
        return;
      }
      if (u.pathname === "/cart") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html><head><title>Cart</title></head><body><h1>Shopping Cart</h1><ul>${cart.map((a) => `<li>${a}</li>`).join("")}</ul></body></html>`);
        return;
      }
      res.writeHead(404).end("nope");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;

    // Ephemeral headless Chrome with its own debugging port (never touches
    // the dev's managed browser on 9222).
    const profile = mkdtempSync(join(tmpdir(), "qube-e2e-prof-"));
    let cdpPort = 19311;
    let chrome: ChildProcess | null = null;
    for (let i = 0; i < 5; i++) {
      const tryPort = 19311 + Math.floor(Math.random() * 80);
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
      if (ready) {
        chrome = proc;
        cdpPort = tryPort;
        break;
      }
      try { proc.kill("SIGKILL"); } catch {}
    }
    assert.ok(chrome, "headless Chrome did not start");

    const mcp = spawn(process.execPath, [SERVER_MJS, "--cdp-endpoint", `http://127.0.0.1:${cdpPort}`], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = mcpClient(mcp);
    try {
      await client.call("initialize", {});
      await client.tool("navigate", { url: `${base}/s?k=keyboard` });
      await new Promise((r) => setTimeout(r, 1200));

      // Click a ref and wait for the expected navigation to commit. A single
      // snapshot right after act races navigation on loaded CI runners (act
      // returns after a fixed 250ms settle, but commit can take longer), so
      // poll for the URL instead. If the click missed (mid-render re-resolve
      // at stale coords), retry with fresh refs — the same same-turn retry
      // the agent itself performs with the fresh snapshot in act errors.
      async function clickAndWaitForUrl(needle: string, expectUrl: string): Promise<string> {
        const deadline = Date.now() + 30000;
        let lastAct = "(no act attempted)";
        let tree = "";
        while (Date.now() < deadline) {
          tree = await client.tool("snapshot", {});
          if (tree.includes(expectUrl)) return tree;
          const ref = refFor(tree, needle);
          try {
            lastAct = await client.tool("act", { actions: [{ kind: "click", ref }] });
          } catch (e) {
            // act errors already carry a fresh snapshot for a same-turn
            // retry — loop around and re-resolve from a new snapshot.
            lastAct = `act error: ${String((e as Error)?.message || e).slice(0, 300)}`;
            continue;
          }
          assert.match(lastAct, /Acted 1\/1/, `click on "${needle}" failed: ${lastAct.slice(0, 300)}`);
          assert.ok(!/vanished mid-action/i.test(lastAct), "click needed a model round-trip");
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 250));
            tree = await client.tool("snapshot", {});
            if (tree.includes(expectUrl)) return tree;
          }
        }
        throw new Error(`never reached ${expectUrl} after clicking "${needle}". Last act: ${lastAct.slice(0, 300)}. Last tree:\n${tree.slice(0, 500)}`);
      }

      // 1. Click a product link while the page re-renders under us.
      let tree = await clickAndWaitForUrl("Keyboard Alpha", "/dp/B001AAAA01");
      assert.ok(tree.includes("/dp/B001AAAA01"), `not on product page:\n${tree.slice(0, 500)}`);

      // 2. Add to Cart on a page whose button node is replaced every 400ms.
      tree = await clickAndWaitForUrl("Add to Cart", "/cart");
      assert.ok(tree.includes("/cart"), `not on cart page:\n${tree.slice(0, 500)}`);
      assert.ok(tree.includes("B001AAAA01"), `cart missing asin:\n${tree.slice(0, 800)}`);
    } finally {
      try { mcp.kill("SIGTERM"); } catch {}
      try { chrome?.kill("SIGKILL"); } catch {}
      await new Promise<void>((r) => server.close(() => r()));
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  });
});
