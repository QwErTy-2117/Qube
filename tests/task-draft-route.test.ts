import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseDraftResponse } from "@/app/api/scheduler/draft/route";

describe("parseDraftResponse", () => {
  it("parses a clean JSON object", () => {
    const r = parseDraftResponse('{"name":"T","instructions":"Do.","scheduleKind":"interval","intervalMinutes":1440}');
    assert.equal(r.ok, true);
  });

  it("strips code fences", () => {
    const r = parseDraftResponse('```json\n{"name":"T","instructions":"Do.","scheduleKind":"interval","intervalMinutes":1440}\n```');
    assert.equal(r.ok, true);
  });

  it("fails on garbage", () => {
    assert.equal(parseDraftResponse("hello world").ok, false);
  });
});
