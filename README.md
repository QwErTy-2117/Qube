# Qube

<p align="center">
  <img src="public/logo.png" alt="Qube" width="180">
</p>

<p align="center">
  <strong>An AI agent for anyone — free, easy to use, and designed to let people get things done with AI without needing to be technical.</strong>
</p>

<p align="center">
  Qube is a desktop app. You describe what you need in plain language, and Qube does the work — organizing files, writing documents, searching the web, connecting to your apps, and running tasks end-to-end.
</p>

---

## What is Qube?

Qube is a personal AI worker that lives on your desktop. It pairs a simple chat interface with an autonomous agent that can use tools, delegate to subagents, and remember context across conversations.

You don't need to write prompts for each step, chain tools manually, or learn a technical setup. Tell Qube what you want — "build me a dashboard," "turn these notes into a deck," "summarize my last session and email the draft" — and it figures out the steps and executes them.

Built as a Tauri + Next.js desktop app, Qube packages into a single binary and keeps your workspace, settings, and memory on your machine.

## Why Qube?

* **For anyone, not just developers.** Qube is built for people who want help getting things done, not for people who want to configure AI infrastructure.
* **Actually does the work.** Qube doesn't just suggest — it reads and writes files, runs commands, browses the web, generates polished documents, and takes actions in connected apps so you don't have to.
* **You stay in control.** Sensitive actions pause for your approval where detected, and everything the agent does is visible in the thread. Your files and keys stay local by default; only the prompts and context you choose to send go to your model provider.
* **Bring your own intelligence.** Qube itself is free — you connect the model you already use (OpenAI, Anthropic, Mistral, Gemini, local models, or your own ChatGPT account) and pay that provider directly. Switch models at any time.

---

## Key features

### Chat that gets things done
Have a conversation and watch Qube work. It explains its plan, streams progress with tool calls and reasoning, and delivers files you can preview and download right in the thread. Attachments, slash commands, and @ mentions keep the flow fast.

### Files and workspace — your agent's home base
* Qube works inside a sandboxed workspace on your device. It can read, create, edit, and organize files, and list directories to understand what you already have.
* When you point it elsewhere (your home folder or `/tmp`) it asks for permission first.
* Generated work is automatically organized — `documents/` for reports, `presentations/` for decks, `spreadsheets/` for datasets, `images/` for graphics, `code/` for projects — so you can find it later.

**Why it matters:** you get a real workspace, not just a chat transcript. Qube can build a project, keep it tidy, and hand you the files.

### Documents, decks, and sheets that look finished
Ask Qube to create polished `.docx`, `.pptx`, and `.xlsx` files with proper styling, charts, headers, and layouts — not placeholder text. It can also inspect and revise documents you already have.

**What to expect:** tell Qube the goal and audience, and get back a download card in the chat (`[file: presentations/…]`) ready to share.

### Web search and fetch — research without the tab chaos
* Search the web for current information and have Qube summarize and cite what it finds.
* Fetch any URL and extract the readable content, or target a specific section with a CSS selector.

**What to expect:** faster research that stays in the conversation, with Qube pulling the context it needs before it writes or builds.

### Connect your apps
Link the services you already use and let Qube work across them — for example Gmail, Google Drive and Calendar, Slack, GitHub, Notion, Linear, Asana, Trello, Airtable, HubSpot, and Dropbox. Connections are made via secure OAuth (through Composio), and actions that send, create, or delete data pause for your confirmation.

**What to expect:** you authorize once, then Qube can read from or act in those services when you ask — like drafting an email from a generated report or pulling context from a doc.

### Browser and desktop automation — when you need hands on the mouse
* **Browser automation** via browser-use: navigate, click, type, scroll, switch tabs, and extract content, or delegate a multi-step web task to an autonomous browser agent.
* **Desktop automation** (opt-in): open and control native apps using the accessibility tree — click, type, and interact with windows without needing vision. Sensitive actions still respect your permissions.

**What to expect:** Qube can follow a workflow in a web app or on your desktop when a file or API isn't enough, without you having to do the clicking.

### Subagents — help that stays out of your way
For larger work, Qube can spin up specialist subagents (coder, researcher, reviewer, architect) that have the same tool access as the main agent. They do the heavy lifting and hand back a structured summary, so the main thread stays readable.

### Memory that carries across conversations
* **Long-term memory** remembers preferences, projects, and decisions so you don't have to repeat yourself.
* **Session history** keeps every conversation searchable, with titles, summaries, and full transcripts you can revisit.

