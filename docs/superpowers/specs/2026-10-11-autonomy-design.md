# Max-Autonomy Agent Design — 2026-10-11

## Goal
Make Qube as autonomous as possible (beyond OpenClaw default), with "auto except externals": workspace/files/shell/web auto-run; external sends/deletes/payments still confirm via approval card.

## Architecture
- `lib/pi/harness.ts`: stopWhen 15→40 steps, temperature 0.7→0.3, maxRetries 0→2.
- `lib/pi/continuation.ts`: maxSilentRounds 3→8, add idle-continue (planning-only turn with zero tool calls → escalating nudge x3, OpenClaw #67538 pattern) even without TodoWrite.
- Force TodoWrite for 3+ step tasks (prompt + harness hint, not hard block).
- Permission middleware: auto-allow reads, workspace writes/edits, safe shell (ls/cat/build/test/python), web_search/fetch, browser navigate/snapshot. Card only for: external send/post/create, delete outside workspace, payments/sharing secrets, rm -rf/sudo, computer mutating actions.
- Denied-once → skip same shape this thread, use draft/file alternative, no retry loop >1.

## Proactivity
- Heartbeat stays read+draft-only. Notice→remember→prep-now→surface-once, max one offer/reply, never repeat rejected suggestion.
- After 2-3x repeated manual task, offer once to automate via schedule_task.
- Pending announcements/heartbeat recap must be woven into next reply.

## Error handling
- Context overflow → compact + retry (existing). Tool error → fix args, retry once with different strategy, then explain in one sentence and move on.
- Never leak internals (sandbox paths, stack traces) to user.

## Testing
- `scripts/run-tests.mjs` pi-harness + permission-middleware suites pass.
- Manual: multi-step file task completes without questions; external send still shows card; heartbeat quiet tick returns HEARTBEAT_OK.
