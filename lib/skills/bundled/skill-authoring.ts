/**
 * Bundled skill: authoring new skills.
 *
 * Original Qube content describing the Agent Skills format and how to add a
 * reusable skill through Qube's own skill system.
 */

import type { SkillConfig } from "../types";

const INSTRUCTIONS = `# Authoring a skill

A skill is a small, self-contained directory with a \`SKILL.md\`: metadata that
tells you *when* to load it, and a body that tells you *how* to do the work.
Create one only when the procedure will genuinely be reused.

## When to create one
Create a skill when ALL of these are true:
- the workflow has at least two non-obvious steps;
- it will recur (same kind of request, same source system, same output format);
- no existing skill already covers it (check the skill list first — improve that
  one instead of adding a near-duplicate);
- you can state when NOT to use it.

Do not create skills for one-off facts, personal preferences, or moods. Facts
belong in memory; preferences belong in memory; repeatable procedures belong here.

## Format
\`\`\`
---
name: quarterly-report            # lowercase-hyphens, ≤64 chars, unique
description: Builds the quarterly board pack from the finance export. Use when
  the user asks for a quarterly report, board pack, or finance summary.
license: Original Qube content (Apache-2.0)
---
# Quarterly report

## When to use
...trigger conditions and non-goals...

## Steps
1. ...
2. ...

## Verify
- ...

## Rules
- ...
\`\`\`

- \`name\` + \`description\` are the only parts always visible. Make the description
  do the routing work: what it does, when to use it, when not to.
- Keep the body under ~200 lines. Move long references and scripts into sibling
  files (\`reference.md\`, \`scripts/foo.py\`) and point to them.
- Write procedures, not transcripts. Generalize: no single URL, no specific date,
  no hardcoded personal data.
- Never put secrets, tokens or private customer data in a skill.

## Create it through Qube
Use \`manage_skill\` with \`action: "create"\` (or "update" when it exists):
- \`name\` — lowercase-hyphens.
- \`description\` — what + when, one or two sentences.
- \`instructions\` — the SKILL.md body.
- \`whenToUse\` — the trigger sentence used in the description.

Qube stores it as \`SKILL.md\` in your skills directory, next to the bundled
skills, so it survives restarts and upgrades. It is available immediately in
this session.

## Maintain it
- After using a skill, note what was wrong. Fix the skill instead of working
  around it next time.
- If two skills overlap, merge them into the better one and delete the other.
- Deprecate (\`manage_skill action: "deprecate"\`) skills that no longer apply
  rather than leaving misleading instructions around.`;

export const SKILL_AUTHORING_SKILL: SkillConfig = {
  id: "bundled-skill-authoring",
  name: "skill-authoring",
  description:
    "Explains how to write, validate and maintain a reusable SKILL.md and how to register it with manage_skill. Use when a recurring workflow needs a new skill, or when an existing skill is stale, overlapping or being corrected.",
  instructions: INSTRUCTIONS,
  allowedTools: "manage_skill skill read_file write_file list_directory",
  userInvocable: true,
  color: "#0284C7",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance:
    "Original text written against the public Agent Skills specification (agentskills.io). Concept inspired by Anthropic's Apache-2.0 `skill-creator`; no text copied.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
