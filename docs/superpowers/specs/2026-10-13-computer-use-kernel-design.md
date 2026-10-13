# Computer-Use Kernel — Design (Sub-project 1 of 6)

Date: 2026-10-13
Status: Draft for review

## Context

The goal is to make browser/computer use reliable, autonomous and safe across
the perceive → reason → act → verify → recover loop. That goal is too large for
one spec, so it is split into sequential sub-projects, each with its own spec,
plan and implementation:

1. **Kernel** (this spec): ActionExecutor, PermissionManager, StateTracker,
   VerificationEngine, RecoveryManager, ActionLog, wired into the default path.
2. Perception: unified observation, change diffs, console/network capture.
3. Browser resilience: dialogs, popups, cookie banners, tabs, downloads/uploads,
   semantic targeting.
4. Computer/desktop grounding: OCR, visual grounding, coordinate correction.
5. Coding-loop integration: dev-server lifecycle, logs, browser testing loop.
6. Port to the pi-durable path.

### Current state (relevant facts)

- Default agent loop: `lib/pi/harness.ts` (`streamText`, 40-step cap). It already
  wraps every tool `execute` (~lines 655-719) to observe `TodoWrite` and the last
  tool error.
- Browser tools (`browser_*`, `open_path`, `request_takeover`) are in
  `lib/pi/tools.ts`; native OS tools (`computer_*`) in `lib/pi/computer-tools.ts`;
  the built-in browser MCP (`obu_*`) in `lib/browser/auto-mcp/server.mjs`.
  Implementation of browser primitives: `lib/pi/computer-use.ts` (CDP over `ws`).
- `browser_*` and `obu_*` tools run with **no approval**; only `browser_pixel_act`,
  `open_path` and `request_takeover` call `withPerm`, and `classifyLocalTool` does
  not classify them as sensitive. `computer_*` is always gated except read-only.
- `lib/agent/observability.ts` exposes `logToolCall`/`logToolResult` but nothing
  calls them: there is no per-action audit log.
- No verification of action effects, no repeat-failure detection, no resumable
  computer-use state.

## Goals

- Every browser/computer/terminal-adjacent tool call passes through one uniform
  pipeline: describe → repeat-guard → permission → pre-probe → execute →
  post-probe → verify → recover → log → return.
- Tool names, schemas and model-visible semantics stay unchanged (no breaking
  change). Results gain a structured `_kernel` block.
- Risk-classified gating (user decision): read-only and benign interaction run
  freely; consequential actions require approval; headless runs refuse them.
- Detect no-effect actions, stale refs, new dialogs, auth walls, CAPTCHAs,
  disabled controls, crashes. Never bypass CAPTCHAs/auth/anti-bot.
- Avoid repeating the same failed action on the same page state.
- Persist enough state to resume an interrupted task.
- Components are independent modules behind typed interfaces.

## Non-goals (later sub-projects)

OCR / visual grounding, cookie-banner and popup auto-handling, downloads and
uploads, dev-server/log tools, durable-path port, a full ActionPlanner. No change
to tool names or schemas. No new unified tool surface.

## Architecture

New module `lib/computer-use/`:

| File | Component | Responsibility |
|---|---|---|
| `types.ts` | all | Shared interfaces: `ActionDescriptor`, `PageFingerprint`, `Verification`, `RiskLevel`, `PermissionDecision`, `RecoveryPlan`, `ActionLogEntry`, `Probe`. |
| `catalog.ts` | ActionCatalog | `describe(toolName, args, ctx) → ActionDescriptor` (domain `browser`/`desktop`/`terminal`/`file`/`other`; kind `observe`/`interact`/`navigate`/`input`; target ref/selector/coords/text). Covers `browser_*`, `obu_*`, `computer_*`, `open_path`, `run_command`. Unknown tools → `other`, passed through. |
| `permission.ts` | PermissionManager | `evaluate(descriptor, state) → {decision: allow\|ask\|deny, risk, purpose}`. Risk levels: `read`, `interact`, `external`, `financial`, `destructive`, `account`, `credential`. Resolves a ref to its label from the last snapshot index and inspects URL/form context, so "Place order" or "Delete account" is caught semantically. Headless/subagent runs deny above `interact`. Asks via existing `createPermissionRequest` card. |
| `state.ts` | StateTracker | Per-thread action history (last 50), last `PageFingerprint`, last-snapshot element index, failure counters keyed by action signature, tab roster, checkpoints. Persists to `<dataDir>/.memory/computer-use/<thread>.json`; `restore()` on next run. |
| `dom-observer.ts` | DOMObserver | `probe() → PageFingerprint`: URL, title, readyState, text hash, dialog/alert presence, focused element, target disabled state, tab count. One CDP eval; reuses `cdpCall`. Probe reuse if < 1s old. |
| `visual-observer.ts` | VisualObserver | Interface + adapter over the existing frame cache and screenshot dedupe. Captures only when the DOM probe is insufficient or coordinates were used. (OCR/grounding deferred.) |
| `verify.ts` | VerificationEngine | Pure: `verify(pre, post, descriptor, result) → {verdict: verified\|no_effect\|failed\|unknown, signals[]}`. Signals: `url_changed`, `text_changed`, `new_dialog`, `error_text`, `auth_wall`, `captcha`, `stale_ref`, `disabled`, `crash`, `nav_failed`. |
| `recovery.ts` | RecoveryManager | `plan(verification, descriptor, history) → RecoveryPlan {autoSteps, hints, block?}`. Auto-runs only safe idempotent steps (re-snapshot, dismiss dialog, heal stale ref). Auth/captcha → `request_takeover` hint. Repeated failure → block + "use a different approach" hint. |
| `executor.ts` | ActionExecutor | `applyKernel(tools, ctx) → tools`. Wraps `execute` of in-scope tools through the pipeline; attaches `_kernel`. Fails open on every stage except permission. |
| `planner.ts` | ActionPlanner (thin) | Reads `TodoWrite` plan state; after N consecutive failures emits a replan steer; records checkpoints. |
| `action-log.ts` | ActionLog | Writes one JSONL entry per action via `lib/agent/observability.ts` (risk, duration, verdict, signals, redacted args). |
| `controllers.ts` | BrowserController / ComputerController | Typed facade interfaces over `computer-use.ts` / `computer-tools.ts`. Implemented lightly now; deepened in sub-projects 3 and 4. |
| `index.ts` | | Public exports and `isKernelEnabled()`. |

