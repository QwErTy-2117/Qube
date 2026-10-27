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
  open in tabbed viewers, so several files can stay open beside the chat.
- Select text in an open file and ask Qube about it.
- Documents, spreadsheets and code get an **Open** button in the viewer;
  images, PDFs and slide decks offer **Download**.

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
commands inside the workspace (120-second timeout per command). Ordinary
commands run without interrupting you, but a destructive command — `rm -rf`,
`sudo`, piped install scripts, disk formatting and similar patterns — always
pauses for an approval card first.

## Folders outside the workspace

By default Qube can only touch its workspace. If a task needs a file
elsewhere (for example your Desktop or Downloads), one of two things happens:

1. Qube shows an **approval card** for that specific access, or
2. You pre-approve the folder in **Settings → Preferences → Allowed
   directories**, choosing read-only or read/write access.

Allowed directories are the safest way to let Qube work on an existing
project folder without repeated prompts. Anything outside both the workspace
and the allowed list stays off-limits until you approve it.

## Keeping the files you care about

The workspace is Qube's app-managed working area. In a source checkout it is
the `workspace/` folder in the repository. In installed desktop builds it
runs inside the local sidecar's working directory, so the reliable way to
keep a deliverable permanently is the **Download** button on its file card,
saving it into one of your own folders.

Your chats, settings, memory and connected accounts are stored separately in
the [application data directory](./permissions-privacy.md#where-your-data-is-stored)
and are not affected by workspace changes, updates, or uninstallation.

## Related reading

- [Permissions and privacy](./permissions-privacy.md) — the full approval model
- [Having conversations](./conversations.md) — attachments and file cards
- [Connected apps](./connectors.md) — working with files in Google Drive, Dropbox and others
