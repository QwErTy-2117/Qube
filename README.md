# Qube

<p align="center">
  <img src="public/logo.png" alt="Qube" width="180">
</p>

<p align="center">
  <strong>An AI agent for anyone — free, easy to use, and designed to let people get things done with AI without needing to be technical.</strong>
</p>

<p align="center">
  Qube is a desktop app. You describe what you need in plain language, and Qube does the work.
</p>

---

## What is Qube?

Qube is a personal assistant that lives on your computer. You talk to it like you would to a person.

Instead of giving you ideas and leaving you to do the work, Qube actually does it — it can organize your files, write documents, look things up online, work with the apps you already use, and handle repeat tasks for you.

You don’t need to learn special commands or set up complicated tools. Just say what you want in your own words. For example:

- “Turn these notes into a nice presentation”
- “Organize the files on my desktop”
- “Find the latest info on this topic and summarize it for me”
- “Draft an email based on the report you just made”

Qube figures out the steps and does them, showing you what it’s doing along the way so you can check and approve anything important.

It runs directly on your computer, and keeps your files, settings, and chat history there.

---

## Why would I use it?

**You don’t need to be technical.** Qube is made for people who want help getting things done, not for people who want to manage AI systems. If you can describe what you need, you can use Qube.

**It does the work, not just the talking.** Many AI tools only give you suggestions. Qube can actually create files, edit them, search the web, and take actions in your connected apps — so you don’t have to switch between tools and do it manually.

**You stay in control.** Qube shows you what it’s doing in the conversation — what it read, what it changed, what it found online. For anything that could have bigger consequences, like deleting files or sending messages, it pauses and asks you to confirm. You decide what it’s allowed to do.

**Your stuff stays on your device.** Your workspace, history, and preferences are stored locally. When Qube needs an AI to think, it uses the AI service you choose.

**You choose the intelligence.** Qube itself is free and doesn’t include an AI. You connect the one you already use — like a ChatGPT login or a key from other providers — or run a local option if you prefer to keep everything offline. You can switch anytime.

---

## What can I actually do with it?

These are the things Qube can really do today, built for everyday use:

### Have a conversation that gets things done
Talk naturally and watch Qube work. It explains what it’s about to do, shows progress as it goes, and gives you the results right in the chat. You can revisit past conversations anytime — Qube remembers titles, summaries, and what you’ve talked about.

### Work with your files, without the mess
Qube has its own workspace on your computer where it can create, read, edit, and organize files for you. It automatically sorts what it makes — for example, reports go to `documents`, slide decks to `presentations`, and tables to `spreadsheets` — so you can find them later. If you ask it to look outside that workspace, it will ask permission first.

### Get finished documents, not drafts
Ask for a report, presentation, or spreadsheet and get back a properly formatted file you can actually use — with headings, tables, charts, and styles — not just placeholder text. You can also give it an existing document and ask it to improve or update it. Files appear right in the chat ready to download.

### Research without juggling tabs
Ask Qube to look something up, and it will search the web, read the pages, and summarize what matters — so you don’t have to. It can also open a specific link you give it and pull out the main content.

### Connect the apps you already use
You can link services like Gmail, Google Drive and Calendar, Slack, GitHub, Notion, Trello, and others you already rely on. You sign in once securely, and then Qube can — when you ask — read from or take actions in those apps for you. Anything that would create, send, or delete something will pause for your approval first.

### Let it handle things on a schedule
Set up something to happen automatically — for example, “check this folder every morning” or “put together a weekly summary.” You decide what the task is allowed to do. Qube also has a regular check-in that can look over your workspace and let you know if anything needs attention.

### Pick up where you left off
Qube remembers preferences, projects, and decisions so you don’t have to repeat yourself. Session history and what it has learned about how you like to work carries across conversations.

> A few things Qube also does behind the scenes for bigger jobs — like breaking a large request into parts and working on them together — so you don’t have to manage that complexity.

---

## How do I get started?

### 1. Download Qube
Get the desktop app for your system from the Releases page. Install it like any other desktop app.

When you first open Qube, it will walk you through a short setup:

1. Read and accept the Terms
2. Choose how you want Qube to think — sign in with your ChatGPT account or add a key from another AI provider you already use
3. Optionally connect apps like Gmail or Drive if you want Qube to work with them

You don’t need to do everything at once. You can start with just the chat and add more later.

### 2. Just talk
Tell Qube what you want to happen, in plain language. If it needs a detail you didn’t give, it will ask. Otherwise it will get started and show you what it’s doing.

A few tips that help:
- Say what the outcome should look like and who it’s for
- Mention where files should go or which app to use if you already know
- Check what it did before you share or send anything — you can see every file it changed and open it right from the chat

---

## What do I need to know before using it?

**You’re in charge of what it does on your behalf.** When you give Qube instructions, approve something, or connect an app, you’re authorizing it to take the steps it thinks are needed. That can include creating or changing files, running actions on your computer, or doing things in your connected apps — even in ways you didn’t exactly expect. Always review what it did before you rely on, send, or share the result.

**It can make mistakes.** Like any AI, Qube can be wrong, miss details, or misunderstand what you meant — even when it sounds confident. Double-check anything important, keep copies of important files, and don’t rely on it alone for high-stakes decisions.

**Your data stays local unless you ask it to go elsewhere.** Files, history, and settings live on your computer. When you chat, the text you send, relevant excerpts of files it read, and some context it has remembered may be sent to the AI service you chose so it can respond. Connected apps receive only what’s needed to do what you asked. Each provider or app handles that data under its own policies.

Qube will also tell you when it wants to do something more sensitive and ask you to confirm. Those checks help, but they don’t catch everything — your review is still the most important safeguard.

For more details, see the [Terms of Service](TERMS.md) and [Privacy Policy](PRIVACY.md).

---

## For those who want to run or build it

You don’t need this section to use Qube — it’s here for anyone who wants to run the app from source or make changes.

**What you’ll need**
- Node.js 18+ and npm
- Rust and Tauri setup only if you want to build the desktop version ([Tauri prerequisites](https://tauri.app/start/prerequisites))
- An AI account or key — Qube doesn’t ship with one

**Quick start (web mode)**

```bash
npm install
cp .env.example .env.local
# open .env.local and add keys if you want them now — you can also add them later in the app
npm run dev
```

Open `http://localhost:3010` and follow the onboarding.

**Environment options** — all optional at first, you can also set them in the app:

```
# For connectors like Gmail, Slack, GitHub, etc. (optional)
COMPOSIO_API_KEY=...

# For a stable ChatGPT login (optional, otherwise auto-created locally)
LWC_SECRET=...
# Generate with: openssl rand -hex 32
```

Most day-to-day settings — which AI you use, your name and preferences, theme, connected apps, and recurring tasks — are managed in the app under Settings and stored locally.

**Build the desktop app**

```bash
# Build the sidecar bundle
TAURI_BUILD=true node scripts/build-sidecar.js

# Package the desktop app
npm run tauri:build
```

During development you can also run the desktop shell directly:

```bash
npm run tauri:dev
```

Find the finished app in `src-tauri/target/` (depends on your system).

**A note on responsibility:** the assistant acts on what you tell it and what you approve. You’re responsible for checking its work before you use it — especially for files, messages, or anything it does in your other apps. See [TERMS.md](TERMS.md) for the full terms.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