Dependencies point inward: `executor` depends on the others through their
interfaces; `verify` and `permission` classification are pure and have no I/O.

## Pipeline (per tool call)

1. **Describe** — ActionCatalog builds the descriptor. Out-of-scope tools skip
   the kernel entirely.
2. **Repeat guard** — signature = tool + normalized args + page fingerprint hash.
   If the signature already failed twice, do not execute; return
   `{blocked:"repeat_failure", suggestion}`.
3. **Permission** — `read`/`interact` run. Higher risk → approval card with a
   purpose line (e.g. `Click "Place order" on shop.example.com`). Headless
   (`includeAskUser === false`) denies. **Fails closed** on error or timeout.
4. **Pre-probe** — DOMObserver probe; skipped for observe tools; reused if fresh.
5. **Execute** — original tool.
6. **Post-probe** — event-driven via existing `waitBrowserQuiet`; no fixed sleeps.
7. **Verify** — verdict + signals.
8. **Recover** — auto-run safe steps; otherwise attach hints.
9. **Log** — ActionLog entry.
10. **Return** — original result plus `_kernel: {actionId, risk, verdict,
    changed, signals, recovery, repeatWarning}`. String results get a compact
    trailer; MCP `{content}` results get an extra text part; `toModelOutput`
    image handling is untouched.

## Error handling

- The kernel never throws into the tool loop. Every stage is try/catch and
  fails open (probe failure → verdict `unknown`, result passes through).
- Permission fails closed.
- Auth walls and CAPTCHAs always map to a `request_takeover` suggestion; the
  kernel never solves or bypasses them.
- Dead CDP / crashed page: one `ensureManagedChrome` restart, `restoreBrowserTabs`,
  verdict `crashed`.

## State and resume

`StateTracker` persists to `<dataDir>/.memory/computer-use/<thread>.json`
(last 50 actions, failure counters, tab roster, last checkpoint). On the next
run of the same thread a short "resume context" line is appended to the system
prompt. Files are written only when kernel-scoped tools were used.

## Rollout

- Enabled by default on the legacy harness path; `COMPUTER_USE_KERNEL=0` is a
  kill switch.
- Wired into `lib/pi/harness.ts` by replacing the in-place wrapper block with a
  call to `applyKernel`, keeping the existing `TodoWrite`/last-error observation
  behavior.
- The PermissionManager is authoritative for `browser_*`, `obu_*`, `computer_*`;
  `classifyLocalTool` is unchanged for all other tools. `computer_*` keeps its
  existing always-ask behavior (existing tests must pass).
- System prompt gains a short paragraph explaining `_kernel` and the
  "don't repeat blocked actions" rule.
- Durable path untouched; the kernel takes plain `execute` functions so it ports
  later via `buildVercelExtension`.

## Testing

`node:test` via `tsx`, files in `tests/`:

- `computer-use-verify.test.ts`, `computer-use-permission.test.ts`,
  `computer-use-recovery.test.ts`, `computer-use-state.test.ts`,
  `computer-use-catalog.test.ts`: pure unit tests.
- `computer-use-executor.test.ts`: pipeline with fake tools, fake probes and a
  fake approval resolver (allow, deny, timeout, headless, repeat-block,
  fail-open, no-throw).
- One real-Chrome smoke test modeled on `browser-act-e2e.test.ts`, skipped when
  no Chrome is found.
- `npm test` must stay green, including existing `computer-use.test.ts`,
  `rakazo-port.test.ts`, `durable-guard.test.ts`.

## Open decisions (resolved)

- Gating policy: risk-classified (user choice).
- Integration: wrap existing tools, no new tool surface (user choice).
- Ordering: foundation first (user choice).
