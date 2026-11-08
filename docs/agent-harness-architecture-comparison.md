# Agent Harness Architecture Comparison

**Qube vs. OpenCode, Claude Code, and OpenAI Codex**

| Field | Value |
|---|---|
| Status | Final |
| Date | 2026-11-08 |
| Qube revision | `f5dedc9` (`feat(settings): rebuild Tasks tab as ReUI event calendar; release 0.0.102`) |
| OpenCode revision | `caf8d6a` (`chore(perf): bench with strobe 0.20.0 ...`) |
| Codex revision | `748ab55` (`Increase Bazel core unit test shards from 8 to 16`) |
| Claude Code evidence | Official documentation snapshot from `docs.claude.com/en/docs/claude-code/*.md`, 2026-11-08 |
| Scope | Context management, long-running execution, prompts, tool orchestration, 14-capability matrix, ten transferable patterns, competitive verdict |

---

## Executive summary

Qube is a credible **consumer desktop agent** with unusually broad integration: local files, a managed browser, OS-level computer control, persistent personal memory, connectors, generative UI, scheduling, and proactive suggestions. Those are real architectural assets, and none of the three coding harnesses matches Qube's end-user surface.

Qube is **not architecturally competitive as a general agent harness**. Its core is still a single-process streaming tool-calling loop with a very long prompt. The gaps are not missing feature checkboxes; they are reliability mechanisms:

1. **No durable execution.** The authoritative run registry is an in-memory `Map` (`lib/pi/harness.ts:160`), the checkpoint module is a no-op stub (`lib/agent/checkpoint.ts`), and the SQLite durable harness is gated behind `PI_DURABLE_ENABLED` (`app/api/chat/route.ts:227`). A crash or restart loses in-flight work.
2. **Weak token accounting.** Qube estimates tokens as `chars / 4` against a fixed 128k window, with a 20k reserve and 15k retained tail (`lib/pi/compaction.ts:59-62,82`). It does not reconcile provider-reported usage, does not detect the model's real window, and does not count tool schemas in its estimate.
3. **No OS-level sandbox.** `run_command` uses `execAsync` with a shell and the user's privileges (`lib/pi/tools.ts:751-773`). Safety depends on a deterministic policy, a sensitive-action classifier, and a 20-second LLM reviewer (`lib/permissions/reviewer.ts:47`) — a probabilistic layer, not a kernel boundary.
4. **Unbounded file reads and lossy output clipping.** `read_file` returns the full file with no cap (`lib/pi/tools.ts:563-575`), while command and web outputs are hard-clipped to character counts with no spill artifact. Large outputs either blow up context or silently lose data.
5. **No independent completion verification.** Silent continuation is driven by the model's own `TodoWrite` snapshot (`lib/pi/harness.ts:926-948`), not by a fresh-context checker or executable evidence.
6. **A monolithic prompt.** The prompt source file `lib/pi/system-prompt.ts` is 48,323 bytes. It is operationally rich but has no project-instruction discovery, no path-scoped rules, and injects the current time near the top, invalidating most of the prompt-cache prefix every minute on providers that honor the configured cache.

The strongest reference per subsystem is:

| Subsystem | Best reference | Why |
|---|---|---|
| Context budgeting | **OpenCode** | Measured usage plus estimate, reserve formula, shrink ladder, precompute |
| Compaction structure | **OpenCode** | `keepID` checkpoint, seven-section summary, 32k summary floor |
| Compaction retention invariants | **Codex** | Retains user messages and pending mail, re-inserts context before the last real user |
| Post-compaction reconstruction | **Claude Code** | Explicit re-injection manifest for instructions, rules, memory, skills, plan, git status, files |
| Durable execution and recovery | **OpenCode** | Write-ahead claims and orphan-resume sweep |
| Sandbox and approvals | **Codex** | OS sandbox modes, protected paths, network policy, approval layers |
| Prompt hierarchy and size budgets | **Codex** | `AGENTS.md` with 32 KiB budget, skills at 2% of context |
| Tool exposure and search | **Codex** | Direct/deferred/code-mode/hidden exposure plus BM25 tool search |
| Subagent orchestration | **Codex** | Persistent agent graph with send/wait/resume/close and mailboxes |
| Verification | **Claude Code** | `/goal`, `/verify`, `/code-review`, Stop hooks |
| Observability | **Codex / Claude Code** | OpenTelemetry traces, metrics, logs with redaction |
| Consumer memory and proactivity | **Qube** | Deterministic BM25-lite memory, auto-injection, scheduler, goals |
| Browser and OS control | **Qube** | Managed browser plus OS-level app control |

The five highest-value patterns are: **durable execution ledger**, **measured-token budgeting**, **post-compaction re-injection manifest**, **deterministic policy plus OS sandbox**, and **independent verification**. The recommendation is to **improve the Pi loop and redesign three subsystems** — context management, execution/persistence, and authority/verification — not to copy an entire competing harness.

---

## 9.1 Methodology, sources, and evidence standard

### 9.1.1 Research question

The comparison asks whether Qube follows modern agent-engineering practice, where it is competitive, where it falls behind, and which mechanisms from OpenCode, Claude Code, and Codex would materially improve it. The unit of comparison is the **harness**: the program around the model that assembles context, executes tools, enforces permissions, persists state, and decides when work is complete. Model quality is out of scope.

### 9.1.2 Evidence base

| System | What was inspected | Access | Pin |
|---|---|---|---|
| **Qube** | `lib/pi/harness.ts`, `compaction.ts`, `system-prompt.ts`, `tools.ts`, `subagents.ts`, `durable.ts`, `task-runner.ts`; `lib/middleware/permission-middleware.ts`; `lib/permissions/reviewer.ts`; `lib/memory/*`; `lib/goals/store.ts`; `lib/agent/checkpoint.ts`, `observability.ts`; `app/api/chat/route.ts`; `lib/memory/session-store.ts`; tests | Local source, direct inspection | `f5dedc9` |
| **OpenCode** | `packages/core/src/session/compaction.ts`, `execution.ts`, `execution/restart.ts`, `inbox.ts`, `run-coordinator.ts`, `subagent-job.ts`, `tool-output.ts`, `permission.ts`, `snapshot.ts`, `revert.ts`; tool and prompt modules; SQLite/Drizzle session store | Public source, shallow clone | `caf8d6a` |
| **Codex** | `codex-rs/core/src/compact.rs`, `session/context_window.rs`, `agents_md.rs`, `agents_md_manager.rs`, `skills.rs`; `tools/tool_namespaces_info.rs`, `tools/router.rs`, `tools/parallel.rs`, `tool_search`; `agent/control`; sandbox and rollout modules; official docs | Public source plus official docs, shallow clone | `748ab55` |
| **Claude Code** | Official docs: `context-window.md`, `memory.md`, `sub-agents.md`, `hooks.md`, `permissions.md`, `checkpointing.md`, `model-config.md`, `prompt-caching.md`, `monitoring-usage.md`, `best-practices.md`, `how-claude-code-works.md`, `sandboxing.md`, `security.md` | Official documentation; implementation not public | Docs snapshot 2026-11-08 |

Claude Code's internals are not public. This report therefore treats Claude Code's **documented behavior** as the evidence ceiling and marks unknown internals explicitly. No proprietary prompt text or leaked implementation is used. OpenCode and Codex are pinned commits, not `main`, so claims are reproducible.

### 9.1.3 Evidence labels

Every substantive claim in this report carries one of these labels:

| Label | Meaning |
|---|---|
| `[S]` | **Verified source.** Inspected in Qube, OpenCode at `caf8d6a`, or Codex at `748ab55`. File and symbol are cited. |
| `[D]` | **Documented behavior.** Stated in official Claude Code documentation or official Codex/OpenCode documentation. The implementation may differ; internals are not assumed. |
| `[O]` | **Observed behavior.** Reproduced from a test, command, or artifact in this workspace. |
| `[I]` | **Architectural inference.** A conclusion drawn from source or documentation, not an explicitly implemented or documented guarantee. |
| `[U]` | **Unknown / inaccessible.** Not publicly inspectable or not verified. Explicitly not guessed. |

A cell may carry more than one label, for example `[S]` for the mechanism and `[I]` for its operational consequence.

### 9.1.4 What was actually verified

- Qube's compaction suite passes: `QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/compaction.test.ts` → **25/25 pass** `[O]`.
- Qube's prompt size is **48,323 bytes** (`wc -c lib/pi/system-prompt.ts`) `[O]`.
- Qube has no root `AGENTS.md` or `CLAUDE.md` (`ls` returns "No such file or directory"), and the harness does not implement project-instruction discovery `[S/O]`.
- OpenCode's compaction constants, write-ahead claims, orphan sweep, tool-output caps, permission rulesets, and snapshot/revert path were inspected in source `[S]`.
- Codex's compaction phases, token accounting scopes, `AGENTS.md` 32 KiB default, skills 2% budget, tool exposure modes, multi-agent control, sandbox modules, and OTel usage were inspected in source `[S]`.
- All twelve key Claude Code documentation pages returned HTTP 200 and were read from the local Markdown snapshot `[D]`.

### 9.1.5 Limits and non-claims

This is an **architectural** comparison, not a controlled benchmark. It does not measure task success rate, latency, or cost on a shared workload. Statements such as "more reliable" mean "has a mechanism that removes a class of failure", not "measured to fail less often". OpenCode and Codex are moving targets; the pinned commits bound the claims. Claude Code documentation can omit implementation detail, and where it does, this report says `[U]` rather than inventing a mechanism. Qube's product requirements differ from coding harnesses: a desktop assistant needs browser/OS control and consumer memory, which coding harnesses do not optimize for. That difference is credited, not used as an excuse for missing durability or sandboxing.

---

## 9.2 Context management and compression

### 9.2.1 Token budgeting and accounting

**Qube.** `getCompactionConfig()` defaults to a 128,000-token context, 20,000-token reserve, 15,000-token retained tail, and 4,096-token summary output (`lib/pi/compaction.ts:59-62`). The trigger threshold is `contextTokens - reserveTokens` = 108,000. Token counts are estimated as `Math.ceil(text.length / 4)` (`lib/pi/compaction.ts:82`). The estimate includes the system prompt, the previous summary, and serialized messages (`lib/pi/compaction.ts:520-523`), but not the tool JSON schemas, provider framing, images, or cache metadata. There is no reconciliation with provider-reported usage and no per-model window table. The 128k default is applied even when the selected model has a different window. `[S]`

**OpenCode.** Compaction uses measured provider usage when available and an estimate otherwise. Its reserve is `max(16,000, 15% of ceiling)` (`packages/core/src/session/compaction.ts:129,135`), with a 200k assumed window when the model window is unknown, a 60k precompute lead (`:158`), a 32k summary output floor (`:139`), and a shrink ladder of `0.85, 0.7, 0.5, 0.35` (`:127`). It tracks whether a request was accepted or rejected and retries with progressively smaller history. `[S]`

**Codex.** Codex distinguishes `AutoCompactTokenLimitScope::Total` from `BodyAfterPrefix` (`codex-rs/core/src/session/context_window.rs:63-68`). That distinction matters: a large stable prompt prefix should not consume the same budget as the growing conversation body. Codex also enforces a full-context-window hard cap, a buffered limit, a post-turn percentage threshold, and recomputes limits when the model changes. It supports token-budget-reset compaction and remote V2 server compaction. `[S]`

**Claude Code.** Auto-compaction triggers at the model's context limit. `/autocompact` allows a lower threshold in the 100K–1M range; on 1M-context models compaction occurs around 967K. The exact internal token accounting is not public `[D/U]`.

**Assessment.** OpenCode has the strongest **adaptive budgeting**: measured usage, reserve formula, unknown-window fallback, shrink ladder, and precompute. Codex has the strongest **accounting correctness**: it separates stable prefix from body and enforces hard and buffered limits. Qube has the weakest accounting of the four: a fixed window, a text-length proxy, no provider feedback, and no tool-schema count. The consequence is predictable: Qube can compact too early on small-window models, too late on large-window models, and can still overflow after compaction because the estimate omitted tools and provider overhead. `[I]`

### 9.2.2 Automatic compaction

**Qube.** Compaction runs preflight before a turn and on overflow recovery. The normal path keeps a recent tail of up to 15,000 tokens, cuts on a user-message boundary, and summarizes the head. The summary is written to `.memory/compactions` with an FNV-1a anchor hash of the last summarized message. On the next request, the client resends full history; Qube uses the anchor to drop the already-summarized head and reuse the checkpoint (`lib/pi/compaction.ts:436-548`). An aggressive path reduces the keep budget to 4,000 tokens and can fall back to a deterministic hard cut (`:491, :633`). A 180-second summarizer timeout bounds the operation. `[S]`

**OpenCode.** Compaction is a first-class session operation with an automatic trigger, a `keep` budget, an optional precompute mode, and provider-native compaction. It stores a checkpoint referencing the messages it kept verbatim via `metadata.keepID`, and it can hold a background summary of everything before `keepID` until compaction is due (`packages/core/src/session/compaction.ts:86-117,265-269,348-396`). It also has a nudge when the model fails to fill the summary template (`:249`). `[S]`

**Codex.** Compaction has pre-turn, mid-turn, and post-turn phases (`codex-rs/core/src/compact.rs`). It supports local Responses summarization, a token-budget-reset mode, and remote V2 server compaction. Pre-compact and post-compact hooks can continue or stop the operation (`compact.rs:200-227`). A background compaction candidate exists. `[S]`

**Claude Code.** Compaction is automatic near the model limit and can be invoked manually with `/compact` and a focus instruction. A `SessionStart(compact)` hook runs after compaction. The summarizer prompt and exact trigger arithmetic are not public. `[D/U]`

**Assessment.** Qube's anchor mechanism is a genuinely good idea: it makes client-resubmitted history cheap and avoids re-summarizing the same head. But Qube has only one compaction mode and a small summary cap. OpenCode's `keepID` checkpoint plus precompute is more robust because it keeps a precise verbatim boundary, supports background summarization, and can fall back to provider-native compaction. Codex's multi-phase compaction is the most comprehensive, but also the most complex. Claude's automatic/manual split is user-friendly, but its internals are opaque. `[S/D/I]`

### 9.2.3 Summarization

**Qube.** The summary template has six sections: Objective, Requirements & Constraints, Key Decisions, Progress, Next Steps, and Critical Context (`lib/pi/compaction.ts:250-255`). Output is capped at 4,096 tokens (`:62`). Summaries are iterative: a previous summary is fed into the next summarization so decisions and context can be carried forward. The summary is injected as an untrusted block, and the model is told not to treat compacted summaries as instructions (`lib/pi/system-prompt.ts:70`). `[S]`