### Scheduled tasks and heartbeat
Set up recurring work — "check this folder every morning," "summarize recent changes," "run a status report weekly" — with per-task permissions (commands, destructive commands, external files, web, browser). A heartbeat task can wake the agent at an interval you choose to review the workspace and report what needs attention.

### Permission system built for an agent that acts
Destructive shell patterns (`rm -rf`, `sudo`, piping remote scripts into a shell), paths outside the workspace, and destructive connector actions pause for your explicit approval where detected. Prompts time out after 5 minutes by default, and scheduled tasks have their own per-task permission scopes (commands, destructive commands, external files, web, browser). They are important safeguards, not guarantees — your review remains the primary control.

---

## Supported integrations

### External services (via Composio)
Google (Gmail, Calendar, Drive), Slack, GitHub, Notion, Linear, Atlassian, Trello, Airtable, HubSpot, Asana, Dropbox, Canva — plus any additional toolkits your Composio account has configured. Add more in the Composio dashboard; Qube will expose them automatically once connected.

### AI providers — bring your own key
OpenAI, Anthropic, DeepSeek, Google Gemini, OpenRouter, Together AI, Fireworks, Groq, Mistral, Cohere, Ollama (local), LM Studio (local), and any OpenAI-compatible endpoint via "Custom." You can also sign in with your own ChatGPT account via Login with ChatGPT, which forwards requests through a local proxy using your session — no separate API key needed.

Models are fetched live from the provider after you enter a key or endpoint, so new models appear automatically. Pick a default model in onboarding or settings and swap at any time from the model picker in the chat. Data you send to a provider is handled under that provider's terms — use a local model (Ollama, LM Studio) if you need stricter data controls.

---

## Getting started

