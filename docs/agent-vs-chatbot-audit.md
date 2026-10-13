# Qube audit: why it feels like "chatbot with tools" — prompt, architecture & backend flaws

Date: 2026-10-13. Method: read `app/api/chat/route.ts`, `lib/pi/harness.ts`,
`lib/pi/task-runner.ts`, `lib/pi/system-prompt.ts`, `lib/pi/continuation.ts`,
`lib/pi/tools.ts`, `lib/pi/agent-tools.ts`, `lib/pi/subagents.ts`,
`lib/pi/memory-context.ts`, `lib/pi/prompt-context.ts`,
`lib/scheduler/{scheduler,task-executor,task-store,types,heartbeat-state,announcements,init}.ts`,
`lib/proactivity/{engine,store,heartbeat-brief}.ts`.
Mapped against Claude's 8-point checklist (loop, done criteria, working state,
verification, approval, trigger without message, tools, UI).

TL;DR: the foreground chat loop is a real agent loop (40 steps + silent
continuation), but it only continues on `TodoWrite` state, `TodoWrite` is
ephemeral/transcript-only, background runs (heartbeat + scheduled) are a
weaker single-pass loop with no `TodoWrite`/continuation, the proactivity
engine (`lib/proactivity/engine.ts`) is dead code nobody calls, and the
prompts teach the exact misbehavior you see (immediate price check →
`schedule_task`; heartbeat → passive `HEARTBEAT_OK` instead of doing reversible
prep work like compiling the pending paper).

---

## 1. Run a loop, not a turn — PARTIAL, split-brain

**What works (chat):** `lib/pi/harness.ts:804` `stopWhen: steps >= 40`,
plus silent continuation `lib/pi/continuation.ts` (budget
`QUBE_SILENT_CONTINUATIONS=8`, default 8): unfinished `TodoWrite` →
server-side nudge → another round, same turn, invisible in UI. Plus idle nudge
(`harness.ts:920`) when `toolCallCount === 0`.

**Flaw 1a — continuation is gated on `TodoWrite` only.**
`hasUnfinishedGoals(lastTodoSnapshot)` (`harness.ts:894`) is the only
multi-step signal. The classic chatbot failure — "1 tool call then a text
reply, user has to say 'now do the next step'" — has `toolCallCount >= 1` and
no/complete `TodoWrite`, so it is NOT continued. The idle nudge only fires on
zero-tool turns. Fix: continue also when the turn ends with an open
explicit/implicit goal and the last message is text-only (e.g. ends with a
question the agent could have answered with a read, or a "want me to…?"
offer — the system prompt itself forbids these at `system-prompt.ts:43-51` but
nothing enforces it).

**Flaw 1b — background loop is single-pass.**
`lib/pi/task-runner.ts:398-409`: `maxSteps = heartbeat 8 / scheduled 12`,
`maxRetries: 0`, no `TodoWrite` ("NOT available headless", `task-runner.ts:105`),
no silent continuation, no idle nudge. A heartbeat brief that needs
`list_directory + 2-3 connector reads + 1-2 web_fetch + note` already exceeds 8
steps and gets cut off. Scheduled research tasks ("3 pricing pages + table")
get 12 steps with no recovery round. So chat feels agentic, background feels
chatbot-like — and background is where proactivity must live.

**Flaw 1c — `TodoWrite` is transcript-only, so the loop signal is fragile.**
`lib/pi/tools.ts:146-151`: "Transcript IS the store — no persistence needed."
The harness observes the snapshot by monkey-patching `execute` (`harness.ts:664`).
If the model never calls `TodoWrite` (prompt explicitly says skip it for
"quick lookups, single answers, one- or two-call tasks",
`system-prompt.ts:99`), there is no plan to continue, no resume after restart,
no cross-thread goals. One misclassification ("this looks quick") collapses a
multi-step job into one turn.

## 2. Explicit done criteria — MISSING

- No "restate success criteria" pattern anywhere. `system-prompt.ts` Goals
  section demands closing every item and defines IMPOSSIBLE, but never tells
  the model to extract checkable acceptance criteria from the user goal first
  (e.g. "3 prices + source links + table file" vs "help me with competitors").
