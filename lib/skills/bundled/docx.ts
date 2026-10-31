/**
 * Bundled skill: DOCX documents.
 *
 * Original Qube content. Written from public OOXML/WordprocessingML
 * documentation and python-docx public API docs — NOT copied from
 * Anthropic's source-available `docx` skill (see docs/skills.md).
 */

import type { SkillConfig } from "../types";

export const DOCX_SKILL: SkillConfig = {
  id: "bundled-docx",
  name: "docx",
  description:
    "Creates, reads, and edits real Word documents (.docx) with headings, tables, lists, images, page numbers and a table of contents. Use when the user asks for a Word file, a report/memo/letter/proposal as .docx, or wants an existing .docx read, restyled, or updated.",
  instructions: `# Word documents (.docx)

A .docx is a ZIP of WordprocessingML XML parts. Edit it through a library, never by
hand-patching XML unless the task is impossible otherwise.

## Pick the approach
| Task | Do this |
| --- | --- |
| Read/extract text or outline | \`python3 -c\` with \`docx\` (python-docx) |
| Create a new document | python-docx script in the workspace |
| Edit an existing document | python-docx: open, modify paragraphs/tables, save to a NEW file |
| Redesign an existing document | extract text structure → rebuild with styles |

Check the library once, install if missing:
\`\`\`
python3 -c "import docx, sys; print(docx.__version__)" || pip install --quiet python-docx
\`\`\`

## Structure that survives editing
- Use the built-in styles (\`Title\`, \`Heading 1\`..\`Heading 3\`, \`List Bullet\`,
  \`Table Grid\`) instead of hand-setting fonts. Style-based documents stay
  editable and keep a working navigation pane.
- One idea per heading. Keep body paragraphs under ~120 words; split long blocks.
- Tables: \`document.add_table(rows=1, cols=n, style="Light Grid Accent 1")\`,
  then header row + data rows. Never draw tables with tabs or spaces.
- Page numbers and a header: edit \`section.header\`/\`footer\` paragraphs and add a
  \`PAGE\` field. A field is two runs plus \`fldChar\` elements — see the snippet below.
- Images: \`document.add_picture(path, width=Inches(6))\`; keep aspect ratio.

## Page numbers snippet
\`\`\`python
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
def add_page_number(paragraph):
    run = paragraph.add_run()
    for kind in ("begin", "instr", "separate", "text", "end"):
        el = OxmlElement("w:fldChar") if kind in ("begin", "separate", "end") else None
        if kind == "instr":
            el = OxmlElement("w:instrText"); el.set(qn("xml:space"), "preserve"); el.text = "PAGE"
        elif kind == "text":
            el = OxmlElement("w:t"); el.text = "1"
        if el is not None:
            if kind in ("begin", "separate", "end"):
                el.set(qn("w:fldCharType"), kind)
            run._r.append(el)
add_page_number(document.sections[0].footer.paragraphs[0])
\`\`\`

## Layout defaults that look professional
- Page: A4 or Letter (\`section.page_width\`), margins 2.2 cm.
- Body: Calibri/Arial 11 pt, line spacing 1.15, space after 6 pt.
- Headings: 20/15/12 pt, bold, colour #1F2937; never all-caps body text.
- Tables: first row bold + shaded; numeric columns right-aligned.
- Cover: title, one-line purpose, author, date — no decorative clutter.

## Verify before presenting
1. The file opens: \`python3 -c "import docx; d=docx.Document(PATH); print(len(d.paragraphs))"\`
2. Paragraph, table and image counts match what you intended.
3. No \`\\\\n\` literals, no placeholder text like "TBD" left behind.
4. Then call \`present_file(PATH)\` exactly once.

## Rules
- Write deliverables under \`documents/\` with short hyphenated filenames.
- Never overwrite an existing user document — save a new version with a suffix.
- If a .doc (legacy) or .odt is requested, say a .docx is what you can produce reliably
  and convert with LibreOffice when it is available.
- Report: path, page/section count, and what you verified.`,
  allowedTools:
    "run_command read_file write_file edit_file list_directory present_file",
  userInvocable: true,
  color: "#1C64F2",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Authored for Qube from public OOXML/WordprocessingML and python-docx documentation. Not derived from Anthropic's proprietary docx skill.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
