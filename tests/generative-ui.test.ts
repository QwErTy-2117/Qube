/**
 * Generative UI regression tests.
 *
 * Covers the assistant-ui built-in generative UI path end to end without a
 * browser:
 * - Pi harness exposes a `render_gui` tool that validates specs
 * - The spec vocabulary is the allowlist the renderer resolves against
 * - The renderer uses MessagePrimitive.GenerativeUI (no iframe sandbox)
 * - The tool is registered, labeled in plain language, and prompted
 * - The old custom implementations are gone
 *
 * Run: node scripts/run-tests.mjs generative-ui
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createPiTools } from "@/lib/pi/tools";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";
import { buildPiSystemPrompt } from "@/lib/pi/system-prompt";
import {
  GENERATIVE_UI_COMPONENT_NAMES,
  buildGenerativeUIPrompt,
  generativeUISpecSchema,
} from "@/lib/generative-ui/catalog";

const ROOT = process.cwd();
const read = (p: string) => readFile(join(ROOT, p), "utf-8");
const exists = (p: string) =>
  access(join(ROOT, p)).then(
    () => true,
    () => false,
  );

async function renderGuiTool() {
  const tools = createPiTools("test-generative-ui", {
    includeSubagents: false,
    includeTodos: false,
    includeAskUser: false,
  }) as Record<string, any>;
  assert.ok(tools.render_gui, "Pi harness must expose render_gui");
  return tools.render_gui;
}

describe("render_gui tool: validation", () => {
  it("renders a valid spec and round-trips it", async () => {
    const t = await renderGuiTool();
    const spec = {
      root: {
        component: "Card",
        props: { title: "Q3 revenue" },
        children: [
          {
            component: "Chart",
            props: {
              variant: "bar",
              data: [
                { label: "Jul", value: 22 },
                { label: "Aug", value: 26 },
              ],
            },
          },
        ],
      },
    };
    const out = JSON.parse(await t.execute({ spec }));
    assert.equal(out.status, "rendered");
    assert.deepEqual(out.spec, spec);
  });

  it("accepts a root array and plain strings", async () => {
    const t = await renderGuiTool();
    const spec = {
      root: [
        "A quick note",
        { component: "Divider" },
        { component: "Text", props: { value: "Done." } },
      ],
    };
    const out = JSON.parse(await t.execute({ spec }));
    assert.equal(out.status, "rendered");
    assert.deepEqual(out.spec, spec);
  });

  it("rejects unknown component names", async () => {
    const t = await renderGuiTool();
    const out = JSON.parse(
      await t.execute({
        spec: { root: { component: "Iframe", props: { src: "https://x.test" } } },
      }),
    );
    assert.equal(out.error, "Invalid visual spec");
    assert.ok(Array.isArray(out.issues) && out.issues.length > 0);
  });

  it("rejects a spec without a root", async () => {
    const t = await renderGuiTool();
    const out = JSON.parse(await t.execute({ spec: { children: [] } }));
    assert.equal(out.error, "Invalid visual spec");
  });

  it("rejects non-object input", async () => {
    const t = await renderGuiTool();
    const out = JSON.parse(await t.execute({ spec: "hello" }));
    assert.equal(out.error, "Invalid visual spec");
  });
});

describe("generative UI vocabulary", () => {
  it("every documented component resolves in the allowlist", () => {
    const prompt = buildGenerativeUIPrompt();
    for (const name of GENERATIVE_UI_COMPONENT_NAMES) {
      assert.ok(prompt.includes(name), `prompt omits ${name}`);
    }
  });

  it("spec schema accepts nested allowlisted nodes only", () => {
    const ok = generativeUISpecSchema.safeParse({
      root: {
        component: "Row",
        children: [
          { component: "Fact", props: { label: "Total", value: "42" } },
          { component: "Button", props: { label: "More", prompt: "Tell me more" } },
        ],
      },
    });
    assert.equal(ok.success, true);

    const nested = generativeUISpecSchema.safeParse({
      root: { component: "Card", children: [{ component: "Script" }] },
    });
    assert.equal(nested.success, false);
  });
});

describe("generative UI: Qube wiring", () => {
  it("has a plain-language label with no jargon", () => {
    const label = friendlyToolLabel("render_gui", {});
    assert.ok(label.length > 0);
    assert.ok(!label.includes("_"), `leaks snake_case: ${label}`);
    for (const jargon of ["snapshot", "pixel", "takeover", "heartbeat", "scratchpad", "mcp"]) {
      assert.ok(
        !label.toLowerCase().includes(jargon),
        `"${label}" leaks jargon "${jargon}"`,
      );
    }
  });

  it("is advertised in the system prompt", () => {
    const prompt = buildPiSystemPrompt({});
    assert.ok(prompt.includes("render_gui"));
    assert.ok(prompt.includes("Allowed components"));
    for (const name of GENERATIVE_UI_COMPONENT_NAMES) {
      assert.ok(prompt.includes(`- ${name}:`), `prompt omits ${name}`);
    }
  });

  it("does not advertise the old OpenUI or sandbox paths", () => {
    const prompt = buildPiSystemPrompt({});
    assert.ok(!prompt.includes("openui-lang"));
    assert.ok(!prompt.includes("OPENUI"));
    assert.ok(!prompt.includes("generate_ui"));
    assert.ok(!/\bgenui\b/i.test(prompt));
    assert.ok(!prompt.includes("var(--background)"));
  });

  it("is registered with the runtime", async () => {
    const provider = await read("components/assistant-ui/agent-runtime-provider.tsx");
    assert.ok(provider.includes('toolName: "render_gui"'));
    assert.ok(provider.includes("RenderGuiToolUI"));
    assert.ok(!provider.includes("GenerativeUIToolUI"));
    assert.ok(!provider.includes("generate_ui"));
  });

  it("renders through assistant-ui's built-in GenerativeUI primitive", async () => {
    const src = await read("components/assistant-ui/generative-ui.tsx");
    assert.ok(src.includes("MessagePrimitive.GenerativeUI"));
    assert.ok(src.includes("generativeUIComponents"));
    assert.ok(src.includes("GenerativeUIUnknownComponent"));
    assert.ok(src.includes("render_gui"));
    assert.ok(!src.includes("<iframe"));
    assert.ok(!src.includes("allow-scripts"));
    assert.ok(!src.includes("dangerouslySetInnerHTML"));
  });

  it("removes the old custom generative UI files", async () => {
    for (const path of [
      "lib/openui/library.ts",
      "lib/openui/openui.spec.json",
      "lib/openui/prompt.ts",
      "lib/openui/segments.ts",
      "lib/generative-ui/sandbox.ts",
      "components/assistant-ui/openui-text.tsx",
      "components/assistant-ui/tools/generative-ui-tool-ui.tsx",
      "tests/openui.test.ts",
    ]) {
      assert.equal(await exists(path), false, `stale file still present: ${path}`);
    }
  });

  it("no longer imports OpenUI packages", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const all = Object.keys(pkg.dependencies || {});
    assert.ok(!all.some((name) => name.startsWith("@openuidev/")));
    assert.ok(!pkg.scripts?.["openui:spec"]);
  });

  it("renders markdown text without the old inline genui fence branch", async () => {
    const src = await read("components/assistant-ui/markdown-text.tsx");
    assert.ok(!src.includes("language-genui"));
    assert.ok(!src.includes("GenerativeUIFrame"));
    assert.ok(!src.includes("parseGenerativeUIFence"));
  });
});
