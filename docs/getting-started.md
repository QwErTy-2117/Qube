# Getting started

This guide takes you from zero to your first completed task. No terminal or
coding knowledge is needed to use the installed app.

## What you need before installing

Qube is a desktop app that runs on your computer. Three things are worth
knowing up front:

1. **Qube does not include an AI model.** You connect an AI you already use —
   either a ChatGPT subscription sign-in, or an API key from a provider such
   as OpenAI, Anthropic or Google, or a local model through Ollama/LM Studio.
   See [Choose your AI](./ai-providers.md).
2. **The built-in browser needs a Chromium-based browser installed.** Qube
   drives the Google Chrome, Chromium, or Microsoft Edge already on your
   machine. On Windows, Edge always qualifies; on macOS and Linux install
   Chrome or Chromium if you want browser automation. See
   [Browser automation](./browser.md).
3. **Real Office files need Python (optional).** Producing `.docx`, `.pptx`
   and `.xlsx` files uses Python libraries. If Python 3 is missing, Qube can
   still create Markdown, CSV and other formats. See
   [Files and the workspace](./files-workspace.md).

Computer control of other desktop apps (clicking buttons outside the browser)
is an additional, optional install described in [Computer use](./computer-use.md).

## Install Qube

1. Open the [Releases page](https://github.com/QwErTy-2117/Qube/releases) and
   download the package for your system:

   | Platform | Download |
   | --- | --- |
   | Windows (Intel/AMD, 64-bit) | `.exe` installer (or `.msi`) |
   | Windows (ARM, 64-bit) | ARM64 `.exe` installer |
   | macOS (Apple Silicon, M-series) | `.dmg` |
   | macOS (Intel) | `.app.zip` |
   | Linux (64-bit Intel/AMD or ARM) | `.deb` (Debian/Ubuntu) or `.rpm` (Fedora/RHEL/openSUSE) |

2. Install it like any other desktop app: run the installer on Windows, drag
   into Applications on macOS, or use your package manager on Linux.
3. Open **Qube**.

The installed app bundles its own Node.js runtime, so you do not need to
install Node.js just to use Qube. (You only need Node when
[running from source](./development.md).)

## Finish onboarding

The first launch walks through five short screens:

1. **Welcome** — what Qube is.
2. **Terms and privacy** — read and accept the
   [Terms](../TERMS.md) and [Privacy Policy](../PRIVACY.md).
3. **Choose how Qube thinks** — sign in with your ChatGPT account, or add an
   API key from another provider, or point at a local model. This is the only
   mandatory configuration step.
4. **Tools and connectors** — optionally connect apps like Gmail or Google
   Drive. You can skip this and connect any app later in
   **Settings → Connectors**.
5. **Ready** — Qube opens the chat.

Nothing here is permanent: providers, connectors, preferences and memory can
all be changed later in **Settings**.

## Say your first task

In the composer at the bottom, type something in your own words and press
Enter. Good first tasks need no setup at all:

- “Summarize this article: https://example.com/article”
- “Make a weekly meal plan for two vegetarians with a grocery list”
- “What’s a good kids’ bike for a 6-year-old under €150? Give me a short sourced answer.”
- “Write a friendly out-of-office email for a two-week holiday.”

As Qube works, you will see:

- **Activity cards** for every step it takes (searching, reading, writing a
  file), written in plain language rather than technical tool names.
- A **goals checklist** in the corner for multi-step jobs, so you can see
  progress.
- **Approval cards** that pause the run whenever it wants to do something
  irreversible or outside its workspace — for example deleting a file,
  sending an email, or clicking inside another app. Read-only work never
  pauses. Read more in [Permissions and privacy](./permissions-privacy.md).
- **File cards** at the end of a reply for any documents, spreadsheets or
  presentations it produced.

## A realistic end-to-end example

Ask:

> “Tailor my CV to this job posting and draft a cover letter. The posting is
> at https://example.com/job and my CV is attached.”

Qube will: read the posting and your attached CV, compare them, write a
tailored CV and cover letter as real files in its workspace, show both as
file cards you can open and download, and list what it changed. Nothing is
sent anywhere without you.

## Next steps

- Connect your apps in **Settings → Connectors** — see
  [Connected apps](./connectors.md).
- Learn how chat history and memory work — see
  [Memory and skills](./memory-and-skills.md).
- Set up a recurring task such as an inbox triage every morning — see
  [Automations](./automations.md).
- If something does not work as expected, start with
  [Troubleshooting](./troubleshooting.md).
