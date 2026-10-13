import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGuardBeforeTool, isSensitiveDurableTool } from "@/lib/pi/durable-guard";
import { buildGuardExtension } from "@/lib/pi/durable-guard";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

function fakeMemoApi(store = new Map<string, unknown>()) {
  return {
    store,
    // Mirrors HookApi overloads: memo(name, context) reads,
    // memo(name, candidate, context) writes first-wins.
    memo: async function (name: string, ...rest: unknown[]) {
      if (rest.length <= 1) return store.get(name) as never;
      const candidate = rest[0];
      if (!store.has(name)) store.set(name, candidate);
      return store.get(name) as never;
    },
  };
}

describe("durable guard", () => {
  it("classifies sensitive tools like the foreground policy", () => {
    assert.equal(isSensitiveDurableTool("read_file"), false);
    assert.equal(isSensitiveDurableTool("read_memory"), false);
    assert.equal(isSensitiveDurableTool("TodoWrite"), false);
    assert.equal(isSensitiveDurableTool("delete_file"), true);
    assert.equal(isSensitiveDurableTool("computer_click"), true);
    assert.equal(isSensitiveDurableTool("computer_list_apps"), false);
    assert.equal(isSensitiveDurableTool("gmail_send_email"), true);
    assert.equal(isSensitiveDurableTool("gmail_search"), false);
  });

  it("allows clean tools without touching memo", async () => {
    const api = fakeMemoApi();
    const out = await createGuardBeforeTool()({ name: "read_file", arguments: { path: "a" } }, api as never, BACKGROUND_CONTEXT);
    assert.equal(out, undefined);
    assert.equal(api.store.size, 0);
  });

  it("denies sensitive tools and reuses the memoized denial", async () => {
    const api = fakeMemoApi();
    const handler = createGuardBeforeTool();
    const first = await handler({ name: "delete_file", arguments: { path: "x" } }, api as never, BACKGROUND_CONTEXT);
    assert.match(String(first?.block || ""), /Approval required/);
    const second = await handler({ name: "delete_file", arguments: { path: "x" } }, api as never, BACKGROUND_CONTEXT);
    assert.match(String(second?.block || ""), /denied earlier/);
  });

  it("honors a memoized approval", async () => {
    const api = fakeMemoApi();
    const handler = createGuardBeforeTool();
    await api.memo("approval:delete_file:{\"path\":\"y\"}", true, BACKGROUND_CONTEXT);
    const out = await handler({ name: "delete_file", arguments: { path: "y" } }, api as never, BACKGROUND_CONTEXT);
    assert.equal(out, undefined);
  });

  it("registers one ToolTask hook on the guard extension", () => {
    const ext = buildGuardExtension() as { name: string; hooks: unknown[] };
    assert.equal(ext.name, "guard");
    assert.equal(ext.hooks.length, 1);
  });
});