**OpenCode.** The summary template has seven sections: Objective, Requirements, Decisions, Work State, Next Move, Relevant Files, and Important Context (`packages/core/src/session/compaction.ts:175-198`). The output floor is 32,000 tokens (`:139`), eight times Qube's cap. The prompt explicitly instructs the summarizer **not** to summarize repository conventions, `AGENTS.md`, or environment details, because the next agent receives current versions separately (`:216`). It reconciles completed work, blockers, and next steps (`:241`). `[S]`

**Codex.** Codex's summary preserves progress, decisions, context, and next steps, and it retains user messages and pending mail across compaction. It re-inserts initial context before the last real user message so the model does not mistake a summary for the user's latest request. `[S]`

**Claude Code.** Official guidance says compaction should preserve architectural decisions, unresolved bugs, and implementation details while discarding redundant tool output. `/compact` accepts a focus instruction. The exact summarizer prompt is not public. `[D/U]`

**Assessment.** OpenCode's template is the most actionable because it separates **Work State**, **Next Move**, and **Relevant Files**; Qube's "Progress" is less structured and its 4,096-token cap is likely to truncate a long, tool-heavy session. Codex is strongest at **retention invariants** — user messages and pending input survive regardless of summary quality. Qube's iterative summary is directionally correct, but it lacks invariants, validation, and a large enough output budget. `[S/I]`

### 9.2.4 Instruction preservation

**Qube.** The system prompt is rebuilt on each turn, so its static behavioral rules are always present. Dynamic sections add skills, connectors, memory recall, a past-chat index, scratchpad contents, kernel resume, and custom instructions (`lib/pi/system-prompt.ts`). After compaction, the summary block and the recent tail are the only conversation-derived context; there is no explicit re-injection of the active plan, git status, recently modified files, or invoked skill bodies. The prompt does include a rule that compacted summaries are untrusted (`:70`). `[S]`

**OpenCode.** Instruction files are treated as separately re-readable state. The compaction prompt tells the summarizer to omit repository conventions, `AGENTS.md`, and environment details because the next agent gets current versions separately (`packages/core/src/session/compaction.ts:216`). The instruction-state modules and `AGENTS.md` reader support this. The checkpoint is sent as a user message, and the kept tail remains verbatim. `[S]`

**Codex.** `AGENTS.md` is loaded with a default 32 KiB budget (`codex-rs/config/defaults.toml:9`, `codex-rs/config/src/config_toml.rs:77`). Skills use progressive disclosure with a 2% context budget and explicit omission warnings when the budget is exceeded. User messages and pending mail are retained across compaction, and initial context is re-inserted before the last real user message. `[S]`

**Claude Code.** Claude Code has the most explicit documented post-compaction reconstruction: it re-injects the system prompt and output style, project-root `CLAUDE.md`, unscoped rules, auto memory, skill descriptions, the current plan, fresh git status, up to five recently modified files, invoked skill bodies (5k per skill, 25k total), and matching `SessionStart(compact)` hooks. Nested and path-scoped rules reload on demand. `[D]`

**Assessment.** Claude Code is strongest on **instruction preservation by design**. OpenCode and Codex are close because they treat instructions as separately sourced state rather than summary content. Qube is weakest: it relies on the system prompt being rebuilt and on a free-text summary, with no manifest and no freshness check. If a critical constraint was stated in the dropped head and the summarizer omitted it, Qube has no recovery path. `[S/D/I]`

### 9.2.5 Tool-result and large-output handling

**Qube.** Caps are per-tool and inconsistent:

- `run_command`: 120s default timeout, 20,000-character stdout and stderr clips, 10 MB `maxBuffer` (`lib/pi/tools.ts:751-773`).
- `web_search` / `web_fetch`: 25k default, 50k max (tool definitions).
- `subagent`: 50 KB / 2,000 lines (`lib/pi/subagents.ts:38-39`).
- `read_file`: **no cap**; it reads the whole file and returns it (`lib/pi/tools.ts:563-575`).
- No spill file, no artifact pointer, no per-step tool-output budget, and no retention policy. `[S]`

**OpenCode.** Tool output is bounded to 2,000 lines / 50 KiB, with a spill file and a bounded preview plus a path to the full output; spilled files have a 7-day retention (`packages/core/src/tool-output.ts:13-14` and the tool-output path). `[S]`

**Codex.** Codex applies token and byte truncation policies per tool, retains tool outputs across compaction, and has explicit policies for command output and unified execution. `[S]`

**Claude Code.** Documentation describes managed tool output and compaction but does not publish exact per-tool character caps. Treat exact thresholds as `[U]`. `[D/U]`

**Assessment.** OpenCode's spill-file design is the best balance: the model sees a bounded preview, the full data remains retrievable, and the context does not blow up. Qube's combination of an unbounded `read_file` and lossy 20k clips is the worst of both worlds: a large file can consume the window, while a large command output is silently truncated with no way to recover the rest. `[S/I]`

### 9.2.6 Historical retrieval

**Qube.** Qube has the most consumer-oriented retrieval of the four. Memory is a unified store with `observation` and `durable` tiers, deterministic consolidation, and a BM25-lite ranker over stemmed tokens with scope, confidence, and recency priors (`lib/memory/memory-store.ts`, `lib/memory/retrieval.ts`). A core memory block and a per-message recall block are each capped at 1,400 characters (`lib/memory/brief.ts:15-16`). The prompt advertises a "Past chats" index and `list_sessions` / `read_session_summary` / `read_session` tools (`lib/pi/system-prompt.ts:145-148`). Scratchpad notes survive restarts and are injected with a 4 KB / 40-item cap (`lib/pi/prompt-context.ts:44-47`). `[S]`

**OpenCode.** Session history is stored in SQLite with a history/projector layer and revert support. It does not document a personal semantic memory equivalent; project knowledge is carried by `AGENTS.md` and instructions. `[S]`

**Codex.** Rollout JSONL is the durable conversation record, with resume/fork. Project knowledge is carried by `AGENTS.md` and skills; no personal semantic memory was found. `[S]`

**Claude Code.** Auto memory stores `MEMORY.md` with the first 200 lines / 25 KB loaded, plus topic files; `CLAUDE.md` provides managed/user/project/local hierarchy and `.claude/rules/` provides path-scoped rules. `[D]`

**Assessment.** Qube wins for a personal assistant: automatic recall, tiered memory, past-chat index, and scratchpad are directly useful. Claude Code wins for project memory. OpenCode and Codex intentionally keep memory in files, which is more inspectable but less proactive. The caveat is that Qube's memory is injected into the same context as untrusted data, and its retrieval is lexical, not semantic embedding-based; the code explicitly favors determinism and sub-millisecond retrieval over embedding recall (`lib/memory/memory-store.ts` header). `[S/I]`

### 9.2.7 Long-session continuity

**Qube.** Thread messages are persisted as JSON snapshots, and session records cap the transcript at 1 MB (`lib/memory/session-store.ts:7,53,80`). The compaction anchor lets Qube reuse a summary across client resubmissions. Goals persist in `.memory/goals.json` with a 200-item cap. The scheduler ticks every 60 seconds and handles missed runs and deduplication. But the **run** is not durable: `activeRuns` is in memory, and graceful shutdown aborts every active run (`lib/pi/harness.ts:160-178`). A long session can survive a page reload because the transcript is on disk, but an in-flight turn cannot survive a process restart. `[S]`

**OpenCode.** SQLite sessions, write-ahead execution claims, a session inbox, job recovery, and snapshot/revert provide continuity at both the conversation and execution levels. `[S]`

**Codex.** Rollout JSONL plus SQLite state/index support resume and fork; execution state is reconstructible from the rollout. `[S]`

**Claude Code.** Sessions are stored as JSONL under `~/.claude/projects/`; resume, fork, and branch are documented. File-edit checkpoints add code-state continuity. Exact crash semantics are `[U]`. `[D/U]`

**Assessment.** OpenCode is strongest for long-running server-side work; Codex is strongest for replayable local sessions; Claude Code is strongest for user-facing session branching and rewind. Qube has good **conversation** persistence but weak **execution** persistence. `[S/D/I]`

### 9.2.8 Recovery after compaction

**Qube.** Recovery consists of the summary block, the retained tail, and a rebuilt system prompt. The anchor is validated; if history was edited or branched and the anchor is lost, Qube keeps full history rather than applying a stale checkpoint (`lib/pi/compaction.ts:514`). If summarization fails, it can hard-cut and annotate the loss. There is no post-compaction check that required instructions, the active plan, or recent files survived, and no hook to re-read project state. `[S]`

**OpenCode.** Recovery uses the `keepID` checkpoint, the retained tail, current instruction state, `AGENTS.md` re-read, and a checkpoint message. The summarizer is explicitly told not to duplicate instructions that will be re-supplied. `[S]`

**Codex.** Recovery retains user messages and pending mail, re-inserts initial context before the last real user message, and runs post-compact hooks. `[S]`

**Claude Code.** Recovery is the documented manifest described in 9.2.4, including fresh git status and recently modified files. `[D]`

**Assessment.** Qube's anchor validation is a good safety property, but its recovery is **passive**: it hopes the summary contains what matters. Claude's recovery is **active**: it reconstructs known-important state. OpenCode and Codex sit between those poles, with explicit retention invariants. This is the single largest context-management gap after token accounting. `[S/D/I]`

### 9.2.9 Comparative judgment

| Dimension | Qube | OpenCode | Codex | Claude Code |
|---|---|---|---|---|
| Budget source | Fixed 128k + `chars/4` `[S]` | Measured + estimate, model-aware `[S]` | Total vs body, hard/buffered caps `[S]` | Model limit, configurable `[D]` |
| Compaction trigger | Preflight + overflow `[S]` | Auto + precompute + provider-native `[S]` | Pre/mid/post-turn + remote `[S]` | Auto + `/compact` `[D]` |
| Summary structure | 6 sections, 4k cap `[S]` | 7 sections, 32k floor `[S]` | Progress/decisions/context/next `[S]` | Documented guidance, prompt `[U]` |
| Retention invariants | Anchor + tail `[S]` | `keepID` + tail `[S]` | User messages + pending mail `[S]` | Manifest + hooks `[D]` |
| Large outputs | Per-tool clips, unbounded read `[S]` | 2k lines/50 KiB + spill `[S]` | Truncation policies + retention `[S]` | Documented, exact caps `[U]` |
| Memory | BM25-lite + past chats `[S]` | Files/SQLite `[S]` | Rollout + AGENTS.md `[S]` | Auto memory + rules `[D]` |
| Execution continuity | In-memory run, durable off `[S]` | Durable claims + resume `[S]` | Rollout resume/fork `[S]` | JSONL resume/fork `[D]` |
| Post-compaction | Passive summary `[S]` | Instruction re-read `[S]` | Retention + hooks `[S]` | Explicit manifest `[D]` |

**Strongest context-management strategy:** OpenCode, narrowly. It combines measured budgeting, a precise checkpoint, a large structured summary, spill files, and durable execution. Codex is a close second and is better on accounting semantics and retention invariants. Claude Code is best on post-compaction reconstruction but weaker on verifiable internals. Qube is fourth on core context engineering, while first on consumer memory.

---

## 9.3 Long-running execution

Qube's execution model is a **streaming model loop**. OpenCode and Codex model execution as a **durable session or turn object** with explicit state transitions. Claude Code exposes the most user-facing continuity controls. This difference is more important than the number of tools each harness has.

### 9.3.1 Execution loops

**Qube.** `streamText` runs with `maxRetries: 2` and a `stopWhen` predicate that stops at 40 steps (`lib/pi/harness.ts:828-830`). A turn has a 300-second default timeout (`PI_HARNESS_TIMEOUT_MS`, `:340`). At most 32 runs may be active (`:160-161`). A new message on the same thread aborts the previous run, which is Qube's steering mechanism (`:291-309`). After the model stops, Qube may run up to eight **silent continuation** rounds (`lib/pi/continuation.ts:18-20`) when `TodoWrite` still has unfinished items, when a tool error suggests recovery, or when the model stalls without text or tools (`lib/pi/harness.ts:926-986`). One overflow retry with aggressive compaction is available. `[S]`

This is a thoughtful loop for a consumer assistant: the anti-stall and goal-continuation heuristics are more developed than a plain chat loop. The weakness is that all of this state lives inside one process invocation. The loop has no durable step record, no idempotent tool-call ledger, and no resume point.

**OpenCode.** The session runner separates a session, a run, a step, and tool execution. A run is coordinated through `run-coordinator.ts` and a session inbox; the execution service records a write-ahead claim at turn start in the same transaction as the turn (`packages/core/src/session/execution.ts:73-79`). Step-level retry and error handling live in the runner. This makes the loop observable and recoverable rather than a single in-memory promise. `[S]`

**Codex.** Codex uses a turn loop with a tool orchestrator, explicit compaction phases, a parallel-execution gate, and an event stream. The loop can invoke local or remote compaction and can hand work to the multi-agent controller. It is the most explicit execution state machine of the four. `[S]`

**Claude Code.** Documentation describes a gather/action/verify loop with configurable `--max-turns` and `--max-budget-usd`, hooks around tool and turn boundaries, and background sessions. The internal loop implementation is not public `[D/U]`.

**Assessment.** Qube's loop is adequate for short interactive tasks and has good anti-stall behavior, but it is the least durable. OpenCode's loop is the best reference for **resumable** execution; Codex's is the best reference for **explicit state and tool orchestration**; Claude's is the best reference for **user-controlled limits and verification hooks**. `[S/D/I]`

### 9.3.2 Persistent task state

**Qube.** State is split across several stores:

- Thread messages: JSON snapshots in `.memory/thread-messages`, loaded by the chat route.
- Session records: transcript capped at 1 MB (`lib/memory/session-store.ts:7,53,80`).
- Goals: `.memory/goals.json`, capped at 200 items, with lane/status/hash deduplication (`lib/goals/store.ts`).
- Compaction checkpoints: `.memory/compactions`, keyed by thread and FNV-1a anchor.
- Observability: `.memory/observability/<thread>.jsonl` and `_global.jsonl` (`lib/agent/observability.ts:58-59`).
- Active runs: an in-memory `Map` (`lib/pi/harness.ts:160`).
- Durable harness: SQLite implementation in `lib/pi/durable.ts`, configured with a 16,384-token reserve, 20,000-token keep, and 32,768-token background budget (`:77`), but only used when `PI_DURABLE_ENABLED=1` (`app/api/chat/route.ts:227`).
- Checkpoint API: a no-op stub whose `loadCheckpoint` always returns `null` (`lib/agent/checkpoint.ts`). `[S]`

