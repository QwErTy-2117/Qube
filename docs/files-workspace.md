# Files and the workspace

Qube does real file work, not just chat. Every file it creates, reads, or
edits lives in a **workspace** on your machine, and finished deliverables
appear as file cards in the chat.

## How the workspace is organized

The agent keeps its work in dedicated folders so you can always find things:

| Folder | Contents |
| --- | --- |
| `documents/` | Reports, letters, Word-style `.docx` files, Markdown notes, PDFs |
| `presentations/` | Real `.pptx` slide decks |
| `spreadsheets/` | `.xlsx` workbooks and CSV exports, with live formulas |
| `images/` | Generated or processed images |
| `code/` | Scripts and code projects |

You never have to name these folders yourself — Qube sorts outputs into them
automatically. When you ask for “a presentation”, you get a real
`presentations/<name>.pptx`, never a Markdown outline dressed up as slides.

## Opening and editing files

Files Qube produces show up as **file cards** at the bottom of the relevant
reply. The built-in side panel opens them directly:

- Word documents, spreadsheets, presentations, PDFs, text and code files all
  open in one shared popup: same window, same header and close button, and a
  viewer made for that file type (paginated document, editable sheet, PDF
  canvas with search, highlighted code, slide deck, plain text).
- Select text in an open file and ask Qube about it.
- Every file card in chat is the same card: **Open** for anything with a
  viewer, **Download** for the raw file. HTML files open in a side panel that
  shows only the rendered page (sandboxed, no browser chrome) with a close
  button in the bottom-left.

You can also hand Qube files you already have: attach them in the composer,
or point it at a folder it has permission to read (see below).

## Real Office documents need Python

`.docx`, `.pptx` and `.xlsx` files are generated with the Python libraries
`python-docx`, `python-pptx` and `openpyxl`, run through Qube's shell tool.
The first time you ask for one, Qube installs the missing library with `pip`
if it can.

For this to work, **install Python 3 with pip** on your machine:

- Windows: install from [python.org](https://www.python.org/downloads/) and
  keep “Add python.exe to PATH” checked.
- macOS: `brew install python` (or use the python.org installer).
- Linux: `sudo apt install python3 python3-pip` (Debian/Ubuntu) or the
  equivalent on your distribution.

Without Python, Qube still works — it will produce Markdown (`.md`), CSV and
plain-text deliverables instead, and tell you it could not build the Office
format. If Office generation fails, check
[Troubleshooting](./troubleshooting.md).

Spreadsheet formulas are real Excel formulas (for example `=SUM(C2:C5)`), not
pasted numbers, so totals recalculate when you change a cell. The built-in
preview computes the same values Excel would show.

## The shell tool

For builds, tests, data processing and Python scripts, Qube can run shell
commands inside the workspace (120-second default timeout per command, up to
10 minutes when a task needs it). Ordinary commands run without interrupting
you. Destructive commands — `rm -rf`, `sudo`, piped install scripts, disk
formatting and similar patterns — are **blocked by default**; if you turn on
**Destructive actions** in **Settings → Advanced → Heartbeat and Task →
Configure**, they go through the invisible self-review and, when it is unsure,
an approval card.

Qube can also start a local development server (for example a web app it is
building), read its log, and open the result — only on `localhost`.

## Folders outside the workspace

By default Qube can only touch its workspace. If a task needs a file
elsewhere (for example your Desktop or Downloads), one of two things happens:

1. Qube asks for that specific access (self-review first, then an
   **approval card** if needed), or
2. You pre-approve the folder in **Settings → Preferences → Allowed
   directories**, choosing read-only or read/write access.

Allowed directories are the safest way to let Qube work on an existing
project folder without repeated prompts. Anything outside both the workspace
and the allowed list stays off-limits until you approve it.

## Where files live

The workspace is Qube's app-managed working area: a `workspace/` folder in
the directory the local server runs from (a legacy `playground/` folder is
used if it already exists).

- **Source checkout:** `workspace/` in the repository.
- **Installed desktop app:** the server runs from a copy of the app in your
  system's temporary folder (`qube-sidecar`), so the workspace is
  `<temp>/qube-sidecar/workspace`.

> **Warning — installed app:** that temporary copy is rebuilt whenever Qube is
> updated to a new version, which also removes the workspace and its
> attachments. Your operating system may clean temporary folders too. Use the
> **Download** button on a file card to keep a deliverable permanently, or
> work in a folder you added under **Allowed directories**.

Your chats, settings, memory and connected accounts are stored separately in
the [application data directory](./permissions-privacy.md#where-your-data-is-stored)
and are not affected by workspace changes or updates. Uninstalling leaves
that directory in place. **Settings → Advanced → Hard Reset** erases the data
directory and, in the desktop app, the temporary server copy including the
workspace. If you run from source and set `WORKSPACE_PATH` outside the data
directory, Hard Reset leaves that folder alone — remove it yourself.

## Related reading

- [Permissions and privacy](./permissions-privacy.md) — the full approval model
- [Having conversations](./conversations.md) — attachments and file cards
- [Connected apps](./connectors.md) — working with files in Google Drive, Dropbox and others
