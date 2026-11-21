# Maintainability audit

| Field | Value |
| --- | --- |
| Date | 2026-11-20 |
| Revision audited | `d1e4085` (`chore: bump version to 0.0.118`) |
| Scope | Repository structure, documentation accuracy, code health signals, security-relevant behavior visible from the code |
| Method | Read-only review of the source; no application code, configuration or dependencies were changed |

This report records what was found while rewriting the documentation against
the code. **None of the recommendations below have been implemented.** Each
one is a suggestion for the maintainers to evaluate. Severity is a rough
guide: **High** means users can lose data or be surprised by an
unreviewed action; **Medium** means a real inconsistency or risk with a
workaround; **Low** means housekeeping.

## Summary

| # | Finding | Area | Severity |
| --- | --- | --- | --- |
| 1 | Desktop workspace is deleted on every version update | Data safety | High |
| 2 | Tools from user-added MCP servers bypass the permission layer | Safety | High |
| 3 | Browser-panel actions are not approval-gated | Safety | Medium |
| 4 | Provider API keys are stored in plain text | Security | Medium |
| 5 | Hard Reset does not revoke Composio connections | Privacy | Medium |
| 6 | Terms consent is not versioned | Legal/UX | Medium |
| 7 | Hidden temperature setting: 0.7 vs 0.3 depending on UI history | Behavior | Medium |
| 8 | `keepAlive` default differs between the UI (on) and the shell (off) | Behavior | Medium |
| 9 | Webview Content Security Policy is disabled | Security | Medium |
| 10 | License mismatch: Apache 2.0 vs `MIT` in Tauri and Cargo metadata | Legal | Medium |
| 11 | Dead and unreachable code | Code health | Low |
| 12 | Very large UI and harness files | Code health | Low |
| 13 | No linter or formatter configuration | Code health | Low |
| 14 | Package name and stray top-level folders | Housekeeping | Low |
| 15 | Two question tools with different timeout variables | Consistency | Low |
| 16 | Documentation drift was significant | Docs | Low |
| 17 | Tailwind source detection may scan `docs-site/` | Build | Low |

## Findings

### 1. Desktop workspace is deleted on every version update — High

**Evidence.** The desktop shell runs the server with its working directory set
to a temporary copy of the app, `std::env::temp_dir()/qube-sidecar`
(`sidecar_base_dir` in `src-tauri/src/sidecar.rs`). The workspace resolves to
`<cwd>/workspace` (`lib/middleware/workspace.ts`). When the cached version
differs from the running version, `prepare_sidecar_dir` calls
`fs::remove_dir_all(base)` before recopying, which removes `workspace/` —
including every generated file and chat attachment. Operating systems may
also clean temporary folders on their own.

**Impact.** After an auto-update, file cards and attachments in old chats point
to files that no longer exist. Chats, settings and memory survive because they
are in the application data directory.

