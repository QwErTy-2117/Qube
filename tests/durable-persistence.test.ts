import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-persist-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { Todos } from "@/lib/pi/durable-docs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable persistence", () => {
  it("persists entries and docs across close and reopen", async () => {
    const h1 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h1.root(BACKGROUND_CONTEXT);
    const convId = root.id;
    await root.commit(async (tx) => {
      await tx.appendEntry(convId, { kind: "app.note", data: { text: "hello-persist" } });
      (await tx.doc(Todos, convId)).items.push("persisted-todo");
    }, BACKGROUND_CONTEXT);
    await closeDurableHarness(BACKGROUND_CONTEXT);

    const h2 = await getDurableHarness(BACKGROUND_CONTEXT);
    const snap = await h2.snapshot(Todos, convId, BACKGROUND_CONTEXT);
    assert.deepEqual([...(snap?.items ?? [])], ["persisted-todo"]);
    const root2 = await h2.root(BACKGROUND_CONTEXT);
    assert.equal(root2.id, convId);
    const page = await root2.commit(
      (tx) => tx.scanEntries({ conversationId: convId, order: "ascending" }, 50),
      BACKGROUND_CONTEXT,
    );
    assert.ok(page.items.some((e) => e.kind === "app.note"));
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
