import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-dfiles-test-"));
import { allowedDirsStore } from "@/lib/permissions/allowed-dirs";
import {
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  presentFileTool,
  readFileTool,
  writeFileTool,
} from "@/lib/pi/durable-files";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-files" } as never;
let ws = "";

function outputText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

before(() => {
  ws = mkdtempSync(join(tmpdir(), "qube-dws-"));
  allowedDirsStore.add(ws, "write", "settings");
});

describe("durable file tools", () => {
  it("writes, reads, edits, lists, presents, then deletes", async () => {
    const p = join(ws, "notes", "hello.txt");
    const written = JSON.parse(outputText(await writeFileTool.execute({ path: p, content: "line one\nline two" } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(written.status, "written");

    const read = JSON.parse(outputText(await readFileTool.execute({ path: p } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(read.lineCount, 2);
    assert.match(read.content, /line one/);

    const edited = JSON.parse(outputText(await editFileTool.execute(
      { path: p, oldString: "line two", newString: "line 2!" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(edited.status, "edited");

    const missing = JSON.parse(outputText(await editFileTool.execute(
      { path: p, oldString: "nope", newString: "x" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(missing.error, "Text not found");

    const listed = JSON.parse(outputText(await listDirectoryTool.execute({ path: join(ws, "notes") } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok(listed.items.some((i: { name: string }) => i.name === "hello.txt"));

    const presented = JSON.parse(outputText(await presentFileTool.execute({ path: p } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(presented.status, "presented");
    assert.equal(presented.filename, "hello.txt");

    const deleted = JSON.parse(outputText(await deleteFileTool.execute({ path: p } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.equal(deleted.status, "deleted");
    const reread = JSON.parse(outputText(await readFileTool.execute({ path: p } as never, fakeApi, BACKGROUND_CONTEXT)));
    assert.ok(typeof reread.error === "string");
  });

  it("rejects multi-match edits", async () => {
    const p = join(ws, "dup.txt");
    await writeFileTool.execute({ path: p, content: "a\nb\na" } as never, fakeApi, BACKGROUND_CONTEXT);
    const res = JSON.parse(outputText(await editFileTool.execute(
      { path: p, oldString: "a", newString: "z" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.match(res.error, /Multiple matches/);
  });
});
