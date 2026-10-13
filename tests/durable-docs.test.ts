import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-docs-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { Todos, seedDurableDocs } from "@/lib/pi/durable-docs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable docs", () => {
  it("seeds and reads todos doc", async () => {
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h.root(BACKGROUND_CONTEXT);
    await root.commit(async (tx) => { await seedDurableDocs(tx, root.id); }, BACKGROUND_CONTEXT);
    const snap = await h.snapshot(Todos, root.id, BACKGROUND_CONTEXT);
    assert.deepEqual(snap, { items: [] });
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