**Recommendation.** In desktop builds, set `WORKSPACE_PATH` (or an equivalent)
to a folder under the application data directory or the user's Documents
folder, and migrate an existing temp workspace on first start. Until then, the
user docs warn about this
([Files and the workspace](./files-workspace.md#where-files-live)).

### 2. Tools from user-added MCP servers bypass the permission layer — High

**Evidence.** In `lib/pi/harness.ts`, connector tools are wrapped with
`withPermissionCheck`, but MCP tools from `loadMcpTools` are merged directly
(`tools = { ...tools, ...mcpResult.tools }`). `lib/pi/mcp.ts` only adds error
detail around `execute`.

**Impact.** No hard policy, self-review or approval card applies to MCP tools.
The Destructive actions switch does not affect them.

**Recommendation.** Wrap MCP tools with `withPermissionCheck` (category
`tool`), treating them as sensitive by default, with an opt-out per server for
read-only servers. The user docs currently state the actual behavior
([Custom MCP servers](./mcp.md#security-considerations)).

### 3. Browser-panel actions are not approval-gated — Medium

**Evidence.** The built-in browser automation service
(`lib/browser/auto-mcp/server.mjs`) is loaded as an internal MCP server, so
it follows the same path as finding 2. The system prompt
(`lib/pi/prompt-context.ts`) instructs the agent that purchases and payments
are allowed and to complete checkouts the user asked for.

**Impact.** Form submissions and purchases in the browser depend only on the
model following the request correctly.

**Recommendation.** At minimum, route submit/checkout-like browser actions
through the self-review, or add a Settings switch that requires confirmation
for purchases. Documented in [Browser automation](./browser.md).

### 4. Provider API keys are stored in plain text — Medium

**Evidence.** Keys are written to `.memory/providers.json`. The Composio key and
MCP server environment variables are also stored as plain JSON.

**Recommendation.** Use the OS keychain (for example a Tauri keyring plugin)
for secrets in desktop builds; keep JSON for non-secret settings.

### 5. Hard Reset does not revoke Composio connections — Medium

**Evidence.** `lib/system/hard-reset.ts` removes local state, including
`.memory/composio-user-id`, but does not call the Composio API.
`app/api/connectors/disconnect/route.ts` shows that deletion is possible
(`client.connectedAccounts.delete`).

**Impact.** OAuth grants remain active at Composio under an ID the app no
longer knows.

**Recommendation.** Before deleting local state, disconnect all connected
accounts for the install's user ID, or warn the user in the Hard Reset dialog.

### 6. Terms consent is not versioned — Medium

**Evidence.** Onboarding stores acceptance as `qube-terms-accepted` in local
storage (`components/shared/onboarding-dialog.tsx`) without a version or date
of the document accepted.

**Recommendation.** Store the accepted document version or hash and ask again
when `TERMS.md` / `PRIVACY.md` change materially. See also the
[legal review checklist](./legal-review-checklist.md).

### 7. Hidden temperature setting — Medium

**Evidence.** `lib/pi/harness.ts` defaults to temperature 0.3. The Settings
dialog holds `useState(0.7)` with no visible control and writes it to local
storage (`qube-temperature`) on save and on close;
`components/assistant-ui/agent-runtime-provider.tsx` sends that value with
every chat request.

**Impact.** Fresh installs use 0.3 until Settings is opened once, then 0.7
forever, with no way to change it in the UI.

**Recommendation.** Either expose the control or remove the hidden state and
rely on the harness default.

### 8. `keepAlive` default mismatch — Medium

**Evidence.** The Settings dialog initializes `keepAlive` to `true`;
`read_app_settings` in `src-tauri/src/lib.rs` treats a missing value as
`false`.

**Impact.** Until settings are saved once, closing the window quits Qube even
though the switch appears on, and scheduled tasks stop.

**Recommendation.** Pick one default and apply it in both places (or write the
default to `app-settings.json` on first run).

### 9. Webview Content Security Policy is disabled — Medium

**Evidence.** `"csp": null` in `src-tauri/tauri.conf.json`.

**Recommendation.** Define a CSP that allows the local server origin and the
known external resources (provider APIs are called server-side, so the
webview needs few external origins).

### 10. License mismatch — Medium

**Evidence.** `LICENSE` is Apache 2.0 and the README says Apache 2.0, but
`src-tauri/tauri.conf.json` (`bundle.license`) and `src-tauri/Cargo.toml`
declare `MIT`. Installers therefore carry MIT metadata.

**Recommendation.** Align the metadata with the actual license.

### 11. Dead and unreachable code — Low

- `lib/connectors/connectors.ts` (an older connector catalog) has no callers.
- `app/api/providers/validate/route.ts` exists, but Settings and onboarding
  validate keys through `/api/providers/models`.
- `components/shared/prompt-pill.tsx` is no longer imported.
- The "Clear Memories / Clear Sessions" confirmation dialog in
  `settings-dialog.tsx` has no control that opens it, so the memory and
  session delete endpoints have no UI.
- `lib/codex/` is a deprecated forwarding shim.
- `app/pptx-test/page.tsx` is a test page shipped in production builds.
- `scripts/reproduce-settings-dialog-close.mjs` looks like a one-off
  debugging script.

**Recommendation.** Remove or wire up each item. Exposing memory deletion in
Settings would also help users and the privacy policy.

### 12. Very large files — Low

`components/shared/settings-dialog.tsx` is about 3,600 lines;
`lib/pi/harness.ts` and `components/examples/base.tsx` are about 1,500 lines
each. Splitting Settings by tab and the harness by phase (setup, tool
assembly, loop, continuation) would make review and testing easier.

### 13. No linter or formatter — Low

There is no ESLint or Prettier configuration. TypeScript runs in strict mode
and CI type-checks, which catches a lot, but unused code (finding 11) would be
flagged automatically by a linter.

### 14. Package name and stray top-level folders — Low

- `package.json` is named `xulux-base-demo`.
- `Qube/` is an Obsidian vault with two near-empty notes.
- `rakazo/install-images.sh` downloads from an unrelated repository
  (`elie222/rakazo`) and is not referenced by the app or CI.

**Recommendation.** Rename the package to `qube`, and remove or move the two
folders if they are not needed.

### 15. Two question tools with different timeouts — Low

`ask_question` (multi-question panel, `lib/pi/tools.ts`) uses
`PERMISSION_TIMEOUT_MS`, while `ask_user` (`lib/pi/agent-tools.ts`) uses
`ASK_USER_TIMEOUT_MS`. Both default to five minutes, so this only matters
when someone changes one variable.

### 16. Documentation drift — Low

Before this rewrite, the docs stated a 40-step limit (the code uses 60), a
Settings temperature control that does not exist, a "chat probe" during key
validation (only the model list is fetched), approval cards for every delete
(deletes are blocked by default instead), approval for MCP tools, a
Confluence connector, and an `OPENUI_ENABLED` variable that is no longer
read. To keep the docs in sync, the contribution guide asks for doc updates
in the same pull request; a lightweight check (for example a test that every
`process.env.*` name appears in `docs/configuration.md`) would catch the
most common drift.

### 17. Tailwind source detection may scan `docs-site/` — Low

The app's `app/globals.css` uses `@import "tailwindcss"` with automatic source
detection, which scans the project tree except gitignored paths. The
committed `docs-site/` sources (JSX with Tailwind classes) could add a few
unused classes to the app's CSS. This has no functional effect. If it matters,
add `@source not "../docs-site";` to the app's CSS — this audit did not
change it.

## What looks healthy

- **Tests:** 112 `node:test` suites in `tests/`, run in CI on all platforms
  with an isolated data directory.
- **CI:** the release workflow type-checks, tests, runs `cargo test`, and
  smoke-tests the exact bundled sidecar before packaging.
- **Permission design:** layered policy → self-review → approval card, with
  stricter headless behavior and draft-only heartbeat tools.
- **Clear separation of state:** all durable state under one data directory,
  with a thorough Hard Reset.
- **Execution limits** are centralized and tested
  (`lib/pi/execution-limits.ts`).
