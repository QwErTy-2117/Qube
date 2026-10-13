# Qube on Pi Durable — Native Conversations Design

Date: 2026-10-13
Goal: make this AI agent app use the pi durable harness (https://earendil.com/posts/pi-durable/)
Approach: B — Native conversations (user-approved; adapter option rejected)
Status: design approved per-section; awaiting spec review before implementation plan

## 1. Architecture

Single `Harness.open()` over SQLite owns all agent state.

- `openNodeSqliteStorage()` from `@earendil-works/pi-durable/storage/sqlite/node`, path resolved via `getDataDir()` (e.g. `<dataDir>/agent.sqlite`) so Next.js web mode and Tauri desktop share one file.
- One harness singleton per server process: `Harness.open(storage, { models, registry, env, settings })`. One process owns storage at a time; Next.js guards double-open; Tauri sidecar reuses same path (no concurrent owners).
- Qube thread IDs become pi-durable conversation IDs. Existing threads imported with original IDs; new chats via `harness.root()` / `createConversation()` / `fork()`.
- Transcript, tasks, docs, and agent config live in SQLite. Client no longer resends full history; `/api/chat` submits input and waits; `/api/threads` reads via `tx.scanConversations` / `scanEntries`.
- Boot calls `harness.resume()` to continue unfinished `pi.generation` / `pi.tool` / custom tasks from last checkpoint.
- Execution env: `env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workspace })` per conversation, preserving workspace + allowed-dirs isolation.

## 2. Components

### 2.1 Models — keep all providers

Adapter from `providerStore.getProviderByModel()` into pi-ai `createModels()` / `setProvider()`.

- Register every built-in provider Qube supports today (OpenAI, Anthropic, Google, Mistral, xAI, DeepSeek, Perplexity, OpenRouter, Groq, Together, Ollama, LM Studio, ChatGPT login via request-scoped client).
- Preserve `reasoningEffort` → Responses API routing and `createPiModelClientForRequest` behavior for ChatGPT (`request` context required).
- Preserve `formatProviderError()` mapping (401/403/404/429, ChatGPT `not_authenticated` / `model_not_allowed` / `usage_limit`, Zen free-tier) verbatim in the bridge so UI hints do not regress.
- Per-conversation `pi.provider` UUIDv7 forwarded as pi-ai `sessionId` for prompt-cache affinity; survives reopen/retry/reset/compaction/model change.

### 2.2 Registry / extensions — port all tools

One extension per Qube area, installed in a process-owned `createRegistry()`:

- `workspace` (read/write/edit/bash via `NodeExecutionEnv`; `replay: "safe"` for reads only; writes/deploys never replay).
- `browser`, `computer-use`, `mcp` (dynamic from `mcpStore`), `composio` (connector tools), `memory` (recall/save), `agent` (schedule/heartbeat/`ask_question`), `openui` (generative UI prompt as section).
- Tool calls run as durable `pi.tool` tasks; intent committed before `execute()`; `api.output()` streams partial output (committed ≤100 ms to `pi.live`).
- Same-name tool in later extension replaces earlier; `wrapTool()` decorates winner (e.g. timing, permission gating).
- Hot reload: `registry.install()` under same name replaces in one step; running calls finish on old code, next calls use new code; after restart install same extensions before `resume()`.
- Sensitive actions (Composio send/create/delete, computer-use mutating ops, `delete_file`) gated by `beforeTool` approval hook (see §4), not by inline wrapper return strings.

### 2.3 Skills — Agent Skills spec + pi-durable sections (corrected)

Qube today inlines all skill bodies (truncated) into the system prompt. This violates Pi / Claude Code progressive disclosure and defeats pi-durable prompt-cache sharing. Correct integration:

- Skills follow Agent Skills spec + Pi `packages/coding-agent/docs/skills.md`: directory with `SKILL.md` (frontmatter `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation`, plus Qube `user-invocable`, `disallowed-tools`, `color`), body <500 lines, relative `scripts/` / `references/` / `assets/` resolved from skill dir.
- Discovery mirrors Pi: scan `~/.agents/skills/`, `.agents/skills/` (project ancestors to repo root), Qube `skillStore` (system + custom + marketplace), and Pi-package manifests (`{"skills": [...]}`). Malformed or description-less skills skipped; name collisions keep first + warn.
- Single `skills` extension exposes `section("skills", ...)` rendering only `name + description + path` per skill. Full `SKILL.md` loads lazily when model calls `read_file(skillPath/SKILL.md)` or user sends `/skill:name` (args appended as user request).
- `disable-model-invocation: true` → manual-only (omitted from auto list, still via `/skill:name`). `user-invocable: false` → background knowledge, auto-applied silently. `allowed-tools` = pre-approved list for invoking turn; `disallowed-tools` enforced via `beforeTool` hook (not static filter) so restart/replay stays consistent.
- Skill prompt + tool-set changes stored as positional `pi.system` entries; restart/fork sees exactly what model saw; only changed sections re-send (cache warm). Sections returning time-varying content avoided.
- `/reload` after skill edit; startup diagnostics list loaded skills.

### 2.4 Documents — app state next to transcript

`defineDoc()` typed JSON, changed in same atomic commit as entries:

- `app.todos` (`scope: conversation`, `history: rewindable`, `fork: asOf`) replaces TodoWrite snapshot observer; UI subscribes via `harness.documentState(Todos, id).subscribe()`.
- `app.scratchpad`, `app.memory-index`, `app.skill-state` similarly scoped; absent doc treated as default.
- `conversationCreated()` seeds docs for every `createConversation` / `fork` / `root`, including tool-created subagent conversations.
- Fork policies: todos `asOf` (parent value at fork entry), scratchpad `asOf`, ephemeral UI `initial`.

## 3. Data flow

- `POST /api/chat`: `conversation.submit({ type: "input", content, requestId }, ctx)` then `submission.wait(ctx)`. `requestId = threadId + turnId` gives exactly-once retry; `harness.submission(id)` reacquires after restart.
- Generation: `pi.generation → pi.system (on change) → pi.assistant (tool calls) → pi.tool × n → pi.tool-result × n → pi.assistant (answer) → submission done`.
- UI bridge: `conversation.viewState(ctx).subscribe(view => ...)` re-emitted as UIMessageStream chunks (`text-start/delta/end`, `tool-input`, `data-compaction`, permission widgets). `watchEvents()` evaluated in implementation as alternative for `message_start/tool_execution_start` deltas; default is `viewState`. `assistant-ui` contract unchanged.
- Busy: submit to busy queues in `pi.inbox`; `whenBusy: steer` joins running round, `follow-up` (default) starts next run, `reject` throws `ConversationBusy`. Failed run leaves queue until next submit places oldest first.
- Abort: `Esc` → `conversation.abort(ctx)` withdraws queued inputs (writes stay), aborts owned tasks bottom-up, resolves when idle. `abort(ctx, { background: true })` also stops background work.
- Forks/subagents: `channel.fork(entryId, { ownership: ownerless })` for threads; task-owned child via `tx.createConversation({ ownership: { kind: "task", taskId } })` + `configure()` (cheaper model, narrowed tools) + `api.details({ conversationId })` for UI nesting. Foreground subagent blocks parent; background reporter posts answer as follow-up input with deduped `requestId`.
- Scheduler/heartbeat: `background: true` tasks owned by conversation; survive `abort()` and keep parent idle.
- Compaction: background `CompactionTask` with `settings.compaction = { enabled, reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768 }`; placed at turn boundary or when next request would overflow; provider-overflow triggers one compact-and-retry; `compact(instructions)` manual; `reset(handoff)` + `control: { handoff }` + `search_history` over `scanEntries` preserved.

## 4. Error handling and durability

- Replay: `safe` only for pure reads; all mutating tools omit replay — crash yields `interrupted` error result with committed partial output, model decides next step. `execute()` throw → error result; `control: { terminate }` ends run when unanimous.
- Approvals: `beforeTool` hook checks sensitive tool; `api.memo("approval:<tool>:<argsHash>")` first-write-wins so restart reuses answer instead of re-asking. Hook throw blocks call; other hooks report + continue chain.
- Providers: overflow → compact + retry once; other errors surface via preserved `formatProviderError` text, never silent.
- Crash: every phase checkpoints; `resume()` restarts scheduler; `pending` tasks with missing extension reported via `harness.inspect()` (must reinstall registry first).
- Env: `env()` throw → call error result; no env → built-in file tools fail with error result (not crash).
- Storage: WAL + `synchronous=NORMAL` survives process crash; power/host failure may lose newest commit (accepted, documented).

## 5. Migration, testing, success

### Migration

Importer (gated by `PI_DURABLE_MIGRATE=1`) reads existing threads JSON, `.memory/skills.json`, scheduler store, compaction checkpoints; writes `createConversation` with preserved IDs + `commit` entries + docs; `conversationCreated` seeds new docs. Dual-read until verified; old JSON retained as backup. No ID breakage.

### Tests

- Existing `npm test` (threads contract, provider routing, permission bar, ACP rehydration) must stay green.
- Add `registerStorageConformance` (SQLite) + `registerEnvConformance` (`NodeExecutionEnv`).
- New crash test: long tool-call run, kill mid-`pi.tool`, reopen + `resume()`, assert continuation from checkpoint, no duplicate side-effect for replay-unsafe tool, queued follow-up delivered, `requestId` retry returns same submission.
- Manual QA: kill-9 demo, fork/thread demo, skill lazy-load check (prompt lists name/desc/path only; body loads via read).

### Success

Done = both: (a) crash-resume demo passes with no duplicate side-effects, (b) chat/threads/settings/ACP UX and `npm test` unchanged from user perspective.

### Non-goals

Remote execution envs, Cloudflare DO / Bun adapters, multi-device sync, fleet/bot channels. Noted as follow-ups.
