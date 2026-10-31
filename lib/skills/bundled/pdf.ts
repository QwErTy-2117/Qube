/**
 * Bundled skill: PDF files.
 *
 * Original Qube content, authored from public PDF specification and
 * pypdf/pdfplumber/reportlab documentation.
 */

import type { SkillConfig } from "../types";

export const PDF_SKILL: SkillConfig = {
  id: "bundled-pdf",
  name: "pdf",
  description:
    "Reads, extracts, merges, splits, rotates, watermarks, fills and creates PDF files. Use whenever a .pdf is involved: pulling out text or tables, combining pages, reducing a scan, filling a form, or producing a PDF deliverable.",
  instructions: `# PDF files

PDFs are a container of objects, not a text file. Use a library; never regex a PDF.

## Pick the right tool
| Need | Tool |
| --- | --- |
| Text/tables out | \`pdfplumber\` (layout-aware) or \`pypdf.extract_text\` |
| Merge/split/rotate/pages | \`pypdf\` |
| Create a PDF (report, invoice) | \`reportlab\` |
| Fill/interrogate forms | \`pypdf\` \`get_fields\` + widget update |
| Scanned pages / OCR | \`pytesseract\` + \`pdf2image\` (needs tesseract + poppler) |

\`\`\`
python3 -c "import pypdf, pdfplumber; print('ok')" || pip install --quiet pypdf pdfplumber
\`\`\`

## Reading
\`\`\`python
from pypdf import PdfReader
r = PdfReader(path)
print(len(r.pages), r.metadata)
text = "\\n".join((p.extract_text() or "") for p in r.pages)
\`\`\`
- Encrypted: try \`r.decrypt("")\` first; only accept a password the user gave you.
- Image-only scans return empty text — detect it (\`len(text.strip()) < 20*len(pages)\`)
  and OCR, or say plainly that the file is a scan.
- Keep page numbers in your summary so users can find things.

## Manipulating
\`\`\`python
from pypdf import PdfWriter, PdfReader
w = PdfWriter()
w.append(path)                 # merge
w.add_page(src.pages[0])       # pick pages
w.pages[0].rotate(90)          # rotate
w.write(dst)
\`\`\`
- Preserve outline/bookmarks and metadata when merging (\`w.add_metadata\`).
- Never modify the user's original; write a new file under \`documents/\`.

## Creating
reportlab canvas or platypus for flowing text/tables. Set page size, margins and
a real font (helvetica or a bundled TTF), then draw a footer with the page number.
Check that every string fits: long unbroken text overflows silently.

## Verify before presenting
1. Reopen the output: page count, page size, and a text sample from page 1 and last.
2. Merged/split files: count must equal the plan.
3. Filled forms: re-read the field values you set.
4. \`present_file(PATH)\` once — PDFs open in the built-in PDF viewer.

## Rules
- Never claim text extraction worked if the text is empty.
- Do not OCR silently: tell the user a scan was OCR'd and that accuracy varies.
- Large files (>200 pages): report progress instead of letting a command hang.`,
  allowedTools:
    "run_command read_file write_file edit_file list_directory present_file",
  userInvocable: true,
  color: "#E02424",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Authored for Qube from the public PDF specification and pypdf/pdfplumber/reportlab documentation. Not derived from Anthropic's proprietary pdf skill.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
