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
} from "@/lib/dev-server/devloop";

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
  it("starts, reuses, logs, and stops", async () => {
    resetDevServersForTests();
    const { EventEmitter } = await import("node:events");
    const { setSpawnForTests } = await import("@/lib/dev-server/devloop");
    const fake = () => {
      const proc: any = new EventEmitter();
      proc.pid = 4242;
      proc.exitCode = null;
      proc.killed = false;
      proc.kill = () => { proc.killed = true; proc.exitCode = 0; return true; };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    };
    setSpawnForTests(fake as never);
    try {
      const a = startDevServer("/tmp", "npm run dev", "http://localhost:9999/");
      const b = startDevServer("/tmp", "npm run dev", "http://localhost:9999/");
      assert.equal(a.pid, b.pid);
      assert.equal(listDevServers().length, 1);
      assert.equal(stopDevServer("/tmp", "npm run dev"), true);
    } finally {
      const { spawn } = await import("node:child_process");
      setSpawnForTests(spawn);
      resetDevServersForTests();
    }
    assert.deepEqual(devServerLog("/tmp", "npm run dev"), []);
  });
  it("catalogs dev_server tools as terminal", () => {
  });
});
