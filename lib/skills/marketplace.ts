/**
 * Curated marketplace catalog — offline snapshot representing the 3 best
 * open skills marketplaces (researched Sep 2026):
 * - skills.sh (Vercel) — npm-style registry, `npx skills add <name>`, 30+ agents
 * - SkillsMP — largest aggregator, 800k+ SKILL.md indexed from GitHub
 * - ClawHub — curated OpenClaw registry, human-reviewed, versioned + lockfile
 * Plus Anthropic official `anthropics/skills` reference skills.
 *
 * Each entry is install-ready: name + description (routing) + instructions
 * (SKILL.md body). Installing copies the entry into the user's skill store
 * as source=marketplace.
 */

export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  allowedTools?: string;
  marketplace: "skills.sh" | "SkillsMP" | "ClawHub" | "Anthropic Official";
  marketplaceUrl: string;
  version: string;
}

export const MARKETPLACE_URLS: Record<string, string> = {
  "skills.sh": "https://skills.sh",
  SkillsMP: "https://skillsmp.com",
  ClawHub: "https://clawhub.com",
  "Anthropic Official": "https://github.com/anthropics/skills",
};

export const MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    slug: "pdf-master",
    name: "pdf-master",
    description:
      "Extracts text, tables, and form fields from PDFs and builds new PDFs. Use when the user shares a PDF, asks to read/parse a PDF, or wants a PDF export.",
    instructions: `## Procedure
1. web_fetch or read_file the PDF path provided (workspace-relative via read_file metadata; remote URL via web_fetch).
2. If text extraction is garbled, fall back to run_command with python (pypdf/pymupdf) to dump text per page.
3. Summarize per page, preserve tables as markdown tables.
4. For PDF creation, write a python script to reports/ and run it, then present_file the output.

## Rules
- Never invent page numbers — cite the page you actually read.
- Keep extracts verbatim for quotes; summarize the rest.`,
    allowedTools: "read_file web_fetch run_command",
    marketplace: "Anthropic Official",
    marketplaceUrl: "https://github.com/anthropics/skills",
    version: "1.4.0",
  },
  {
    slug: "docx-edit",
    name: "docx-edit",
    description:
      "Reads and writes Word documents with styles, tables, and track-changes intent. Use when the user asks for .docx, Word export, or editing a Word file.",
    instructions: `## Procedure
1. For reading: run_command with python-docx to dump paragraphs + tables to markdown.
2. For writing: generate .docx under documents/ with heading styles, tables, and page breaks.
3. present_file the result and list what was styled.

## Rules
- Preserve existing styles when editing — never strip formatting silently.
- Use documents/ for outputs; verify with list_directory.`,
    allowedTools: "read_file write_file run_command",
    marketplace: "Anthropic Official",
    marketplaceUrl: "https://github.com/anthropics/skills",
    version: "1.2.1",
  },
  {
    slug: "xlsx-wizard",
    name: "xlsx-wizard",
    description:
      "Builds and analyzes spreadsheets with formulas, charts, and pivots. Use when the user asks for Excel, .xlsx, CSV analysis, or tabular reports.",
    instructions: `## Procedure
1. Inspect input CSV/sheet with read_file (first 50 lines) to infer schema.
2. Write python (openpyxl) to spreadsheets/ with header row, filters, formulas, and a totals row.
3. Run, verify file size, then VERIFY the formulas actually landed: reload the workbook and print every formula cell (e.g. "for row in ws.iter_rows(): for c in row: print(c.coordinate, c.value)") — openpyxl never computes values, so confirm each "=FORMULA" string is present in the right cell. Only then present_file the sheet.

## Rules
- Header row is mandatory; freeze intent noted in reply.
- Totals rows must be real dynamic Excel formulas (e.g. "=SUM(C2:C5)"), never precomputed static numbers.
- Never fabricate numbers — only compute from provided data.`,
    allowedTools: "read_file write_file run_command",
    marketplace: "Anthropic Official",
    marketplaceUrl: "https://github.com/anthropics/skills",
    version: "1.3.0",
  },
  {
    slug: "frontend-design",
    name: "frontend-design",
    description:
      "Designs polished landing pages and UI with modern CSS. Use when the user asks for a landing page, website mock, or UI polish.",
    instructions: `## Procedure
1. Clarify brand, sections, and CTA in one pass.
2. Write semantic HTML + Tailwind under code/ or documents/ as a single file when possible.
3. Verify by listing the file; describe layout, palette, and responsive behavior.

## Rules
- Mobile-first, accessible contrast, no lorem ipsum in final output.`,
    allowedTools: "write_file read_file list_directory",
    marketplace: "Anthropic Official",
    marketplaceUrl: "https://github.com/anthropics/skills",
    version: "2.0.2",
  },
  {
    slug: "mcp-builder",
    name: "mcp-builder",
    description:
      "Scaffolds Model Context Protocol servers and clients. Use when the user asks to create, debug, or extend an MCP server.",
    instructions: `## Procedure
1. Ask: transport (stdio/SSE), language (TS/python), tools to expose.
2. Scaffold server with tool list + JSON schemas, zod validation, and error envelopes.
3. Show how to register it in Qube Advanced → MCP Servers (command + args + env).
4. Verify with a tools/list smoke test via run_command.

## Rules
- Every tool needs a description and a schema — no schema-less tools.`,
    allowedTools: "write_file read_file run_command",
    marketplace: "Anthropic Official",
    marketplaceUrl: "https://github.com/anthropics/skills",
    version: "1.1.0",
  },
  {
    slug: "deep-research",
    name: "deep-research",
    description:
      "Runs multi-hop research with parallel searches and source grading. Use for market scans, tech comparisons, and literature-style reviews.",
    instructions: `## Procedure
1. Decompose into 3-5 sub-questions; spawn one researcher subagent per sub-question in parallel.
2. Grade sources A (primary) / B (reputable secondary) / C (unverified) — cite grades inline.
3. Merge into one brief: TL;DR, findings by question, conflicts, sources.

## Rules
- At least 5 fetched primary sources for broad topics.
- Date-stamp every key claim (accessed date + published date when known).`,
    allowedTools: "web_search web_fetch",
    marketplace: "skills.sh",
    marketplaceUrl: "https://skills.sh",
    version: "3.1.0",
  },
  {
    slug: "code-review-pro",
    name: "code-review-pro",
    description:
      "Reviews diffs for correctness, security, and simplicity. Use when the user asks for a review, audit, or pre-merge check.",
    instructions: `## Procedure
1. run_command git diff HEAD (or read the listed files).
2. Check: correctness, edge cases, error handling, secrets, perf footguns, test coverage.
3. Output: severity-tagged findings (blocker/major/nit) with file:line + suggested fix.

## Rules
- Read-only by default — never edit code unless asked.
- Praise once, then findings. No filler.`,
    allowedTools: "read_file list_directory run_command",
    marketplace: "skills.sh",
    marketplaceUrl: "https://skills.sh",
    version: "2.4.1",
  },
  {
    slug: "web-artifacts",
    name: "web-artifacts",
    description:
      "Builds shareable HTML artifacts (dashboards, calculators, visualizations). Use when the user wants an interactive single-file web app.",
    instructions: `## Procedure
1. Single self-contained HTML under code/ or documents/ (inline CSS/JS, no external keys).
2. Include sample data so it renders instantly.
3. present_file the artifact and describe interactions.

## Rules
- No external network calls at runtime unless the user asked.
- Must work by double-clicking the file.`,
    allowedTools: "write_file read_file",
    marketplace: "skills.sh",
    marketplaceUrl: "https://skills.sh",
    version: "1.9.0",
  },
  {
    slug: "supabase-guide",
    name: "supabase-guide",
    description:
      "Teaches Postgres/Supabase patterns: schema, RLS, edge functions. Use when working with Supabase, Postgres, or auth/storage questions.",
    instructions: `## Procedure
1. Inspect schema files first (read_file) before suggesting migrations.
2. Always include RLS policies for new tables; show rollback SQL.
3. Provide copy-paste SQL + TS client snippets.

## Rules
- Never suggest disabling RLS in production.
- Assume Postgres 15+ syntax.`,
    allowedTools: "read_file web_search web_fetch",
    marketplace: "SkillsMP",
    marketplaceUrl: "https://skillsmp.com",
    version: "4.0.0",
  },
  {
    slug: "notion-writer",
    name: "notion-writer",
    description:
      "Drafts structured Notion-style docs with databases and templates. Use for wikis, meeting notes, and project docs.",
    instructions: `## Procedure
1. Outline: title, properties, sections, action items with owners.
2. Write markdown under documents/ using callouts, toggles-as-details, and tables.
3. End with next-actions checklist.

## Rules
- One owner per action item. No ownerless todos.`,
    allowedTools: "write_file read_file",
    marketplace: "SkillsMP",
    marketplaceUrl: "https://skillsmp.com",
    version: "1.6.2",
  },
  {
    slug: "gmail-triage",
    name: "gmail-triage",
    description:
      "Triages inbox into act-now, waiting, and archive batches. Use when the user asks to clean, summarize, or process email via a connected Gmail.",
    instructions: `## Procedure
1. List recent threads via the connected Gmail connector tools (never ask for passwords).
2. Classify: act-now (needs reply <24h), waiting (blocked on others), FYI/archive.
3. Draft replies for act-now; never send without confirmation.

## Rules
- Destructive sends always need user confirmation.
- Quote message IDs for every claim.`,
    allowedTools: "web_search web_fetch",
    marketplace: "ClawHub",
    marketplaceUrl: "https://clawhub.com",
    version: "2.2.0",
  },
  {
    slug: "calendar-sweep",
    name: "calendar-sweep",
    description:
      "Preps the day: agenda, conflicts, and prep notes. Use for daily briefs, meeting prep, and schedule reviews.",
    instructions: `## Procedure
1. Pull today's events via the connected calendar tools.
2. Flag overlaps, back-to-backs without breaks, and missing prep.
3. Output: timeline table + 3-line prep per important meeting.

## Rules
- Times in the user's local timezone; state the zone.
- Never invent attendees or links.`,
    allowedTools: "web_search web_fetch",
    marketplace: "ClawHub",
    marketplaceUrl: "https://clawhub.com",
    version: "1.8.3",
  },
];