There is no transaction that atomically records "user message accepted, run started, tool call in flight". A crash can leave a persisted user message with no run, or a tool side effect with no record. The durable harness is the right direction, but it is not the production path.

**OpenCode.** SQLite/Drizzle stores sessions, messages, inbox items, jobs, and execution claims. The claim is written with the turn start, and the restart sweep uses it to resume orphaned work. Snapshots capture file trees for revert. `[S]`

**Codex.** Rollout JSONL is the append-only record of turns, tool calls, and events; SQLite provides state/indexing. Thread state can be resumed or forked from the rollout. `[S]`

**Claude Code.** Sessions are JSONL under `~/.claude/projects/`; checkpoints capture file edits; resume, fork, and branch are documented. `[D]`

**Assessment.** OpenCode has the cleanest **transactional** state model. Codex has the cleanest **replayable** state model. Qube has good conversation state and poor execution state. The existence of a gated durable harness makes this a migration problem, not a greenfield problem. `[S/I]`

### 9.3.3 Background execution

**Qube.** Qube has a 60-second scheduler, heartbeat, announcements, and scheduled tasks through `lib/pi/task-runner.ts`. These are real background features for a consumer assistant. Subagents, however, run inside the parent turn: four may run concurrently (`lib/pi/subagents.ts:58`), each with 12 steps (`:274`) and a 180-second timeout (`:247`), but the parent waits for their results and there is no follow-up, resume, or background job handle. `[S]`

**OpenCode.** Subagent work is a background job with recovery (`packages/core/src/session/subagent-job.ts:14,54,64-65`), and the session inbox allows work to continue independently. Jobs can be resumed. `[S]`

**Codex.** Unified execution keeps persistent processes alive across calls; background compaction can run before it is needed; multi-agent work can continue while the parent does other things. `[S]`

**Claude Code.** Background subagents, background sessions, `/loop`, and cloud schedules are documented. `[D]`

**Assessment.** Qube's scheduler is a genuine consumer advantage, but it is not a general background **agent** runtime. A long research or coding task cannot be detached, inspected, and resumed the way it can in OpenCode or Claude Code. `[S/D/I]`

### 9.3.4 Session continuity

**Qube.** Conversation continuity survives a page reload because thread messages are on disk. The client resends full history on each turn, and Qube's compaction anchor trims the summarized head server-side. A process restart loses in-flight work but not the thread. The 1 MB transcript cap means a sufficiently long session is truncated at the session-record level, though the thread snapshot may retain more. `[S]`

**OpenCode.** Session continuity survives server restart through SQLite plus execution claims; the restart path injects a "server restarted while you were working" notice (`packages/core/src/session/execution/restart.ts:17`). `[S]`

**Codex.** Rollout resume and fork provide continuity across process restarts. `[S]`

**Claude Code.** `--resume`, `--continue`, fork, and branch are documented; session files persist under the projects directory. `[D]`

**Assessment.** Qube has conversation continuity but not run continuity. For a desktop assistant that may be closed at any time, that is a material reliability gap. `[S/I]`

### 9.3.5 Checkpointing

**Qube.** `lib/agent/checkpoint.ts` is explicitly a stub: `saveCheckpoint` returns a synthetic id, `loadCheckpoint` returns `null`, `buildResumePlan` returns `shouldResume: false`, and `formatCheckpointForPrompt` returns an empty string. The compaction anchor is a **summary** checkpoint, not an execution or file checkpoint. There is no code-state snapshot and no rewind. `[S]`

**OpenCode.** Git-tree snapshots capture file state; `revert.ts` restores files and computes diffs (`packages/core/src/session/revert.ts:32-47,62-66`). Compaction checkpoints capture the conversation boundary. Together they support reverting code and conversation. `[S]`

**Codex.** Rollout provides conversation replay and fork. File-level checkpoint/rewind was not verified in the inspected modules; treat it as `[U]` rather than assuming parity with Claude Code. `[S/U]`

**Claude Code.** File-edit checkpoints keep the 100 most recent snapshots with roughly 30-day retention, and support rewinding code, conversation, or both. `[D]`

**Assessment.** Claude Code is the best reference for **user-facing rewind**, OpenCode for **programmatic snapshot/revert**, and Codex for **replayable rollout**. Qube has no real checkpointing despite having a module with that name. `[S/D/I]`

### 9.3.6 Interruption recovery

**Qube.** Same-thread steering aborts the previous run. Graceful shutdown aborts all active runs (`lib/pi/harness.ts:170-178`). Failure recovery and idle-stall continuation can rescue a turn **inside the same process**, and overflow recovery can retry with a smaller history. After a process death, there is no resume. `[S]`

**OpenCode.** The execution claim survives a graceful shutdown by design; the restart sweep finds orphaned claims, injects a restart notice, and resumes. It caps resume attempts (the inspected constant is 10) to avoid crash loops, then terminalizes the session (`packages/core/src/session/execution/restart.ts:38-56,81-84`). This is at-least-once execution, not exactly-once. `[S]`

**Codex.** Resume/fork from rollout is the recovery path. Whether individual tool effects are deduplicated on resume is `[U]`; the rollout records calls, but idempotency depends on the tool. `[S/U]`

**Claude Code.** Resume, fork, and checkpoint rewind are documented. Crash-time in-flight tool semantics are `[U]`. `[D/U]`

**Assessment.** OpenCode is the only harness here with an explicit **orphan-resume protocol**. Qube's recovery is process-local. For a desktop app that can be killed by the OS or the user, an orphan-resume protocol is the single most valuable execution pattern to adopt. `[S/D/I]`

### 9.3.7 Retry mechanisms

**Qube.** Provider calls use AI SDK retries (`maxRetries: 2`); overflow has one aggressive-compaction retry; the loop has up to eight continuation rounds. There is no tool-level retry ledger, no idempotency key, no exponential backoff policy documented in the Pi harness, and no durable retry after a crash. `[S]`

**OpenCode.** The runner has step-level error handling and retry; the restart path has a bounded resume-attempt counter. Claims make retries visible to the rest of the system. `[S]`

**Codex.** The turn loop has explicit error events and retry paths; exact backoff and tool-idempotency policy were not enumerated in this review `[S/U]`.

**Claude Code.** Retry behavior is not publicly documented in the reviewed pages `[U]`.

**Assessment.** Qube's retries are **model-call retries**, not **work retries**. A failed tool with a side effect is re-driven by the model, which may repeat the effect. Durable execution and idempotency are the missing layer. `[S/I]`

### 9.3.8 Tool execution isolation

**Qube.** Subagents get fresh context windows and narrowed tool subsets (Explore/researcher/reviewer are read-only), but they share the parent process and workspace. `run_command` executes through a shell with the user's privileges. There is no OS sandbox. Permission checks are the only boundary. `[S]`

**OpenCode.** Permission rulesets and snapshots provide policy and rollback. No OS-level sandbox was found in the inspected core; isolation is process/policy/snapshot based `[S]`. (If a platform-specific sandbox exists outside the inspected modules, it is `[U]`.)

**Codex.** Codex has the strongest isolation: macOS Seatbelt, Linux Landlock/bubblewrap/seccomp, Windows sandboxing, read-only/workspace-write/danger-full-access modes, protected paths, and network off by default with an allowlist proxy and DNS-rebinding checks. `[S]`

**Claude Code.** Permission modes plus an optional Bash sandbox (Seatbelt/bubblewrap) with filesystem and network isolation; the sandbox is off by default. Worktrees provide workspace isolation for some workflows. `[D]`

**Assessment.** Qube is last. Its permission reviewer is a useful second layer, but it cannot contain a malicious or mistaken shell command that the reviewer approves or that arrives through a prompt injection. Codex is the reference architecture for isolation; Claude is the reference for optional sandboxing with a smooth default. `[S/D/I]`

### 9.3.9 Task decomposition

**Qube.** Decomposition primitives are `TodoWrite`, durable goals, and the `subagent` tool with four profiles (Explore, researcher, reviewer, general). Limits: four concurrent subagents, 12 steps each, 180-second timeout, 50 KB / 2,000-line output cap, no nested subagents, and no follow-up to a completed subagent (`lib/pi/subagents.ts:38-39,58,247,274`). `[S]`

**OpenCode.** Subagents are child sessions with background jobs and follow-up; they can be resumed and can continue after the parent turn. `[S]`

**Codex.** Multi-agent V2 provides `spawn_agent`, `send_input`, `wait_agent`, `resume_agent`, and `close_agent`; a persistent agent graph, mailboxes, shared filesystem, residency eviction, concurrency slots, and budget reminders. `[S]`

**Claude Code.** Built-in Explore, Plan, and general-purpose agents; custom agents with tools, model, permission mode, max turns, auto-compact window, skills, MCP servers, hooks, memory, background, and worktree isolation; fork copies the conversation; resume is supported. `[D]`

**Assessment.** Qube's subagents are **one-shot helpers**, not a decomposition runtime. They are useful for recon and review, but they cannot own a multi-step subproject. Codex is the strongest orchestration reference; Claude is the strongest user-facing delegation model; OpenCode is the lightest-weight resumable design. `[S/D/I]`

### 9.3.10 Multi-step orchestration

**Qube.** Orchestration is model-driven inside one loop: the model calls tools, updates `TodoWrite`, and may call subagents. Qube then uses the todo snapshot to decide whether to continue silently. There is no execution DAG, no agent mailbox, no parent-child graph, and no scheduler for agent work beyond the consumer scheduler. `[S]`

**OpenCode.** Run coordinator, session inbox, child sessions, background jobs, and claims provide an explicit orchestration substrate. `[S]`

**Codex.** Agent control, mailboxes, shared filesystem, concurrency slots, and persistent agents provide the most complete orchestration substrate. `[S]`

**Claude Code.** Main agent plus subagents, hooks, `/goal`, and background sessions; the internal scheduler is `[U]`. `[D/U]`

**Assessment.** Qube's orchestration is a **single-agent loop with helpers**. That is appropriate for many consumer tasks but insufficient for long, parallel, or failure-prone work. `[S/I]`

### 9.3.11 Human approval workflows

**Qube.** Approval is multi-layered:

1. Hard category switches and workspace/allowed-directory checks.
2. A sensitive-action classifier (`lib/permissions/sensitive.ts`).
3. An independent LLM reviewer with a 20-second timeout (`lib/permissions/reviewer.ts:47`), given the user's request and redacted action details.
4. A blocking approval card with a 300-second timeout (`lib/middleware/permission-middleware.ts:317`).
5. Headless denial or draft when no user is present (`:306, :395`).
6. Audit logging. `[S]`

This is the most consumer-friendly approval UX of the four: plain-language cards, intent-aware review, and a safe headless fallback. The weakness is that the reviewer is probabilistic and there is no kernel boundary behind it.

**OpenCode.** Permission rulesets use wildcard action/resource rules, deny-first evaluation, saved allow rules, and an unattended fallback that denies unless a rule explicitly allows (`packages/core/src/permission.ts:20,60-61,177-206`). `[S]`

**Codex.** Approval modes plus sandbox escalation plus the Guardian auto-review. The sandbox is the primary boundary; approval is the exception path. `[S]`

**Claude Code.** Modes (manual, auto, acceptEdits, plan, dontAsk, bypassPermissions), deny > ask > allow precedence, `Tool(specifier)` rules, compound-command parsing, hooks, and managed settings. `[D]`

**Assessment.** Qube has the best **UX** and the weakest **guarantee**. OpenCode has the cleanest deterministic rule engine. Codex has the strongest layered enforcement. Claude has the most configurable policy surface. `[S/D/I]`

### 9.3.12 Completion verification

**Qube.** Completion is inferred from the model's `TodoWrite` snapshot. If items remain, Qube injects a silent continuation up to the budget (`lib/pi/harness.ts:926-948`). If items are marked complete, Qube trusts that. There is no fresh-context verifier, no required evidence, and no test/command gate. `[S]`

**OpenCode.** Runs complete when the model ends the turn and tools settle. No dedicated verification agent was found in the inspected core `[S]`. Tests and CI are external.

**Codex.** No dedicated completion verifier was found in the inspected core. Sandbox and approvals constrain actions, not correctness; tests and CI are external. `[S]`

**Claude Code.** The strongest documented verification surface: `/goal` runs a separate checker after each turn, `/verify` checks a change, `/code-review` uses a fresh subagent, and Stop hooks can block completion for up to eight consecutive stops by default. `[D]`

**Assessment.** Claude Code is the reference for **verification as a harness feature**. Qube is the weakest because its continuation heuristic can reward optimistic todo updates. A model that marks everything done gets no further scrutiny. `[S/D/I]`

### 9.3.13 Comparative execution table

| Capability | Qube | OpenCode | Codex | Claude Code |
|---|---|---|---|---|
| Loop shape | `streamText`, 40 steps, 300s `[S]` | Session/run/step with inbox `[S]` | Turn loop + tool orchestrator `[S]` | Gather/action/verify `[D]` |
| Durable run state | In-memory `Map`; durable gated `[S]` | SQLite claims + jobs `[S]` | Rollout + SQLite `[S]` | JSONL sessions `[D]` |
| Background work | Scheduler/heartbeat; sync subagents `[S]` | Background jobs + resume `[S]` | Unified exec + multi-agent `[S]` | Background agents/sessions `[D]` |
| Checkpointing | No-op stub `[S]` | Git snapshots + revert `[S]` | Rollout replay/fork `[S]` | 100 snapshots/~30 days `[D]` |
| Interruption recovery | Process-local continuation `[S]` | Orphan claim + resume `[S]` | Resume/fork `[S]` | Resume/fork/rewind `[D]` |
| Retries | Model retries + 8 continuations `[S]` | Step retries + bounded resume `[S]` | Turn retry paths `[S/U]` | `[U]` |
| Isolation | No OS sandbox `[S]` | Policy + snapshots `[S]` | OS sandbox modes `[S]` | Optional Bash sandbox `[D]` |
| Decomposition | 4 one-shot subagents `[S]` | Child sessions + follow-up `[S]` | Persistent agent graph `[S]` | Custom agents + fork `[D]` |
| Approvals | Reviewer + card + headless deny `[S]` | Wildcard rulesets `[S]` | Sandbox + approvals + Guardian `[S]` | deny > ask > allow + hooks `[D]` |
| Verification | Todo self-report `[S]` | No dedicated verifier `[S]` | No dedicated verifier `[S]` | `/goal`, `/verify`, Stop hooks `[D]` |

