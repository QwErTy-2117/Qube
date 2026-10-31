# Skills

A skill is a directory containing a `SKILL.md`: YAML front matter (`name`,
`description`, optional `license`) followed by the instructions. Qube keeps
skill bodies out of the system prompt and loads them only when they are
needed, so a large library costs nothing until it is used.

## Where skills live

| Source | Location | Editable | Wins on name clash |
| --- | --- | --- | --- |
| `bundled` | compiled into the app (`lib/skills/bundled/`) | no | no (lowest) |
| `user` | `$QUBE_DATA_DIR/.memory/skills/<name>/SKILL.md` | yes | yes |

- Discovery is deterministic: the bundled registry first, then the skills
  directory sorted by name, with a user skill replacing a bundled skill of the
  same name (the bundled copy is never deleted — it comes back if the user
  skill is removed).
- A directory without a readable `SKILL.md`, with invalid front matter, or
  without a `name`/`description` is skipped with a warning; one bad skill
  never breaks discovery of the others.
- Duplicate names inside the user directory resolve to the lexicographically
  first directory, and the conflict is reported.
- Upgrades refresh bundled definitions in place. User-created skills are
  never overwritten or deleted by an upgrade.

## Precedence and loading

1. The system prompt carries only metadata: name, description and source of
   every enabled skill, plus a short instruction to check them first.
2. When a task matches, the model calls `skill(name)` and gets the `SKILL.md`
   body (truncated at 24k characters). Bodies are never in the prompt.
3. Skills can be disabled for model invocation (`disableModelInvocation`) or
   forced by the user with `/name`.

## Authoring skills

- The model creates and updates skills through `manage_skill`
  (`create` / `update` / `deprecate` / `delete` / `list` / `get`), which
  writes the same `SKILL.md` layout as a hand-written skill.
- The `skill-authoring` bundled skill documents the format and the review
  checklist; the `skill` tool can load it like any other.
- Prefer improving an existing skill over creating a near-duplicate.

## Bundled skills

| Skill | When it applies | Licence | Provenance |
| --- | --- | --- | --- |
| `docx` | Creating or editing Word documents (`docx`) | Original Qube content, Apache-2.0 | Written for Qube; behaviour modelled on the anthropics/skills *ideas*, no text copied |
| `pptx` | Building presentations (`pptx`) | Original Qube content, Apache-2.0 | Written for Qube |
| `xlsx` | Spreadsheets, formulas and recalculation (`xlsx`) | Original Qube content, Apache-2.0 | Written for Qube |
| `pdf` | Reading, extracting from and producing PDFs | Original Qube content, Apache-2.0 | Written for Qube |
| `software-delivery` | Implementing, testing and shipping code | Original Qube content, Apache-2.0 | Written for Qube |
| `frontend-design` | UI/layout/typography work | Original Qube content, Apache-2.0 | Written for Qube |
| `skill-authoring` | Writing or improving a skill | Original Qube content, Apache-2.0 | Written for Qube |

### Provenance and licence audit (anthropics/skills)

Reviewed at https://github.com/anthropics/skills. Findings that shaped the
bundled set:

- The repository is a mix of licences. The document skills directory
  (`document-skills/docx`, `pdf`, `pptx`, `xlsx`) is **source-available, not
  open source**: it may be viewed and used with Claude, but redistribution of
  the content is restricted. Qube therefore ships **no** text, scripts or
  templates from those skills; the `docx`/`pdf`/`pptx`/`xlsx` skills here are
  independent reimplementations written against Qube's own tooling
  (`/api/workspace/document`, the artifact viewers, `sheet-ops`).
- `doc-coauthoring` ships without a licence file. Nothing from it was used.
- The remaining skills are Apache-2.0. Their *structure* (a folder with a
  `SKILL.md` carrying `name`/`description`) is a convention, not copyrightable
  expression, and is implemented here from the published Agent Skills
  specification; no Apache-2.0 skill body was copied verbatim, so no third
  party notices are required.
- The licence of every bundled skill is recorded in its `SkillConfig`
  (`license`, `provenance`) and surfaced through `manage_skill list`.

The curated marketplace snapshot (`lib/skills/marketplace.ts`) is a separate
surface: its rows are Qube-written offline summaries used to browse and preview
before installing, not copies of upstream text, so no third-party licence
attaches to them. Live marketplace rows link back to the upstream repository and
keep their own licence and audit badge.

If a future skill is imported from an Apache-2.0 source, its `NOTICE`/licence
header must be preserved in the skill directory and recorded in the table
above.

## Related reading

- [Memory and skills](./memory-and-skills.md) — how skills fit with memory
- [Permissions and privacy](./permissions-privacy.md) — skills cannot widen tool permissions
- [Development](./development.md) — where the loader, store and tests live