### Requirements
* Node.js 18+ and npm
* Rust and Tauri prerequisites if you want to build the desktop binary ([Tauri getting-started guide](https://tauri.app/start/prerequisites/))
* An AI provider key **or** a ChatGPT login — Qube doesn't ship with a model

### 1. Install and configure

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and add the keys you want to use:

```env
# Built-in models (Muse Spark, Nemotron) — get a key at https://opencode.ai/auth
OPENCODE_API_KEY=...

# Connectors (Slack, Gmail, etc.) — get a key at https://dashboard.composio.dev/settings
COMPOSIO_API_KEY=...

# Stable secret for Login with ChatGPT — generate with: openssl rand -hex 32
LWC_SECRET=...
```

> All three variables are optional for a quick start. You can run Qube, connect a provider from the onboarding flow (or paste a key directly in Settings), and add `COMPOSIO_API_KEY` only when you need external service connectors. If `LWC_SECRET` is unset, a dev secret is auto-saved to `.memory/lwc-secret.txt`.

### 2. Run in the browser (development)

```bash
npm run dev
```

Open [http://localhost:3010](http://localhost:3010). The first launch shows the onboarding flow: accept the Terms, pick a provider and model, optionally sign in with ChatGPT, and connect any services.

### 3. Build the desktop app

```bash
# Build the Next.js sidecar bundle
TAURI_BUILD=true node scripts/build-sidecar.js

# Package the Tauri binary
npm run tauri:build
```

During development you can also run the Tauri shell directly:

```bash
npm run tauri:dev
```

Find the packaged app in `src-tauri/target/` (platform-dependent).

---

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `OPENCODE_API_KEY` | — | Enables Qube's built-in models via OpenCode Zen |
| `COMPOSIO_API_KEY` | — | Enables external service connectors |
| `LWC_SECRET` | auto-generated | Signs ChatGPT session cookies; set a stable value in production |
| `WORKSPACE_PATH` | `./workspace` | Folder where the agent reads, writes, and runs commands |
| `WORKSPACE_DIR_NAME` | `workspace` | Fallback name if `WORKSPACE_PATH` is not set |
| `PERMISSION_TIMEOUT_MS` | `300000` (5 min) | How long a permission prompt waits before timing out |
| `QUBE_DATA_DIR` | `process.cwd()` | Where `.memory/` (sessions, memory, provider cache) is stored |
| `TAURI_BUILD` | — | Set to `true` when building the sidecar for Tauri |

Most daily settings — model choice, custom instructions, theme, provider keys, connectors, and scheduled tasks — live in the app's Settings dialog and in `localStorage` plus the local `.memory/` directory. Keys and connectors are stored on your device, not on our servers.

## Using Qube

* **Just talk.** Describe the outcome you want. Qube will ask for clarification only when it truly needs it.
* **Check the thread.** Every file edit, command, search, and connector call appears in the thread with its label and result. Review diffs and outputs before you ship or send.
* **Confirm the big steps.** When Qube detects a destructive command, a path outside the workspace, or a send/create/delete action in a connected app, it will pause and ask you to approve.
* **Revisit and reuse.** Past sessions are saved automatically — search them, reopen transcripts, and let long-term memory carry preferences forward.

> **A note on responsibility:** the agent acts on your instructions, approvals, and configuration. You are responsible for reviewing its actions and outputs before you rely on or share them — including files, code, emails, and changes in connected services. See [TERMS.md](TERMS.md) for details.

---

## Project structure

```
Qube/
├── app/
│   ├── api/
│   │   ├── chat/              # streaming agent endpoint
│   │   ├── ask-user/          # agent → user questions
│   │   ├── permission/        # permission approvals
│   │   ├── connectors/        # OAuth and connector proxy
│   │   ├── providers/         # provider key sync + model listing
│   │   ├── scheduler/         # scheduled tasks API
│   │   ├── memory/ & settings/ # memory + session persistence
│   │   └── computer/          # desktop automation settings
│   └── page.tsx               # main page
├── components/
│   ├── assistant-ui/          # chat UI, tool renderers, composer
│   ├── shared/                # onboarding, settings, connectors tab
│   ├── chatgpt/               # Login with ChatGPT UI
│   └── examples/base.tsx      # main chat page
├── lib/
│   ├── agent/                 # agent orchestration, tools, system prompt
│   ├── memory/                # session & semantic memory stores
│   ├── connectors/            # Composio client and connector registry
│   ├── middleware/            # workspace sandbox + permission middleware
│   └── scheduler/             # task scheduling and execution
├── src-tauri/                 # Tauri shell (Rust)
├── scripts/build-sidecar.js   # sidecar build for Tauri
├── workspace/                 # agent sandbox (created on first run)
└── .memory/                   # local sessions, memory, provider cache (gitignored)
```

## Architecture at a glance

```
┌──────────────────────────────────────────────────┐
│  Tauri Desktop Shell                             │
│  ┌────────────────────────────────────────────┐  │
│  │  Next.js (standalone)                      │  │
│  │  ┌─────────┐ ┌──────────────────────────┐  │  │
│  │  │ Chat UI │ │ AI Agent                  │  │  │
│  │  │(assistant│ │ ├─ file / shell / web    │  │  │
│  │  │  -ui)   │ │ ├─ browser & desktop     │  │  │
│  │  └─────────┘ │ ├─ connectors (Composio) │  │  │
│  │              │ ├─ subagents & scheduler │  │  │
│  │  ┌───────────┴──────────────────────────┐ │  │
│  │  │  Provider API (your chosen model)    │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

The Next.js app compiles to a standalone build and is bundled as a Tauri sidecar. At runtime the sidecar spawns a local server from a temp directory — no cloud backend is required for core use.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Framework | Next.js 16 (App Router, TypeScript) |
| Chat UI | assistant-ui, Lexical editor, Zustand |
| Streaming | Vercel AI SDK |
| Styling | Tailwind CSS 4, shadcn/ui |
| Icons | lucide-react, Radix, LobeHub |
| AI providers | OpenAI-compatible APIs + Mistral SDK |
| Browser | browser-use MCP |
| Desktop | CUA driver (accessibility tree) |
| Integrations | Composio |
| Documents | docx, pptxgenjs, xlsx |
| Local data | File-backed stores under `.memory/` |

---

## Development and contribution

* Run `npm run dev` for the web-only loop; run `npm run tauri:dev` when you need the desktop shell.
* The agent's behavior is driven by `lib/agent/system-prompt.ts` (base instructions) and `lib/agent/agent.ts` (tool definitions). Start there if you want to adjust what the agent can do.
* Use `npm run build` (or `next build`) to verify the Next.js build before packaging Tauri.
* Check [TERMS.md](TERMS.md) and the `LICENSE` file for usage and licensing terms. The source is under Apache 2.0; the Terms of Service govern use of Qube as a product.
* Give feedback or report issues via the repository's issue tracker — `ctrl+p` lists available actions in the app, and feedback can be reported at https://github.com/anomalyco/opencode.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Terms of Service

By installing or using Qube you agree to the [Terms of Service](TERMS.md). In short: you direct the agent, you approve high-stakes actions, and you review outputs before relying on them — especially when the agent touches files, external apps, or third-party services. Model and connector data is sent to the providers you choose and handled under their terms.

