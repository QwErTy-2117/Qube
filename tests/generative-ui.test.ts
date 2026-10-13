/**
 * Generative UI regression tests (OpenIntelligentUI pattern, Qube style).
 *
 * Covers the full vertical slice without a browser:
 * - Pi harness exposes a `generate_ui` tool with validating `execute`
 * - Sandbox helpers stay self-contained, Qube-themed, and scrubbed
 * - Renderer stays sandboxed (`allow-scripts` only) in Qube card style
 * - Tool is registered, labeled in plain language, and prompted
 *
 * Run: node scripts/run-tests.mjs generative-ui
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createPiTools } from "@/lib/pi/tools";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";
import { buildPiSystemPrompt } from "@/lib/pi/system-prompt";
import {
  buildSandboxSrcDoc,
  clampHeight,
  parseGenerativeUIFence,
  stripDangerousJs,
} from "@/lib/generative-ui/sandbox";

const ROOT = process.cwd();
const read = (p: string) => readFile(join(ROOT, p), "utf-8");

async function generateUiTool() {
  const tools = createPiTools("test-generative-ui", {
    includeSubagents: false,
    includeTodos: false,
    includeAskUser: false,
  }) as Record<string, any>;
  assert.ok(tools.generate_ui, "Pi harness must expose generate_ui");
  return tools.generate_ui;
}

describe("generate_ui tool: validation", () => {
  it("renders a valid payload", async () => {
    const t = await generateUiTool();
    const out = JSON.parse(
      await t.execute({
        title: "Bill splitter",
        kind: "calculator",
        html: "<div>hi</div>",
        height: 400,
      }),
    );
    assert.equal(out.status, "rendered");
    assert.equal(out.title, "Bill splitter");
    assert.equal(out.kind, "calculator");
    assert.equal(out.height, 400);
  });

  it("rejects a missing body", async () => {
    const t = await generateUiTool();
    const out = JSON.parse(await t.execute({ title: "Empty", html: "" }));
    assert.ok(out.error, "expected an error for empty html");
  });

  it("rejects oversized payloads", async () => {
    const t = await generateUiTool();
    const out = JSON.parse(
      await t.execute({ title: "Big", html: "x".repeat(60001) }),
    );
    assert.match(out.error, /too large/i);
  });

  it("clamps height and truncates titles", async () => {
    const t = await generateUiTool();
    const tall = JSON.parse(
      await t.execute({ title: "T", html: "<div>hi</div>", height: 5000 }),
    );
    assert.equal(tall.height, 900);
    const short = JSON.parse(
      await t.execute({ title: "S", html: "<div>hi</div>", height: 10 }),
    );
    assert.equal(short.height, 120);
    const long = JSON.parse(
      await t.execute({
        title: "t".repeat(500),
        html: "<div>hi</div>",
      }),
    );
    assert.ok(long.title.length <= 120);
  });
});

describe("sandbox helpers: Qube-themed and scrubbed", () => {
  it("injects Qube theme tokens with a dark-mode companion", () => {
    const doc = buildSandboxSrcDoc({ html: "<div>hi</div>" });
    for (const token of [
      "--background",
      "--foreground",
      "--muted",
      "--border",
      "--primary",
      "--radius",
    ]) {
      assert.ok(doc.includes(token), `srcDoc must define ${token}`);
    }
    assert.ok(doc.includes("prefers-color-scheme: dark"));
    assert.ok(doc.includes("window.qube"));
    assert.ok(doc.includes("sendPrompt"));
  });

  it("scrubs exfiltration vectors from model scripts", () => {
    const dirty =
      "top.location='x'; fetch('/steal'); localStorage.setItem('k','v');";
    const clean = stripDangerousJs(dirty);
    assert.ok(!/top\s*\.\s*location/i.test(clean));
    assert.ok(!/localStorage/.test(clean));
    assert.ok(!/fetch\s*\(/.test(clean));
  });

  it("bounds iframe heights", () => {
    assert.equal(clampHeight(5000), 900);
    assert.equal(clampHeight(-5), 120);
    assert.equal(clampHeight(undefined), 320);
  });
});

describe("generative UI: Qube wiring", () => {
  it("has a plain-language label with no jargon", () => {
    const label = friendlyToolLabel("generate_ui", {});
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
    assert.ok(prompt.includes("generate_ui"));
    assert.ok(prompt.includes("var(--background)"));
  });

  it("renderer stays sandboxed in a Qube card", async () => {
    const src = await read(
      "components/assistant-ui/tools/generative-ui-tool-ui.tsx",
    );
    assert.ok(src.includes('sandbox="allow-scripts"'));
    assert.ok(!src.includes("allow-same-origin"));
    assert.ok(src.includes("rounded-xl border"));
    assert.ok(src.includes("border-border/60"));
    // Host validates the event source before honoring resize/follow-ups.
    assert.ok(src.includes("contentWindow"));
    assert.ok(src.includes("__qubeGenerativeUIHeight"));
    assert.ok(src.includes("thread().append"));
  });

  it("is registered with the runtime and exported", async () => {
    const [provider, index] = await Promise.all([
      read("components/assistant-ui/agent-runtime-provider.tsx"),
      read("components/assistant-ui/tools/index.ts"),
    ]);
    assert.ok(provider.includes('toolName: "generate_ui"'));
    assert.ok(provider.includes("GenerativeUIToolUI"));
    assert.ok(index.includes("GenerativeUIToolUI"));
  });
});

describe("generative UI: inline placement, chromeless card", () => {
  it("tool card has no header chrome", async () => {
    const src = await read(
      "components/assistant-ui/tools/generative-ui-tool-ui.tsx",
    );
    for (const chrome of [
      "SparklesIcon",
      "Copy HTML",
      "Open in new tab",
      "TooltipIconButton",
    ]) {
      assert.ok(!src.includes(chrome), `card still contains ${chrome}`);
    }
    assert.ok(!src.includes('"Hide"'), "card still contains a Hide toggle");
    assert.ok(
      !src.includes("runs locally in a sandbox"),
      "card still contains the bottom disclaimer",
    );
    assert.ok(src.includes("GenerativeUIFrame"));
    assert.ok(src.includes('sandbox="allow-scripts"'));
    assert.ok(!src.includes("allow-same-origin"));
  });

  it("markdown renders ```genui fences inline", async () => {
    const src = await read("components/assistant-ui/markdown-text.tsx");
    assert.ok(src.includes("language-genui"));
    assert.ok(src.includes("GenerativeUIFrame"));
    assert.ok(src.includes("parseGenerativeUIFence"));
  });

  it("fence JSON round-trips into a themed sandbox doc", () => {
    const fence = JSON.stringify({
      title: "Tip calc",
      kind: "calculator",
      html: "<div>hi</div>",
      height: 400,
    });
    const parsed = parseGenerativeUIFence(fence);
    assert.ok(parsed);
    const doc = buildSandboxSrcDoc(parsed!);
    assert.ok(doc.includes("<div>hi</div>"));
    assert.ok(doc.includes("--background"));
    assert.equal(parseGenerativeUIFence("not json"), null);
    assert.equal(parseGenerativeUIFence(JSON.stringify({ title: "x" })), null);
  });

  it("system prompt documents inline placement", () => {
    const prompt = buildPiSystemPrompt({});
    assert.ok(prompt.includes("tagged genui"));
  });
});
