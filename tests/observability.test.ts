/**
 * Observability read path: what gets logged can be read back (per-thread,
 * global, filtered, counted) and served over HTTP.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/observability.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-obs-test-"));

import {
  logEvent,
  queryObservability,
  getGlobalRecent,
  getStats,
} from "../lib/agent/observability";
import { GET } from "../app/api/observability/route";

function get(url: string): Promise<Response> {
  return GET(new Request(`http://localhost${url}`) as never);
}

describe("observability readback", () => {
  it("round-trips logged events per thread with type filters", async () => {
    const thread = `obs-thread-${Date.now()}`;
    await logEvent({ threadId: thread, type: "computer_action", status: "success", metadata: { tool: "browser_act" } });
    await logEvent({ threadId: thread, type: "computer_action", status: "error", metadata: { tool: "browser_act" } });
    await logEvent({ threadId: thread, type: "checkpoint", metadata: { label: "Reached x" } });
    const all = await queryObservability(thread);
    assert.equal(all.length, 3);
    const actions = await queryObservability(thread, { type: "computer_action" });
    assert.equal(actions.length, 2);
    assert.ok(actions.every((e) => e.metadata?.tool === "browser_act"));
    const limited = await queryObservability(thread, { limit: 1 });
    assert.equal(limited.length, 1);
  });

  it("serves global recent and stats", async () => {
    const thread = `obs-global-${Date.now()}`;
    await logEvent({ threadId: thread, type: "computer_action", status: "error", metadata: {} });
    const recent = await getGlobalRecent(10);
    assert.ok(recent.some((e) => e.threadId === thread));
    const stats = await getStats(thread);
    assert.equal(stats.total, 1);
    assert.equal(stats.byType.computer_action, 1);
    assert.equal(stats.errors, 1);
    assert.deepEqual(await queryObservability("no-such-thread"), []);
    assert.deepEqual(await getStats("no-such-thread"), { total: 0, byType: {}, errors: 0 });
  });

  it("serves events over HTTP with filters", async () => {
    const thread = `obs-http-${Date.now()}`;
    await logEvent({ threadId: thread, type: "computer_action", status: "success", metadata: {} });
    const res = await get(`/api/observability?threadId=${thread}&type=computer_action`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.threadId, thread);
    assert.equal(body.events.length, 1);
    const statsRes = await get(`/api/observability?threadId=${thread}&stats=1`);
    assert.equal((await statsRes.json()).stats.total, 1);
    const global = await get(`/api/observability?limit=5`);
    assert.equal(global.status, 200);
    assert.ok(Array.isArray((await global.json()).events));
  });
});
