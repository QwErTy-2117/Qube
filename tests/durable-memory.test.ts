import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-dmem-test-"));
import { readMemoryTool, saveMemoryTool } from "@/lib/pi/durable-registry";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-1" } as never;

function outputText(result: unknown): string {
  const out = (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
  return out;
}

describe("durable memory tools", () => {
  it("saves and recalls a memory", async () => {
    const saved = JSON.parse(outputText(await saveMemoryTool.execute(
      { category: "preference", content: "User prefers short answers" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(saved.saved, true);
    const found = JSON.parse(outputText(await readMemoryTool.execute(
      { query: "user answer preferences" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.ok(Array.isArray(found.entries) && found.entries.length >= 1);
    assert.ok(found.entries.some((e: { id: string }) => e.id === saved.id));
  });

  it("blocks secrets from persistence", async () => {
    const res = JSON.parse(outputText(await saveMemoryTool.execute(
      { category: "general", content: "My key is sk-live-abcdefgh12345678" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(res.saved, false);
    assert.match(String(res.error || ""), /blocked/i);
  });
});
