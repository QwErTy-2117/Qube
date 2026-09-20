import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-scratch-test-"));

import { readScratchpad, writeScratchpad, appendScratchpad, clearScratchpad } from "@/lib/pi/scratchpad";

describe("scratchpad", () => {
  it("write/read/append/clear", async () => {
    const tid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    assert.equal(await readScratchpad(tid), null);
    await writeScratchpad(tid, "# Goal\nhello");
    assert.match((await readScratchpad(tid)) || "", /hello/);
    await appendScratchpad(tid, "\n## Findings\nx");
    assert.match((await readScratchpad(tid)) || "", /Findings/);
    await clearScratchpad(tid);
    assert.equal(await readScratchpad(tid), null);
  });
});
