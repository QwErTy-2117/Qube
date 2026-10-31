/**
 * Bundled skill: XLSX spreadsheets.
 *
 * Original Qube content, authored from public OOXML/SpreadsheetML,
 * openpyxl and Excel formula documentation.
 */

import type { SkillConfig } from "../types";

export const XLSX_SKILL: SkillConfig = {
  id: "bundled-xlsx",
  name: "xlsx",
  description:
    "Creates, edits and analyses real Excel workbooks (.xlsx/.csv) with live formulas, number formats, multiple sheets and tables. Use when the user asks for a spreadsheet, budget, tracker, model, or wants existing tabular data cleaned, summed or compared.",
  instructions: `# Spreadsheets (.xlsx / .csv)

Workbooks are documents users keep editing: formulas must stay formulas, not
pre-computed numbers. Build with openpyxl (or the \`xlsx\` npm package when Node is
the better fit), and always reopen the saved file to verify.

## Setup
\`\`\`
python3 -c "import openpyxl; print(openpyxl.__version__)" || pip install --quiet openpyxl
\`\`\`

## Structure
- Sheet 1 is the answer: title row, then a clean header row, then data.
- Long or multi-source workbooks: one sheet per source, one summary/README sheet
  with definitions and assumptions.
- Freeze the header row (\`ws.freeze_panes = "A2"\`); set column widths explicitly.
- Never merge cells inside data ranges — it breaks sorting and formulas.

## Formulas (the part that matters)
- Totals and derived values MUST be formulas: \`=SUM(C2:C13)\`, \`=AVERAGE(D2:D13)\`,
  \`=IFERROR(B2/C2, 0)\`, \`=COUNTIF(A:A, "paid")\`, \`=SUMIF(B:B, "Food", C:C)\`,
  \`=XLOOKUP(...)\` / \`=VLOOKUP(...)\`, \`=TEXT(D2,"yyyy-mm-dd")\`.
- Reference cells/ranges by address, never by hardcoded result.
- Cross-sheet references: \`='Q1 data'!B7\` (quote names with spaces).
- Compute the same numbers in Python to sanity-check: if your check disagrees with
  the formula, fix the formula or the data, not the check.
- Dates: write real \`datetime\` values with a number format, not text.

## Number and text formatting
\`\`\`python
ws["E2"].number_format = '#,##0.00 "€"'
ws["F2"].number_format = "yyyy-mm-dd"
ws["B2"].font = Font(bold=True, color="FFFFFF")
ws["B2"].fill = PatternFill("solid", fgColor="374151")
\`\`\`
Align numbers right, text left; keep widths wide enough for the formatted value.

## CSV
- Write UTF-8 with \`\\n\` newlines, quote fields containing \`,\` \`"\` or newlines.
- CSV has no formulas, formulas or types: keep the .xlsx when either matters.

## Verify before presenting
1. Reopen with \`openpyxl.load_workbook(path, data_only=False)\`.
2. Print sheet names, dimensions and every formula cell you wrote.
3. Reopen with \`data_only=True\` only to read values that a real spreadsheet app
   already cached — do not rely on it for formulas Qube just wrote.
4. Convert to CSV once (\`libreoffice --headless --convert-to csv\` if present) to
   confirm the file is readable by a real spreadsheet engine.
5. \`present_file(PATH)\` once; the spreadsheet viewer supports tabs, editing and
   formula re-evaluation.

## Rules
- Deliverables go under \`spreadsheets/\`.
- Never overwrite the user's source workbook — write a new file.
- Currency/locale: use the user's currency and ISO dates unless told otherwise.`,
  allowedTools:
    "run_command read_file write_file edit_file list_directory present_file",
  userInvocable: true,
  color: "#0E9F6E",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Authored for Qube from public SpreadsheetML, openpyxl and Excel function documentation. Not derived from Anthropic's proprietary xlsx skill.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
