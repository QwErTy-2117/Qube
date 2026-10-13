import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQubeExtension, buildQubePromptSection } from "@/lib/pi/durable-prompt";

const DURABLE_TOOLS = [
  "read_file", "write_file", "edit_file", "delete_file", "list_directory", "present_file",
  "run_command", "web_search", "web_fetch", "TodoWrite", "subagent", "read_memory", "save_memory",
];

describe("durable prompt", () => {
  it("names exactly the tools that exist, nothing else", () => {
    const out = buildQubePromptSection();
    for (const t of DURABLE_TOOLS) assert.match(out, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), t);
    assert.doesNotMatch(out, /browser_navigate/);
    assert.doesNotMatch(out, /ask_question/);
  });

  it("renders the user block only when profile set", () => {
    assert.doesNotMatch(buildQubePromptSection(), /## User/);
    const withUser = buildQubePromptSection({ userName: "Ada", userAbout: "Likes concise answers" });
    assert.match(withUser, /Name: Ada/);
    assert.match(withUser, /concise answers/);
  });

  it("is deterministic for prompt-cache stability", () => {
    assert.equal(buildQubePromptSection(), buildQubePromptSection());
  });

  it("registers as the qube extension", () => {
    const ext = buildQubeExtension() as { name: string; sections: unknown[] };
    assert.equal(ext.name, "qube");
    assert.equal(ext.sections.length, 1);
  });
});
