# Qube Harness Reliability Implementation

Status: implemented and validated against the current worktree (November 2026).

This document is the implementation counterpart to
[`agent-harness-architecture-comparison.md`](./agent-harness-architecture-comparison.md).
It records what was actually changed, the guarantees that now exist, how the
guarantees are enforced in code, what was tested, and what remains open. It is
not a second architecture review.

Scope note: the work targets the foreground Pi harness (`lib/pi/harness.ts`) and
the shared context/tool/permission layers. Qube's separate durable engine
(`@earendil-works/pi-durable`, gated by `PI_DURABLE_ENABLED`) is unchanged; the
relationship between the two paths is listed as a remaining limitation.

---

## A. Implementation summary

### New modules

| File | Purpose |
|---|---|
| `lib/pi/context-budget.ts` | Model-window table, reserve math, tool-schema accounting, token estimation, provider-usage calibration, shrink ladder. |
| `lib/pi/tool-output.ts` | Bounded tool results, per-thread spill files, safe paged reads, retention/pruning. |
| `lib/pi/context-manifest.ts` | Bounded, machine-generated post-compaction state (todos, files, evidence, last error). |
| `lib/pi/project-instructions.ts` | `AGENTS.md` / `QUBE.md` / `CLAUDE.md` / `.qube` rules loader with byte budgets and mtime cache. |
| `lib/pi/execution-limits.ts` | Testable hard ceilings for steps, verification rounds, concurrency, and outer rounds. |
| `lib/agent/execution-ledger.ts` | Durable per-thread run record: lifecycle, heartbeat, todos, evidence, files, write-ahead journal, orphan sweep, resume notice, replay. |
| `lib/agent/completion-verifier.ts` | Independent completion gate over todos, tool outcomes, errors, and claimed files on disk. |
| `lib/agent/checkpoint.ts` | Real append-only checkpoint store plus resume planning and `compactAndCheckpoint`. |

### Modified modules

