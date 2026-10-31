# Memory and skills

Qube improves the more you use it — not by sending your data somewhere, but
by keeping notes on your machine and reusing proven ways of working. This
page explains the two systems behind that: **memory** (what it knows about
you) and **skills** (how it does particular kinds of jobs).

## Long-term memory

### What Qube remembers

While you work, Qube saves durable facts such as:

- your name and how you like answers written;
- projects, tools and technical decisions;
- constraints, goals and preferences (for example “vegetarian”, “concise
  answers”, “uses Postgres”);
- reusable lessons from tasks that went wrong or worked well.

It deliberately skips ephemeral one-off details and never stores passwords,
API keys or tokens — a safety filter runs on every memory write to redact
secrets. Memories are generalized: it keeps the reusable principle, not the
raw incident.

### How memory is used

- Relevant memories and an index of past chats are automatically added to the
  context of new conversations, so Qube doesn't ask for something it already
  knows.
- It can search memory explicitly when the automatic context isn't enough,
  and read past conversations to answer “what did we decide about X?”.
- Saves happen silently in the background after meaningful tasks. Small talk
  doesn't create memories.

Confidence is tracked: something you state explicitly is high-confidence; a
single guess stays low-confidence and can decay. When new information
contradicts an old memory, Qube narrows or conditions the preference rather
than blindly overwriting it.

### Turning memory off

**Settings → Advanced → Memory** toggles the whole system. When off, Qube
neither reads nor writes persistent memory, and the memory tools are removed
from runs entirely. Existing memory files remain on disk until you delete
them.

### Where it is stored

Memory lives in the `.memory/` folder inside your
[application data directory](./permissions-privacy.md#where-your-data-is-stored)
(`memory.json` and related files), alongside settings and chat sessions —
local-first, with no separate cloud account.

## Chat history

Every conversation is saved locally with an automatic title (which you can
rename), a transcript and, for longer threads, compaction checkpoints. Use
**Search chats** in the sidebar (`⌘K`/`Ctrl+K`) to find anything you've
discussed. Full history stays on disk even when the model's working context
has been compacted — see [Having conversations](./conversations.md#long-conversations-automatic-compaction).

## Skills

A skill is a reusable playbook: instructions that steer how Qube handles a
particular kind of task, including which tools it may use.

### Built-in skills

Seven skills ship with Qube, always available and not deletable:

| Skill | When it applies |
| --- | --- |
| `docx` | Creating and editing Word documents |
| `pptx` | Building slide decks |
| `xlsx` | Spreadsheets, formulas and recalculation |
| `pdf` | Reading, extracting from and producing PDFs |
| `software-delivery` | Implementing, testing and shipping code |
| `frontend-design` | UI, layout and typography work |
| `skill-authoring` | Writing or improving a skill |

Skills are folders with a `SKILL.md`. Qube lists their names and descriptions
in the prompt and loads a body only when the work actually calls for it, so a
large skill library costs nothing until it is used. Qube picks the relevant
skill automatically; you can force one by starting a message with its name, for
example `/docx turn these notes into a report`.

Every skill records its licence and provenance, and you can see them in
**Settings → Skills**. The provenance and licence audit of the Anthropic Skills
repository is documented in [Skills](./skills.md).

### The skills marketplace

**Settings → Skills** offers a curated catalog plus a live marketplace:

- Curated entries are hand-reviewed (for example `deep-research`,
  `code-review-pro`, `gmail-triage`, `pdf-master`).
- Live entries come from the public skills registry and carry a security
  badge: **safe** (audited with no high/critical findings), **review**
  (medium-severity notes — read the preview first), **unaudited**, or
  **curated**. Entries with high or critical audit findings are hidden
  entirely.

Review a skill's instructions before installing, exactly as you would for any
software that can call tools on your behalf.

### Your own skills

You can create a custom skill in the same screen or by writing a `SKILL.md`
folder under `.memory/skills/`. Qube can also create and improve skills itself
through `manage_skill`, and it is instructed to prefer improving an existing
skill over adding a near-duplicate. Your skills win over bundled skills with
the same name and survive app upgrades; unused skills can be deprecated or
deleted. The full format and precedence rules are in [Skills](./skills.md).

## Related reading

- [Permissions and privacy](./permissions-privacy.md) — what is stored and what reaches your AI provider
- [Automations](./automations.md) — how memory feeds background checks and proactive suggestions