- `schedule_task` schema (`agent-tools.ts:30-39`) is `name + instructions`
  free text. No `doneCriteria`, `outputContract`, `successCondition`,
  `onlyReportIf`, `deliverablePath` fields. Vague instructions persist verbatim
  into headless runs (`task-store.ts` stores `instructions` as-is), and the
  executor marks `status: success` for any text including `"(no output)"`
  (`task-runner.ts:411-428`).
- **Your price-check bug, root cause:** the ONLY price example in the whole
  system prompt is the monitoring one (`system-prompt.ts:234`: `"tell me when
  the price drops" / "keep an eye on X" → schedule_task … only runs while Qube
  is open`). There is no negative example ("check the price of X right now →
  `web_search` + `web_fetch` NOW, no schedule"). Weak-example wiring + the
  `schedule_task` description ("exact-timing work: daily reports, reminders…")
  makes "check price" pattern-match to scheduling. Fix: add one-shot vs
  recurring decision examples + a `scheduleKind: once|interval` gate that
  requires an explicit recurring cue ("every…", "keep an eye", "tell me when")
  before `create`.

## 3. Working state — SIX STORES, NO SINGLE SOURCE

| Store | Scope | Problem |
|---|---|---|
| `TodoWrite` snapshot | turn only, in-memory | lost on restart, cleared when completed (`tools.ts` desc: "goals panel clears") |
| scratchpad md | per-thread file | optional ("you decide when to use", `tools.ts:214`); harness re-parses it with a bullet regex (`harness.ts:484-496`), drops non-bullet state, caps 40 items |
| `heartbeat-state.json` pending/failed/deferred | global | LLM sees only a 5-line summary (`task-runner.ts:361`), not evidence/drafts |
| `proactive.json` prefs + suggestions | durable | written by brief paths, never read by scheduler to decide work |
| `scheduled-tasks.json` | durable | isolated per-task instructions, no shared plan |
| memory goals (`memory-store`) | durable facts | heuristic regex extraction only (`memory-context.ts:129`), no plan link |

Consequences: background tasks can't see chat `TodoWrite`; chat can't see
background plan (only `getLog(3)` last-3 lines via `heartbeat-brief.ts:122`);
heartbeat pending checklist and proactive suggestions are dual-written
(`agent-tools.ts:163-167` + `heartbeat-brief.ts:199-203`) with different dedup
keys (48-char prefix vs content hash), so they diverge.

## 4. Verification — EXHORTED, NOT ENFORCED

- Prompt says "verify actions after tool calls" (`task-runner.ts:119-123`,
  `system-prompt.ts:35`) but defines no verifier: no "re-fetch the page you
  edited / run the tests / validate JSON" step, no acceptance re-check against
  §2 criteria (which don't exist).
- Harness `sawError` only tracks provider `error` chunks (`harness.ts:845`);
  tool-level failures returned as JSON strings (`{"error":…}`) are treated as
  success. The `lastToolError` detector (`harness.ts:676-699`) only catches
  `isError === true` objects or `^error:` strings — most Pi tools return
  `JSON.stringify({error})` (lowercase key, not prefix), so the continuation
  nudge usually carries no error context and the model blindly repeats the call
  (despite "retry at most ONCE" in the prompt).
- Executor logs `success` with `output.slice(0,480)` even for empty output;
  `announcements.isMeaningfulResult` (<20 chars, `(no output)`,
  `HEARTBEAT_OK` filtered) runs AFTER success is recorded, so empty runs still
  count as successful ticks and reset `consecutiveEmptyTicks`.

## 5. Approval — WELL BUILT, CONTRADICTORY HEADLESS SEMANTICS

Credit: `permission-middleware` + `withPermissionCheck` + sensitive-connector
wrapping (`harness.ts:577-598`) + approval card as the confirmation
(`system-prompt.ts:46-47,117-124`) is the right design.

Flaws:
- **Heartbeat vs scheduled split is prompt-only, not type-enforced.**
  `task-runner.ts:250-271` replaces heartbeat sensitive connectors with
  draft-only stubs using `z.object({}).passthrough()` — the exact schema-
  destroying pattern `harness.ts:642-648` warns broke MCP tools. The model sees
  a tool with the same name but no params, calls it with real args, gets a fake
  `{"drafted":true}` — a hallucinated success.
- `schedule_task` remains callable headless (`agent-tools.ts` `background:true`
  still exposes create/update/trigger), so the heartbeat ban ("do NOT create
  schedules from here", `task-runner.ts:88`) is advisory. A heartbeat run can
  spawn schedules despite the discipline block.
- Computer mutating tools "refuse without an interactive user"
  (`task-runner.ts:220-221`) but are still listed as available — wasted steps
  every headless run discovering the refusal.
- ChatGPT default model silently falls back to another provider headless
  (`task-runner.ts:18-36,366-394`), logged server-side only. Same goal, weaker
  model, no user-visible note — reads as "agent got dumb in background".

## 6. Trigger work without a message — BUILT BUT SELF-DEFEATING

- Scheduler ticks every 60s (`scheduler.ts:14`), heartbeat default 30 min
  (`types.ts:42`). Lazy start via `ensureSchedulerStarted()` on first
  `loadTasks()` (`task-store.ts:35-42`, `init.ts`) — no explicit server-boot
  hook found; if nothing loads tasks, nothing ticks. Sequential execution
  (heartbeat first, then scheduled one-at-a-time, `scheduler.ts:157-166`): a
  180s heartbeat LLM run starves scheduled tasks behind it.
- **Quiet-tick skip kills your use case.** `scheduler.ts:57-63`: if
  `classifyHeartbeatNeed() === "nothing"` and `consecutiveEmptyTicks > 3`, no
  LLM call at all — just a timestamp update. And `classifyHeartbeatNeed`
  (`heartbeat-state.ts:134-141`) returns non-`nothing` only for in-progress /
  failed-retry / needs-attention / due pending/deferred. Workspace changes, new
  files, upcoming deadlines, "paper waiting to be compiled" NEVER flip the
  classifier by themselves — there is no file watcher, no deadline scan. So the
  exact "monitor everything he controls and find work to pre-do" run is skipped
  precisely when the checklist is empty. The monitor can only re-find what is
  already listed.
- **Consumed dues can vanish.** `consumeDueActions`
  (`heartbeat-state.ts:180-192`) REMOVES due pending actions from the store
  before the LLM runs. If the run returns `HEARTBEAT_OK`, errors, or is
  skipped, they are neither announced nor re-queued (only deferred-promotion
  re-adds). The next chat's `<heartbeat_recap>` then shows an empty checklist.
- Announcements cover scheduled tasks only (`scheduler.ts:124-129`);
  heartbeat findings travel via `update_heartbeat note` → pendingActions +
  `recordHeartbeatFinding` suggestion. Two deliveries, two dedups, one race
  with the consumer above.

## 7. Tools — TOO MANY, OVERLAPPING, WEAK EXAMPLES

- Main agent gets ~30-50 tools (files 6 + scratchpad 3 + browser 7 + computer
  ~10 + connectors dynamic + MCP dynamic + memory + schedule/heartbeat/ask 3-4
  + TodoWrite + subagent + generate_ui + present_file). Narrowing exists only
  for subagents (Explore 5, researcher 2, reviewer 4 — `subagents.ts:213-222`),
  never for the main loop or background runs. Weak models drown; strong models
  waste context.
- `schedule_task` vs `update_heartbeat` descriptions overlap ("OpenClaw-style
  cron" vs "Muse-style monitor"); the disambiguation table lives only in the
  chat prompt (`system-prompt.ts:127-138`), while the background prompt
  (`task-runner.ts:82-94`) restates it differently ("flexible periodic
  inspection, NOT exact-timed" vs "exact-timed automation"). Same concepts,
  different words, no shared enum — the model merges them (your symptom).
- `schedule_task` schema can't express what the store supports: `hour/minute/
  weekdays/monthDay` exist in `types.ts` + `computeNextDailyOccurrence` but are
  absent from the tool input (`agent-tools.ts:30-39`), so "every day at 9am" is
  inexpressible — the model improvises interval math.
- `update_heartbeat note` is one free-text string; downstream dedups by
  normalized 48-char prefix (`heartbeat-state.ts:148-151`) while suggestions
  dedup by content hash (`heartbeat-brief.ts:183-189`). Same finding, two
  identities → repeats or drops.
- `ask_user` (background-aware, `agent-tools.ts:187`) vs `ask_question`
  (chat-only questionnaire, `tools.ts:77`) overlap; prompt says "batch into ONE
  call" but two tools invite split calls across turns.
- `web_search` scrapes DuckDuckGo HTML with a single regex
  (`tools.ts:738-748`), often zero links + empty snippets; `web_fetch` dumps up
  to 25k chars unchunked. Concise-useful-results discipline (§7) is not implemented.

## 8. UI/shape — CHAT-SHAPED, BACKGROUND NEWS FRAGILE

- `app/api/chat/route.ts:122-158`: pending announcement IDs are snapshotted
  pre-turn and marked delivered post-turn **unconditionally on stream success**
  — even if the model never mentioned them. One generic "hi" reply permanently
  burns the news. No check that the reply actually contains the announcement.
  Fix: mark delivered only on verified mention, or re-inject until acknowledged.
- Goals widget is transcript-derived (last `TodoWrite` call); reload/new thread
  clears it. No durable goals view spanning chat + background.
- Background completion has no push: user must start the next chat to see
  `<pending_announcements>` / `<heartbeat_recap>` woven in (`memory-context.ts:
  113-121`). Long work looks like silence until asked about — the chatbot feel.
- Agent can rewrite heartbeat instructions / schedules via tools with no
  diff/review surface (`heartbeat/route.ts` PUT takes raw instructions).

---

## Proactivity focus: heartbeat, goals, scheduled tasks

### Heartbeat today: a quiet monitor that is told not to do the job you want

Default instructions (`types.ts:49-50`), discipline block
(`task-runner.ts:82-89`), and tool gating all say: read-only lookups, draft
only, never send/post/delete, never create schedules, `HEARTBEAT_OK` with no
tool calls when idle. Permissions actually allow `runCommands:true,
webAccess:true` (`types.ts:53-58`) — compiling a paper via `run_command` +
`write_file` is permitted and reversible — but the prompt frames any action as
suspicious, so the model stays silent. Your target behavior needs a third lane:

- **Lane A (monitor):** read-only connector/workspace checks → note findings.
- **Lane B (prep, reversible, in-workspace):** compile the paper, build the
  grocery list / comparison table / draft file NOW, save under `documents/` etc.
- **Lane C (outside/reaching people):** send/post/delete/purchase → NEVER
  headless; prepare draft + `present_file`, ask in next chat (approval card).

Today B is lumped into A ("draft only") and C's approval story only exists in
chat. Fix: explicitly authorize B in the heartbeat discipline + permissions
(`externalFiles:false, destructiveCommands:false` already bound it), require
`[file: path]` markers + `update_heartbeat note` with the file path, and let
the next chat `present_file` + ask to send. That is "does the work before you,
asks before sending".

### Goals today: session checklist, not a goal system

`TodoWrite` (chat) + `pendingActions` (heartbeat) + `preferences/suggestions`
(proactive store) + `scheduled-tasks.json` + scratchpad + memory goals = six
goal-ish stores, none authoritative. Background runs are denied `TodoWrite`,
so a "compile paper then ask to send" chain can't persist steps across
heartbeat → chat. Fix: one durable goal object (topic, done-criteria, owner
lane A/B/C, evidence, draft/file refs, status, dedup hash) shared by chat,
heartbeat, and scheduled tasks; `TodoWrite` becomes a view on it, not a
transcript trick.

### The engine nobody calls

`lib/proactivity/engine.ts` implements exactly Claude's "decide what needs
approval" ladder (`no_action → remember → suggest_once → prepare_draft →
ask_confirm → schedule → execute_low_risk`) with confidence scoring, duplicate
gate, fatigue backoff, scope checks. Nothing in `scheduler.ts`,
`task-runner.ts`, `heartbeat-state.ts`, or `memory-context.ts` imports
`evaluateOpportunity` / `countSimilarRequests` / `hasMeaningfulNewInfo`. All
proactivity decisions are ad-hoc LLM judgment against weak examples. Wiring the
engine in (score every heartbeat candidate; only `prepare_draft`+ surfaces;
`execute_low_risk` limited to lane B) would fix "never repeats twice" and
fatigue more reliably than prompt prose.

---

## Fix list, ordered by leverage (no code changed in this audit)

1. **Teach one-shot vs recurring with examples.** Add to system prompt +
   `schedule_task` description: "check X now → tools NOW, no schedule" vs
   "`every…/keep an eye/tell me when` → `schedule_task`"; require an explicit
   recurring cue for `create`, else do it inline. This alone fixes the price-check symptom.
2. **Authorize heartbeat lane B.** Rewrite heartbeat discipline: reads + REVERSIBLE
   workspace prep allowed (compile/build/draft files, `runCommands` non-
   destructive); outside sends still draft-only; every B action ends with
   `update_heartbeat note` containing file path + "ask user to send in next chat".
3. **Give background runs a real loop.** Raise heartbeat/scheduled `maxSteps`
   (or budget by task), add `TodoWrite`-equivalent headless plan + 2-3 silent
   continuation rounds in `task-runner.ts` mirroring `harness.ts`.
4. **Wire `engine.ts` into the heartbeat path.** Score candidates
   (requestCount via `countSimilarRequests`, meaningful-change via hash,
   fatigue via `recentDismissals`); gate surfacing on confidence; enforce
   never-repeat via content hash, not prefix match.
5. **Unify goal state.** One durable goal record; `TodoWrite`, pendingActions,
   suggestions become views. Persist across restart; share chat ↔ background.
6. **Fix delivery semantics.** Mark announcements delivered only on verified
   mention; don't delete consumed dues on empty/failed ticks (re-queue);
   reconcile pendingActions ↔ suggestions dedup keys.
7. **Repair tool schemas.** `schedule_task`: add `doneCriteria`,
   `outputContract`, `condition/onlyReportIf`, `hour/minute/weekdays`,
   `permissions`, `deliverablePath`. `update_heartbeat note`: structured
   `{topic, evidence, draft, fileRefs, deadline}`. Fix draft-stub schemas (keep
   real params, block in `execute`, don't `passthrough()`-destroy). Narrow main-
   agent tools per task type.
8. **Verify before finishing.** Require done-criteria check + concrete verifier
   (re-fetch edited page, `list_directory` after write, test run) before final
   summary; executor `success` only on verifier pass; tool errors as real
   `isError` results so the loop can recover.
9. **Stop the quiet-tick skip from killing discovery.** Run a cheap
   deterministic sweep (workspace root list, due-deadline scan from memory/
   tasks) even on "silent" ticks; call the LLM only on diff. File the diff as
   candidate goals for the engine.
10. **Start the scheduler explicitly + isolate runs.** Boot hook (not lazy
    import), bounded concurrency so heartbeat can't starve scheduled tasks,
    user-visible "runs while Qube is open" disclosure in the `schedule_task`
    tool text (not buried in a playbook line).

## Files to change first (smallest diffs, biggest feel change)

- `lib/pi/system-prompt.ts:234-235` + `lib/pi/agent-tools.ts:26-30` — one-shot
  vs recurring examples + gate (fixes price-check mis-scheduling).
- `lib/pi/task-runner.ts:82-89,105,398` — lane-B authorization, headless plan,
  step budget.
- `lib/scheduler/scheduler.ts:57-63` + `lib/scheduler/heartbeat-state.ts:134-141,180-192`
  — discovery sweep, classifier inputs, no-loss consume.
- `app/api/chat/route.ts:153-158` — verified delivery before
  `markAnnouncementsDelivered`.
- Wire `lib/proactivity/engine.ts:evaluateOpportunity` into heartbeat candidate
  handling (new call site, ~50 lines).
