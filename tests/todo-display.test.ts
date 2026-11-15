import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanTaskTitle, orderTodoItems } from "@/lib/todo/display";

describe("cleanTaskTitle", () => {
  it("strips the manual-task marker", () => {
    assert.equal(
      cleanTaskTitle("[manual-task:task_123] Buy milk"),
      "Buy milk",
    );
  });

  it("strips heartbeat and reminder prefixes, including repeats", () => {
    assert.equal(cleanTaskTitle("Heartbeat: Backlog"), "Backlog");
    assert.equal(
      cleanTaskTitle("Heartbeat reminder: Reminder: Call Alex"),
      "Call Alex",
    );
    assert.equal(cleanTaskTitle("Scheduled task: Weekly review"), "Weekly review");
  });

  it("keeps normal names intact and never returns blank text", () => {
    assert.equal(cleanTaskTitle("  Backlog  "), "Backlog");
    assert.equal(cleanTaskTitle(""), "Untitled task");
    assert.equal(cleanTaskTitle("Heartbeat:"), "Untitled task");
  });
});

describe("orderTodoItems", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `item-${index}`,
    done: index % 2 === 0,
  }));

  it("is stable for the same seed and items", () => {
    assert.deepEqual(orderTodoItems(items, 42), orderTodoItems(items, 42));
  });

  it("keeps completed items at the top", () => {
    const ordered = orderTodoItems(items, 7);
    assert.equal(ordered[0].done, true);
  });

  it("keeps a completed item in the first five when any exist", () => {
    const ordered = orderTodoItems(items, 3);
    assert.ok(ordered.slice(0, 5).some((item) => item.done));
  });

  it("keeps an unfinished item in the first five when any exist", () => {
    const ordered = orderTodoItems(items, 3);
    assert.ok(ordered.slice(0, 5).some((item) => !item.done));
  });

  it("does not invent completed rows when everything is open", () => {
    const open = items.map((item) => ({ ...item, done: false }));
    const ordered = orderTodoItems(open, 9);
    assert.equal(ordered.length, open.length);
    assert.ok(ordered.every((item) => !item.done));
  });
});
