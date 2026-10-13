import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baselineDurableCursor,
  buildRequestId,
  closeDurableStreamCursor,
  createDurableStreamCursor,
  renderDurableViewDiff,
} from "@/lib/pi/durable-stream";

describe("durable chat", () => {
  it("builds exactly-once request id", () => {
    assert.equal(buildRequestId("thread_1", "turn_2"), "thread_1:turn_2");
  });

  it("streams assistant text incrementally without replay", () => {
    const cursor = createDurableStreamCursor();
    const v1 = { entries: [{ id: "e1", kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Hel" }] }] }] };
    const c1 = renderDurableViewDiff(v1, cursor);
    assert.deepEqual(c1, [
      { type: "text-start", id: "e1" },
      { type: "text-delta", id: "e1", delta: "Hel" },
    ]);
    const v2 = { entries: [{ id: "e1", kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Hello" }] }] }] };
    const c2 = renderDurableViewDiff(v2, cursor);
    assert.deepEqual(c2, [{ type: "text-delta", id: "e1", delta: "lo" }]);
    const c3 = renderDurableViewDiff(v2, cursor);
    assert.deepEqual(c3, []);
    assert.deepEqual(closeDurableStreamCursor(cursor), [{ type: "text-end", id: "e1" }]);
  });

  it("emits tool calls and results once", () => {
    const cursor = createDurableStreamCursor();
    const view = {
      entries: [
        { id: "e1", kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.txt" } }] }] },
        { id: "e2", kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "c1", toolName: "read_file", content: [{ type: "text", text: "contents" }], isError: false }] },
      ],
    };
    const chunks = renderDurableViewDiff(view, cursor);
    assert.deepEqual(chunks, [
      { type: "tool-input-available", toolCallId: "c1", toolName: "read_file", input: { path: "a.txt" } },
      { type: "tool-output-available", toolCallId: "c1", output: "contents" },
    ]);
    assert.deepEqual(renderDurableViewDiff(view, cursor), []);
  });

  it("baselines old transcript silently and surfaces tool errors", () => {
    const cursor = createDurableStreamCursor();
    baselineDurableCursor(
      { entries: [{ id: "old", kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "Old answer" }] }] }] },
      cursor,
    );
    assert.deepEqual(renderDurableViewDiff({ entries: [] }, cursor), []);
    const chunks = renderDurableViewDiff(
      { entries: [{ id: "e9", kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "c9", toolName: "deploy", content: [{ type: "text", text: "denied" }], isError: true }] }] },
      cursor,
    );
    assert.deepEqual(chunks, [{ type: "tool-output-error", toolCallId: "c9", errorText: "denied" }]);
  });
});
