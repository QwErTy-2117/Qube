# Troubleshooting

Start here when something doesn't work. Problems are grouped by symptom, with
the most common cause first.

## Where the logs are

The desktop app writes its local-server log to `sidecar.log` inside the
[application data directory](./permissions-privacy.md#where-your-data-is-stored)
(`~/.local/share/com.qube.desktop` on Linux, `~/Library/Application Support/com.qube.desktop`
on macOS, `%APPDATA%\com.qube.desktop` on Windows). In source runs, logs go to
the terminal where `npm run dev` is running.

## Setup and onboarding

### “No model configured” when sending a message

Qube has no built-in AI. Sign in with ChatGPT in **Settings → Preferences**,
or add a provider API key or a local Ollama/LM Studio server in **Settings →
Advanced → Providers & Models**, then pick a model in the composer's model
picker. See
[Choose your AI](./ai-providers.md).

### The desktop app says the local server failed to start

Open `sidecar.log` and look at the end of the file. Typical causes:

- An incomplete install (missing `sidecar-dist/server.js`) — reinstall Qube.
- Port 3010 is normally not a problem: if another process holds it, the
  sidecar picks a free port automatically and points the window at it.
- A bundled runtime that doesn't match your architecture — download the build
  for your platform/architecture from the
  [Releases page](https://github.com/QwErTy-2117/Qube/releases).

### Settings show the wrong version after an update

The version in Settings always comes from the desktop binary. If it looks
stale, the temporary sidecar copy (`<temp>/qube-sidecar` or
`<temp>/qube-sidecar-*`) was not rebuilt.
Restart Qube; if it persists, quit the app, delete that temp folder, and
restart.

## AI provider errors

Qube rewrites raw provider errors into plain language, but the fixes map
cleanly:

| Symptom in chat | Cause | Fix |
| --- | --- | --- |
| Invalid key / `401` / unauthorized | Wrong or rotated API key | Re-enter the key in **Settings → Advanced → Providers & Models** |
| Rate limit / `429` / quota | Chat credits or rate window exhausted on the provider | Check provider billing, wait 1–2 minutes, use a smaller model, or switch providers |
| `403` / blocked upstream | Workspace flagged or model disabled on the account | Check the provider dashboard |
| Model not found / `404` | Model renamed or retired | Use **Save & Fetch Models** again and pick from the live list |
| ChatGPT sign-in missing or expired | Session expired | Sign in again in **Settings → Preferences** |
| ChatGPT usage limit | Plan limit enforced by OpenAI | Wait for the reset window, pick a smaller model, or use another provider |
| OpenCode Zen free-tier block | Zen free models only work in OpenCode's own client | Add Zen billing and use a paid Zen model, or switch providers |

Listing models successfully in Settings does not guarantee chat works — the
key check only fetches the provider's model list, while quotas, billing and
account blocks are only visible on a real chat request. See
[Choose your AI](./ai-providers.md#why-a-working-key-can-still-fail-in-chat).

### Local models (Ollama / LM Studio) won't respond

- Confirm the local server is running and serving the default endpoints
  (`http://localhost:11434/v1` for Ollama, `http://localhost:1234/v1` for LM
  Studio).
- Pull at least one model (`ollama pull <model>`) and make sure the model is
  activated in Qube's model list.
- Small local models may fail multi-step tool tasks; try a larger model or a
  cloud provider for complex jobs.

## Browser automation

### Browser tasks fail with “no browser” or launch errors

Qube needs a Chromium-based browser on the system. Install Google Chrome or
Chromium (on Windows, the built-in Edge is detected automatically). If your
browser is in a non-standard location, set `CHROME_PATH` to its binary — see
[Environment variables](./configuration.md).

### A “Browser Use … Connection closed” warning appears in chat

The built-in browser service could not start. In a source checkout, ensure the
repository is complete (the service script lives at
`lib/browser/auto-mcp/server.mjs`) and dependencies are installed. In a
desktop install, this normally means an incomplete or corrupted bundle —
reinstall the app. You can silence the service with `BROWSER_MCP_DISABLED=1`
while troubleshooting.

### The browser panel says it's temporarily busy

Only one agent can drive the browser at a time. Wait for the current run to
finish; file and shell tools keep working in the meantime.

### A login or 2FA stops the task

That's intended — Qube requests a takeover. Click into the Browser panel,
complete the human step yourself, and confirm to resume. CAPTCHAs and bot
checks are handled by Qube automatically. The request waits up to fifteen
minutes.

## Computer use

### Actions return an install hint

The `ocu` driver isn't installed. Install Node.js, then:

```bash
npm i -g open-computer-use
ocu doctor
```

Full instructions in [Computer use](./computer-use.md).

### On macOS, `ocu doctor` or actions report permission errors

Grant **Accessibility** and **Screen Recording** to the host application in
**System Settings → Privacy & Security**, then restart Qube. Read-only app
listing works without these; seeing and controlling windows does not.

### Clicks land in the wrong place

Window state changes invalidate element references quickly. Qube normally
re-reads the app state and retries; if it keeps missing, stop the run, ask it
to observe the app again, and prefer `computer_run_sequence` over single
clicks.

## Files, documents and the workspace

### Office files (.docx/.pptx/.xlsx) fail or fall back to Markdown/CSV

Office generation requires Python 3 with pip so Qube can install
`python-docx`, `python-pptx` and `openpyxl`. Verify with:

```bash
python3 --version
python3 -m pip --version
```

Install Python if missing, then ask Qube to regenerate the file. See
[Files and the workspace](./files-workspace.md).

### Access to a folder keeps asking for permission

Add the folder once in **Settings → Preferences → Allowed directories** with
read or read/write access. Qube will then stop prompting for paths inside it.

### A file card can't be opened after an app update

In the installed app, updating to a new version deletes the temporary server
copy that holds the workspace, so older file cards and attachments point to
files that no longer exist. Those files cannot be recovered by Qube. In
future, use the **Download** button on file cards to keep deliverables. Your
chats, settings and memory are unaffected — they live in the application data
directory. See [Files and the workspace](./files-workspace.md#where-files-live).

## Connectors and connected apps

### No connector tools appear / “connect it in Settings”

The app isn't connected. Open **Settings → Connectors**, connect it through
the browser sign-in, and make sure it shows as connected before retrying.

### Source build: connector connection fails immediately

Released builds embed a Composio key; source builds need your own. Set
`COMPOSIO_API_KEY` in `.env.local` (or the environment), restart the dev
server, or enter the key in **Settings → Advanced → Composio API Key**.

### A send/create action keeps waiting

When the self-review is unsure, a sensitive connector action pauses on an
approval card until you approve or deny. Unanswered cards time out after five
minutes and the action is cancelled. Background check-ins never send at all —
they only draft.

### “Blocked: … turned off in Settings → Advanced → Heartbeat and Task”

The action falls under a switch that is off — most often **Destructive
actions** (deleting files, `rm -rf`, merging pull requests, closing issues),
which is off by default. Turn it on under **Settings → Advanced → Heartbeat
and Task → Configure** only if you want Qube to be able to do this; it will
still be reviewed and, if needed, shown as an approval card.

## Scheduled tasks and automations

### Tasks never run when Qube is closed

That's expected: the scheduler runs inside the Qube process. Keep the app open
(with **Keep background server alive** enabled) and consider **Run on start**. Overdue
tasks run once, deduplicated, when Qube reopens. See
[Automations](./automations.md).

### A scheduled task is allowed but does nothing in the background

Check the task's permission switches (shell, web, external files, destructive
commands) and the global switches under **Settings → Advanced → Heartbeat and
Task → Configure** — a background task cannot prompt, so any action outside
its permissions, or one the self-review does not clearly approve, is refused.
Background runs also cannot use a ChatGPT sign-in model; make sure at least
one API-key or local model is enabled. Ask Qube for the task's recent runs to
see the exact failure.

## MCP servers

### A custom MCP server shows a startup warning

Qube isolates failing servers, so the rest keeps working. Check:

- The command and arguments run correctly in a terminal.
- On Windows, npm shims (`npx`, `uvx`, `.cmd`/`.bat`) are handled
  automatically, but a bare missing binary still fails — use an absolute path
  if PATH is minimal.
- Required environment variables are set on the server entry in Settings.

Only stdio MCP servers are supported; HTTP/SSE servers won't connect.

## Resetting everything

For a fresh start without uninstalling, use **Settings → Advanced → Hard
Reset**. It signs out of ChatGPT, pauses and clears background work, removes
all local state files (providers, sessions, memory, tasks, heartbeat work,
announcements, settings, connector keys, learned skills, diagnostics, the
durable database and browser profiles), deletes workspace deliverables
including saved chat attachments, clears browser storage and the webview's
native browsing data, and reloads or restarts Qube with fresh defaults. This
cannot be undone, so download any files you want to keep first. If you set
`WORKSPACE_PATH` to a folder outside the
[application data directory](./permissions-privacy.md#where-your-data-is-stored),
remove that external folder separately.

## Reporting a problem

When an issue survives this page, include in your report:

1. The Qube version from **Settings** and your operating system.
2. The relevant tail of `sidecar.log`.
3. The exact request you sent and whether a connector or local model was
   involved, with any provider error text shown in the chat.
