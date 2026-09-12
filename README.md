# Qube

<p align="center">
  <img src="public/logo.png" alt="Qube" width="180">
</p>

<p align="center">
  <strong>An AI agent for anyone.</strong>
</p>

<p align="center">
  <a href="#support-qube">❤️ Donate</a>
</p>

---

## What is Qube?

Qube is a personal assistant that lives on your computer. You talk to it like you would to a person. If you can install an app and type a message, you can use Qube — no coding, no terminal, no s[...]

Instead of giving you ideas and leaving you to do the work, Qube actually does it — it can organize your files, write documents, look things up online and work with the apps you already use.

Just say what you want in your own words. For example:

- "Turn these notes into a nice presentation"
- "Organize the files on my desktop"
- "Find the latest info on this topic and summarize it for me"
- "Draft an email based on the report you just made"

Qube figures out the steps and does them, showing you what it's doing along the way so you can check and approve anything important.

It runs directly on your computer, and keeps your files, settings, and chat history there.

---

## What makes Qube different?

Most AI agents assume you're comfortable with the terminal. Qube doesn't.

**Qube itself is free.** It's open-source (Apache 2.0) and costs nothing to download and use. There's no Qube subscription and no per-message charge from Qube — you only ever pay your AI provider.

**Bring the AI you already pay for.** Qube doesn't ship with an AI — you connect the one you already use:

- Have a ChatGPT subscription? Sign in with it in the welcome screen and use your plan. No API key, no copying long secret codes, no extra per-token bill.
- Prefer another provider? Add a key from OpenAI, Anthropic, Google, Mistral, and dozens of others, or point Qube at a local model with Ollama or LM Studio if you'd rather keep everything offline.

You can switch anytime in Settings.

**Setup takes minutes, with clicks — not commands.** Download Qube like any other desktop app, open it, and follow three short steps. Connect Gmail or Drive later only if you want to, with a normal log-in page.

---

## Why would I use it?

**It finishes the job, not just describes it.** Ask for a cleaned-up spreadsheet, a rewritten cover letter, or a folder of vacation photos sorted by date, and you get the actual file back.

**You describe the result, not the steps.** "Compare these three insurance quotes and tell me which is cheapest over five years" is enough on its own. Qube reads the documents, works out the numbe[...]

**You stay in control.** Qube shows its work as it goes — what it read, what it wrote, what it found online — and pauses to check before touching files outside its workspace or running a send/[...]

**Your stuff stays on your device.** Your files, chat history, and settings live on your computer, not in someone else's cloud. Qube only reaches out to an AI service to think through your request[...]

**Why Qube instead of a terminal-first agent?**

- **No terminal commands or config-file edits for everyday use.** You install Qube like a normal desktop app and talk in plain words. OpenClaw and Hermes now also ship desktop installers, but thei[...]
- **Reuse the AI you already pay for.** Got ChatGPT? Sign in with it in the welcome screen — no API key hunt. Or paste one key, or point it at a local model via Ollama or LM Studio you run yours[...]
- **Apps connect with a normal sign-in window.** Gmail, Drive, Calendar, Slack, GitHub, Notion, Trello and others: sign in once, then just ask. You don't create bot tokens yourself — releases in[...]

Everyday examples: tailor a resume plus cover letter per job post; a household budget with live totals that update when you change a number; compare three insurance quotes (paste the text) and sho[...]

Honest note: if you want a fleet of bots on Telegram, Discord, and WhatsApp at once, deep per-tool and per-platform sandbox tuning, or a headless Gateway/server setup — including OpenClaw's simu[...]

---

## What can I actually do with it?

These are the things Qube can really do today, built for everyday use:

### A conversation that actually finishes things
Ask, and watch it happen. Qube explains what it's about to do, shows progress as it goes, and drops the results right into the chat. You can come back to any past conversation — Qube remembers t[...]

### A tidy workspace, not a folder disaster
Qube has its own workspace on your computer for the files it creates, and it sorts them automatically — reports go to `documents`, decks to `presentations`, tables to `spreadsheets` — so you c[...]

### Real files, ready to use
Ask for a report, a presentation, or a spreadsheet and get back something properly formatted — headings, tables, charts, styling — not placeholder text. Hand it something you already have, lik[...]

### Answers, not eleven open tabs
"What's a good kids' bike for a 6-year-old, under €150?" — Qube searches, reads through what it finds, and comes back with a short, sourced answer instead of a page of links. Give it a specifi[...]

### The apps you already use, working together
Connect Gmail, Google Drive and Calendar, Slack, GitHub, Notion, Trello, and others you rely on. Releases include a built-in key for this; if you build from source, add your own `COMPOSIO_API_KEY`[...]

### Things that happen without you asking twice
Set something up once — "check this folder every morning," "put together a summary every 7 days" — and Qube's scheduler repeats it on its own, within whatever limits you set. (Weekday-cron lik[...]

