# Development and architecture

This page is for running Qube from source, understanding how the pieces fit,
and contributing changes. Everyday users should start with
[Getting started](./getting-started.md) instead.

## Prerequisites

- **Node.js** — the CI uses Node 22; use a current LTS (20 or newer).
- **npm** — ships with Node.
- **Rust and the Tauri prerequisites** — only needed to build or run the
  desktop shell. Follow the official
  [Tauri prerequisites](https://tauri.app/start/prerequisites) for your OS
  (on Linux this includes WebKitGTK, GTK, AppIndicator and related libraries).
- **Python 3 with pip** — optional, but needed at runtime if you want the
  agent to produce real `.docx`/`.pptx`/`.xlsx` files.
- A Chrome/Chromium/Edge installation for browser automation.

## Run the web app from source

```bash
git clone https://github.com/QwErTy-2117/Qube.git
cd Qube
npm install
cp .env.example .env.local   # optional: add keys now, or configure them in the app later
npm run dev
```

Open <http://localhost:3010> and complete onboarding. The dev server is a
plain Next.js app, so all settings and data are written under the repository
working directory (`.memory/`, `workspace/`) unless you set `QUBE_DATA_DIR`.

The only variable commonly needed in `.env.local` is `COMPOSIO_API_KEY` if
you want connectors while self-hosting — released builds embed a built-in
key, source builds do not. See [Environment variables](./configuration.md).

## Build the desktop app

```bash
# 1. Build the standalone Next.js server bundle used as the Tauri sidecar
TAURI_BUILD=true node scripts/build-sidecar.js

# 2a. Run the desktop shell against the dev server during development
npm run tauri:dev

# 2b. Or package installers for your platform
npm run tauri:build
```

Packaged artifacts appear under `src-tauri/target/`. The build pipeline
(run in CI on Linux x64/ARM64, Windows x64/ARM64 and macOS arm64/x64)
produces `.deb`/`.rpm`, NSIS/MSI Windows installers, and macOS `.dmg`/`.app`
bundles.

### How the desktop app is put together

The Tauri shell (`src-tauri/`) is a thin native wrapper:

1. On launch it copies the bundled `sidecar-dist` into a writable temp
   directory (`qube-sidecar`), reusing unchanged files between launches and
   rebuilding on version changes.
2. It starts the bundled Node.js runtime against `server.js` with
   `QUBE_DATA_DIR` pointed at the OS application data directory, on
   `127.0.0.1:3010`.
3. The webview points at that local server. A system tray, deep links
   (`qube://`), auto-start and the updater are native Tauri plugins.

## Tests and checks

```bash
npm test          # cross-platform runner: tsx --test against tests/*.test.ts
npm run acp:test  # the ACP integration tests only
npx tsc --noEmit  # type checking (strict TypeScript)
```

The test runner creates an isolated temporary `QUBE_DATA_DIR` per run, so
tests never touch your real data and work identically on Windows, macOS and
Linux. The CI additionally builds the sidecar, boots the exact bundled
artifact with the packaged Node binary, and smoke-tests the browser MCP
service on all three operating systems.

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
                              40-step loop · continuation · compaction
                 ┌────────────┬───────────────┬───────────────┬───────────┐
                 ▼            ▼               ▼               ▼           ▼
           file/shell     web + browser   connectors      memory +     scheduler
           tools          (managed Chrome, (Composio)       skills       (tasks +
           (workspace)     CDP + MCP)                      (.memory)     heartbeat)
```

### Key directories

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js App Router: chat streaming route, settings/connector/scheduler/computer APIs, onboarding pages |
| `components/` | React UI: chat shell, settings dialogs, artifact viewers, the Qube Computer panel, tool activity cards |
| `lib/pi/` | The authoritative agent harness, system prompt, tool definitions, subagents, scheduling tools, model clients, compaction |
| `lib/dev-server/` | Workspace dev-server registry for the edit → run → observe loop |
| `lib/agent/` | Shared agent helpers: observability, vision/thinking capability detection, SSRF guards |
| `lib/computer/` | Qube Computer runtime: confined paths/commands, persistent Chromium profile, attachments, tools |
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
  stay generic; `lib/middleware/permission-middleware.ts` and
  `lib/permissions/sensitive.ts` decide whether a call runs, prompts, or is
  denied, including headless background runs.
- **The computer is one persistent runtime.** `lib/computer/` owns the
  directory tree, the confined command environment, the Chromium profile and
  the tool surface; `app/api/computer` is only a read-mostly view of it. There
  is no second browser bridge or OS-automation driver. Resetting the computer
  is explicit — an app hard reset never deletes its files.
- **All durable state is local**, under `QUBE_DATA_DIR` (`.memory/`,
  workspace, browser profile). Nothing requires a Qube-operated backend.
- **System-prompt behavior is tested.** Several test suites lock in the
  wording of the system prompt and the approval classifier; when changing
  agent behavior, update the matching tests rather than weakening them.

## Contributing

1. Work on a branch and keep changes focused; run `npx tsc --noEmit` and
   `npm test` before opening a pull request.
2. Match existing patterns: tools live in `lib/pi/`, UI cards for tool
   activity in `components/assistant-ui/tools/`, and user-facing strings use
   plain language rather than raw tool names.
3. Add or update tests in `tests/` for behavior changes — the suites are
   fast, network-free and use an isolated data directory.
4. User-visible behavior changes should be reflected in the relevant page of
   `docs/` in the same pull request.
5. The project is licensed under Apache 2.0 (see [LICENSE](../LICENSE));
   by contributing you agree your changes are provided under that license.
