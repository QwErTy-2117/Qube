# Environment variables

Environment variables matter when you [run Qube from source](./development.md)
or self-host the web server. The installed desktop app is configured almost
entirely through its in-app Settings screen, and most people never touch
these.

In development, Next.js loads variables from `.env.local` (copy the provided
`.env.example` as a starting point). In a desktop build, the release pipeline
bakes the connector key into an `env.json` next to the server; everything else
can be set in the app.

## Variables you are most likely to need

| Variable | Purpose |
| --- | --- |
| `COMPOSIO_API_KEY` | Key for [connected apps](./connectors.md). Required when building from source; released desktop builds already embed a built-in key, and you can also set your own in **Settings → Advanced → Composio API Key**. Get one at the [Composio dashboard](https://dashboard.composio.dev/settings). |
| `QUBE_DATA_DIR` | Directory for all durable state (`.memory/`, browser profile, logs, SQLite). Defaults to the current working directory in source runs; the desktop app points it at the [application data directory](./permissions-privacy.md#where-your-data-is-stored). |
| `WORKSPACE_PATH` | Absolute path to the file workspace. Defaults to `./workspace` under the working directory (a legacy `./playground` folder is used if it already exists). |
| `WORKSPACE_DIR_NAME` | Folder name for the workspace when `WORKSPACE_PATH` is not set (default `workspace`). |
| `LWC_SECRET` | Secret used to sign ChatGPT sign-in session cookies. If unset, Qube generates and persists one in `.memory/lwc-secret.txt`, so this is mainly needed for stable multi-deploy hosting. Generate with `openssl rand -hex 32`. |
| `PORT` | Port for the local web server (the dev script uses `3010`; the desktop sidecar defaults to `3010`). |

## ChatGPT sign-in

| Variable | Purpose |
| --- | --- |
| `LWC_SECRET` | Signing secret for session cookies (see above). Rotating it signs everyone out. |
| `LWC_CLIENT_VERSION` | Pins the Codex client version used for ChatGPT model discovery. By default Qube tracks the latest `@openai/codex` release automatically; only pin it if discovery misbehaves. |
| `LWC_DEFAULT_MODEL` | Fallback ChatGPT model for requests that don't name one. |

## Qube Computer

See [Qube Computer](./computer.md) for the full feature context: the
persistent runtime, its browser profile, attachments and reset.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUBE_DATA_DIR` | app data dir | Where the `.computer/` runtime directory lives. |
| `CHROME_PATH` | auto-detect | Absolute path to the Chrome/Chromium/Edge binary used by the computer browser. |
| `QUBE_COMPUTER_BROWSER_PORT` | `9223` | DevTools port for the computer browser. |
| `QUBE_COMPUTER_BROWSER_HEADED` | off (headless) | Set to `1` to show the browser window. |

## Agent execution limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_HARNESS_TIMEOUT_MS` | `300000` (5 min) | Hard timeout for one interactive chat run. |
| `QUBE_SILENT_CONTINUATIONS` | `8` | Extra silent continuation rounds when goals remain unfinished; `0` disables them. |
| `PI_TASK_TIMEOUT_MS` | `180000` | Timeout for one background task run. |
| `PI_TASK_HEARTBEAT_STEPS` | `12` | Max tool steps for a check-in run. |
| `PI_TASK_SCHEDULED_STEPS` | `20` | Max tool steps for a scheduled task run. |
| `PI_TASK_MAX_ROUNDS` | `3` | Continuation rounds inside a background run. |
| `PI_SUBAGENT_TIMEOUT_MS` | `180000` | Timeout for a subagent. |
| `PI_MCP_TIMEOUT_MS` | `45000` | Startup/communication timeout for custom MCP servers. |
| `PI_CONNECTOR_TIMEOUT_MS` | `30000` | Timeout for connector (Composio) tool calls. |
| `PERMISSION_TIMEOUT_MS` | `300000` | How long an approval card waits before timing out. |
| `ASK_USER_TIMEOUT_MS` | `300000` | How long a question panel waits for an answer. |

## Memory, compaction and UI

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENUI_ENABLED` | enabled | Set to `false` to turn off inline generative UI cards/charts and keep plain Markdown plus the `generate_ui` sandbox. |
| `QUBE_COMPACTION_ENABLED` | enabled | Set to `false` to disable automatic context compaction (the manual compaction endpoint still works). |
| `QUBE_COMPACTION_CONTEXT_TOKENS` | `128000` | Assumed model context window when the provider reports none. |
| `QUBE_COMPACTION_RESERVE_TOKENS` | `20000` | Headroom below the window that triggers compaction. |
| `QUBE_COMPACTION_KEEP_RECENT_TOKENS` | `15000` | Recent history kept verbatim alongside the summary. |
| `QUBE_COMPACTION_SUMMARY_TOKENS` | `4096` | Maximum size of a generated summary. |
| `QUBE_COMPACTION_TOOL_CHARS` | `2000` | Per-tool-output truncation when serializing history for a summary. |

## ACP and experimental flags

| Variable | Purpose |
| --- | --- |
| `QUBE_MODEL` | Default model as `provider:model` for [ACP editor sessions](./acp.md); falls back to the app's configured default. |
| `PI_DURABLE_ENABLED` | Set to `1` to route chat through the experimental SQLite-backed durable harness instead of the default in-memory Pi harness. Unfinished migration path — not recommended for daily use. |

## How settings interact

- In-app **Settings** (providers, memory toggle, custom instructions, run
  on start, keep-alive, temperature) are stored in `.memory/app-settings.json`
  and related files under `QUBE_DATA_DIR`; they apply regardless of how the
  server was launched.
- Environment variables fill in what the app settings don't cover and are
  useful for containers and CI. When both exist, the in-app setting generally
  wins for user-facing preferences, while build-time variables such as
  `COMPOSIO_API_KEY` are read directly.
