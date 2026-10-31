/**
 * Bundled skill: frontend design.
 *
 * Original Qube content. The idea of a "design direction" skill comes from
 * Anthropic's Apache-2.0 `frontend-design` example; this text is written
 * independently for Qube (see docs/skills.md).
 */

import type { SkillConfig } from "../types";

const INSTRUCTIONS = `# Frontend design

Design is a decision, not a default. Before you write markup, choose a direction
and commit to it.

## 1. Understand the subject
- Who uses this, on what screen, to do what? Name the single most important action.
- Collect the real content first (headings, numbers, labels). Design around real
  words, not lorem ipsum.
- If the user has brand assets or colours, they win over your taste.

## 2. Choose a direction (write it in one paragraph)
Pick and name a direction, e.g. "quiet editorial: warm off-white, serif display
type, generous line length" or "technical console: near-black, monospace meta,
thin rules". Then derive every choice from it:
- **Type**: one display face + one text face (or one family in two weights).
  Set a scale (e.g. 12 / 14 / 16 / 20 / 28 / 44) and use only those sizes.
- **Colour**: 1 background, 1 surface, 1 text, 1 muted text, 1 accent. Check
  contrast for body text (≥ 4.5:1) and focus rings.
- **Space**: one spacing rhythm (4 or 8 px). Whitespace is the design; do not
  fill space with borders and boxes.
- **Shape**: one radius family. Shadows only where depth carries meaning.

## 3. Build it properly
- Semantic HTML, real buttons and labels, keyboard reachable controls, visible
  focus, \`prefers-reduced-motion\` respected.
- Responsive by construction: use fluid widths and a single breakpoint that
  solves a real problem, not five.
- Dark mode: define both palettes up front; never invert by opacity.
- Loading, empty and error states are part of the design — design them too.

## 4. Check before declaring done
- Screenshot at 375 px, 768 px and 1440 px wide; look for clipping, overflow and
  cramped line lengths.
- Tab through the page: focus order, traps, invisible focus.
- Toggle dark mode and re-check borders, scrollbars, nested surfaces.
- Remove one decoration. If nothing is lost, it should not have been there.

## Rules
- Avoid template signals: purple-blue gradients on everything, three-column
  icon grids, generic "Hero / Features / CTA" without a reason.
- Accessibility is not a polish step.
- Report the direction you chose and what you verified.`;

export const FRONTEND_DESIGN_SKILL: SkillConfig = {
  id: "bundled-frontend-design",
  name: "frontend-design",
  description:
    "Guides distinctive, intentional visual design for new or reshaped interfaces: direction, typography, palette, spacing and accessibility. Use when building or restyling a UI and the result must look deliberate rather than templated.",
  instructions: INSTRUCTIONS,
  allowedTools: "read_file write_file edit_file run_command present_file",
  userInvocable: true,
  color: "#DB2777",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Original text. Concept inspired by Anthropic's Apache-2.0 `frontend-design` example skill; no text copied.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
