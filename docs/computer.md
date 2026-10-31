# Qube Computer

Qube Computer is Qube's own persistent runtime. Instead of driving a separate
browser bridge or an OS-level automation driver, Qube gives the agent a
directory tree it owns, a browser whose profile it owns, and a small set of
tools that run **inside** that runtime.

You can watch the session at any time: the **Qube Computer** card sits in the
bottom-right corner of the chat. Hovering it shows its name; clicking opens the
side panel with the live session — session id, disk usage, the files actually
in the computer, the browser state, and the activity journal the tools write
while they work. The only control in the panel is the close **X** in the
bottom-left corner (plus an explicit **Reset**, which always asks first).

## What it is, and what it is not

- It is a **persistent, confined workspace**: its own home directory, its own
  `HOME`/`TMPDIR`, its own browser profile, its own attachments and downloads.
- It is **not a virtual machine** and it is not a second operating system. Qube
  runs on your computer; the isolation here is a dedicated filesystem root with
  guarded path resolution and a confined process environment. Commands cannot
  read your home directory through the computer's tools, but they are still
  processes on your machine — treat the computer like a project sandbox, not a
  security boundary against hostile code you deliberately run.
- It does **not** see your desktop, your other apps, or your screen.

## What persists

Everything below survives app restarts, crashes and upgrades. Nothing is wiped
automatically — not on restart, not when idle, not on upgrade.

| Path | Contents |
| --- | --- |
| `.computer/home/` | The agent's working directory: projects, notes, generated files |
| `.computer/attachments/` | Files you hand over, copied in and referenced by path |
| `.computer/downloads/` | Browser downloads and screenshots |
| `.computer/browser/profile/` | The Chromium profile: cookies, logins, session storage |
| `.computer/logs/activity.jsonl` | Rolling activity journal (size-capped) |
| `.computer/state.json` | Session identity and reset counter |

Paths are relative to your Qube data directory (`QUBE_DATA_DIR`, the app's data
folder for the desktop build). The directory is gitignored in the repository.

## Tools

| Tool | What it does |
| --- | --- |
| `computer_status` | Session id, paths, disk usage, recent activity |
| `computer_list` / `computer_read` / `computer_write` / `computer_delete` | Files inside the computer (paths relative to its home) |
| `computer_run` | Runs a shell command inside the computer, with a timeout and capped output |
| `computer_browser` | `open`, `read`, `navigate`, `click`, `type`, `press`, `screenshot`, `status`, `stop` in the persistent browser |
| `computer_import` | Copies a file from your machine **into** the computer (asks first) |
| `computer_export` | Copies a file **out** of the computer to a path you pick (asks first) |
| `computer_reset` | Deletes the computer's files and browser profile and starts a fresh session |

Commands see a confined environment: `HOME`, `XDG_*` and `TMPDIR` point inside
the computer, and credential-shaped variables (`*_API_KEY`, `*_TOKEN`,
`*SECRET*`, `PASSWORD`, `GITHUB_TOKEN`, …) are stripped, so a command cannot
read the app's own secrets.

## The browser

`computer_browser` launches Chromium with `--user-data-dir` pointing at the
computer's profile. That is why logins stick: cookies, session storage and the
profile itself live inside the computer. Downloads land in
`.computer/downloads/`.

- Launch is lazy: nothing starts until a tool or the panel needs a page, so an
  idle computer costs no process.
- A Chromium already holding the profile is adopted rather than duplicated.
- `stop` closes only an instance Qube started; a browser you launched yourself
  is left alone.
- No Chrome/Chromium installed? The tool says so and suggests installing Chrome
  or setting `CHROME_PATH`. Qube never downloads a browser behind your back.

## Attachments

Two different things share the word "attachment":

- Files you attach in **chat** are saved into the workspace
  (`attachments/<chat>/…`) and the agent is told that path, so workspace file
  tools can read them. They are not inside the computer.
- `computer_import` copies a file **into** `.computer/attachments/` and returns
  its absolute path inside the computer; `computer_export` copies one back out
  to a path you choose.

The staging rules are deliberately boring (they apply to both paths):

- Unicode names are preserved (normalised to NFC); separators, control
  characters and Windows-reserved names are neutralised.
- Duplicate names never overwrite: `report.txt`, `report (2).txt`, …
- Missing files and oversized files (over 512 MB) fail with a clear message
  instead of a partial copy.
- Path traversal is rejected on the way in and on every later read/write, and
  symlinks are resolved before the containment check, so a planted link cannot
  walk out of the sandbox.

## Permissions

Everything inside the computer runs without a prompt — that is the point of a
runtime Qube owns. The two boundary crossings are the exception:

- `computer_import` (your machine → computer)
- `computer_export` (computer → a path on your machine)

Both always use the same approval card as every other host file tool — the
crossing itself is what needs approval, not the path. In a background task
there is nobody to ask, so those calls are refused instead of silently
allowed.

`computer_reset` requires an explicit `confirm: true` and is never triggered by
Qube on its own.

## Resetting

**Reset** in the panel header (confirm it) or `computer_reset` deletes the
computer's home, downloads, browser profile and logs, then starts a fresh
session. Attachments are kept by default — pass `keep_attachments: false` to
remove those too.

Resetting Qube itself (Settings → Reset) is different: it clears app state and
stops the computer's browser, but it deliberately leaves the computer's files
and browser profile alone.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUBE_DATA_DIR` | app data dir | Where `.computer/` lives |
| `CHROME_PATH` | auto-detect | Chromium/Chrome binary for the computer browser |
| `QUBE_COMPUTER_BROWSER_PORT` | `9223` | DevTools port for the computer browser |
| `QUBE_COMPUTER_BROWSER_HEADED` | off | Set to `1` to show the browser window |

## Related reading

- [Permissions and privacy](./permissions-privacy.md) — the approval model and where data lives
- [Files and the workspace](./files-workspace.md) — the workspace and its viewers
- [Troubleshooting](./troubleshooting.md) — when the browser or a command misbehaves
