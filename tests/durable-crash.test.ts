import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-crash-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable crash resume", () => {
  it("same requestId returns same submission after reopen", async () => {
    const h1 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h1.root(BACKGROUND_CONTEXT);
    const s1 = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" } as never, BACKGROUND_CONTEXT);
    await closeDurableHarness(BACKGROUND_CONTEXT);
    const h2 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root2 = await h2.root(BACKGROUND_CONTEXT);
    const s2 = await root2.submit({ type: "input", content: "Hello", requestId: "greeting-1" } as never, BACKGROUND_CONTEXT);
    assert.equal(s2.id, s1.id);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
