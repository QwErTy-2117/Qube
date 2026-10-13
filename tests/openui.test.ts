/**
 * OpenUI integration tests (https://www.openui.com/).
 *
 * Verifies the OpenUI generative-UI vertical slice without a browser:
 * - Committed library spec exists (Card root, chat-optimized groups)
 * - Server prompt helper builds inline-mode instructions (no React import)
 * - Pi base prompt points the model at OpenUI first, generate_ui second
 * - Client hybrid renderer uses <Renderer /> with the chat library and
 *   falls back to Markdown for plain replies
 *
 * Run: node scripts/run-tests.mjs openui
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildPiSystemPrompt } from "@/lib/pi/system-prompt";
import { getOpenUISystemPrompt, getOpenUIPromptLength } from "@/lib/openui/prompt";
import { containsOpenUI, splitBareRoot, splitOpenUISegments, toModelMessage } from "@/lib/openui/segments";
import specJson from "@/lib/openui/openui.spec.json";

const ROOT = process.cwd();
const read = (p: string) => readFile(join(ROOT, p), "utf-8");

describe("openui: library spec", () => {
  it("commits a chat-optimized spec with Card root", () => {
    const spec = specJson as unknown as {
      root?: string;
      components?: Record<string, unknown>;
      componentGroups?: Array<{ name?: string }>;
    };
    assert.equal(spec.root, "Card");
    assert.ok(spec.components && typeof spec.components === "object");
    assert.ok("Card" in spec.components);
    assert.ok("TextContent" in spec.components);
    assert.ok("Table" in spec.components);
    // Visual primitives the prompt advertises must exist in the spec.
    for (const name of ["BarChart", "Form", "FormControl", "Input", "Buttons", "Button", "Tabs", "Callout"]) {
      assert.ok(name in spec.components, `spec missing ${name}`);
    }
    const groups = (spec.componentGroups || []).map((g) => g?.name);
    assert.ok(groups.includes("Forms") || groups.includes("Content"));
  });
});

describe("openui: server prompt", () => {
  it("builds inline-mode instructions with Qube preamble", () => {
    const prompt = getOpenUISystemPrompt();
    assert.ok(prompt.length > 10000, "prompt should carry full component signatures");
    assert.ok(prompt.includes("Plain Markdown is the default") || prompt.includes("plain Markdown"));
    assert.ok(prompt.includes("Inline Mode"));
    assert.ok(prompt.includes("root = Card"));
    assert.ok(
      prompt.includes("COMPLETE OpenUI program"),
      "must override partial-update rules: each message renders standalone",
    );
  });

  it("caches the prompt (no 28KB rebuild on every turn)", () => {
    const a = getOpenUISystemPrompt();
    const b = getOpenUISystemPrompt();
    assert.equal(a, b, "repeated calls must return the identical prompt");
    assert.equal(getOpenUIPromptLength(), a.length);
  });
});

describe("openui: pi system prompt", () => {
  it("documents OpenUI as the preferred visual path", () => {
    const prompt = buildPiSystemPrompt({});
    assert.ok(prompt.includes("OpenUI"), "base prompt must mention OpenUI");
    assert.ok(prompt.includes("tagged genui"), "must keep genui inline-placement docs");
  });
});

describe("openui: client renderer", () => {
  it("segments prose and fenced programs without losing either", () => {
    assert.equal(containsOpenUI("plain markdown answer"), false);
    assert.equal(containsOpenUI("```openui-lang\nroot = Card([t])\n```"), true);
    // Unclosed fence while streaming still counts.
    assert.equal(containsOpenUI("intro\n```openui-lang\nroot = Card([t])"), true);

    const segs = splitOpenUISegments(
      'Here is your comparison:\n```openui-lang\nroot = Card([t])\nt = TextContent("Hi")\n```\nHope that helps!',
    );
    assert.equal(segs.length, 3);
    assert.equal(segs[0]?.type, "text");
    assert.ok((segs[0] as { content: string }).content.includes("comparison"));
    assert.equal(segs[1]?.type, "openui");
    assert.ok((segs[1] as { code: string }).code.includes("root = Card"));
    assert.equal(segs[2]?.type, "text");
    assert.ok((segs[2] as { content: string }).content.includes("Hope that helps"));

    // Streaming: trailing unclosed fence keeps partial code renderable.
    const streaming = splitOpenUISegments("intro\n```openui-lang\nroot = Card([t])");
    assert.equal(streaming.length, 2);
    assert.equal(streaming[1]?.type, "openui");

    // No fences: single text segment.
    assert.deepEqual(splitOpenUISegments("just text"), [{ type: "text", content: "just text" }]);
  });

  it("keeps leading prose around fence-less programs", () => {    const segs = splitBareRoot('Here is your summary:\nroot = Card([t])\nt = TextContent("Hi")');
    assert.equal(segs.length, 2);
    assert.equal(segs[0]?.type, "text");
    assert.ok((segs[0] as { content: string }).content.includes("summary"));
    assert.equal(segs[1]?.type, "openui");
    assert.ok((segs[1] as { code: string }).code.startsWith("root = Card"));
    // Pure program: blank prose segment skipped by the renderer.
    const pure = splitBareRoot('root = Card([t])\nt = TextContent("Hi")');
    assert.equal(pure.length, 2);
    assert.equal((pure[0] as { content: string }).content.trim(), "");
    // No bare root: single text segment.
    assert.deepEqual(splitBareRoot("just text"), [{ type: "text", content: "just text" }]);
  });

  it("ignores bare roots inside fenced code samples", () => {
    // A reply *discussing* OpenUI syntax must stay Markdown, not route to the Renderer.
    assert.equal(
      containsOpenUI('Use it like this:\n```python\nroot = Card([t])\n```\nHope that helps!'),
      false,
    );
    // A real fence-less program still counts.
    assert.equal(containsOpenUI('Here:\nroot = Card([t])\nt = TextContent("Hi")'), true);
  });

  it("briefs the model about visual actions with form values", () => {
    assert.equal(toModelMessage({ humanFriendlyMessage: "Book this flight" }), "User clicked: Book this flight");
    assert.equal(
      toModelMessage({ humanFriendlyMessage: "Submit", formState: { name: "Ada", seats: 2 } }),
      'User clicked: Submit\nForm values: {"name":"Ada","seats":2}',
    );
  });

  it("hybrid text renders OpenUI programs and falls back to Markdown", async () => {
    const src = await read("components/assistant-ui/openui-text.tsx");
    assert.ok(src.includes("Renderer"), "must use OpenUI Renderer");
    assert.ok(src.includes("openuiChatLibrary"), "must render with the chat library");
    assert.ok(src.includes("MarkdownText"), "must fall back to Markdown");
    assert.ok(src.includes("ContinueConversation"), "must handle continue_conversation actions");
    assert.ok(src.includes("OpenUrl"), "must handle open_url actions");
    assert.ok(src.includes("splitOpenUISegments"), "must split prose from fenced programs");
    assert.ok(src.includes("SegmentMarkdown"), "must render prose as Markdown next to visuals");
    assert.ok(src.includes("FILE_REF_RE"), "prose segments must strip file markers like MarkdownText");
    assert.ok(src.includes("renderLatexShortcuts"), "prose segments must keep LaTeX shortcuts");
  });

  it("assistant message routes text through the OpenUI hybrid", async () => {
    const src = await read("components/examples/base.tsx");
    assert.ok(src.includes("OpenUIText"), "AssistantText must use the OpenUI hybrid");
  });

  it("global styles include the OpenUI component CSS", async () => {
    const css = await read("app/globals.css");
    assert.ok(
      css.includes("@openuidev/react-ui/styles/index.css"),
      "built-in library styles must be imported once globally",
    );
  });
});
