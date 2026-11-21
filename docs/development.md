# Development and architecture

This page is for running Qube from source, understanding how the pieces fit,
and contributing changes. Everyday users should start with
[Getting started](./getting-started.md) instead.

## Prerequisites

- **Node.js** — the CI uses Node 22, so that is the tested version. The
  repository does not declare an `engines` range.
- **npm** — ships with Node.
- **Rust and the Tauri prerequisites** — only needed to build or run the
  desktop shell. Follow the official
  [Tauri prerequisites](https://tauri.app/start/prerequisites) for your OS
  (on Linux this includes WebKitGTK, GTK, AppIndicator and related libraries).
- **Python 3 with pip** — optional, but needed at runtime if you want the
  agent to produce real `.docx`/`.pptx`/`.xlsx` files: it writes small Python
  scripts using `python-docx`, `python-pptx` or `openpyxl` and installs them
  with pip when missing. The same applies to installed desktop builds.
- A Chrome/Chromium/Edge installation for browser automation.

## Run the web app from source

```bash
git clone https://github.com/QwErTy-2117/Qube.git
cd Qube
npm install
cp .env.example .env.local   # optional: add keys now, or configure them in the app later
npm run dev
```

Open `http://localhost:3010` and complete onboarding. `npm install` and
`npm run dev` also copy the PDF viewer worker into `public/` via
`scripts/sync-pdf-worker.mjs`. The dev server is a
plain Next.js app, so all settings and data are written under the repository
working directory (`.memory/`, `workspace/`) unless you set `QUBE_DATA_DIR`.

The only variable commonly needed in `.env.local` is `COMPOSIO_API_KEY` if
you want connectors while self-hosting — released builds embed a built-in
key, source builds do not. See [Environment variables](./configuration.md).

## Build the desktop app

```bash
# 1. Build the standalone Next.js server bundle used as the Tauri sidecar
#    (writes sidecar-dist/; the script sets TAURI_BUILD=true itself)
node scripts/build-sidecar.js

# 2a. Run the desktop shell during development — Tauri starts `npm run dev`
#     and loads http://localhost:3010
npm run tauri:dev

# 2b. Or package installers for your platform (runs build-sidecar.js again
#     as Tauri's beforeBuildCommand)
npm run tauri:build
```

Step 1 is needed even for `tauri:dev`, because `tauri.conf.json` bundles
`../sidecar-dist/**/*` as a resource and the glob fails if the folder is
missing. Packaged artifacts appear under `src-tauri/target/`. Release builds
also bake `COMPOSIO_API_KEY` from the environment into the sidecar's
`env.json`. The build pipeline
(run in CI on Linux x64/ARM64, Windows x64/ARM64 and macOS arm64/x64)
produces `.deb`/`.rpm`, NSIS/MSI Windows installers, and macOS `.dmg`/`.app`
bundles.

### How the desktop app is put together

The Tauri shell (`src-tauri/`) is a thin native wrapper:

1. On launch it copies the bundled `sidecar-dist` into a writable temp
   directory (`qube-sidecar`), reusing unchanged files between launches. When
   the app version changes, the whole directory — including the `workspace/`
   folder inside it — is deleted and recopied.
2. It starts the bundled Node.js runtime against `server.js` with
   `QUBE_DATA_DIR` pointed at the OS application data directory, on
   `127.0.0.1:3010`. A server already running on that port from the same app
   version (left behind by **Keep background server alive**) is reused;
   one from a different version is ignored and a fresh server is started.
3. The webview points at that local server. A system tray, deep links
   (`qube://`), auto-start and the updater are native Tauri plugins.

## Tests and checks

```bash
npm test          # cross-platform runner: tsx --test against tests/*.test.ts
npm run acp:test  # only tests/acp.test.ts
npx tsc --noEmit  # type checking (strict TypeScript)
cd src-tauri && cargo test   # Rust unit tests for the desktop shell
```

The test runner creates an isolated temporary `QUBE_DATA_DIR` per run, so
tests never touch your real data and work identically on Windows, macOS and
Linux. The CI (`.github/workflows/build.yml`) runs type checking, the
tests and `cargo test`, builds the sidecar, boots the exact bundled artifact
with the packaged Node binary, and smoke-tests the browser MCP service
(`scripts/smoke-mcp.js`) before packaging releases.

## Architecture at a glance

```
Tauri shell (src-tauri/)            Next.js app (app/, components/, lib/)
┌──────────────────────┐            ┌─────────────────────────────────────┐
│ window + tray        │  webview   │ React UI (assistant-ui, workspaces)  │
│ updater + autostart  │ ◀────────▶ │ app/api/* REST + streaming routes   │
│ sidecar process mgr  │   HTTP     └──────────────┬──────────────────────┘
└──────────────────────┘  127.0.0.1:3010           │
                                                    ▼
                              Pi harness (lib/pi/harness.ts)
                              model resolution · tool registry · streaming
                              60-step loop · continuation · compaction
                 ┌────────────┬───────────────┬───────────────┬───────────┐
                 ▼            ▼               ▼               ▼           ▼
           file/shell     web + browser   connectors      memory +     scheduler
           tools          (managed Chrome, (Composio)       skills       (tasks +
           (workspace)     CDP + MCP)                      (.memory)     heartbeat)
```

### Key directories

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js App Router: chat streaming route, settings/connector/scheduler/browser APIs, onboarding pages |
| `components/` | React UI: chat shell, settings dialogs, file/browser workspaces, tool activity cards |
| `lib/pi/` | The authoritative agent harness, system prompt, tool definitions, subagents, scheduling tools, model clients, compaction |
| `lib/agent/` | Shared agent helpers: observability, vision/thinking capability detection, SSRF guards |
| `lib/browser/` | Managed Chromium launch, CDP screencast, cookie jar, the built-in browser MCP service |
| `lib/computer-use/` | OS-level control pipeline (describe → permission → execute → verify → recover) |
| `lib/connectors/` | Composio integration, connector metadata and branding, key storage |
| `lib/memory/`, `lib/skills/`, `lib/learning/`, `lib/proactivity/` | Persistent memory, skills marketplace and learning, proactive-suggestion engine |
| `lib/scheduler/` | 60-second tick scheduler, task store, heartbeat state, announcements |
| `lib/middleware/`, `lib/permissions/` | Workspace resolution and the approval/permission classifier |
| `lib/acp/` | Agent Client Protocol stdio adapter for editors |
| `src-tauri/` | Rust desktop shell, sidecar lifecycle, tray, updater |
| `scripts/` | Sidecar build, test runner, legal-doc sync, migration utilities |
| `tests/` | Node test-runner suites covering every major subsystem |

### Concepts worth knowing before changing code

- **The Pi harness is the only production agent path.** The Codex harness in
  `lib/codex/` is a deprecated forwarding shim; don't add callers to it. A
  separate SQLite-backed durable harness exists behind the
  `PI_DURABLE_ENABLED` flag as an unfinished migration and is not the default.
- **Tools are permission-wrapped, not permission-aware.** Tool definitions
  stay generic; `lib/permissions/policy.ts` (hard Settings switches),
  `lib/permissions/sensitive.ts` (classification),
  `lib/middleware/permission-middleware.ts` (self-review and approval cards)
  decide whether a call runs, prompts, or is denied, including headless
  background runs. Built-in, connector and computer-use tools are wrapped;
  tools from user-added MCP servers currently are not.
- **The browser is a shared managed Chromium** driven over CDP by the
  auto-MCP service (`lib/browser/auto-mcp/server.mjs`) and mirrored into the
  side panel. It is separate from optional OS-level computer use (`ocu`).
- **All durable state is local**: `.memory/`, `.agents/`, browser profiles
  and logs under `QUBE_DATA_DIR`, plus the workspace under the working
  directory or `WORKSPACE_PATH`. Nothing requires a Qube-operated backend.
- **System-prompt behavior is tested.** Several test suites lock in the
  wording of the system prompt and the approval classifier; when changing
  agent behavior, update the matching tests rather than weakening them.

## Contributing

1. Work on a branch and keep changes focused; run `npx tsc --noEmit` and
   `npm test` before opening a pull request. The repository has no ESLint
   or Prettier configuration, so follow the style of the surrounding code.
2. Match existing patterns: tools live in `lib/pi/`, UI cards for tool
   activity in `components/assistant-ui/tools/`, and user-facing strings use
   plain language rather than raw tool names.
3. Add or update tests in `tests/` for behavior changes — the suites are
   fast, network-free and use an isolated data directory.
4. User-visible behavior changes should be reflected in the relevant page of
   `docs/` in the same pull request. The documentation website in
   `docs-site/` is generated from those files — see
   [Documentation website](./docs-site.md).
5. The project is licensed under Apache 2.0 (see [LICENSE](../LICENSE));
   by contributing you agree your changes are provided under that license.
