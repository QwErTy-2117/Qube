# Learning memory, self-improving skills & proactive assistance

How Qube learns across chats, reuses what it learns, and proactively helps —
and how to extend each piece. For the product view of memory, see the
in-app Settings → Memory panel.

## Architecture (reuse, don't duplicate)

There is exactly one of each system; the new code extends the existing
stores rather than adding parallel ones:

| Concern | Owner | Notes |
|---|---|---|
| Memory persistence | `lib/memory/voicemem-core.ts` (dual-brain store) | Extended `MemoryEntry` with optional metadata; legacy 4-arg `addMemoryEntry` still works |
| Memory schema | `lib/memory/memory-schema.ts` | Types, scopes, confidence model, expiry |
| Retrieval scoring | `lib/memory/retrieval.ts` | Pure functions: score → scope → confidence → recency → dedupe → bounded inject |
| Learning rules | `lib/memory/learning.ts` | Pure: meaningful-task gate, generalization, contradiction resolution, consolidation, preference inference |
| Safety gate | `lib/memory/safety.ts` | Runs on **every** memory write path; blocks/redacts secrets |
| Skill learning | `lib/skills/learner.ts` | Creation criteria, specificity check, lifecycle — deterministic, no hardcoded topics |
| Skill storage | `lib/skills/store.ts` | Unchanged shape; self-created skills persist as `custom` source |
| Proactivity decisions | `lib/proactivity/engine.ts` | Pure evidence→decision ladder |
| Proactivity state | `lib/proactivity/store.ts` | `.memory/proactive.json`: preferences, suggestion history, fatigue counters |
| Post-task pass | `lib/learning/protocol.ts` | Fire-and-forget orchestration, never throws |
| Prompt wiring | `lib/pi/system-prompt.ts` | Learning + Proactivity sections |
| Tool wiring | `lib/pi/memory-tools.ts` | `read_memory` (filtered search), `save_memory` (safe+generalizing), `manage_skill`, `manage_proactive` |
| Context injection | `lib/pi/memory-context.ts` | Bounded top-5 recall + active prefs + rejected-topic guard |
| Telemetry | `lib/agent/observability.ts` | JSONL per thread + `_global.jsonl`, secrets redacted |

Scheduling stays in `lib/scheduler/` — the proactivity store only owns
*decision state* and hands exact-timing work to `schedule_task`.

## Memory lifecycle

```
Understand → Plan → Execute → Recover → Complete goals
    → LEARNING + MEMORY + SKILL EXTRACTION → PROACTIVITY EVALUATION
    → Final response
```

1. **Harness hook** (`lib/pi/harness.ts`, end of `runPiWithVercel`):
   counts streamed tool calls and calls `runPostTaskLearning` fire-and-forget
   when long-term memory is enabled. It never blocks or fails the response.
2. **Gate** (`isMeaningfulTask`): tool effort, file changes, or signal
   keywords. Trivial chatter is skipped — always *evaluate*, rarely *store*.
3. **Extract**: explicit statements (high confidence) and repeated-behavior
   signals (medium) become candidates; single weak inferences stay
   low-confidence or are dropped.
4. **Generalize** (`generalizeContent`): a raw incident
   ("on Sep 10 clicked button Y on site X") is widened to the reusable
   principle before storage.
5. **Contradict** (`resolveContradiction` + store upsert): prefer conditional
   preferences ("generally concise, but detailed for technical work"),
   temporary exceptions, or narrowed scopes over erasure.
6. **Consolidate** (`consolidateMemories` / `dedupeMemories`): repeated
   observations strengthen one record instead of spawning twins.

### Scopes

`global_user` → `project`/`workspace` (with `scopeKey`) → `task`/`workflow` →
`conversation`/`temporary`, plus `proactive_preference`/`scheduled_action`.
Retrieval (`scopeWeight`) gives matching-scope memories a boost and
down-weights foreign-project memories; global memories always apply.

## Skills

A memory answers *"what do I know?"*; a skill answers
*"what procedure should I follow?"*. The agent manages them via the
`manage_skill` tool (create/update/deprecate/get/list).

- **Create** only when reusable + procedural + understood + likely to recur
  + generalizable (`evaluateSkillCreation`, threshold-gated).
- **Generalize** (`skillSpecificity`): hardcoded URLs, exact UI labels,
  exact errors, or single datasets fail validation with guidance to extract
  the strategy instead.
- **Lifecycle** (`nextSkillStatus`): `candidate → tested → trusted`,
  demotion on failure, `deprecated` as terminal. A failure caused by changed
  context keeps its status (narrow the scope instead).
- New skills persist through the existing `skillStore` as `custom` source,
  so prompt injection (`buildSkillsPromptSection`) picks them up unchanged.

## Proactivity

Least-intrusive ladder: `no_action → remember → suggest_once →
prepare_draft → ask_confirm → schedule → execute_low_risk`.

- **Evidence first**: explicit recurring requests (0.9) > repeated requests
  > single mention (≤0.25, never acts alone).
- **Duplicate suppression**: content hashes + meaningful-change gate —
  no repeat delivery without new information.
- **Fatigue backoff**: recent dismissals raise the confidence bar
  (`fatiguePenalty`); rejections stop re-suggestion.
- **Authorization**: anything with external side effects requires
  confirmation — the engine returns `prepare_draft`/`ask_confirm`, never
  `execute` for external actions.
- **Scope**: project-scoped preferences only fire in their project
  (`isInScope`).
- **No background? No pretending**: when background execution is
  unavailable, the decision is a transparent one-time suggestion with the
  limitation stated.
- Feedback (`accepted / rejected / paused / cancelled / modified`) flows
  through `manage_proactive` → store → `applyFeedback`, so future decisions
  adapt.

## Observability

`.memory/observability/<thread>.jsonl` + `_global.jsonl` record
`memory_retrieved/written/suppressed`, `skill_created/updated/selected/
deprecated/failed`, `proactive_detected/suggested/scheduled/executed/
suppressed/deferred/rejected_learned`, and `learning_pass` — each with
reasons. Use `readRecentEvents(threadId)` to inspect. Secrets are redacted
before logging; raw secrets never hit disk via the safety gate.

## Performance notes

- Auto-recall injects at most ~5 ranked memories (~1600 chars) plus ≤5
  active prefs — never the whole DB.
- The learning pass runs only after meaningful tasks and does constant-time
  heuristic work plus a bounded number of writes.
- Suggestion history is capped at 200 records; dismissals decay after 7 days;
  consolidation keeps the memory file from growing without bound.

## Tests

`tests/memory-skills.test.ts` (25 scenarios) and
`tests/proactivity.test.ts` (24 scenarios) use `node:test` + `tsx`:

```bash
npm test   # isolated QUBE_DATA_DIR, both suites
```

Pure logic (scoring, generalization, engine) is tested without disk;
persistence tests (cross-chat round-trip, filtered search, protocol pass)
run against a temp data dir. When adding behavior, add a scenario test in
the same style — one focused assertion per mechanism.