### Continuity, not a blank slate every time
Qube remembers your preferences, your projects, and decisions you've already made, so you're not re-explaining yourself in every new conversation.

> Behind the scenes, Qube also breaks larger requests into parts and works through them together — so you don't have to manage that complexity yourself.

---

## How is Qube different from tools like OpenClaw or Hermes?

They're powerful, but they're built for people who are comfortable in the terminal. Qube is built for everyone else too.

**OpenClaw** runs as a gateway on your machine or server, and now also ships desktop apps (Windows Hub installer, macOS menu-bar app) that can provision a local Gateway on first run. Its docs sti[...]

**Hermes Agent** is a terminal-first agent that now also offers a Desktop installer on macOS/Windows. Its docs still route setup through commands like `hermes setup`, `hermes model`, and `hermes [...]

**Qube takes the opposite route:**

- Install it like a normal desktop app — no terminal commands to get started.
- If you already have ChatGPT, just sign in with it. No hunting for API keys. Or paste a single key, or point it at a local model via Ollama or LM Studio you run yourself.
- Connect Gmail, Drive, Slack, and the rest with a normal sign-in window (releases include a built-in key; source builds use your own `COMPOSIO_API_KEY`), then just ask in plain words. There's no[...]

If you enjoy running servers and editing settings files, you'll feel at home in OpenClaw or Hermes. If you just want to download something and ask for help in your own words, Qube is the easier s[...]

---

## How do I get started?

### 1. Get Qube

No terminal needed for normal use. The quickest way is to grab a build for your system from the [Releases page](https://github.com/QwErTy-2117/Qube/releases) and install it like any other desktop[...]

When you first open Qube, it walks you through a short setup:

1. Read and accept the Terms
2. Choose how you want Qube to think — sign in with your ChatGPT account or add a key from another AI provider you already use
3. Optionally connect apps like Gmail or Drive, if you want Qube to work with them

You don't need to do everything at once. Start with just the chat and add the rest later.

App connections use a built-in key in releases, so there's nothing to paste. If you'd rather use your own key (higher limits or a private project), you can switch anytime in Settings → Advanced[...]

### 2. Just talk

Tell Qube what you want to happen, in your own words. If it needs a detail you didn't give, it'll ask. Otherwise it gets started and shows you what it's doing.

A few tips that help:
- Say what the outcome should look like and who it's for
- Mention where files should go or which app to use, if you already know
- Check what it did before you share or send anything — you can see every file it changed and open it right from the chat

---

## What do I need to know before using it?

**You're in charge of what it does on your behalf.** When you give Qube instructions, approve something, or connect an app, you're authorizing it to take the steps it thinks are needed. That can [...]

**It can make mistakes.** Like any AI, Qube can be wrong, miss details, or misunderstand what you meant — even when it sounds confident. Double-check anything important, keep copies of importan[...]

**Your data stays local unless you ask it to go elsewhere.** Files, history, and settings live on your computer. When you chat, the text you send, relevant excerpts of files it read, and some con[...]

Qube will also tell you when it wants to do something more sensitive and ask you to confirm. Those checks help, but they don't catch everything — your review is still the most important safegua[...]

For more details, see the [Terms of Service](TERMS.md) and [Privacy Policy](PRIVACY.md).

---

## Build it yourself

You don't need this section to use Qube — it's here for anyone who wants to run it from source or make changes. See the [Releases page](https://github.com/QwErTy-2117/Qube/releases) for direct downloads.

**What you'll need**
- Node.js 18+ and npm
- Rust and Tauri, only if you want to build the desktop version ([Tauri prerequisites](https://tauri.app/start/prerequisites))
- An AI account or key — Qube doesn't ship with one

**Quick start (web mode)**

```bash
git clone https://github.com/QwErTy-2117/Qube.git
cd Qube
npm install
cp .env.example .env.local
# open .env.local and add keys if you want them now — you can also add them later in the app
npm run dev
```

Open `http://localhost:3010` and follow the onboarding.

**Environment options** — all optional at first, you can also set them in the app:

```
# For connectors like Gmail, Slack, GitHub, etc.
# Releases already include a built-in key; only needed when building from source.
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

Find the finished app in `src-tauri/target/` (path depends on your system).

**A note on responsibility:** the assistant acts on what you tell it and what you approve. You're responsible for checking its work before you use it — especially for files, messages, or anythi[...]

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Support Qube

Qube is free and open-source, and it stays that way thanks to people like you. If Qube saves you time, consider supporting its development:

- **BTC:** `bc1qkn3slg3ql0z7xfuzqzwkcx3jv6my7t6xq6ekek`
- **SOL:** `EF8MNkBgeifY3KUtPHzQvQg4o2qw3MCQE1WkVrvFsEjM`
- **ETH:** `0x57C7de26041eab3cafbF7e024E1CC0817E2daf6F`
