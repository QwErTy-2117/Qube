# Qube

Qube is an AI agent app. It's a desktop chat interface for an AI that can work with your files, run commands, search the web, and remember things between conversations.

Designed for non-power users who want the capabilities of a coding agent without the terminal setup.

<img src="public/logo.png" alt="Qube screenshot" width="400">

---

## What it does

Qube is more than a chatbot. The AI can:

- **Read and edit files** in its workspace — you can ask it to write code, edit documents, or generate reports
- **Run commands** — ask it to install packages, run scripts, or execute shell commands
- **Search the web** — it can look things up and cite sources
- **Create documents** — generate `.docx`, `.pptx`, `.xlsx` files and download them
- **Remember you** — long-term memory persists across conversations so it learns your preferences and project context
- **Keep history** — all your conversations are saved and organized by date
- **Ask you for permission** — before running destructive commands or accessing files outside its workspace, it asks first

---

## Features

### Chat & Conversations
- Multi-thread conversations switchable from a sidebar
- Conversations grouped by Today, Yesterday, Earlier
- Edit your own messages after sending
- Copy, reload, or export any assistant response as Markdown
- Keyboard shortcuts and markdown rendering with syntax-highlighted code

### Rich Input
- Slash commands (`/summarize`, `/translate`, `/search`, `/help`)
- @ mentions for quick actions
- Voice dictation (speak instead of type)
- File attachments with image preview
- Quote text from messages to ask follow-ups

### Model Selection
Choose between three models from the dropdown:
- **GLM 4.7** (355B) — the most capable, good for complex tasks
- **GPT-OSS 120B** — fast and efficient for everyday use
- **Gemma 4 31B** — lightweight, great for quick questions

Your preferred model and settings are saved automatically.

### Long-Term Memory
Qube builds a memory of what matters to you:
- **Preferences** — how you like things done
- **Projects** — what you're working on
- **Patterns** — recurring request types
- **Decisions** — choices that affect future work

Memories are automatically extracted between conversations. You can view, delete, or clear them from the Settings dialog.

### Safety

Qube is sandboxed in its own workspace directory:
- File operations outside the workspace require your explicit approval
- Destructive commands (`rm -rf`, `sudo`, pipe-to-shell) are intercepted and ask permission
- Permission requests time out after 5 minutes if unanswered

---

## Getting started

### Requirements

- Node.js 20 or newer
- A [Cerebras](https://console.cerebras.ai/api-keys) API key

### Setup

```bash
cp .env.example .env.local
```

Add your API key to `.env.local`:

```
CEREBRAS_API_KEY=your_key_here
```

Then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Running without an API key

The app works without a key — it returns a simulated response so you can explore the interface. To use the live AI, add your Cerebras API key.

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `CEREBRAS_API_KEY` | — | API key for Cerebras inference |
| `WORKSPACE_PATH` | `./workspace` | Agent's working directory |
| `PERMISSION_TIMEOUT_MS` | `300000` | How long permission prompts wait (ms) |
| `MEMORY_MODEL` | `zai-glm-4.7` | Model used for memory extraction |

---

## Tech stack

- **Next.js 16** with App Router and TypeScript
- **assistant-ui** — chat UI primitives and runtime
- **Cerebras** — AI inference (OpenAI-compatible API)
- **Tailwind CSS 4** — styling
- **Lexical** — rich text composer with slash commands and mentions
- **Zustand** — client state

---

## Project structure

```
Qube/
├── app/
│   ├── api/chat/route.ts       # AI agent endpoint
│   ├── api/files/              # Serves workspace files for download
│   ├── api/settings/           # Session and memory management
│   └── globals.css             # Styles and themes
├── components/
│   ├── assistant-ui/           # Chat UI components
│   ├── examples/base.tsx       # Main chat page
│   └── shared/                 # Settings dialog, etc.
├── lib/
│   ├── agent/                  # Agent logic, tools, system prompt
│   ├── memory/                 # Long-term memory and session storage
│   └── middleware/             # Permission and workspace safety
├── workspace/                  # Agent's sandboxed working directory
└── constants/
    └── model.ts                # Default model selection
```

---

## Built with

- [assistant-ui](https://www.assistant-ui.com/) — React components for AI chat interfaces
- [Cerebras](https://cerebras.ai/) — fast AI inference hardware
- [shadcn/ui](https://ui.shadcn.com/) — UI component primitives
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — streaming and tool use

---

## License

MIT
