# Permissions and privacy

Qube acts on your behalf, so the ground rules matter. This page documents
exactly when it asks first, where your data lives, and what leaves your
machine. The legal wording lives in the [Terms](../TERMS.md) and
[Privacy Policy](../PRIVACY.md); this is the practical version.

## The approval model

Qube sorts every action into three buckets.

### Runs without asking

- Reading and writing files **inside its workspace**.
- Read-only web searches and page fetches.
- Read-only connector calls: listing mail, searching tickets, reading pages.
- Read-only computer observations: listing apps, reading a window.
- Creating an email **draft** (drafts stay in your account and are
  reversible; sending still prompts).

### Always asks first

An approval card appears and the run pauses until you decide:

- **Deleting anything**, including files inside the workspace.
- Accessing files **outside the workspace**, unless the folder is in your
  Allowed directories list (**Settings → Preferences**).
- **Sending, posting, creating, updating or deleting** in a connected app —
  emails, Slack messages, GitHub issues, calendar events, Notion pages and
  similar.
- **Purchases, payments, sharing private data.**
- **Destructive shell commands** — patterns such as `rm -rf`, `sudo`, piped
  remote install scripts, disk formatting.
- **Moving files across the Qube Computer boundary** — `computer_import`
  (your machine → computer) and `computer_export` (computer → your machine).
  Every transfer asks, whatever the path, because the crossing itself is the
  action. Everything the agent does *inside* the computer is not a host action
  and does not pause; resetting the computer always asks.

If you deny, or don't respond within five minutes, the action is cancelled and
Qube continues with an in-workspace alternative. Sensitive connector calls
time out rather than executing silently.

### Handled by you in person

Logins, captchas, two-factor prompts and payments in the Qube Computer
browser are never automated — Qube asks you to complete the human step
yourself in the Qube Computer panel, then continues. See
[Qube Computer](./computer.md).

### Background runs have stricter rules

The periodic check-in can read and prepare, but never sends, posts or
deletes. Scheduled tasks can only take the actions their own permission flags
allow, and a send inside a task you explicitly created is considered
pre-approved by that task's instructions. See [Automations](./automations.md).

## Where your data is stored

Qube is local-first. There is no Qube cloud account and no Qube server
holding your data.

### Application data directory

All durable state lives under the per-app data directory, identified by
`com.qube.desktop`:

| OS | Path |
| --- | --- |
| Linux | `~/.local/share/com.qube.desktop` |
| macOS | `~/Library/Application Support/com.qube.desktop` |
| Windows | `%APPDATA%\com.qube.desktop` |

Inside it you will find:

- `.memory/` — settings (`app-settings.json`), AI providers and keys
  (`providers.json`), long-term memory, chat sessions and titles, scheduled
  tasks and run logs, MCP server configs, skills, ChatGPT sign-in session,
  and the local signing secret.
- `.computer/` — the Qube Computer runtime: its files (`home/`), staged
  attachments, downloads, browser profile (cookies and logins) and activity
  log. It persists across restarts and is only deleted by an explicit reset.
- `sidecar.log` — the local server's diagnostic log.
- `agent.sqlite` — only present when the experimental durable storage flag is
  enabled; the default installation uses the JSON files above.

When running from source, the repository root is used instead (override with
the `QUBE_DATA_DIR` environment variable).

### Workspace files

Files Qube creates live in its **workspace** — the `workspace/` folder in a
source checkout, or the sidecar's local working directory in an installed
desktop app. Treat the workspace as app-managed storage: use the **Download**
button on file cards to keep important deliverables in your own folders.
Workspace content is separate from the application data directory, which
holds your settings, chats and memory and is preserved across updates and
uninstalls.

The desktop app also keeps a temporary copy of its local server under the
system temp directory (`qube-sidecar`); it is rebuilt automatically and is
safe to clear while Qube is closed.

### Deleting your data

- Delete individual chats from the sidebar; their sessions and snapshots are
  removed.
- Turn memory off in **Settings → Advanced → Memory**, or delete the memory
  files in the data directory.
- **Settings → Advanced → Hard reset** signs out of ChatGPT, pauses background
  work, and wipes every local state file (`.memory/`, including scheduled
  tasks, heartbeat work, approvals and the cross-chat announcement ledger),
  the experimental `agent.sqlite`, the managed browser profile, connector
  keys, provider settings and memories. It also clears in-browser storage and
  in-process caches. Workspace deliverables, including chat attachments saved
  under `workspace/attachments/`, and `sidecar.log` are preserved.
- Uninstalling the app leaves the data directory in place deliberately; delete
  it manually for a complete removal. See [Desktop app details](./desktop.md#uninstalling).

## What leaves your device

- **Your AI provider receives every message you send**, plus the conversation
  history, file excerpts, tool outputs, attachments and memory entries needed
  to answer — under that provider's own terms. Choose a local model
  (Ollama/LM Studio) if you want fully offline reasoning.
- **Connected services receive only the actions you request**, routed through
  the connector infrastructure when an integration requires it.
- **Browser and computer observations** (page text, screenshots, app window
  state) are included in model context only when the task needs them.
- Qube itself embeds no advertising, analytics, or cross-site tracking. The
  ChatGPT sign-in uses a local session cookie to keep you signed in.

## Practical safety habits

- Review an approval card's description before accepting — it states the app,
  action and target.
- Keep backups of important files; treat generated content as a first draft
  and verify anything high-stakes (medical, legal, financial).
- Prefer Allowed directories over blanket approvals for recurring project
  folders.
- Audit connected apps and MCP servers periodically and disconnect anything
  you no longer use.