| File | Change |
|---|---|
| `lib/pi/harness.ts` | Wires ledger, resume notice, idempotent replay, bounded outputs, tool events, context calibration, compaction spans, completion gate, honest run status, bounded rounds/steps. |
| `lib/pi/compaction.ts` | Seven-section summary, structural validation with one retry, objective retention, summary cap, tool-schema accounting, provider calibration, injectable summarizer, expanded stats, deterministic hard-cut fallback. |
| `lib/pi/system-prompt.ts` | Time line moved to the cache-friendly tail; new execution-state/context/completion guidance; paginated `read_file` and `read_tool_output` documented. |
| `lib/pi/tools.ts` | Fixed `dev_server`/`dev_server_log` registration; paginated/bounded `read_file`; new `read_tool_output`; bounded `list_directory`; capped `/ spilled `run_command` output. |
| `lib/middleware/workspace.ts` | Segment-aware destructive-command classifier and protected-path classification. |
| `lib/permissions/sensitive.ts` | Protected writes become a `protected_path` sensitive kind. |
| `lib/permissions/policy.ts` | `protected_path` is destructive for hard policy purposes. |
| `lib/pi/durable-guard.ts` | Uses the shared local-tool classifier as the single sensitivity source. |
| `lib/agent/observability.ts` | Trace/span helpers, context-budget events, model-usage events, verification events. |
| `lib/pi/continuation.ts` | Silent continuation budget now has a hard ceiling (100). |

### Test files added or extended

`tests/context-budget.test.ts`, `tests/tool-output.test.ts`,
`tests/execution-ledger.test.ts`, `tests/completion-verifier.test.ts`,
`tests/project-instructions.test.ts`, `tests/checkpoint-manifest.test.ts`,
`tests/dangerous-actions.test.ts`, `tests/execution-limits.test.ts`,
`tests/harness-tools.test.ts`, `tests/subagent-isolation.test.ts`,
`tests/compaction.test.ts`.

---

## B. Architectural improvements and rationale

The report's five highest-priority patterns were the implementation guide. The
changes were added beside working components rather than replacing them.

1. **P1 — write-ahead execution ledger with orphan resume.**
   In-memory `activeRuns` could not survive a restart. The ledger now records a
   run before model work starts, heartbeats every 15 s, journals mutating calls
   before execution, and reconciles stale runs on the next start. File mutations
   are replayed only when the same call completed successfully within the TTL;
   pending calls are reported as unknown, never retried blindly.

2. **P2 — measured-token budgeting with a reserve and shrink ladder.**
   The threshold now counts system prompt, tool schemas, summary, and messages
   against a model-specific window. Provider prompt-token counts calibrate the
   estimator per thread. The reserve is `max(16k, 15% of window)`, capped at 40%
   so small local windows still retain prompt space.

3. **P3 — post-compaction manifest.**
   A generated summary is framed as untrusted history. After compaction, a
   separate manifest is built from the ledger and the real filesystem, and it
   explicitly overrides the summary where they disagree.

4. **P4 — deterministic policy before the reviewer (partial).**
   Dangerous commands are classified segment by segment (chains, env wrappers,
   absolute binary paths, recursive+force deletes, pipe-to-shell, fork bombs).
   Writes to Git internals, SSH/GPG/AWS/Kubernetes/Docker/GH credentials, and
   system directories are destructive-by-policy. This is deterministic; the LLM
   reviewer remains a second layer. OS-level sandboxing was **not** added.

5. **P5 — independent verification.**
   Before the harness stops, it checks todos, the last tool error, successful
   tool counts, and claimed output files on disk. A failed check produces a
   bounded silent correction round. If the budget is exhausted, the answer
   carries an explicit partial-result note and the ledger records the run as
   interrupted, so the next run resumes instead of claiming completion.

6. **P6 — bounded output with spill artifacts.**
   Large string tool results are written to per-thread spill files and replaced
   with a head plus an id; `read_tool_output` pages the full result. This keeps
   the original data inspectable without requiring a new dependency.

7. **P7/P10 — project instructions and structured telemetry.**
   Repository guidance is loaded deterministically with a 32 KiB budget. The
   harness emits JSONL spans for runs, compaction, tool calls, context budgets,
   model usage/calibration, and verification.

Preserved strengths: local-first storage, consumer memory, browser/OS control,
approval UX, and the existing provider/tool stack were not replaced. No new
runtime dependency was introduced.

---

## C. Precise context-limit behavior

### Estimation and window

- `estimateTokens` prices ASCII at 4 chars/token and non-ASCII at 1.5
  chars/token. This is still an estimate; it is corrected by measured usage.
- `resolveContextWindow` order: `QUBE_COMPACTION_CONTEXT_TOKENS` →
  model-name table → 128k default. The table includes GPT-4.1/4o/4.5/5, o-series,
  Codex, Claude, Gemini, DeepSeek, Grok, Kimi/Moonshot, Qwen, Llama, Mistral,
  Command-R, Phi-4, and Gemma families.
- Tool schemas are counted from descriptions plus JSON Schema. Zod 4 schemas are
  converted with `z.toJSONSchema`; AI SDK `jsonSchema()` wrappers are read
  directly.
- Provider calibration stores an EWMA per thread (`52% old + 48% new`, clamped
  to `0.5–3.0`). Samples below 1,000 estimated or 500 actual prompt tokens are
  ignored.

### Trigger and compaction

- Trigger condition: `ceil((system + tools + messages + summary) × calibration)
  > window − reserve`.
- Default reserve: `min(max(16k, ceil(0.15 × window)), max(256, floor(0.4 × window)))`.
- Default keep-recent budget: 15,000 tokens; aggressive overflow recovery:
  `min(configured, 4,000)`.
- The cut lands on a user-message boundary so a tool call/result pair is never
  split. If no valid boundary exists, compaction fails open and the provider
  error is surfaced; overflow recovery then attempts one aggressive pass and a
  deterministic hard cut.
- The summary prompt requires seven sections: Objective, Requirements &
  Constraints, Decisions, Work State, Next Move, Relevant Files, Important
  Context.
- A summary is accepted only if Objective, Work State, and Next Move are
  present. One corrective retry is allowed. The previous objective is prepended
  if a later summary drops it. Stored summaries are capped at 24,000 chars.
- Existing checkpoints are re-applied by anchor on later turns without another
  model call. Repeated compactions update one anchored summary instead of
  stacking summaries.
- After any compaction, the manifest (≤6,000 chars) re-injects todos, touched
  files with current existence/size, recent evidence, and the last recorded
  error.

### Output containment

- String tool results above 16,000 chars are spilled; at most 24,000 chars plus
  a truncation notice are returned inline. Spill retention defaults to 168 h
  and 200 files per thread. Ids are validated against `[A-Za-z0-9_-]{6,80}`.
- `read_tool_output` returns at most 30,000 chars per call by default (100,000
  maximum) and reports `nextOffset`.
- `read_file` returns at most 2,000 lines and ~30,000 chars per call, with
  `startLine`/`endLine`/`nextOffset`; files over 5 MiB are rejected with a
  command-line hint. `list_directory` caps at 300 entries. `run_command` defaults
  to 120 s, caps at 600 s, keeps 12,000 chars of stdout and stderr inline, and
  spills the full combined output.

### Overflow

- Context-overflow errors from both stream creation and stream error chunks are
  recognized. One aggressive compaction-and-retry is allowed per turn. If
  summarization itself fails, the hard cut keeps at least the last user turn and
  injects an explicit "automatic summary unavailable" note.

---

## D. Long-running execution capabilities

### Execute and persist

- `lib/agent/execution-ledger.ts` stores `.memory/runs/<thread>.json` atomically
  (temp file + rename) with per-thread write serialization.
- Lifecycle: `running`, `completed`, `failed`, `cancelled`, `interrupted`.
- Tracked state: run id, timestamps, heartbeat, iterations, tool calls/failures,
  last tool, last error, todos, files touched, evidence, write-ahead journal.
- Heartbeat every 15 s from the harness; stale threshold defaults to 45 s
  (`QUBE_RUN_STALE_MS`, minimum 501 ms for tests).
- Startup sweeps stale `running` records to `interrupted`; a stale record is
  also classified as interrupted at read time by `buildResumePlan`.
- Resume notices are delivered exactly once and explicitly framed as operational
  history, not user instructions. Pending journal entries are called out as
  unknown-outcome actions that must be verified before retrying.

### Resume and duplicate prevention

- Mutating tools (`write_file`, `edit_file`, `delete_file`, plus connector names
  matching mutation verbs) are journaled as `pending` before execution and
  marked `ok`/`error` after.
- Only successful *file* mutations are replayable, and only with an identical
  normalized argument hash within 10 minutes. Pending/failed entries never
  replay. A replay returns the recorded result without re-running the tool.
- A journal still pending when a run finishes is marked `error`, so a clean
  finish cannot fabricate success.
- Checkpoints (`.memory/checkpoints/<thread>.jsonl`) are append-only, bounded to
  100 records per thread, redact secrets, and cap string fields at 4,000 chars.
  `buildResumePlan` combines ledger state with the newest checkpoint and lists
  files/todos that must be re-verified.
- `compactAndCheckpoint` records task state even when compaction is not needed.

### Bounded loops and limits

| Limit | Default | Maximum | Env |
|---|---:|---:|---|
| Steps per model round | 60 | 500 | `PI_HARNESS_MAX_STEPS` |
| Verification retry rounds | 2 | 10 | `QUBE_VERIFICATION_ROUNDS` |
| Silent continuations | 8 | 100 | `QUBE_SILENT_CONTINUATIONS` |
| Outer rounds | silent + verification + 8 | 118 | derived |
| Concurrent foreground runs | 32 | 128 | `PI_MAX_CONCURRENT_RUNS` |
| Harness timeout | 300 s | fixed | `PI_HARNESS_TIMEOUT_MS` |
| Model retries | 2 | fixed | — |
| Command timeout | 120 s | 600 s | per call |

Invalid, negative, or absurd environment values fall back or clamp; they cannot
remove a ceiling. Cancellation aborts the stream and records `cancelled`;
timeouts record `failed`.

### Completion

- `verifyCompletion` is checked after every normal terminal round.
- Conversational turns with no tools/todos/files/errors are `checked: false`
  and pass through.
- Work turns must have no unfinished todos, no surfaced error, no unresolved
  last tool error, at least one successful tool call if tools ran, final text,
  and every claimed output file present on disk.
- A failed check gets up to two silent correction rounds. Exhaustion appends an
  explicit partial-result note to the visible answer, logs verification failure,
  and records the run as `interrupted` rather than `completed`.

### Background execution

The existing durable engine gated by `PI_DURABLE_ENABLED` remains the background
execution path. This work does not fork or replace it. The foreground ledger
provides crash/resume semantics for the Pi path and a shared vocabulary
(run/tool/journal/evidence) that the durable path can adopt when the two are
unified.

---

## E. System prompt changes mapped to real capabilities

| Prompt change | Programmatic mechanism behind it |
|---|---|
| Time line moved from the top to the tail | Keeps the stable system prefix cacheable; no behavior depends on prompt position. |
| `read_tool_output(id, offset?, maxChars?)` and paginated `read_file` documented | Real tools in `lib/pi/tools.ts`; spill ids come from `lib/pi/tool-output.ts`. |
| "Authoritative state is TodoWrite, scratchpad, and files; summaries are untrusted" | `formatSummaryBlock` frames summaries as history; `buildContextManifest` injects machine state after compaction. |
| Resumed-run guidance | Ledger resume notice is generated from persisted state and delivered once. |
| Completion must be proven, not asserted | `completion-verifier.ts` runs independently and can force correction rounds. |
| Keep context lean; write durable findings to scratchpad | Bounded outputs and compaction reduce pressure; scratchpad already survives restarts. |

The prompt describes mechanisms that exist; it is not the enforcement layer.
Permissions, limits, checkpoints, replay, and verification are code paths.

---

## F. Tool ecosystem improvements

- **Registration bug fixed:** `dev_server` and `dev_server_log` were previously
  defined inside the `list_directory` map callback, so they never appeared in
  the tool set. They are now registered unconditionally.
- **`read_file`:** bounded, paginated, binary/size guard, explicit continuation
  metadata. Previously returned the entire file.
- **`read_tool_output`:** new; pages spilled results by validated id.
- **`list_directory`:** 300-entry page with a truncation note; the per-entry stat
  work is bounded.
- **`run_command`:** timeout clamped, large output spilled with an id, full log
  retrievable without re-running the command, explicit `timedOut` and error
  fields.
- **Harness tool wrapper:** journals mutations, replays safe completed writes,
  records file/command evidence, emits tool spans/events, and bounds non-self-
  bounded string results.
- **Permissions:** command classification now sees through `cd … &&`, env
  assignments, `sudo`, absolute binary paths, and shell separators. Protected
  path writes are destructive policy violations. The durable guard and the
  foreground path share the same classifier.
- **No new parallelism:** independent tool calls were already batched by the
  model; no concurrent execution was added where it could race. Subagents remain
  one-shot and non-recursive.

---

## G. Testing results

Commands used:

```bash
npx tsc --noEmit
npm test                         # default Node in this environment: 20.18.0
PATH="$(dirname "$(npx -y node@22 -p 'process.execPath')"):$PATH" npm test
```

Results (final run, this worktree):

- `npx tsc --noEmit`: **passes**.
- Full suite under Node **22.23.4**: **799 tests, 220 suites, 799 pass, 0 fail**
  (`duration ≈ 28.2 s`).
- Full suite under Node **20.18.0**: **788 tests, 208 suites, 775 pass, 13 fail**
  (`duration ≈ 28.9 s`). All 13 failures are `durable-*` suite import failures:
  `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`. `node:sqlite`
  is a Node 22.5+ built-in required by the existing `pi-durable` dependency; this
  is an environment/runtime requirement, not a regression introduced here.
  Node 22 is the runtime used for the complete result.

Coverage by required scenario:

| Scenario | Test evidence |
|---|---|
| Context near limit / overflow | `tests/compaction.test.ts` (fail-open, aggressive hard cut, low-window config), `tests/context-budget.test.ts` (reserve, calibration, clamping), `tests/harness-tools.test.ts` (real bounded outputs). |
| Multiple consecutive compactions | `tests/compaction.test.ts`: 12 consecutive forced cycles with one evolving objective and count/objective assertions; anchor re-application without an LLM call. |
| Critical instruction recovery | `tests/compaction.test.ts`: objective retention/validation/retry/cap; `tests/checkpoint-manifest.test.ts`: manifest reflects real todo/file/evidence state. |
| Very large tool outputs | `tests/tool-output.test.ts` (spill, paging, traversal, pruning); `tests/harness-tools.test.ts` (real 20k-char command output spilled and paged end-to-end). |
| Hundreds of iterations | `tests/execution-ledger.test.ts`: 250 journaled tool calls plus 80 evidence/file updates, with journal/evidence/file bounds asserted. |
| Tool timeouts | `tests/harness-tools.test.ts`: foreground `run_command` `sleep 5` with a 1 s timeout; existing `tests/durable-shell.test.ts` covers the durable path. |
| Repeated tool failures | `tests/continuation.test.ts` (failure recovery gate), `tests/completion-verifier.test.ts` (all calls failed/unresolved error). |
| Interrupted execution / restart | `tests/execution-ledger.test.ts`: stale heartbeat, one-time resume notice, orphan sweep, corrupt ledger; `tests/checkpoint-manifest.test.ts`: resume plan from interrupted ledger + checkpoint. |
| Resumption from checkpoint | `tests/checkpoint-manifest.test.ts`: save/load/history/clear, resume plan, `compactAndCheckpoint`; `tests/execution-ledger.test.ts`: replay/pending rules. |
| Duplicate-action prevention | `tests/execution-ledger.test.ts`: identical-call replay, different-argument rejection, pending/failed never replayed, finish marks unconfirmed as error. |
| Independent parallel subtasks | `tests/subagent-isolation.test.ts`: parallel calls fail independently, report distinct tasks, and leave the active counter at zero. |
| Failed dependent subtasks | `tests/subagent-isolation.test.ts`: empty dependent task returns a structured failure without registering a run; `tests/execution-ledger.test.ts` covers failed-call state. |
| Incorrect completion claims | `tests/completion-verifier.test.ts`: missing claimed file, unfinished todos, unresolved error, all-failed tools, error/no-text turns; bounded nudge and partial note. |
| Permission hardening | `tests/dangerous-actions.test.ts`, `tests/permissions-policy.test.ts`, `tests/durable-guard.test.ts`. |

Coverage gaps are stated in §H rather than hidden: tests use an injectable
summarizer and simulated crashes, not live provider calls or a killed OS process.

---

## H. Remaining limitations

1. **No OS sandbox.** Command classification and protected paths are lexical
   policy, not a kernel boundary. Shell commands still run with user privileges,
   and symlink real-path resolution is not part of the classifier. The report's
   P4 sandbox half remains open.
2. **Dual harness paths.** The durable engine is still gated by
   `PI_DURABLE_ENABLED`; the foreground ledger complements but does not replace
   it. There is no single authoritative execution store yet.
3. **Subagents are still one-shot.** No persistent child sessions, mailboxes,
   dependency graph, or resumable parent/child lifecycle. Parallel independent
   calls are isolated, but dependent subtask orchestration is not implemented.
4. **Deferred tool exposure is not implemented.** All tool schemas are still
   sent every request; they are now counted against the budget. Tool search /
   deferred loading remains an optimization opportunity.
5. **Estimation is heuristic plus calibration.** The first request for a new
   thread/model can still overflow; recovery is one aggressive attempt per turn.
6. **Summaries remain lossy.** The manifest reduces plan/file loss but cannot
   reconstruct arbitrary earlier conversation detail. Full history survives on
   disk and through existing transcript/past-chat tools, not in-model.
7. **Verifier evidence is partial.** It checks todos, last error, successful
   call counts, and files written through `write_file`/`edit_file`. Artifacts
   created indirectly by shell commands, external services, or browser actions
   are not independently verified.
8. **Object-shaped tool results are not spilled.** The harness bounds string
   results; an MCP/object result that stringifies large is not centrally
   truncated.
9. **Observability is JSONL only.** No OpenTelemetry export, metrics backend, or
   retention pruning for observability files.
10. **Test fidelity.** Compaction uses an injected summarizer; crashes are
    simulated by stale heartbeats; no live-model end-to-end run was executed in
    this environment. The durable suites require Node 22+.

---

## I. Updated competitive assessment

This is a mechanism-level comparison, not a product comparison. "Before" refers
to the state documented in the comparison report; "now" to this worktree.

| Subsystem | Qube before | Qube now | OpenCode / Claude Code / Codex | Remaining gap |
|---|---|---|---|---|
| Context budgeting | Fixed 128k, chars/4, no tool schemas | Model windows, reserves, tool accounting, provider calibration, shrink ladder | Measured usage and reserves (OpenCode/Codex) | Heuristic first estimate; no precomputed tokenizer |
| Compaction | Six-section summary, weak validation | Seven sections, validation+retry, objective retention, anchor reuse, hard-cut fallback | Structured summaries with retention rules | Lossy; no semantic retrieval of dropped detail |
| Post-compaction recovery | Passive summary | Machine manifest from ledger+filesystem, explicit precedence | Claude Code explicit manifest | No rules/skills/git snapshot in manifest |
| Durable execution | In-memory runs, no-op checkpoint | Ledger, heartbeat, orphan sweep, resume notice, checkpoint store | Write-ahead claims, resumable sessions | Durable engine still separate; no OS process supervision |
| Idempotency | None | Keyed journal, file-only replay, unknown-outcome reporting | Claim/replay mechanisms | External/connector actions never replayed (intentional) |
| Tool containment | Unbounded `read_file`, lossy clips | Pagination, spill files, paged retrieval, command cap | Spill/artifact patterns | Object results not central; no deferred exposure |
| Permissions | LLM reviewer as primary boundary | Deterministic command/path policy + reviewer | OS sandbox + approval modes (Codex) | No kernel sandbox or network policy |
| Verification | TodoWrite self-report | Independent verifier, correction rounds, honest partial note, interrupted status | Separate checker/hooks (Claude Code) | Shell/external evidence not covered |
| Observability | JSONL domain events | Run/tool/compaction/usage/verification spans + calibration | OTel spans/metrics | No OTel export/retention |
| Prompt architecture | 48 KB monolith, cache-hostile time | Time at tail, project instructions, execution-state section, tool docs | Modular layered prompts | Still a large single file; no path-scoped rule engine |
| Subagents | One-shot helpers | One-shot helpers with tested failure isolation | Persistent graph/mailboxes | No persistent multi-agent graph |

Honest verdict: Qube's foreground harness is materially closer to the reference
architectures on context control, crash recovery, duplicate prevention, and
completion honesty. It is still **not** equivalent to Codex on isolation, to
Claude Code on verification breadth, or to OpenCode on measured token
precomputation. Qube's consumer advantages (browser/OS control, local memory,
proactivity, approval UX) remain intact and were not traded away.

---

## J. Recommended next steps

1. **Unify execution state.** Make the durable engine authoritative for
   background work and adopt the ledger/checkpoint vocabulary there; eliminate
   the dual-path ambiguity.
2. **Add a real sandbox boundary.** OS-level filesystem/network policy for shell
   commands, with the deterministic classifier retained as fast pre-filter and
   the reviewer as intent-aware escalation.
3. **Resolve real paths in protected-path checks.** `realpath` before
   classification to close symlink escapes, and add tests for symlinked
   credential directories.
4. **Deferred tool exposure.** Keep high-frequency tools direct; put long-tail
   MCP/connector tools behind a bounded search so prompt schemas shrink.
5. **Structured verifier evidence.** Record shell/browser/connector artifacts
   with provenance and verify the ones that are safe to re-check; consider a
   fresh-context review for large changes.
6. **Observability retention and export.** Add size/age pruning for JSONL and an
   optional OTel exporter; keep redaction.
7. **Fault-injection evaluation harness.** Run live-model long tasks with
   process kills, provider 429/5xx, duplicate deliveries, and context overflows;
   measure completion and recovery, not just unit behavior.
8. **Prompt modularization.** Split the system prompt into stable global,
   execution, tool, and task modules while keeping the current behavioral text;
   measure cache hit rate before/after.
9. **Persistent subagents.** Only if product demand justifies it: add child
   session resume, mailboxes, dependency edges, and per-child budgets on top of
   the durable engine.