---

## 9.4 System prompts and agent instructions

The question is not "which prompt is longest". Qube's prompt is 48,323 bytes, roughly 12k tokens before tool schemas. A long prompt can encode valuable domain behavior, but it also dilutes attention, increases cost, and makes every instruction compete with every other instruction. The comparison is therefore about **hierarchy, modularity, dynamic injection, and the boundary between instructions and guarantees**.

### 9.4.1 Instruction hierarchy

**Qube.** Qube has a **flat** hierarchy: one system prompt, plus a user message, plus optional dynamic sections (skills, connectors, memory, past chats, scratchpad, kernel resume, custom instructions). There is no project instruction discovery, no path-scoped rules, no managed policy layer, and no `AGENTS.md` or `CLAUDE.md` equivalent. The root repository has neither file, and the harness does not implement discovery. The prompt does contain a strong untrusted-data rule: page content, quoted replies, recalled memories, compacted summaries, scratchpad contents, tool outputs, file contents, and web results are data, never instructions (`lib/pi/system-prompt.ts:70`). `[S/O]`

**OpenCode.** A small core system prompt (756 bytes in `packages/core/src/session/runner/prompt/system.txt`) plus model-specific plugin prompts (roughly 2.5–8.7 KB in the inspected set), `AGENTS.md`, skills, and instruction-state modules. The compaction prompt explicitly excludes repository conventions and `AGENTS.md` from the summary because the next agent receives current versions separately (`packages/core/src/session/compaction.ts:216`). `[S]`

**Codex.** Model-specific base prompts (roughly 6.6–21.7 KB in the inspected set), `AGENTS.md` with a 32 KiB default budget (`codex-rs/config/defaults.toml:9`; `codex-rs/config/src/config_toml.rs:77`), skills with a 2% context budget and omission warnings, and explicit developer/user instructions. `[S]`

**Claude Code.** Managed policy, user, project, and local `CLAUDE.md`; `AGENTS.md` fallback; `.claude/rules/` with `paths` scoping; auto memory; skills; hooks. This is the most documented hierarchy. The actual system prompt text is not public `[D/U]`.

**Assessment.** Claude Code has the strongest **hierarchy**; Codex has the strongest **size discipline**; OpenCode has the best **cache-friendly modularity**; Qube has the flattest structure and the least user-editable project context. `[S/D/I]`

### 9.4.2 Tool awareness

**Qube.** The system prompt embeds a long inline tool catalog: browser, computer control, memory, sessions, scratchpad, connectors, scheduler, generative UI, and more (`lib/pi/system-prompt.ts:75-96` and following). This duplicates the actual tool schemas sent to the model, creating two sources of truth that can drift. All tools are exposed every turn; there is no dynamic tool search or deferred exposure. `[S]`

**OpenCode.** Tool descriptions live with the tool implementations and plugins; the core prompt encourages parallel tool calls and codebase exploration. `AGENTS.md` supplies repository conventions. `[S]`

**Codex.** Tool namespaces and exposure modes (`direct`, `deferred`, `code-mode`, `hidden`) plus BM25 `tool_search` let the harness choose what the model sees. This is the most sophisticated tool-awareness design. `[S]`

**Claude Code.** Built-in tools, MCP tools, and skills, with permissions attached to tool specifications. The exact prompt text and tool-search behavior are `[U]` unless documented. `[D/U]`

**Assessment.** Codex is the reference for tool awareness at scale. Qube's inline catalog is acceptable at its current tool count but becomes a liability as MCP/connectors grow. `[S/I]`

### 9.4.3 Planning behavior

**Qube.** Planning is `TodoWrite` plus durable goals plus silent continuation. The prompt tells the model to act first and to track multi-step work in todos. There is no explicit plan mode, no user-approved plan artifact, and no plan re-injection after compaction. `[S]`

**OpenCode.** A todo tool and session planning are present; the prompt encourages parallel independent calls and sequential dependent calls. `[S]`

**Codex.** Planning is model-driven within the turn and across the multi-agent graph; the prompt and tool surface emphasize explicit task decomposition. `[S]`

**Claude Code.** Plan mode, `/plan`, todo tracking, and plan re-injection after compaction are documented. This is the strongest user-facing planning model. `[D]`

**Assessment.** Qube's planning is lightweight and implicit. It works for consumer tasks but lacks the durable plan artifact that survives compaction and user review. `[S/D/I]`

### 9.4.4 Execution discipline

**Qube.** The prompt is highly prescriptive: act immediately, do not open with clarifying questions when tools can answer, follow through, verify actions, avoid "let me know" endings, use tools rather than asking, and treat untrusted content as data (`lib/pi/system-prompt.ts:35-70`). It includes many few-shot examples for consumer scenarios. This produces good initiative but risks over-eagerness and instruction dilution: 48 KB of rules and examples compete for attention, and some rules are absolute ("never open with clarifying questions") in situations where a question is appropriate. `[S]`

**OpenCode.** The core prompt is concise; model-specific plugin prompts add behavior. Discipline is enforced more by tool design and permissions than by a giant prompt. `[S]`

**Codex.** The prompt is model-specific and paired with sandbox/approval instructions; the harness, not the prompt alone, enforces the boundary. `[S]`

**Claude Code.** Best practices documentation emphasizes exploration, planning, verification, and explicit context management; hooks provide deterministic enforcement. `[D]`

**Assessment.** Qube's prompt is operationally rich but over-specified. It is not inferior in **domain intent**; it is inferior in **structure**. The "act first" rule is a legitimate consumer-product choice, but it should be scoped and balanced with a "ask only when the action is irreversible or ambiguous" rule. `[S/D/I]`

### 9.4.5 Error recovery instructions

**Qube.** The prompt tells the model to diagnose failures, try alternatives, and not conclude something is missing after one look (for example, the path-search rule at `lib/pi/system-prompt.ts:261`). The harness adds retries, overflow recovery, and continuation. There is no structured error taxonomy or recovery policy per tool. `[S]`

**OpenCode.** Step errors, restart notices, and resume paths are explicit. `[S]`

**Codex.** Compaction and retry paths are explicit; tool errors are events. `[S]`

**Claude Code.** Stop/StopFailure hooks and recovery guidance are documented; internal retry policy `[U]`. `[D/U]`

**Assessment.** Qube's prompt-level recovery is practical, but it depends on the model noticing the error. A typed error with a suggested recovery action is more reliable. `[S/I]`

### 9.4.6 Permission instructions

**Qube.** The prompt describes permission behavior and tells the model that some actions are reviewed automatically. The actual enforcement is in middleware, but the reviewer is an LLM and the shell is unsandboxed. The model is therefore both instructed about safety and able to propose actions that the safety layer must catch. `[S]`

**OpenCode.** Permissions are rule-based and evaluated outside the prompt; the model is told what is allowed, but the ruleset is authoritative. `[S]`

**Codex.** Sandbox and approval policy are harness state; the prompt explains them but cannot override them. `[S]`

**Claude Code.** Deny/ask/allow rules, hooks, and managed settings are authoritative; `CLAUDE.md` is advisory. `[D]`

**Assessment.** Qube has the weakest separation between **model instructions** and **programmatic guarantees**. Codex and Claude are the reference designs. `[S/D/I]`

### 9.4.7 Verification instructions

**Qube.** The prompt says to verify actions and report evidence, but the only programmatic completion signal is `TodoWrite`. There is no verifier prompt, no required evidence schema, and no test gate. `[S]`

**OpenCode.** Verification is left to the model and external tests; no dedicated verifier was found. `[S]`

**Codex.** Verification is left to the model and external tests; sandbox/approval are not correctness checks. `[S]`

**Claude Code.** `/goal` uses a separate checker after each turn; `/verify` and `/code-review` provide explicit verification workflows; Stop hooks can block completion. `[D]`

**Assessment.** Claude Code is the clear reference. Qube's "verify" instruction is advisory only. `[S/D/I]`

### 9.4.8 Prompt modularity

**Qube.** One 48,323-byte file plus dynamic string builders. Sections are separated by Markdown headings but compiled into one system message. There is no module registry, no per-module token budget, and no way to enable/disable a module per task. `[S]`

**OpenCode.** Core prompt, model-specific prompt plugins, `AGENTS.md`, skills, and instruction state are separate inputs. `[S]`

**Codex.** Model-specific prompts, `AGENTS.md`, and skills are separate, with explicit budgets. `[S]`

**Claude Code.** System prompt, output style, `CLAUDE.md`, rules, memory, skills, and hooks are separate layers. `[D]`

**Assessment.** Qube is the least modular. This is a maintainability and cache problem, not just a style preference. `[S/D/I]`

### 9.4.9 Dynamic instruction injection

**Qube.** Dynamic injections include:

- Current date and time. `formatCurrentTimeInstruction()` is inserted at `lib/pi/system-prompt.ts:31`; it includes hour and minute (`lib/pi/prompt-context.ts:38-42`). The line sits early in the prompt, so on providers that honor the configured cache it invalidates the cacheable prefix after that point every minute. Qube nevertheless sets an OpenAI prompt cache key and 24-hour retention (`lib/pi/harness.ts:511-512`), which is largely defeated by the changing time line for those providers.
- Skills (`lib/skills/prompt.ts`), connectors, user name/about.
- Memory core and recall blocks, each 1,400 characters (`lib/memory/brief.ts:15-16`).
- Past-chat index.
- Scratchpad, with 4 KB / 40-item caps (`lib/pi/prompt-context.ts:44-47`).
- Kernel resume and custom instructions. `[S]`

This is rich context, but it is injected without a per-section token budget and without cache segmentation.

**OpenCode.** Instruction state, `AGENTS.md`, skills, and compaction checkpoint are separate; the cache can retain stable instructions while the conversation changes. `[S]`

**Codex.** Skills snapshots, `AGENTS.md`, and compaction retention are separate; the 2% skill budget prevents catalog bloat. `[S]`

**Claude Code.** Post-compaction manifest, hooks, memory, and skills are re-injected deliberately. `[D]`

**Assessment.** Qube has the most **consumer-relevant** dynamic context and the worst **cache discipline**. Moving the time line out of the cached prefix would be a low-effort, high-value fix. `[S/I]`

### 9.4.10 Model instructions vs. programmatic guarantees

| Control | Qube | OpenCode | Codex | Claude Code |
|---|---|---|---|---|
| Workspace paths | Programmatic check + prompt `[S]` | Permission rules `[S]` | Sandbox + policy `[S]` | Permission rules + sandbox `[D]` |
| Shell commands | Classifier + LLM reviewer; no sandbox `[S]` | Ruleset; no OS sandbox found `[S]` | OS sandbox + approvals `[S]` | deny/ask/allow + optional sandbox `[D]` |
| Network | Prompt/permission; no network policy found `[S]` | Permission rules `[S]` | Off by default + allowlist proxy `[S]` | Sandbox network isolation `[D]` |
| Completion | Prompt + Todo self-report `[S]` | Model/tool completion `[S]` | Model/tool completion `[S]` | `/goal` checker + Stop hooks `[D]` |
| Secrets/redaction | Reviewer redaction + audit `[S]` | Permission/redaction paths `[S]` | OTel redaction `[S]` | OTel redaction `[D]` |

**Assessment.** Qube has a real programmatic permission layer, which is more than a prompt-only design. But its highest-risk boundary — arbitrary shell execution — is guarded by a probabilistic reviewer rather than a kernel sandbox. Codex is the reference for **defense in depth**; Claude is the reference for **configurable policy**; Qube is the reference for **consumer-friendly approval UX**. `[S/D/I]`

### 9.4.11 Prompt quality judgment

Qube's prompt is **not inferior in domain content**. It contains hard-won consumer behaviors: act rather than ask, use memory silently, cite evidence for proactive suggestions, treat recalled content as untrusted, avoid narrating memory operations, and search thoroughly before claiming a file is missing. Those are valuable.

It is **inferior in architecture** for five reasons:

1. **Monolithic size.** 48 KB of instructions before tool schemas leaves less room for the conversation and increases dilution.
2. **No project instruction hierarchy.** Qube cannot learn a repository's conventions from an `AGENTS.md` or `.claude/rules` equivalent; everything must be in the global prompt or memory.
3. **Duplicated tool catalog.** The prompt describes tools that are also described by schemas, creating drift.
4. **Cache-hostile dynamic injection.** The minute-level time line sits early in the prompt, defeating the 24-hour cache key.
5. **Advisory verification and permissions.** Important guarantees are described in the prompt rather than enforced by the harness.

OpenCode's prompt is the best example of **small core plus modular context**. Codex's is the best example of **model-specific prompts plus explicit budgets**. Claude's is the best documented example of **layered instructions plus post-compaction reconstruction**. Qube should modularize, not merely shorten.

---

## 9.5 Tool orchestration and harness architecture

Qube's tool **breadth** is a genuine strength. Its tool **containment** and **selection** are weak. The coding harnesses are narrower but more disciplined about what the model sees and what a tool can do.

### 9.5.1 Tool registration and discovery

**Qube.** Tools are registered statically in `lib/pi/tools.ts` with Zod input schemas. The registry includes filesystem, shell, web, browser, OS computer control, `TodoWrite`, subagent, scratchpad, ask, memory, sessions, scheduler/heartbeat/announcements, Composio connectors, MCP, and generative UI. All registered tools are exposed to the model on every turn. There is no tool search, no deferred exposure, and no per-task tool filtering. `[S]`

**OpenCode.** Tools are registered through the core tool module and plugins, including MCP tools, filesystem tools, shell, search, patch, and subagent. Tool output is normalized through the tool-output module. `[S]`

**Codex.** The tool registry/router supports `direct`, `deferred`, `code-mode`, and `hidden` exposure, plus `tool_search` with BM25 ranking and namespaces. This is the most scalable discovery design. `[S]`

**Claude Code.** Built-in tools, MCP tools, and skills are documented; exact discovery and filtering internals are `[U]`. `[D/U]`

**Assessment.** Codex is the reference. Qube's static exposure is fine for a small tool set but does not scale to a large connector/MCP catalog. `[S/I]`

### 9.5.2 Tool schemas and descriptions

**Qube.** Zod schemas validate inputs. Descriptions are detailed and sometimes embed operational rules (for example, the browser and computer-control instructions). The prompt also contains an inline catalog, so the model sees two descriptions of the same tool. `[S]`

**OpenCode.** Tool schemas and descriptions live with implementations; the core prompt is small and does not duplicate the full catalog. `[S]`

