import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseTitleResponse } from "@/app/api/scheduler/draft/route";

describe("parseTitleResponse", () => {
  it("parses a clean JSON object", () => {
    const r = parseTitleResponse('{"name":"Check prices"}');
    assert.deepEqual(r, { ok: true, name: "Check prices" });
  });

  it("strips code fences", () => {
    const r = parseTitleResponse('```json\n{"name":"Check prices"}\n```');
    assert.deepEqual(r, { ok: true, name: "Check prices" });
  });

  it("fails on garbage and empty names", () => {
    assert.equal(parseTitleResponse("hello world").ok, false);
    assert.equal(parseTitleResponse('{"name":"  "}').ok, false);
  });
});
