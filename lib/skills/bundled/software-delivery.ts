/**
 * Bundled skill: software delivery.
 *
 * Original Qube content covering the recon → plan → implement → verify loop
 * for code work in the Qube Computer workspace.
 */

import type { SkillConfig } from "../types";

const INSTRUCTIONS = `# Software delivery

The unit of success is working, verified code — not an explanation of code.

## 1. Recon before writing
- \`list_directory\` the repo root; read \`package.json\` / \`pyproject.toml\` /
  \`Cargo.toml\` to learn the real toolchain. Read the files you intend to touch and
  one neighbour for conventions.
- Find the existing pattern for the thing you are adding (a route, a component, a
  test). Match it; do not invent a second architecture.
- Search before creating: \`run_command('grep -rn "Foo" . --include=*.ts')\`.

## 2. Plan
- Track 3+ steps with TodoWrite, exactly one item in progress.
- Decide the verification command up front (typecheck / unit test / build). If the
  repo has none, create the smallest meaningful check.

## 3. Implement
- Small coherent diffs. No drive-by renames, no formatting churn, no dead code.
- Prefer fixing the cause over adding a special case. Never leave TODOs or
  placeholders that pretend to work.
- Keep public behaviour stable unless the task asks to change it; update callers.

## 4. Verify (do it, do not describe it)
- Run the repo's own commands in order: format/lint → typecheck → tests → build.
- Read the output. A red step is not done; fix and re-run.
- For UI work, run the app and exercise the flow: open it, click through, check the
  console, then stop the server.
- For a bug fix, reproduce first and confirm the fix against the same repro.

## 5. Report
- What changed (paths), how it was verified (exact commands and their result), and
  exactly how to run it (command + URL/port).
- State anything still broken or unverified. Never claim success from static
  reasoning alone.

## Rules
- Do not install heavyweight dependencies to solve a small problem.
- Preserve unrelated working behaviour; if you must change it, say why.
- Never commit secrets, build output or node_modules.`;

export const SOFTWARE_DELIVERY_SKILL: SkillConfig = {
  id: "bundled-software-delivery",
  name: "software-delivery",
  description:
    "Implements, fixes, refactors and verifies code in a repository with tests and a reproducible run command. Use when the user asks to build a feature or app, fix a bug, add tests, migrate an API, or otherwise change a codebase.",
  instructions: INSTRUCTIONS,
  allowedTools:
    "read_file write_file edit_file list_directory run_command present_file",
  userInvocable: true,
  color: "#7E3AF2",
  source: "bundled",
  version: "1.0.0",
  license: "Original Qube content (Apache-2.0, same as the Qube repository)",
  provenance: "Authored for Qube.",
  installedAt: 0,
  updatedAt: 0,
  isSystem: true,
};