**Codex.** Tool specs are JSON schemas with namespaces and exposure metadata; descriptions are model-facing and budgeted. `[S]`

**Claude Code.** Tool permissions reference `Tool(specifier)` patterns; exact schemas are `[U]`. `[D/U]`

**Assessment.** Qube's schemas are sound; the duplication and lack of a token budget are the problems. `[S/I]`

### 9.5.3 Tool selection

**Qube.** Selection is entirely model-driven over the full tool list. With many MCP/connector tools, the model must distinguish similar tools from a long catalog. There is no search step and no risk-based grouping. `[S/I]`

**OpenCode.** The model selects from the available tool set; the prompt encourages parallel independent calls and sequential dependent calls. `[S]`

**Codex.** Exposure modes plus `tool_search` let the harness present a small direct set and reveal deferred tools on demand. This reduces selection error and context cost. `[S]`

**Claude Code.** Tool permissions and skills guide selection; exact search behavior `[U]`. `[D/U]`

**Assessment.** Codex is best. Qube should at minimum group tools by risk and hide long-tail connectors behind a search/activation step. `[S/I]`

### 9.5.4 Parallel tool execution

**Qube.** Parallelism is model-driven through the AI SDK: if the model emits multiple independent tool calls, they can run concurrently. There is no explicit harness-level gate or dependency analysis. Subagents have a separate four-concurrency cap. `[S/I]`

**OpenCode.** The prompt explicitly encourages parallel independent calls; same-step parallel reads settle concurrently, with an in-memory claim guard (`packages/core/src/session/instructions.ts:40`). `[S]`

**Codex.** An explicit parallel-execution gate (`codex-rs/core/src/tools/parallel.rs`) decides which calls may run together. This is the most controlled design. `[S]`

**Claude Code.** Parallel tool use is documented; the exact gate is `[U]`. `[D/U]`

**Assessment.** Codex is the reference for safe parallelism. Qube's model-driven approach is acceptable but can create write conflicts when two tools touch the same file. `[S/I]`

### 9.5.5 Subagents and delegation

**Qube.** Four profiles (Explore, researcher, reviewer, general), four concurrent runs, 12 steps, 180-second timeout, 50 KB / 2,000-line output cap, isolated child context, no recursion, no follow-up, and no background handle (`lib/pi/subagents.ts`). The prompt tells the parent to track each delegation as a `TodoWrite` item and to avoid concurrent writes to the same file (`lib/pi/system-prompt.ts:96`). `[S]`

**OpenCode.** Child sessions, background jobs, follow-up, and resume (`packages/core/src/session/subagent-job.ts`). `[S]`

**Codex.** Multi-agent V2 with persistent agents, mailboxes, send/wait/resume/close, shared filesystem, concurrency slots, and budget reminders (`codex-rs/core/src/tools/handlers/multi_agents_spec.rs:166-310`). `[S]`

**Claude Code.** Built-in and custom agents, fork, background, worktree isolation, resume. `[D]`

**Assessment.** Qube's subagents are useful but one-shot. Codex is the orchestration reference; Claude is the delegation-UX reference. `[S/D/I]`

### 9.5.6 Filesystem operations

**Qube.** `read_file`, `write_file`, `edit_file`, `delete_file`, `list_directory`, and `present_file`. Path checks enforce the workspace and allowed directories. `read_file` is unbounded (`lib/pi/tools.ts:563-575`); there is no patch/apply-patch tool and no diff-based edit primitive. `[S]`

**OpenCode.** Read, search, patch, and filesystem tools; snapshots support revert. `[S]`

**Codex.** `apply_patch` plus sandboxed filesystem access; protected paths. `[S]`

**Claude Code.** Read/Edit/Write plus checkpoints for rewind. `[D]`

**Assessment.** Codex is the reference for safe patching; Claude for rewind; OpenCode for snapshot/revert. Qube's unbounded read is a concrete reliability bug. `[S/D/I]`

### 9.5.7 Terminal and code execution

**Qube.** `run_command` uses `execAsync` with a shell, a 120-second default timeout, 20,000-character stdout/stderr caps, and a 10 MB `maxBuffer` (`lib/pi/tools.ts:751-773`). There is no PTY, no persistent process, no job control, and no sandbox. `[S]`

**OpenCode.** Shell/command abstraction with command parsing and execution; the inspected shell modules handle quoting and command structure. PTY/persistent-session support was not verified `[S/U]`.

**Codex.** Unified execution keeps persistent processes and supports interactive terminal workflows; sandboxing applies to execution. `[S]`

**Claude Code.** Bash tool with optional sandbox and permission rules; long-running/background shell behavior is documented in part. `[D]`

**Assessment.** Codex is the strongest terminal runtime. Qube's `execAsync` is a one-shot command runner, adequate for simple tasks but not for dev servers, REPLs, or long builds. `[S/D/I]`

### 9.5.8 Browser and external integrations

**Qube.** This is Qube's clearest advantage. It has a managed browser, browser-use instructions, OS-level computer control through `open-codex-computer-use` (app listing, state inspection, click/type/key sequences, app launch), web search/fetch, Composio connectors, MCP, and generative UI. The prompt contains detailed computer-control rules, including the requirement to observe and act in one sequence call (`lib/pi/system-prompt.ts:83`). `[S]`

**OpenCode.** Web search/fetch and MCP; no OS-level computer control found. `[S]`

**Codex.** Web search, MCP, unified execution; no OS-level computer control found in the inspected core. `[S]`

**Claude Code.** Web fetch/search and MCP; no OS-level computer control documented. `[D]`

**Assessment.** Qube wins decisively for consumer automation. This is the part of Qube's architecture that the coding harnesses should not be used to replace. `[S/D/I]`

### 9.5.9 Permission boundaries

**Qube.** Hard category switches, workspace and allowed-directory checks, sensitive-action classification, LLM review, approval card, headless denial/draft, and audit. No OS sandbox. `[S]`

**OpenCode.** Wildcard rulesets, deny-first, saved allows, unattended fallback. `[S]`

**Codex.** Sandbox modes, protected paths, network policy, approval modes, Guardian. `[S]`

**Claude Code.** Deny > ask > allow, modes, hooks, managed settings, optional sandbox. `[D]`

**Assessment.** Qube's UX is best; Codex's enforcement is best; Claude's policy surface is broadest; OpenCode's rule engine is cleanest. `[S/D/I]`

### 9.5.10 Tool output validation

**Qube.** Zod validates inputs; AI SDK validates tool arguments. Outputs are truncated per tool and returned as JSON strings or text. There is no semantic validation that a tool actually achieved its goal (for example, that an edited file contains the intended change), and no schema for error vs. success beyond ad hoc fields. `[S]`

**OpenCode.** Typed tool output and bounded spill files; step errors are typed. `[S]`

**Codex.** Schema-backed tool specs, truncation policies, and retained tool outputs. `[S]`

**Claude Code.** Documented tool results and permission integration; exact output validation `[U]`. `[D/U]`

**Assessment.** Qube's input validation is fine; its output validation is thin. A post-tool verifier or assertion layer would catch silent failures. `[S/I]`

### 9.5.11 Error propagation

**Qube.** Tool errors are returned to the model as strings or JSON; permission denials become messages; the harness retries model calls and can continue after errors. There is no structured error code, no retryability flag, and no per-tool recovery hint. `[S]`

**OpenCode.** Typed errors, restart notices, and step-level handling. `[S]`

**Codex.** Structured events, error paths, and OTel spans. `[S]`

**Claude Code.** Documented error surfaces and Stop/StopFailure hooks; internals `[U]`. `[D/U]`

**Assessment.** Qube's error propagation is conversational rather than typed. That is workable for a consumer assistant but makes automated recovery and analytics harder. `[S/I]`

### 9.5.12 Execution tracing

**Qube.** Observability is JSONL: one file per thread plus a global file, with redaction (`lib/agent/observability.ts:58-59`). There are no spans, trace IDs, parent-child relationships, latency histograms, token/cost attribution per step, or OTel export. `[S]`

**OpenCode.** Event/bus architecture with structured session events; a full OTel pipeline was not verified `[S/U]`.

**Codex.** Opt-in OpenTelemetry with traces, metrics, and logs; prompts are redacted by default. `[S]`

**Claude Code.** OpenTelemetry metrics, logs, and traces are documented. `[D]`

**Assessment.** Qube is last. JSONL is useful for local debugging but cannot answer "which step in which subagent consumed the tokens and why did it take 40 seconds" without manual correlation. `[S/D/I]`

### 9.5.13 Tool orchestration summary

| Dimension | Qube | OpenCode | Codex | Claude Code |
|---|---|---|---|---|
| Registration | Static registry + MCP/Composio `[S]` | Core + plugins + MCP `[S]` | Registry/router + namespaces `[S]` | Built-in + MCP + skills `[D]` |
| Exposure | All tools every turn `[S]` | Available tool set `[S]` | direct/deferred/code-mode/hidden `[S]` | Documented tools; internals `[U]` |
| Selection | Model-only `[S]` | Model + prompt `[S]` | BM25 tool search `[S]` | Model + permissions `[D]` |
| Parallelism | Model-driven `[S]` | Same-step parallel reads `[S]` | Explicit gate `[S]` | Documented parallel `[D]` |
| Subagents | One-shot, 4×12×180s `[S]` | Child sessions + jobs `[S]` | Persistent graph `[S]` | Custom/background/fork `[D]` |
| Filesystem | Unbounded read; no patch `[S]` | Read/patch/snapshot `[S]` | `apply_patch` + sandbox `[S]` | Read/Edit/Write + rewind `[D]` |
| Terminal | `execAsync`, no PTY `[S]` | Shell abstraction `[S]` | Unified exec `[S]` | Bash + optional sandbox `[D]` |
| Browser/OS | Managed browser + OS control `[S]` | Web/MCP only `[S]` | Web/MCP only `[S]` | Web/MCP only `[D]` |
| Permissions | Reviewer + card + no sandbox `[S]` | Rulesets `[S]` | Sandbox + approvals `[S]` | deny/ask/allow + hooks `[D]` |
| Output bounds | Per-tool clips; read unbounded `[S]` | 2k lines/50 KiB + spill `[S]` | Truncation + retention `[S]` | Documented; caps `[U]` |
| Tracing | JSONL only `[S]` | Event bus `[S/U]` | OTel `[S]` | OTel `[D]` |

---

## 9.6 Architectural benchmarking matrix

The matrix covers exactly the fourteen capabilities named in the research objective. Cells state the strongest evidence-backed characterization, not a score. `[S]` = verified source, `[D]` = official documentation, `[O]` = observed, `[I]` = inference, `[U]` = unknown. No numeric scores are used.

