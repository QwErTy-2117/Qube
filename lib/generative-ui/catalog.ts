import { z } from "zod";

/**
 * The Qube generative-UI vocabulary. This is the allowlist the built-in
 * assistant-ui `MessagePrimitive.GenerativeUI` resolves spec component names
 * against — any name not listed here is rejected by the renderer.
 *
 * This module is server-safe (zod only, no React) so the Pi harness can use
 * it to describe the tool and build the system prompt.
 */
export const GENERATIVE_UI_COMPONENT_NAMES = [
  "Card",
  "Header",
  "Text",
  "Caption",
  "Markdown",
  "Fact",
  "Row",
  "Col",
  "Divider",
  "Badge",
  "Table",
  "Chart",
  "Alert",
  "Button",
] as const;

export type GenerativeUIComponentName = (typeof GENERATIVE_UI_COMPONENT_NAMES)[number];

type ComponentDoc = {
  description: string;
  props: string;
};

export const GENERATIVE_UI_COMPONENTS: Record<GenerativeUIComponentName, ComponentDoc> = {
  Card: {
    description:
      "A bordered container grouping related content. Use it as the visual's root.",
    props: "title? string, subtitle? string",
  },
  Header: {
    description: "A section heading.",
    props: "text string, size? 'sm' | 'md' | 'lg'",
  },
  Text: {
    description: "A paragraph of plain text.",
    props: "value string, size? 'sm' | 'md' | 'lg', weight? 'normal' | 'medium' | 'semibold' | 'bold', muted? boolean",
  },
  Caption: {
    description: "Small, muted supporting text.",
    props: "value string",
  },
  Markdown: {
    description:
      "Rich text rendered as Qube markdown (bold, lists, links, tables and $LaTeX$ math).",
    props: "value string",
  },
  Fact: {
    description: "A label/value pair for a key number or detail.",
    props: "label string, value string",
  },
  Row: {
    description: "Horizontal layout; children are placed side by side.",
    props: "gap? number 0-8",
  },
  Col: {
    description: "Vertical stack; children are stacked.",
    props: "gap? number 0-8",
  },
  Divider: {
    description: "A horizontal rule between sections.",
    props: "none",
  },
  Badge: {
    description: "A small status tag.",
    props: "value string, variant? 'info' | 'success' | 'warning' | 'danger' | 'muted'",
  },
  Table: {
    description: "A data table with a header row.",
    props: "columns string[], rows string[][]",
  },
  Chart: {
    description: "A simple bar or line chart for numeric comparisons and trends.",
    props:
      "variant? 'bar' | 'line', data { label string, value number }[], title? string, unit? string, height? number 120-320",
  },
  Alert: {
    description: "A callout for a warning, success, or important note.",
    props: "title? string, description? string, tone? 'info' | 'success' | 'warning' | 'danger'",
  },
  Button: {
    description:
      "A button that sends its prompt as the next user message when clicked. Use it for a concrete follow-up action.",
    props: "label string, prompt string, variant? 'primary' | 'secondary' | 'outline'",
  },
};

export type GenerativeUINode =
  | string
  | {
      component: string;
      props?: Record<string, unknown>;
      children?: GenerativeUINode[];
      key?: string;
    };

export type GenerativeUISpec = {
  root: GenerativeUINode | readonly GenerativeUINode[];
};

/**
 * Recursive node schema for the built-in `generative-ui` message-part shape:
 * `{ component, props?, children?, key? }`. Strings render as text.
 */
export const generativeUINodeSchema: z.ZodType<GenerativeUINode> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({
      component: z
        .enum(GENERATIVE_UI_COMPONENT_NAMES)
        .describe("Allowlisted Qube visual component name"),
      props: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Component props; see the component vocabulary for supported keys"),
      children: z.array(generativeUINodeSchema).optional(),
      key: z.string().optional(),
    }),
  ]),
) as z.ZodType<GenerativeUINode>;

export const generativeUISpecSchema = z.object({
  root: z.union([generativeUINodeSchema, z.array(generativeUINodeSchema)]),
});

/** Tool input for the model-facing `render_gui` tool. */
export const renderGuiInputSchema = z.object({
  spec: generativeUISpecSchema.describe(
    "Complete visual spec: { root: node | node[] }, where each node is a string or { component, props?, children?, key? }",
  ),
});

export type RenderGuiInput = z.infer<typeof renderGuiInputSchema>;

/**
 * Natural-language component vocabulary appended to the Pi system prompt.
 * Kept beside the allowlist so prompt and renderer cannot drift apart.
 */
export function buildGenerativeUIPrompt(): string {
  const components = GENERATIVE_UI_COMPONENT_NAMES.map((name) => {
    const doc = GENERATIVE_UI_COMPONENTS[name];
    return `- ${name}: ${doc.description}${
      doc.props === "none" ? "" : ` Props: ${doc.props}.`
    }`;
  }).join("\n");

  return `### Visual answers with render_gui
When a visual genuinely helps — comparing numbers, showing a trend, laying out options side by side, or presenting a compact reference — call render_gui with a COMPLETE spec. Plain Markdown stays the default; do not offer a visual first, just make one when it earns its place. Always give the direct answer in text too.

Spec shape:
{"spec":{"root":{"component":"Card","props":{"title":"Q3 revenue"},"children":[{"component":"Chart","props":{"variant":"bar","data":[{"label":"Jul","value":22},{"label":"Aug","value":26}]}}]}}}
A root may be one node or an array of nodes. Each node is a string (plain text) or {component, props?, children?, key?}.

Allowed components (the only names that render):
${components}

Rules: props must be JSON-serializable; never send HTML, JavaScript, scripts, external images, or URLs; use Markdown when rich formatting helps; buttons carry a prompt that becomes the user's next message. Keep the visual compact and focused on the answer.`;
}
