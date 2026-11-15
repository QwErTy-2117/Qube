import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isThreadUnread,
  parseThreadSeen,
} from "@/lib/chat/thread-unread";

describe("isThreadUnread", () => {
  const last = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("is unread when the last message is newer than the check", () => {
    assert.equal(isThreadUnread(last, last - 1), true);
  });

  it("is read when the check happened after the last message", () => {
    assert.equal(isThreadUnread(last, last + 1), false);
    assert.equal(isThreadUnread(new Date(last), last), false);
  });

  it("never marks a thread without a last message unread", () => {
    assert.equal(isThreadUnread(undefined, 0), false);
    assert.equal(isThreadUnread(null, 0), false);
  });
});

describe("parseThreadSeen", () => {
  it("keeps only finite numeric timestamps", () => {
    assert.deepEqual(
      parseThreadSeen('{"a":10,"b":"20","c":null,"d":30}'),
      { a: 10, d: 30 },
    );
  });

  it("survives malformed or empty storage", () => {
    assert.deepEqual(parseThreadSeen(null), {});
    assert.deepEqual(parseThreadSeen("not json"), {});
    assert.deepEqual(parseThreadSeen("[1,2]"), {});
  });
});
