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

Qube has no built-in AI. Add one in **Settings → Providers & Models** —
sign in with ChatGPT, paste a provider API key, or add a local Ollama/LM
Studio server — and set a default model. See
[Choose your AI](./ai-providers.md).

### The desktop app says the local server failed to start

Open `sidecar.log` and look at the end of the file. Typical causes:

- An incomplete install (missing `sidecar-dist/server.js`) — reinstall Qube.
- Port 3010 already occupied by another process — close it or restart Qube;
  the sidecar falls back to a free port automatically and reconnects the
  window.
- A bundled runtime that doesn't match your architecture — download the build
  for your platform/architecture from the
  [Releases page](https://github.com/QwErTy-2117/Qube/releases).

### Settings show the wrong version after an update

The version in Settings always comes from the desktop binary. If it looks
stale, the temporary sidecar copy (`<temp>/qube-sidecar`) was not rebuilt.
Restart Qube; if it persists, quit the app, delete that temp folder, and
restart.

## AI provider errors

Qube rewrites raw provider errors into plain language, but the fixes map
cleanly:

| Symptom in chat | Cause | Fix |
| --- | --- | --- |
| Invalid key / `401` / unauthorized | Wrong or rotated API key | Re-enter the key in **Settings → Providers & Models** |
| Rate limit / `429` / quota | Chat credits or rate window exhausted on the provider | Check provider billing, wait 1–2 minutes, use a smaller model, or switch providers |
| `403` / blocked upstream | Workspace flagged or model disabled on the account | Check the provider dashboard |
| Model not found / `404` | Model renamed or retired | Refresh models in Settings and pick from the live list |
| ChatGPT sign-in missing or expired | Session expired | Reconnect in **Settings → ChatGPT** |
| ChatGPT usage limit | Plan limit enforced by OpenAI | Wait for the reset window, pick a smaller model, or use another provider |
| OpenCode Zen free-tier block | Zen free models only work in OpenCode's own client | Add Zen billing and use a paid Zen model, or switch providers |

Listing models successfully in Settings does not guarantee chat works —
quotas and workspace blocks are only visible on a real chat request, which is
why Qube runs a chat probe during validation.

### Local models (Ollama / LM Studio) won't respond

- Confirm the local server is running and serving the default endpoints
  (`http://localhost:11434/v1` for Ollama, `http://localhost:1234/v1` for LM
  Studio).
- Pull at least one model (`ollama pull <model>`) and make sure the model is
  activated in Qube's model list.
- Small local models may fail multi-step tool tasks; try a larger model or a
  cloud provider for complex jobs.

## Qube Computer

### “No Chrome/Chromium found”

The computer's browser needs a Chromium-based browser on the system. Install
Google Chrome, Chromium or Microsoft Edge, or point `CHROME_PATH` at the binary
— see [Environment variables](./configuration.md). Files and `computer_run`
keep working without a browser; only `computer_browser` needs it.

### The browser opens but a page looks empty or stale

Read the page again (`computer_browser` action `read`) before acting: a
navigation or a form submit may still have been in flight. If the window was
closed by hand, the next `open`/`navigate` starts a new instance with the same
profile (cookies and logins are kept).

### A command fails or times out

`computer_run` has a bounded timeout (120 s by default, 600 s maximum) and
capped output, and the process tree is killed when the timeout fires. Read the
stderr in the result and the activity journal in the Qube Computer panel. For a
long-running process, start a dev server instead of blocking a command.

### “Path escapes the computer”

Paths are relative to the computer's home, and `..`, absolute paths and
symlinks that leave the runtime are refused. Move the file in with
`computer_import` (which asks for approval) or write it to a path inside the
computer.

### Attachments do not appear

Stage them again from chat: files are copied into `.computer/attachments/` and
the tool result carries the absolute path inside the computer. Duplicate names
get a ` (2)` suffix rather than overwriting.

### Resetting

**Reset** in the panel header deletes the computer's files, downloads, browser
profile and logs and starts a fresh session (attachments are kept unless you
uncheck that). Resetting Qube itself does not touch the computer's files. See
[Qube Computer](./computer.md).

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

### Access to a folder keeps showing approval cards

Add the folder once in **Settings → Preferences → Allowed directories** with
read or read/write access. Qube will then stop prompting for paths inside it.

### A file card can't be opened after an app update

Workspace files live in app-managed working storage; an update can rebuild
that area. Keep deliverables you care about by using the **Download** button
on the file card to save them into your own folders. Your chats, settings and
memory are unaffected — they live in the application data directory.

## Connectors and connected apps

### No connector tools appear / “connect it in Settings”

The app isn't connected. Open **Settings → Connectors**, connect it through
the browser sign-in, and make sure it shows as connected before retrying.

### Source build: connector connection fails immediately

Released builds embed a Composio key; source builds need your own. Set
`COMPOSIO_API_KEY` in `.env.local` (or the environment), restart the dev
server, or enter the key in **Settings → Advanced → Composio API Key**.

### A send/create action keeps waiting

Sensitive connector actions pause on an approval card until you approve or
deny. Unanswered cards time out after five minutes and the action is
cancelled. Background check-ins never send at all — they only draft.

## Scheduled tasks and automations

### Tasks never run when Qube is closed

That's expected: the scheduler runs inside the Qube process. Keep the app open
(with **Keep server running** enabled) and consider **Run on start**. Overdue
tasks run once, deduplicated, when Qube reopens. See
[Automations](./automations.md).

### A scheduled task is allowed but does nothing in the background

Check the task's permission switches (shell, web, external files, destructive
commands) — a background task cannot prompt, so any action outside its
permissions is refused. Its execution log in **Settings → Scheduling** shows
the exact failure.

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
reset**. It signs out of ChatGPT, pauses and clears background work, removes
all local state files (providers, sessions, memory, tasks, heartbeat work,
announcements, settings, connector keys, the durable database and browser
profile), clears browser storage, then reloads. Workspace deliverables
(including saved chat attachments) and the diagnostic log are kept. To remove
those too, also delete the
[application data directory](./permissions-privacy.md#where-your-data-is-stored).

## Reporting a problem

When an issue survives this page, include in your report:

1. The Qube version from **Settings** and your operating system.
2. The relevant tail of `sidecar.log`.
3. The exact request you sent and whether a connector or local model was
   involved, with any provider error text shown in the chat.
