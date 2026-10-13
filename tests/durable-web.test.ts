import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webFetchTool, webSearchTool } from "@/lib/pi/durable-web";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-web" } as never;

function outputText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

describe("durable web tools", () => {
  it("web_search returns shaped JSON even offline", async () => {
    const parsed = JSON.parse(outputText(await webSearchTool.execute(
      { query: "test query shapes" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(parsed.query, "test query shapes");
    assert.ok(Array.isArray(parsed.results));
  });

  it("web_fetch blocks SSRF targets without network", async () => {
    const parsed = JSON.parse(outputText(await webFetchTool.execute(
      { url: "http://169.254.169.254/latest/meta-data/" } as never, fakeApi, BACKGROUND_CONTEXT,
    )));
    assert.equal(parsed.url, "http://169.254.169.254/latest/meta-data/");
    assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);
  });
});
