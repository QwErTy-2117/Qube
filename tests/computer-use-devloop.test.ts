import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import {
  waitForHttp,
  startDevServer,
  devServerLog,
  stopDevServer,
  listDevServers,
  resetDevServersForTests,
} from "../lib/computer-use/devloop";
import { describeAction } from "../lib/computer-use/catalog";

describe("devloop waitForHttp", () => {
  it("resolves when a server responds", async () => {
    const srv = createServer((_req, res) => { res.statusCode = 200; res.end("ok"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    try {
      const w = await waitForHttp(`http://127.0.0.1:${port}/`, 5000);
      assert.equal(w.ok, true);
      assert.equal(w.status, 200);
    } finally {
      srv.close();
    }
  });
  it("times out cleanly when nothing listens", async () => {
    const w = await waitForHttp("http://127.0.0.1:1/", 1200);
    assert.equal(w.ok, false);
  });
});

describe("devloop server registry", () => {
  it("starts, reuses, logs, and stops", () => {
    resetDevServersForTests();
    const a = startDevServer("/tmp", "sleep 60", "http://localhost:9999/");
    const b = startDevServer("/tmp", "sleep 60", "http://localhost:9999/");
    assert.equal(a.pid, b.pid);
    assert.equal(listDevServers().length, 1);
    assert.equal(stopDevServer("/tmp", "sleep 60"), true);
    try { process.kill(a.pid, "SIGKILL"); } catch {}
    resetDevServersForTests();
    assert.deepEqual(devServerLog("/tmp", "sleep 60"), []);
  });
  it("catalogs dev_server tools as terminal", () => {
    assert.equal(describeAction("dev_server", { command: "npm run dev" }).domain, "terminal");
    assert.equal(describeAction("dev_server_log", {}).kind, "observe");
  });
});