| # | Capability | Qube | OpenCode | Claude Code | Codex | Key evidence |
|---|---|---|---|---|---|---|
| 1 | **Context management** | Fixed 128k window; `chars/4` estimate; 20k reserve; 15k tail; system counted, tool schemas not counted `[S]` | Measured usage + estimate; `max(16k, 15%)` reserve; 200k unknown-window fallback; shrink ladder `[S]` | Auto-compact at model limit; `/autocompact` 100K–1M; ~967K on 1M models `[D]` | `Total` vs `BodyAfterPrefix`; hard and buffered caps; model-switch recompute `[S]` | `lib/pi/compaction.ts:59-62,82,520-523`; `packages/core/src/session/compaction.ts:127-171`; `codex-rs/core/src/session/context_window.rs:63-68`; `claude-docs/model-config.md`, `context-window.md` |
| 2 | **Context compaction** | Preflight + overflow; FNV-1a anchor; six-section summary; 4k output cap; hard-cut fallback `[S]` | Auto + precompute + provider-native; `keepID`; seven-section summary; 32k floor `[S]` | Auto + `/compact` with focus; `SessionStart(compact)` hook `[D]` | Pre/mid/post-turn; local Responses summary; remote V2; pre/post hooks `[S]` | `lib/pi/compaction.ts:250-255,436-548,633`; `packages/core/src/session/compaction.ts:139,175-198,216,265-269,348-396`; `codex-rs/core/src/compact.rs:200-227`; `claude-docs/context-window.md` |
| 3 | **Long-running execution** | `streamText`, 40 steps, 300s, 8 silent continuations; single process `[S]` | Session/run/step, inbox, coordinator, durable claims `[S]` | Gather/action/verify; `--max-turns`, `--max-budget-usd`; background sessions `[D]` | Turn loop + tool orchestrator; parallel gate; multi-agent `[S]` | `lib/pi/harness.ts:160-161,340,828-830,926-986`; `packages/core/src/session/execution.ts:73-79`; `codex-rs/core/src/agent/control_tests.rs` and tool orchestrator; `claude-docs/how-claude-code-works.md` |
| 4 | **Persistent task state** | Thread JSON, goals JSON, 1 MB transcript cap; `activeRuns` in memory; durable harness gated off `[S]` | SQLite sessions/messages/jobs/claims `[S]` | JSONL sessions under `~/.claude/projects/` `[D]` | Rollout JSONL + SQLite state/index `[S]` | `lib/memory/session-store.ts:7,53,80`; `lib/pi/harness.ts:160`; `lib/pi/durable.ts:77`; `app/api/chat/route.ts:227`; OpenCode session store; Codex rollout; `claude-docs/checkpointing.md` |
| 5 | **Session recovery** | Conversation survives reload; in-flight run lost on restart `[S]` | Orphan claim sweep; restart notice; bounded resume attempts `[S]` | Resume, fork, branch; crash-time tool semantics `[U]` `[D/U]` | Rollout resume/fork `[S]` | `lib/agent/checkpoint.ts` (no-op); `packages/core/src/session/execution/restart.ts:17,38-56,81-84`; `claude-docs/checkpointing.md`; Codex rollout |
| 6 | **Tool orchestration** | Static registry; all tools every turn; inline catalog; MCP/Composio `[S]` | Core tools + plugins + MCP; typed output; shell abstraction `[S]` | Built-in + MCP + skills; exact internals `[U]` `[D/U]` | Registry/router; direct/deferred/code-mode/hidden; BM25 `tool_search`; parallel gate `[S]` | `lib/pi/tools.ts`; `packages/core/src/tool.ts`, `tool-output.ts`; `codex-rs/core/src/tools/tool_namespaces_info.rs`, `tools/parallel.rs`; `claude-docs/sub-agents.md` |
| 7 | **Parallel execution** | Model-driven; no harness gate `[S/I]` | Prompt-driven; same-step parallel reads `[S]` | Parallel tool use documented; exact gate `[U]` `[D/U]` | Explicit parallel-execution gate `[S]` | `lib/pi/harness.ts` AI SDK loop; `packages/core/src/session/instructions.ts:40`; `codex-rs/core/src/tools/parallel.rs`; `claude-docs/best-practices.md` |
| 8 | **Subagent support** | Four profiles; 4 concurrent; 12 steps; 180s; one-shot; no follow-up `[S]` | Child sessions; background jobs; follow-up/resume `[S]` | Explore/Plan/general; custom agents; fork/worktree/background/resume `[D]` | Persistent graph; `spawn/send/wait/resume/close`; mailboxes; residency `[S]` | `lib/pi/subagents.ts:38-39,58,247,274`; `packages/core/src/session/subagent-job.ts`; `codex-rs/core/src/tools/handlers/multi_agents_spec.rs:166-310`; `claude-docs/sub-agents.md` |
| 9 | **Memory architecture** | BM25-lite tiered memory; core/recall 1.4k each; past chats; scratchpad `[S]` | SQLite history; `AGENTS.md`; no personal semantic memory found `[S]` | `CLAUDE.md` hierarchy; auto memory 200 lines/25 KB; path-scoped rules `[D]` | Rollout + `AGENTS.md` (32 KiB) + skills `[S]` | `lib/memory/memory-store.ts`, `retrieval.ts`, `brief.ts:15-16`; `packages/core/src/tool/plugin/read.ts`; `codex-rs/core/src/agents_md.rs:51`; `claude-docs/memory.md` |
| 10 | **Permission management** | Hard switches + classifier + 20s LLM reviewer + 300s card + headless deny; no OS sandbox `[S]` | Wildcard rulesets; deny-first; saved allows; unattended fallback `[S]` | deny > ask > allow; modes; hooks; managed settings; optional sandbox `[D]` | Sandbox modes; protected paths; network policy; approvals; Guardian `[S]` | `lib/middleware/permission-middleware.ts:317`; `lib/permissions/reviewer.ts:47`; `packages/core/src/permission.ts:20,60-61,177-206`; `codex-rs/core/src/sandboxing/mod.rs`; `claude-docs/permissions.md`, `sandboxing.md` |
| 11 | **Error recovery** | `maxRetries: 2`; one overflow retry; 8 continuations; no durable retry ledger `[S]` | Step retries; restart notices; bounded resume `[S]` | Stop/StopFailure hooks; resume; exact retry policy `[U]` `[D/U]` | Retry paths and events; exact policy `[S/U]` | `lib/pi/harness.ts:828,922-986`; `packages/core/src/session/execution/restart.ts`; `codex-rs/core/src` error paths; `claude-docs/hooks.md` |
| 12 | **Execution verification** | `TodoWrite` self-report; silent continuation; no independent verifier `[S]` | No dedicated verifier found; tests external `[S]` | `/goal` checker; `/verify`; `/code-review`; Stop hooks up to 8 `[D]` | No dedicated verifier found; tests external `[S]` | `lib/pi/harness.ts:926-948`; OpenCode runner; Codex turn loop; `claude-docs/best-practices.md`, `hooks.md` |
| 13 | **Observability** | Per-thread/global JSONL with redaction; no spans/metrics/OTel `[S]` | Event/bus architecture; full OTel not verified `[S/U]` | OTel metrics/logs/traces `[D]` | Opt-in OTel traces/metrics/logs; redacted prompts `[S]` | `lib/agent/observability.ts:58-59`; OpenCode event modules; `codex-rs/otel`; `claude-docs/monitoring-usage.md` |
| 14 | **Prompt architecture** | 48,323-byte monolith; no `AGENTS.md`/`CLAUDE.md`; time at line 31; rich dynamic sections `[S]` | 756-byte core + 2.5–8.7 KB model prompts + `AGENTS.md` + skills `[S]` | Layered `CLAUDE.md`/rules/memory/skills/hooks; prompt text `[U]` `[D/U]` | Model-specific 6.6–21.7 KB + `AGENTS.md` 32 KiB + skills 2% `[S]` | `wc -c lib/pi/system-prompt.ts`; `lib/pi/system-prompt.ts:14,31,70`; `packages/core/src/session/runner/prompt/system.txt`; `codex-rs/config/defaults.toml:9`; `claude-docs/memory.md`, `context-window.md` |

