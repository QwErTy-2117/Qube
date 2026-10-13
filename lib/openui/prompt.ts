/**
 * Server-only OpenUI system-prompt helper (no React import).
 *
 * Builds the OpenUI Lang instructions from the committed spec
 * (`lib/openui/openui.spec.json`, generated via `npm run openui:spec`)
 * using `@openuidev/lang-core` — pure string generation, safe in Next.js
 * Route Handlers / Node.
 *
 * Uses `inlineMode: true` so the model keeps plain Markdown by default and
 * emits OpenUI only inside ```openui-lang fenced blocks when a visual
 * (table / chart / form / cards) genuinely helps. The client renders those
 * fences with <Renderer /> and everything else as Markdown.
 */

import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core";
// Imported as JSON — resolveJsonModule types this automatically.
import specJson from "./openui.spec.json";

let cached: string | null = null;

const QUBE_PREAMBLE = [
  "You are Qube, a personal assistant for everyday people.",
  "Plain Markdown is the default for direct answers.",
  "Emit an OpenUI ```openui-lang fenced block ONLY when an interactive visual",
  "genuinely helps: a comparison table, a chart, a short form, option cards,",
  "or step-through cards. Otherwise answer in plain Markdown with no code fence.",
  "When you do emit OpenUI, every program must define root = Card(...).",
  "Keep visuals small (one Card, a few children) and use realistic data.",
  "Buttons that need a follow-up MUST use @ToAssistant(\"label\") actions;",
  "external links MUST use @OpenUrl(url).",
].join(" ");

export function getOpenUISystemPrompt(): string {
  if (cached) return cached;
  try {
    const library = specJson as unknown as LibrarySpec;
    cached = generateSystemPrompt({
      library,
      promptOptions: {
        inlineMode: true,
        preamble: QUBE_PREAMBLE,
        // Each chat message renders standalone (no patch application), so
        // partial-update fences would render blank. Override the Inline Mode
        // "changed statements only" rule: every fence must be complete.
        additionalRules: [
          "Always emit a COMPLETE OpenUI program in every fenced block: root = Card(...) plus every statement it references. Never emit partial updates or changed-statements-only blocks — each message renders standalone.",
        ],
      },
    });
    return cached;
  } catch (e) {
    // Fallback: compact hand-written instruction so chats still work even
    // if spec parsing ever fails. Frontend falls back to Markdown anyway.
    console.warn("[openui] prompt generation failed, using fallback:", (e as Error)?.message);
    cached = [
      QUBE_PREAMBLE,
      "OpenUI syntax: one statement per line `id = Component(...)`, root = Card([...]).",
      "Available: Card, CardHeader, TextContent, MarkDownRenderer, Callout, Table, BarChart, LineChart, PieChart, Form, FormControl, Input, TextArea, Select, Buttons, Button, Tabs, TabItem, Steps.",
      "Wrap OpenUI in ```openui-lang fences; plain questions get plain Markdown with no code.",
      "Every fenced block must be a COMPLETE program (root = Card(...) plus all referenced statements) — never partial updates; each message renders standalone.",
    ].join("\n");
    return cached;
  }
}

/** Byte length of the generated prompt (for logging / budget checks). */
export function getOpenUIPromptLength(): number {
  return getOpenUISystemPrompt().length;
}
