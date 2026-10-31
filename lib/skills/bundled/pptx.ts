/**
 * Bundled skill: PPTX presentations.
 *
 * Original Qube content, authored from public OOXML/PresentationML and
 * python-pptx documentation.
 */

import type { SkillConfig } from "../types";

export const PPTX_SKILL: SkillConfig = {
  id: "bundled-pptx",
  name: "pptx",
  description:
    "Creates and edits real PowerPoint decks (.pptx) with layouts, images, charts and speaker notes. Use when the user asks for slides, a deck, a pitch, or wants an existing .pptx inspected, restyled or updated.",
  instructions: `# Presentations (.pptx)

A .pptx is a ZIP of PresentationML XML parts. Build decks with python-pptx so the
result is a real, editable presentation — never an outline pasted into a text file.

## Setup
\`\`\`
python3 -c "import pptx; print(pptx.__version__)" || pip install --quiet python-pptx
\`\`\`

## Story first, pixels later
1. Decide the audience and the ONE takeaway of the deck.
2. Write the slide plan as titles + 3-5 bullets (or a 3-column table) before styling.
3. Then build: one idea per slide, at most 6 bullets, at most ~12 words per bullet.

## Build rules that avoid ugly decks
- 16:9 by default: \`prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)\`.
- Use the built-in layouts (\`layout 0\` title, \`1\` title+content, \`5\` title only,
  \`6\` blank for freeform). Do not manually place the title box on every slide.
- Palette: one background, one text colour, one accent. Reuse the same two fonts.
- Font sizes: title 36-44 pt, body 18-24 pt, footnote 12-14 pt. Never below 14 pt.
- Images: keep aspect ratio, place on the right half for title+binary layouts.
- Charts: use \`slide.shapes.add_chart(...)\` with real data — never screenshot a
  chart or describe it in text.
- Speaker notes: one or two sentences per slide via \`slide.notes_slide.notes_text_frame.text\`.
- Closing slide: summary + next action, not "Thank you".

## Editing an existing deck
\`\`\`python
prs = Presentation(src)
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            ...replace text, keep paragraph formatting...
prs.save(dst)
\`\`\`
Preserve the template's master/layout when only content changes. Save to a new
file; never overwrite the user's original.

## Verify before presenting
1. Reopen the file and print the slide count and every slide title.
2. Confirm no text frame overflows (long strings were split or shortened).
3. Confirm charts/images exist where intended.
4. \`present_file(PATH)\` once. The chat card renders slide thumbnails and opens
   the deck in the presentation viewer.

## Rules
- Deliverables go under \`presentations/\` with short hyphenated names.
- Never claim a deck is done without reopening it.
- If the user only wants an outline, ask once whether they want a real .pptx.`,
  allowedTools:
    "run_command read_file write_file edit_file list_directory present_file",
  userInvocable: true,
  color: "#C27803",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Authored for Qube from public PresentationML and python-pptx documentation. Not derived from Anthropic's proprietary pptx skill.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