**Reading the matrix.** Qube leads on consumer memory (row 9) and browser/OS integration (not a matrix row because it is outside the coding-harness comparison, but decisive for Qube's product). It is at or near parity on approval UX (row 10) and tool breadth (row 6). It is behind on context accounting (row 1), compaction structure (row 2), durable state (rows 3–5), verification (row 12), observability (row 13), and prompt modularity (row 14). OpenCode leads on context and durability; Codex on safety, tool exposure, and accounting; Claude on instruction preservation and verification.

---

## 9.7 Ten transferable architectural patterns

Each pattern is specified with the harness that demonstrates it, the problem, the mechanism, Qube's existing equivalent, the gap, an integration path, complexity, expected reliability/performance impact, and trade-offs. Complexity is Low, Medium, or High for Qube's actual stack (TypeScript/Next.js/Tauri), not for the source harness.

### P1. Write-ahead durable execution ledger with orphan resume

- **Harness:** OpenCode (`packages/core/src/session/execution.ts`, `execution/restart.ts`); Codex corroborates with rollout replay.
- **Problem:** Qube's run state is an in-memory `Map`. A crash, OS kill, app update, or restart loses the turn. Tool side effects may have happened, but the model has no record and the user gets no completion. Retrying can duplicate side effects.
- **Mechanism:** At turn start, write an execution claim in the same transaction as the user message. Record run state transitions (queued, running, waiting-approval, completed, failed) and tool-call intents/results. On startup, sweep claims whose owner is dead, inject a "server restarted while you were working; continue without repeating completed work" notice, and resume from the last durable step. Bound resume attempts to avoid crash loops. Release the claim on deliberate stop; preserve it on shutdown. This is at-least-once execution; exactly-once requires idempotency keys per tool call. `[S]`
- **Existing Qube equivalent:** `activeRuns` Map (`lib/pi/harness.ts:160`), thread JSON snapshots, goals JSON, compaction anchor, a no-op checkpoint module (`lib/agent/checkpoint.ts`), and a gated SQLite durable harness (`lib/pi/durable.ts`, `PI_DURABLE_ENABLED`).
- **Gap:** No write-ahead claim, no run/step/tool-call tables in the production path, no startup sweep, no restart notice, no idempotency, no bounded resume. The durable harness exists but is not authoritative.
- **Integration path:** Finish `lib/pi/durable.ts`; add `runs`, `run_steps`, `tool_calls`, and `claims` tables; make the chat route write the claim before streaming; record each tool call before execution and its result after; on startup, run an orphan sweep with a max-attempt counter; inject a restart notice on resume; add per-tool idempotency keys for writes and shell commands where feasible; run the durable path in shadow mode first; remove `activeRuns` as the source of truth.
- **Complexity:** **High** (schema, transaction boundaries, resumability, idempotency, migration).
- **Expected impact:** Eliminates the "lost run" class of failures; enables safe background work, approvals that outlive a request, and app restarts. Performance cost is a few database writes per step; the reliability gain is large.
- **Trade-offs:** At-least-once semantics can duplicate side effects without idempotency; recovery notices can confuse the model; schema migrations and dual-write periods add risk; testing crash points is laborious.
- **Priority:** **1.**

### P2. Measured-token budgeting with reserve and shrink ladder

- **Harness:** OpenCode (`packages/core/src/session/compaction.ts`); Codex corroborates with `Total` vs `BodyAfterPrefix` accounting.
- **Problem:** Qube's `chars/4` estimate and fixed 128k window ignore the actual model, provider usage, tool schemas, images, and provider framing. It can compact too early (losing useful context) or too late (overflowing), and it cannot respond to provider rejections with a smaller request.
- **Mechanism:** Use provider-reported usage when available; fall back to a calibrated estimate. Compute a ceiling from the model's real window, reserve `max(16k, 15%)`, and keep a tail budget. On rejection or near-limit, retry with progressively smaller history using a shrink ladder (`0.85, 0.7, 0.5, 0.35`). Give the summarizer a large output floor (OpenCode uses 32k). When the window is unknown, use a conservative fallback (OpenCode uses 200k). Precompute a summary when within a lead distance (OpenCode uses 60k) if the cost is acceptable. `[S]`
- **Existing Qube equivalent:** `lib/pi/compaction.ts` with 128k/20k/15k defaults, `chars/4`, preflight compaction, one aggressive overflow retry, and a 4k summary cap.
- **Gap:** No measured usage, no model window table, no reserve formula, no shrink ladder, no precompute, no provider-native compaction, no tool-schema count.
- **Integration path:** Capture `usage` and provider metadata from the AI SDK result; add a model context table (or provider API lookup); replace the fixed threshold with `window - max(reserve, 15%)`; add shrink steps around the compaction retry; count serialized tool schemas and images in the estimate; raise the summary cap; make precompute opt-in behind a flag; add tests for unknown/1M/128k windows.
- **Complexity:** **Medium**.
- **Expected impact:** Fewer overflow failures and fewer unnecessary compactions; lower summarization cost; better long-session continuity. Performance improves because the harness stops guessing.
- **Trade-offs:** Provider usage may be missing or delayed; model tables need maintenance; precompute adds background cost; aggressive shrink can discard detail; provider-native compaction may be vendor-specific.
- **Priority:** **2.**

### P3. Post-compaction re-injection manifest

- **Harness:** Claude Code (documented); OpenCode and Codex corroborate with separately sourced instructions and retention invariants.
- **Problem:** Qube's post-compaction recovery is passive. If the summary omits a constraint, the active plan, a path-scoped rule, or a recently modified file, the model resumes stale. Rebuilding the static system prompt is not enough because project and task state live outside it.
- **Mechanism:** After compaction, build a manifest of known-important context and inject it before the next model call: system prompt/output style, project-root instructions, unscoped rules, auto memory, skill descriptions, the active plan, fresh git status, up to five recently modified files, invoked skill bodies (with per-skill and total caps), and matching post-compact hooks. Keep instructions out of the summary so they are not duplicated or distorted. `[D]`
- **Existing Qube equivalent:** The system prompt is rebuilt each turn and includes skills, connectors, memory, past chats, scratchpad, kernel resume, and custom instructions; the summary block is injected as untrusted context. There is no manifest, no freshness check, and no plan/git/recent-file re-injection.
- **Gap:** No list of required post-compaction items, no re-read of project instructions, no git status, no touched-file list, no verification that the summary contains the objective/constraints, no hook.
- **Integration path:** Add `buildPostCompactManifest()` (new `lib/pi/context-manifest.ts`); collect active goals and `TodoWrite`, the latest user objective, project instruction files (once P7 lands), skills, memory brief, git status, and files touched in the last N tool calls; cap each section and the total; inject as a separate system block with an "untrusted data" marker where appropriate; validate required sections after summarization; add a compaction test that asserts the manifest survives.
- **Complexity:** **Medium**.
- **Expected impact:** Fewer "where was I" turns and fewer repeated mistakes; better continuity on long tasks. The performance cost is a few file reads and a git command per compaction, which is negligible compared with a re-summarization.
- **Trade-offs:** Token cost; stale or noisy git status; privacy of file paths; manifest bloat if not capped; project files are untrusted and must not override safety.
- **Priority:** **3.**

### P4. Deterministic policy engine plus OS-level sandbox

- **Harness:** Codex (sandbox modes, protected paths, network policy, approvals, Guardian); Claude Code (deny > ask > allow, hooks, optional Bash sandbox).
- **Problem:** Qube executes shell commands with the user's privileges and relies on a sensitive-action classifier plus a 20-second LLM reviewer. A prompt injection, a misleading action description, or a reviewer mistake can delete files, exfiltrate data, or change system state. The reviewer is also a latency and cost center.
- **Mechanism:** Put a deterministic policy engine in front of tools (allow/deny/ask by tool, path, command pattern, network destination). Put an OS sandbox behind it: read-only, workspace-write, or danger-full-access; protected paths; network off by default with an allowlist proxy; platform backends (Seatbelt, Landlock/bubblewrap/seccomp, Windows sandbox). Approval is the exception path for actions the sandbox would otherwise block. Keep the LLM reviewer as a second, intent-aware layer, not the only boundary. `[S/D]`
- **Existing Qube equivalent:** Hard category switches, workspace/allowed-directory checks, sensitive-action classifier, independent LLM reviewer (`lib/permissions/reviewer.ts:47`), blocking card (`lib/middleware/permission-middleware.ts:317`), headless denial/draft, audit. No OS sandbox.
- **Gap:** No kernel boundary, no network policy, no protected paths, no read-only/workspace-write modes, no per-command policy language, no sandbox escalation protocol.
- **Integration path:** Add `lib/sandbox/` with a common interface and platform backends; default to workspace-write with network denied; add protected paths (`.git`, `.env`, SSH keys, browser profile, app data); add a deterministic command/path policy in front of the reviewer; keep the reviewer for ambiguous intent; map denials to an approval card with a clear explanation; audit both layers; add a "danger-full-access" opt-in for advanced users. On platforms where a sandbox is unavailable, fail closed for high-risk categories or require explicit approval.
- **Complexity:** **High** (cross-platform sandboxing is the hard part).
- **Expected impact:** Contains prompt injection and destructive commands; enables unattended and background work with a credible safety story; reduces reviewer load and latency for obviously safe actions.
- **Trade-offs:** Platform complexity and packaging (Tauri sidecars, entitlements); developer friction; false denials; sandbox escapes are still possible; performance overhead for filesystem-heavy work.
- **Priority:** **4.**

### P5. Independent verification pass

- **Harness:** Claude Code (`/goal`, `/verify`, `/code-review`, Stop hooks); Codex/OpenCode rely more on external tests.
- **Problem:** Qube decides completion from the model's `TodoWrite` snapshot. A model can mark tasks complete without evidence, and silent continuation stops as soon as the todo list looks clean. There is no fresh-context check, no required artifact, and no test gate.
- **Mechanism:** After a turn that claims completion, run a separate checker with fresh context and read-only tools. Give it the user objective, the claimed result, the diff/artifacts, and the relevant commands. Require evidence: a passing test command, a file path with the expected content, a screenshot, or a diff. If verification fails, return a structured failure to the main loop and continue. Cap verifier cost and turns. Claude's `/goal` runs a checker after each turn; Stop hooks can block up to eight consecutive stops; `/code-review` uses a fresh subagent. `[D]`
- **Existing Qube equivalent:** `TodoWrite` incomplete detection and silent continuation (`lib/pi/harness.ts:926-948`); prompt-level "verify actions" rules; no independent checker.
- **Gap:** No verifier agent, no evidence schema, no gate on completion, no separation between the producer and the checker.
- **Integration path:** Add a `verify_completion` subagent profile with read-only tools and a strict output schema (`pass`, `fail`, `evidence`, `missing`); trigger it when the main loop claims completion or when `TodoWrite` transitions to all-complete; require at least one executable or file-level evidence item for code/file tasks; store the verdict in the run record; feed failures back as a continuation; expose the verdict in the UI; cap cost.
- **Complexity:** **Medium–High** (prompt/schema design, cost control, avoiding verifier collusion).
- **Expected impact:** Fewer false completions; higher user trust; catches regressions that the producer model is blind to. Adds latency and token cost only on completion, not every step.
- **Trade-offs:** Verifier can be wrong or over-strict; extra cost; requires clear task-specific evidence criteria; may slow simple tasks (use a fast path for trivial answers).
- **Priority:** **5.**

### P6. Bounded tool output with spill artifacts

- **Harness:** OpenCode (`packages/core/src/tool-output.ts`); Codex (truncation and retained tool outputs).
- **Problem:** Qube's `read_file` is unbounded, while command and web outputs are hard-clipped to character counts. A large file can consume the context window; a large command output is silently truncated and the rest is unrecoverable. Neither behavior is safe for long tasks.
- **Mechanism:** Normalize every tool result into a bounded preview plus an artifact reference. Cap by lines and bytes (OpenCode uses 2,000 lines / 50 KiB), write the full output to a content-addressed spill file, return the preview and the path, and add a retrieval tool. Apply retention (OpenCode uses 7 days). On compaction, retain artifact pointers rather than full outputs. `[S]`
- **Existing Qube equivalent:** Per-tool clips: command 20k chars, web 25k/50k, subagent 50 KB/2,000 lines; `read_file` unbounded; no spill file or artifact tool.
- **Gap:** No unified output wrapper, no artifact store, no retrieval pointer, no per-step output budget, no retention, no compaction integration.
- **Integration path:** Add a `ToolOutput` wrapper with `{ preview, artifactPath, bytes, lines, truncated, kind }`; write full outputs under `.memory/tool-output/<thread>/<run>/<call>`; return preview + path from every tool; add `read_tool_output(path, offset, limit)`; cap `read_file` to a preview and require the retrieval tool for the rest; apply a per-step aggregate budget; add cleanup and size limits.
- **Complexity:** **Low–Medium**.
- **Expected impact:** Prevents context blowups and silent data loss; improves debuggability because the full output is retained. Performance impact is small (one file write per large output).
- **Trade-offs:** Disk usage; sensitive data retention; extra tool call to read the full output; artifact cleanup; path handling.
- **Priority:** **6.**

### P7. Project instruction hierarchy with size budgets and path scoping

- **Harness:** Codex (`AGENTS.md`, 32 KiB default, skills 2%); Claude Code (`CLAUDE.md` managed/user/project/local, `.claude/rules` with `paths`); OpenCode (`AGENTS.md`).
- **Problem:** Qube has a 48 KB global prompt and no project-specific instruction discovery. It cannot learn a repository's conventions, commands, or boundaries from a file the user edits. Everything must be baked into the global prompt or memory, which does not scale across projects.
- **Mechanism:** Load instructions in a defined hierarchy: managed policy, user, project, local. Support path-scoped rules via globs. Enforce a byte budget and warn when exceeded. Treat project instructions as untrusted data that cannot override safety policy. Re-read them after compaction rather than summarizing them. `[S/D]`
- **Existing Qube equivalent:** The global `lib/pi/system-prompt.ts`; custom instructions; skills; memory. No `AGENTS.md`/`CLAUDE.md` loader and no path scoping.
- **Gap:** No project discovery, no precedence model, no path scoping, no size budget, no re-read after compaction, no user-editable per-project behavior.
- **Integration path:** Add `lib/instructions/loader.ts` supporting `AGENTS.md`, `CLAUDE.md`, and `.qube/rules/*.md` with globs; define precedence (`managed > project > user > local` or a documented order); enforce 32 KiB; inject as a separate system block, not into the main monolith; mark as untrusted; re-read on each turn or cache with mtime; add tests for nested directories and path scoping; migrate some global prompt sections into default project rules.
- **Complexity:** **Medium**.
- **Expected impact:** Better repository awareness, less prompt bloat, user-editable behavior, and a path to reduce the 48 KB monolith. Performance improves via smaller prompts and cacheable instruction blocks.
- **Trade-offs:** Precedence conflicts; untrusted project files can attempt prompt injection; discovery adds file I/O; users may not know which file wins; path globbing has edge cases.
- **Priority:** **7.**

### P8. Deferred tool exposure with search

- **Harness:** Codex (direct/deferred/code-mode/hidden, BM25 `tool_search`, namespaces).
- **Problem:** Qube exposes every tool on every turn and duplicates the catalog in the prompt. As MCP servers and connectors grow, the model must choose from a long list, descriptions consume context, and selection accuracy falls.
- **Mechanism:** Classify tools by frequency, risk, and namespace. Expose a small direct set (core filesystem, shell, web, todo, subagent). Defer long-tail tools behind a `tool_search` step that returns schemas on demand. Support code-mode for tools that are better called from code. Hide unavailable tools. Budget descriptions. `[S]`
- **Existing Qube equivalent:** Static registry and full exposure (`lib/pi/tools.ts`); inline catalog in the system prompt; MCP/Composio connectors.
- **Gap:** No exposure metadata, no search, no namespaces, no per-tool token budget, no activation step for connectors.
- **Integration path:** Add metadata to each tool (`exposure`, `namespace`, `risk`, `cost`, `whenToUse`); always expose a core set; add `tool_search(query)` with BM25 over names/descriptions; return the selected schema and require a second call; cap description bytes; group MCP/connector tools by namespace; log selection and misselection for evaluation.
- **Complexity:** **Medium**.
- **Expected impact:** Smaller prompts, better tool selection, lower latency/cost as the catalog grows. The trade-off is an extra search round for long-tail tools.
- **Trade-offs:** Discovery failures; extra model turn; model compatibility; ranking quality; more harness complexity.
- **Priority:** **8.**

### P9. Persistent multi-agent graph with mailboxes and resume

- **Harness:** Codex multi-agent V2 (`spawn_agent`, `send_input`, `wait_agent`, `resume_agent`, `close_agent`); Claude Code background/custom agents; OpenCode child sessions.
- **Problem:** Qube's subagents are one-shot helpers with 12 steps and a 180-second timeout. They cannot be asked a follow-up, cannot be resumed, cannot own a subproject, and cannot run after the parent turn ends. Complex work that needs parallelism or long-lived delegation fails.
- **Mechanism:** Persist each subagent as a child session with its own context and mailbox. The parent can spawn, send input, wait, resume, and close. Maintain a parent-child graph, concurrency slots, residency/eviction, shared filesystem, and budget reminders. Isolate writers with worktrees where possible. `[S/D]`
- **Existing Qube equivalent:** Four profiles, four concurrent runs, 12 steps, 180s, isolated context, no recursion/follow-up, no persistence.
- **Gap:** No child session persistence, messaging, resume, mailbox, budget, worktree isolation, or graph.
- **Integration path:** Persist subagent sessions in the durable store (P1); add `send_subagent_message`, `wait_subagent`, `resume_subagent`, and `close_subagent`; store parent/child links; add a mailbox and a per-agent budget; allow follow-up turns; use a worktree per writer; cap depth and concurrency; propagate permissions and audit; expose status in the UI.
- **Complexity:** **High**.
- **Expected impact:** Enables long, parallel, failure-tolerant work; improves throughput on independent subtasks; allows recovery instead of restarting a subagent.
- **Trade-offs:** Orchestration complexity; duplicate work; cost; debugging; permission propagation; worktree management.
- **Priority:** **9.**

### P10. Event-level tracing with spans and redaction

- **Harness:** Codex (OTel), Claude Code (OTel metrics/logs/traces); OpenCode has event infrastructure.
- **Problem:** Qube's JSONL logs are per-thread event records without causal structure. It cannot answer which model call, tool, subagent, or compaction consumed the tokens, how long each step took, or where a failure originated. Cost and latency regressions are invisible.
- **Mechanism:** Instrument the harness with OpenTelemetry spans: run, model call, tool call, subagent, compaction, approval. Add attributes for thread/run/tool/model, token usage, latency, status, and error class. Propagate context across subagents and background work. Redact prompts/tool contents by default; make full capture opt-in. Export via OTLP and keep JSONL as a local fallback. `[S/D]`
- **Existing Qube equivalent:** `.memory/observability/<thread>.jsonl` and `_global.jsonl`, with redaction (`lib/agent/observability.ts:58-59`).
- **Gap:** No trace IDs, parent-child spans, durations, token/cost attribution, sampling, dashboards, or OTel export.
- **Integration path:** Add an OTel SDK initialization for the Node runtime; create spans around `runPiHarness`, each model call, each tool execution, subagent runs, compaction, and approvals; attach usage and model metadata; redact by default; export to an OTLP endpoint when configured; keep JSONL for local debugging; add a trace ID to the UI and to error reports.
- **Complexity:** **Medium**.
- **Expected impact:** Faster diagnosis, cost control, latency regression detection, and evidence for reliability work. Overhead is small with sampling.
- **Trade-offs:** Collector infrastructure; privacy; schema stability; overhead if tracing everything; redaction must be correct.
- **Priority:** **10.**

### Pattern priority summary

| Priority | Pattern | Impact | Complexity | Sequence |
|---|---|---|---|---|
| 1 | P1 Durable execution ledger | Removes lost runs | High | Phase 2 |
| 2 | P2 Measured-token budgeting | Removes overflow/over-compaction | Medium | Phase 1 |
| 3 | P3 Post-compaction manifest | Restores task continuity | Medium | Phase 1 |
| 4 | P4 Policy + OS sandbox | Contains dangerous actions | High | Phase 3 |
| 5 | P5 Independent verification | Removes false completion | Medium–High | Phase 4 |
| 6 | P6 Bounded output + spill | Removes context blowups | Low–Medium | Phase 1 |
| 7 | P7 Instruction hierarchy | Project awareness, smaller prompt | Medium | Phase 5 |
| 8 | P8 Deferred tool exposure | Scales tool catalog | Medium | Phase 5 |
| 9 | P9 Persistent multi-agent graph | Long parallel work | High | Phase 6 |
| 10 | P10 OTel tracing | Diagnosis and cost control | Medium | Phase 0 |

---

## 9.8 Final competitive verdict

### 9.8.1 Is Qube architecturally competitive?

**As a general agent harness: no.** Qube is approximately one architectural generation behind OpenCode, Codex, and Claude Code in the mechanisms that make agent systems reliable: durable execution, measured context budgeting, deterministic isolation, independent verification, and structured observability. It compensates with product integration, not harness engineering.

**As a consumer desktop assistant: yes.** Qube's combination of local files, managed browser, OS-level computer control, persistent personal memory, connectors, generative UI, scheduling, and proactive suggestions is genuinely differentiated. None of the three coding harnesses can do Qube's everyday-consumer jobs. The correct conclusion is not "Qube is obsolete"; it is "Qube's differentiation is real, but its core is under-engineered relative to its ambition."

The gap is most visible when a task runs long enough to hit a failure: a crash, a context overflow, a shell command with a side effect, a compaction that drops a constraint, or a model that claims success without evidence. Qube has heuristics for these; the competitors have **mechanisms**.

### 9.8.2 Where Qube is substantially behind

1. **Execution durability.** In-memory runs, a no-op checkpoint module, and a gated durable harness. No write-ahead claim, no orphan resume, no idempotency. This is the largest gap.
2. **Token accounting.** Fixed 128k, `chars/4`, no provider usage, no tool-schema count, no shrink ladder. Qube is guessing where OpenCode and Codex measure.
3. **Isolation.** Shell commands run with user privileges. The LLM reviewer is a probabilistic control, not a boundary. Codex has OS sandboxes; Qube has none.
4. **Post-compaction reconstruction.** Passive summary versus Claude's explicit manifest. Qube can lose the plan, project rules, and recent file state.
5. **Verification.** `TodoWrite` self-report versus a separate checker. Qube can declare success without evidence.
6. **Observability.** JSONL events versus OTel traces/metrics/logs. Qube cannot attribute cost or latency to a step.
7. **Prompt architecture.** A 48 KB monolith with no project instruction hierarchy and a cache-hostile time line. The competitors are modular and budgeted.
8. **Tool containment.** Unbounded `read_file`, lossy clips, no spill artifacts, no deferred exposure.
9. **Subagent lifecycle.** One-shot helpers versus persistent child sessions with follow-up and resume.
10. **Dual harness ambiguity.** The Pi path and the gated durable path both exist; the checkpoint stub and the durable module tell different stories. This is an architectural debt that will slow every reliability fix.

### 9.8.3 Where Qube has architectural advantages

1. **Consumer integration.** Browser, OS-level app control, files, connectors, MCP, and generative UI in one assistant. The coding harnesses are terminal-first.
2. **Personal memory.** Tiered observations/durables, deterministic BM25-lite retrieval, automatic recall, past-chat index, and scratchpad. This is better suited to a personal assistant than file-only project memory.
3. **Proactivity.** Scheduler, heartbeat, announcements, goals, and silent continuation create a persistent assistant rather than a request-response tool.
4. **Approval UX.** Plain-language cards, intent-aware review, headless denial/draft, and allowed-directory management are more accessible than permission modes and sandbox flags.
5. **Local-first architecture.** Tauri plus local stores gives Qube a privacy and ownership story that hosted coding harnesses do not have.
6. **Simplicity and iteration speed.** A TypeScript/Next.js codebase with a small harness is easier to change than an Effect-TS monorepo or a Rust workspace. This is an advantage **if** Qube uses it to adopt proven mechanisms rather than reinvent them.

### 9.8.4 Best reference architecture by subsystem

| Subsystem | Best reference | What to take | What not to take |
|---|---|---|---|
| Context budgeting | OpenCode | Measured usage, reserve formula, shrink ladder, precompute | Effect-TS service complexity |
| Compaction structure | OpenCode | `keepID`, seven sections, 32k floor, instruction exclusion | Provider-specific assumptions |
| Compaction retention | Codex | User-message/pending-mail retention, initial-context insertion | Rust/remote-V2 coupling |
| Post-compaction recovery | Claude Code | Explicit manifest, rules/memory/skills/plan/git/files, hooks | Undocumented internals |
| Durable execution | OpenCode | Write-ahead claim, orphan sweep, bounded resume | Full server architecture |
| Sandbox and approvals | Codex | Sandbox modes, protected paths, network policy, approval escalation | Windows/Linux/macOS packaging complexity |
| Prompt hierarchy | Codex + Claude Code | `AGENTS.md` 32 KiB, skills 2%, `CLAUDE.md` hierarchy, path rules | Closed prompt text assumptions |
| Tool exposure | Codex | Direct/deferred/code-mode/hidden, BM25 search, namespaces | Immediate full multi-agent scope |
| Subagents | Codex | Persistent graph, mailboxes, resume, budgets | Full V2 complexity on day one |
| Verification | Claude Code | Separate checker, `/verify`, Stop hooks, fresh-context review | Opaque checker behavior |
| Observability | Codex / Claude Code | OTel spans, metrics, redaction | Vendor lock-in |
| Memory | Qube + Claude Code | Qube's consumer memory; Claude's project hierarchy | Replacing Qube's memory with file-only memory |
| Browser/OS | Qube | Keep and harden it | Coding-harness terminal bias |

### 9.8.5 The five most important patterns to adopt

1. **P1 — Write-ahead durable execution ledger with orphan resume.** Without this, every other reliability improvement is fragile.
2. **P2 — Measured-token budgeting with reserve and shrink ladder.** This is the difference between guessing and controlling context.
3. **P3 — Post-compaction re-injection manifest.** This preserves the task, not just the transcript.
4. **P4 — Deterministic policy plus OS-level sandbox.** This is the safety boundary Qube currently lacks.
5. **P5 — Independent verification pass.** This is how Qube stops trusting self-reported completion.

P6 (bounded output with spill artifacts) is a close sixth and should ship with P2/P3 because it directly prevents the context failures those patterns manage.

### 9.8.6 Improve or redesign?

**Improve the Pi loop; redesign three subsystems around proven patterns.** Do not rewrite Qube as OpenCode or Codex. The application's value is in its consumer integration, memory, and proactivity, not in its harness internals. A full rewrite would discard that advantage and impose a large migration cost.

The three subsystems that need redesign, not incremental patching:

1. **Context manager.** Replace the fixed estimator and six-section/4k summary with measured budgeting, a precise checkpoint, a larger structured summary, spill artifacts, and a post-compaction manifest. Keep the anchor idea; it is good.
2. **Execution and persistence layer.** Make the durable harness authoritative. Add claims, run/step/tool-call records, orphan resume, restart notices, idempotency, and checkpointing. Retire the no-op checkpoint module.
3. **Authority and verification layer.** Move from "LLM reviewer as the boundary" to "deterministic policy + OS sandbox + reviewer as a second layer", and add an independent verifier for completion.

The prompt should be **modularized**, not simply shortened. Keep the consumer-specific behavioral content; move stable sections into modules, add project instruction discovery, remove the inline tool catalog duplication, and move the time line out of the cacheable prefix.

### 9.8.7 Recommended sequence

| Phase | Work | Patterns | Complexity | Exit criterion |
|---|---|---|---|---|
| 0 | Instrument usage, latency, and traces; establish baseline failure taxonomy | P10 | Medium | Every run has trace IDs, token usage, and step timings |
| 1 | Replace token estimation; add spill artifacts; build post-compaction manifest | P2, P3, P6 | Medium | No context overflow in a long-session test; manifest survives compaction |
| 2 | Make the durable harness authoritative; add claims and orphan resume | P1 | High | A killed process resumes or cleanly reports, with no lost run |
| 3 | Add deterministic policy and OS sandbox; keep reviewer as second layer | P4 | High | High-risk shell actions are blocked or require explicit approval without the reviewer |
| 4 | Add independent verification; gate silent continuation on evidence | P5 | Medium–High | A false completion test is caught by the verifier |
| 5 | Add project instruction hierarchy; modularize the prompt; add deferred tool search | P7, P8 | Medium | Prompt size drops materially; project rules load; long-tail tools are searchable |
| 6 | Add persistent multi-agent graph | P9 | High | A child agent can be followed up, resumed, and closed |

The order is deliberate: instrumentation first, then context, then durability, then safety, then verification, then scale. Trying to build the multi-agent graph before durable execution would multiply the failure modes.

### 9.8.8 What success would look like

Success is not "Qube has the same features as Codex". It is:

- A run survives an app restart or is cleanly reported as failed, with no silent loss.
- Context compaction is driven by measured usage and a real model window, not a fixed guess.
- After compaction, the objective, constraints, plan, project rules, and recently touched files are present and verified.
- A dangerous shell command is stopped by a kernel boundary, not only by a model's judgment.
- A claimed completion is backed by evidence, and a failed verification continues the task.
- A slow or expensive step is identifiable from a trace without reading raw JSONL.
- The prompt is smaller, modular, project-aware, and cache-friendly, while retaining Qube's consumer behavior.

### 9.8.9 Confidence and counterarguments

**High confidence:** Qube lacks durable execution, OS sandboxing, measured token accounting, and independent verification; the source is explicit. OpenCode and Codex have the mechanisms cited; the source is public and pinned. Claude Code documents post-compaction re-injection, hooks, checkpoints, permissions, and OTel.

**Medium confidence:** The relative importance of each gap for Qube's actual users. A consumer assistant may tolerate a lost run better than a coding harness, but it should not. The cost/benefit of precompute and multi-agent persistence depends on task mix.

**Low confidence / unknown:** Claude Code's internal prompt text, exact token accounting, retry policy, and crash semantics. OpenCode's full OTel support. Codex's file-level checkpoint/rewind parity. These are marked `[U]` rather than assumed.

**Counterargument:** Qube's product is not a coding harness, so the comparison is unfair. The response is that durability, context control, isolation, and verification are **domain-independent** reliability properties. A consumer assistant that books travel, edits files, and controls apps needs them more than a coding harness, not less. The comparison is fair on mechanisms and unfair only on product surface, which is exactly why Qube's browser/OS/memory advantages are credited separately.

---

## Appendix A. Evidence index

### A.1 Qube files inspected

| Area | Files |
|---|---|
| Loop and lifecycle | `lib/pi/harness.ts`, `lib/pi/continuation.ts`, `lib/pi/prompt-context.ts` |
| Compaction | `lib/pi/compaction.ts`, `tests/compaction.test.ts` |
| Prompt | `lib/pi/system-prompt.ts`, `lib/skills/prompt.ts` |
| Tools | `lib/pi/tools.ts`, `lib/pi/subagents.ts`, `lib/pi/task-runner.ts` |
| Permissions | `lib/middleware/permission-middleware.ts`, `lib/permissions/reviewer.ts`, `lib/permissions/sensitive.ts`, `lib/permissions/allowed-dirs.ts`, `lib/permissions/workspace.ts` |
| Persistence | `lib/pi/durable.ts`, `lib/memory/session-store.ts`, `lib/goals/store.ts`, `lib/agent/checkpoint.ts` |
| Memory | `lib/memory/memory-store.ts`, `lib/memory/retrieval.ts`, `lib/memory/brief.ts`, `lib/memory/session-store.ts`, `lib/memory/tools-core.ts` |
| Observability | `lib/agent/observability.ts` |
| API | `app/api/chat/route.ts`, `app/api/threads/route.ts` |

### A.2 OpenCode files inspected

| Area | Files |
|---|---|
| Compaction | `packages/core/src/session/compaction.ts` |
| Execution | `packages/core/src/session/execution.ts`, `execution/restart.ts`, `run-coordinator.ts`, `inbox.ts` |
| Tools | `packages/core/src/tool.ts`, `tool-output.ts`, `tool/plugin/read.ts`, `tool/plugin/todowrite.txt` |
| Permissions | `packages/core/src/permission.ts`, `permission/saved.ts`, `util/wildcard.ts`, `managed-policy.ts` |
| Subagents/background | `packages/core/src/session/subagent-job.ts`, `background.ts` |
| Snapshots | `packages/core/src/snapshot.ts`, `session/revert.ts` |
| Prompts | `packages/core/src/session/runner/prompt/system.txt`, `plugin/system-prompt/*.txt` |

### A.3 Codex files inspected

| Area | Files |
|---|---|
| Compaction | `codex-rs/core/src/compact.rs`, `session/context_window.rs`, compact remote modules |
| Instructions | `codex-rs/core/src/agents_md.rs`, `agents_md_manager.rs`, `codex-rs/config/defaults.toml`, `config/src/config_toml.rs` |
| Skills | `codex-rs/core/src/skills.rs`, `codex-rs/ext/skills/*` |
| Tools | `codex-rs/core/src/tools/tool_namespaces_info.rs`, `tools/router.rs`, `tools/parallel.rs`, multi-agent specs |
| Sandbox | `codex-rs/core/src/sandboxing/mod.rs`, Linux/Windows sandbox modules |
| Agent control | `codex-rs/core/src/agent/control_tests.rs`, `agent/history.rs` |
| Observability | `codex-rs/otel` |

### A.4 Claude Code documentation

`best-practices.md`, `checkpointing.md`, `context-window.md`, `hooks.md`, `how-claude-code-works.md`, `memory.md`, `model-config.md`, `monitoring-usage.md`, `permissions.md`, `prompt-caching.md`, `sandboxing.md`, `security.md`, `sub-agents.md`.

### A.5 Reproduction commands

```bash
# Qube revision and prompt size
git -C /home/luca/Projects/coding\ projects/Qube log -1 --format='%h %s'
wc -c lib/pi/system-prompt.ts

# Qube compaction tests
QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/compaction.test.ts

# Research pins
git -C /tmp/opencode/research/opencode log -1 --format='%h %s'
git -C /tmp/opencode/research/codex log -1 --format='%h %s'
```

Observed results at the time of writing:

- Qube: `f5dedc9`, prompt 48,323 bytes.
- Compaction tests: 25/25 pass.
- OpenCode: `caf8d6a`.
- Codex: `748ab55`.
- Claude Code docs: 12 key pages retrieved with HTTP 200.

---

## Appendix B. Coverage checklist

| Requirement | Where covered | Status |
|---|---|---|
| 9.1 Methodology and evidence standard | 9.1.1–9.1.5 | Complete |
| 9.2 Token budgeting | 9.2.1 | Complete |
| 9.2 Automatic compaction | 9.2.2 | Complete |
| 9.2 Summarization | 9.2.3 | Complete |
| 9.2 Instruction preservation | 9.2.4 | Complete |
| 9.2 Tool-result and large-output handling | 9.2.5 | Complete |
| 9.2 Historical retrieval | 9.2.6 | Complete |
| 9.2 Long-session continuity | 9.2.7 | Complete |
| 9.2 Post-compaction recovery | 9.2.8 | Complete |
| 9.3 Execution loops | 9.3.1 | Complete |
| 9.3 Persistent task state | 9.3.2 | Complete |
| 9.3 Background work | 9.3.3 | Complete |
| 9.3 Session continuity | 9.3.4 | Complete |
| 9.3 Checkpointing | 9.3.5 | Complete |
| 9.3 Interruption recovery | 9.3.6 | Complete |
| 9.3 Retries | 9.3.7 | Complete |
| 9.3 Isolation | 9.3.8 | Complete |
| 9.3 Decomposition | 9.3.9 | Complete |
| 9.3 Orchestration | 9.3.10 | Complete |
| 9.3 Approvals | 9.3.11 | Complete |
| 9.3 Completion verification | 9.3.12 | Complete |
| 9.4 Instruction hierarchy | 9.4.1 | Complete |
| 9.4 Tool awareness | 9.4.2 | Complete |
| 9.4 Planning | 9.4.3 | Complete |
| 9.4 Discipline | 9.4.4 | Complete |
| 9.4 Error recovery | 9.4.5 | Complete |
| 9.4 Permissions | 9.4.6 | Complete |
| 9.4 Verification | 9.4.7 | Complete |
| 9.4 Modularity | 9.4.8 | Complete |
| 9.4 Dynamic injection | 9.4.9 | Complete |
| 9.4 Instructions vs guarantees | 9.4.10 | Complete |
| 9.5 Registration/discovery | 9.5.1 | Complete |
| 9.5 Schemas/descriptions | 9.5.2 | Complete |
| 9.5 Selection | 9.5.3 | Complete |
| 9.5 Parallelism | 9.5.4 | Complete |
| 9.5 Subagents | 9.5.5 | Complete |
| 9.5 Filesystem | 9.5.6 | Complete |
| 9.5 Terminal/code execution | 9.5.7 | Complete |
| 9.5 Browser/integrations | 9.5.8 | Complete |
| 9.5 Permission boundaries | 9.5.9 | Complete |
| 9.5 Output validation | 9.5.10 | Complete |
| 9.5 Error propagation | 9.5.11 | Complete |
| 9.5 Tracing | 9.5.12 | Complete |
| 9.6 14-row matrix | 9.6 | Complete: 14 rows |
| 9.7 Ten patterns with all fields | 9.7 P1–P10 | Complete |
| 9.8 Competitiveness | 9.8.1 | Complete |
| 9.8 Substantial gaps | 9.8.2 | Complete |
| 9.8 Advantages | 9.8.3 | Complete |
| 9.8 Best reference per subsystem | 9.8.4 | Complete |
| 9.8 Top five patterns | 9.8.5 | Complete |
| 9.8 Improve vs redesign | 9.8.6–9.8.7 | Complete |

---

## Appendix C. Limitations and open questions

1. **No controlled benchmark.** This report compares mechanisms, not measured task success. Claims about reliability are architectural, not statistical.
2. **Pinned commits.** OpenCode and Codex are inspected at `caf8d6a` and `748ab55`. Later commits may change the mechanisms.
3. **Claude Code internals are closed.** Documented behavior is used, and unknown internals are marked `[U]`. No leaked prompt text or unofficial reverse engineering is used.
4. **Static inspection.** Qube's compaction tests were run, but no crash-injection, load, or prompt-injection test suite was executed. The durability and sandbox gaps are established from source, not from exploit demonstrations.
5. **Product context.** Qube is a consumer assistant, not a coding harness. The report credits its browser/OS/memory advantages, but those do not compensate for missing durability, isolation, and verification.
6. **Cost estimates.** The sequencing table gives relative complexity, not engineering weeks. A real estimate requires staffing and platform constraints.
7. **Open questions:** How often do Qube users lose runs to restarts in practice? What is the actual provider usage distribution? Which model windows are used most? What is the false-completion rate of the current `TodoWrite` heuristic? These should be measured in Phase 0 before committing to the full roadmap.

---

*End of report.*


