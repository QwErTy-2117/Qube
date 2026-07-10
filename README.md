# Qube

A desktop AI agent app — a chat interface for an AI that edits files, runs commands, searches the web, generates documents, and remembers context across conversations.

Built with Tauri + Next.js, designed to package as a single desktop binary.

<p align="center"><img src="public/logo.png" alt="Qube" width="200"></p>

---

## Capabilities

- **File operations** — read, write, edit files in a sandboxed workspace
- **Command execution** — run shell commands with permission gating
- **Web search** — search and fetch web content with CSS selector extraction
- **Document generation** — create `.docx`, `.pptx`, `.xlsx` files
- **Long-term memory** — persistent memory across conversations (preferences, projects, patterns, decisions)
- **Session history** — all conversations saved and organized
- **Permission system** — destructive commands and external file access require approval
- **Scheduled tasks** — recurring agent tasks with heartbeat monitoring
- **Browser automation** — Playwright-based web interaction tools

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Tauri Desktop Shell                             │
│  ┌────────────────────────────────────────────┐  │
│  │  Next.js (standalone)                      │  │
│  │  ┌─────────┐ ┌──────────────────────────┐  │  │
│  │  │ Chat UI │ │ AI Agent                  │  │  │
│  │  │(assistant│ │ ├─ file/web/command tools│  │  │
│  │  │  -ui)   │ │ ├─ memory extraction     │  │  │
│  │  └─────────┘ │ ├─ permission middleware  │  │  │
│  │              │ └─ session management     │  │  │
│  │  ┌───────────┴──────────────────────────┐ │  │
│  │  │  Provider API (OpenAI / Mistral)     │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

The Next.js app is compiled to a standalone build and bundled as a Tauri sidecar. At runtime, the sidecar spawns a local server from a temp directory.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Framework | Next.js 16 (App Router, TypeScript) |
| Chat UI | assistant-ui |
| Streaming | Vercel AI SDK |
| Styling | Tailwind CSS 4, shadcn/ui |
| Rich editor | Lexical (slash commands, @ mentions) |
| State | Zustand |
| AI providers | OpenAI / Mistral (bring your own key) |
| Browser automation | Playwright |
| Documents | docx, pptxgenjs, xlsx |
| Icons | lucide-react, Radix icons, LobeHub icons |

---

## Getting started

### Development

```bash
npm install
cp .env.example .env.local
```

Add your API key to `.env.local`:

```
OPENAI_API_KEY=sk-...
# or
MISTRAL_API_KEY=...
```

```bash
npm run dev
```

Open [http://localhost:3010](http://localhost:3010).

### Desktop build

```bash
# Build the Next.js sidecar
TAURI_BUILD=true node scripts/build-sidecar.js

# Package the Tauri desktop app
npm run tauri:build
```

---

## Configuration

| Env variable | Default | Description |
|---|---|---|
| `WORKSPACE_PATH` | `./workspace` | Agent's sandboxed working directory |
| `WORKSPACE_DIR_NAME` | `workspace` | Subdirectory name for workspace |
| `PERMISSION_TIMEOUT_MS` | `300000` | Permission prompt timeout (ms) |
| `TAURI_BUILD` | — | Set to `true` for standalone/sidecar output |

---

## Project structure

```
Qube/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           # AI agent endpoint
│   │   ├── ask-user/               # Permission request flow
│   │   ├── files/                  # Workspace file serving
│   │   ├── permission/             # Permission approval
│   │   ├── providers/sync/         # Provider key sync
│   │   ├── scheduler/              # Scheduled task API
│   │   └── settings/               # Session & memory management
│   └── globals.css
├── components/
│   ├── assistant-ui/               # Chat UI components
│   ├── examples/base.tsx           # Main chat page
│   └── shared/                     # Dialogs, settings
├── lib/
│   ├── agent/                      # Agent logic, tool definitions
│   ├── memory/                     # Memory & session persistence
│   ├── middleware/                  # Permission & workspace safety
│   └── scheduler/                  # Task scheduling & execution
├── scripts/
│   └── build-sidecar.js            # Sidecar build orchestrator
├── src-tauri/                      # Tauri backend (Rust)
├── workspace/                      # Agent sandbox directory
└── constants/
    └── model.ts
```

---

## License

Apache 2.0
