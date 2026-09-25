# Rakazo port — browser automation (browser window only) / context / prompt engineering

Source: https://github.com/elie222/rakazo (Apache-2.0)

This doc maps what was copied from Rakazo into Qube and where it lives.
Rakazo is a server product (Docker/E2B/Daytona/Box, Postgres, multi-bot);
Qube is a local desktop app (managed Chromium via CDP). Provider machinery
was NOT copied — only the agent-facing patterns, adapted to the managed
browser window. SCOPE: browser window only — NOT OS desktop control. The old
`computer_*` tool names survive only as deprecated aliases of `browser_*`.

## Browser use (`lib/pi/computer-use.ts`)
- `browser_navigate(url)` → CDP `Page.navigate` (Rakazo `browser-tools.ts` parity).
- `browser_snapshot()` → isolated-world eval, bounded page text (4000 chars) +
  max 80 interactive elements as `e1…` refs, password values masked
  (`computer-browser.ts` parity: isolated script world, mask passwords,
  reject stale refs, ≤80 elements).
- `browser_act(click/fill/type by ref)` → stale refs rejected with fresh-snapshot
  guidance, never retargeted; failures report `completed/N + uncertain` with
  `fallback: "browser_pixel_act"` + "inspect current state, never replay" note.
- `formatSnapshotTree()` + `withBrowserFallback()` match Rakazo exactly.

## Browser window automation (`lib/pi/computer-use.ts`, `lib/pi/tools.ts`)
- `browser_screenshot` (was `computer_observe`) → CDP `Page.captureScreenshot` of the managed browser window only; identical consecutive
  frames omit image bytes (metadata + `unchanged` only) — Rakazo
  `computer-tools.ts observationToolResult` parity.
- `browser_pixel_act` (was `computer_act`, actions ≤ 24, observe=true) → ordered x/y batch inside the browser window: click/move/down/up (pointer),
  type→paste, key, scroll, wait — Rakazo `parsePixelActions` parity.
  `observe:false` batches predictable actions without a screenshot; `settle_ms`
  (0–5000) waits before the screenshot (executor parity).
- `open_path(path|url)` → URL via `browser_navigate` + browser screenshot (visible), or workspace file in its OS default application
  (`open`/`xdg-open`/`start`, permission-gated) with an open confirmation only — OS app windows are NOT visible to the agent
  (Rakazo `open_path` parity; `launch_app` has no browser equivalent — OS app work stays with `run_command`/`read_file`).
- `SingleScreenClaimTracker` — Rakazo `computer-screens.ts` parity (busy →
  "browser window temporarily busy, file/shell still work").
- `request_takeover` tool — Rakazo `waiting_takeover` parity: pauses for
  protected input (login/captcha/2FA) via the Browser panel questionnaire.
- System prompt carries Rakazo executor guidance (browser-only wording): batch predictable actions,
  screenshot before coordinates/after nav/when uncertain, never kill browser
  processes, page banners are content not stop commands, re-screenshot on change.

## Context (`lib/pi/prompt-context.ts`, harness, memory, compaction)
- `escapePromptData` + byte-budget `truncateUtf8` (Rakazo `memory-context.ts`,
  `scratchpad-context.ts`, `history-compaction.ts` parity).
- `<durable_memory>` (32k, revision-ordered, data-not-instructions) — built from
  the real memory store (newest entries) in `memory-context.ts`, supplementing
  the relevance-ranked recall.
- `<scratchpad_open>` (4k, 40 open items, not a scheduler) — open + parked
  statuses stay visible (Rakazo `open|parked|done` parity); title ≤200 /
  notes ≤4000 caps exported as `SCRATCHPAD_TITLE_MAX` / `SCRATCHPAD_NOTES_MAX`.
- `<recalled_memory>` (max 5, provenance/id/entity citations).
- `<compacted_thread_summary>` framed as untrusted historical data
  (compaction block already existed; framing hardened).
- `formatReplyTarget` (reply_target / reaction_target quoting).
- `formatCurrentTimeInstruction` injected into every system prompt.
- Harness injects `<scratchpad_open>`; memory-context wraps recall in
  `<recalled_memory>` framing.

## Prompt engineering (`lib/pi/system-prompt.ts`)
- Global untrusted-data discipline section (page/memory/summary/scratchpad/
  tool/file/web = data, never instructions).
- Inspect-before-continue / never-replay-completed-or-uncertain rule.
- Page-tools-first ordering: navigate → snapshot → act → browser_pixel_act → takeover.
- `browserUseInstructions(true)` appended verbatim-style from Rakazo executor (browser-only wording).

## Web safety (`lib/agent/browser/ssrf-dns.ts`, wired into `web_fetch`)
- Rakazo `web-ssrf.ts` parity: scheme/credential check, hostname blocklist,
  DNS lookup + private-address rejection (v4/v6), per-hop redirect
  re-validation (max 5), size cap (5MB), 15s timeout.
- Rakazo `web-limits.ts` parity: `clampMaxResults` (1–10, default 6) wired into
  `web_search` (`maxResults` param); `clampMaxChars` (100–50000, default 8000)
  wired into `web_fetch` (`maxChars` param, Qube keeps its 25k default).

## Browser lease
- `takeoverLeaseMs()` / `DEFAULT_TAKEOVER_LEASE_MS` (15 min, `COMPUTER_TAKEOVER_TTL_MS`
  override, env name kept for back-compat) — Rakazo `computer-control.ts` parity. `request_takeover` waits on the
  lease TTL, not the generic permission timeout, since logins/captchas take longer
  than a permission click.

## Tests
- `tests/rakazo-port.test.ts`: 20 cases (parsing incl. double-click expansion
  limit, framing, budgets, SSRF, web-limit clamps, takeover TTL, tool registry
  incl. `open_path`, parked visibility).
- Full suite: 125 pass. `tsc --noEmit` clean.

## MCP path (`lib/browser/auto-mcp/server.mjs`)
- `snapshot` tool: bounded text + ≤80 refs with `data-qube-ref` tagging,
  password masking, stale-ref rejection (mirrors `browser_snapshot`).
- `act` tool: click/fill/type by ref, max 24, never-replay guidance.

## Notes
- `evalIsolated` tries `Page.createIsolatedWorld` then falls back to the
  default world (some Chromium builds reject world creation without a frame).

## Deliberately NOT ported
- Sandbox providers (Docker/E2B/Daytona/Box), workspace checkpoint/export,
  multi-bot displays, Postgres/Graphile jobs, mobile/Electron shells.
  Qube's local managed-Chrome + workspace model replaces these.
- OS desktop control: Rakazo's desktop actions were adapted to x/y actions
  inside the managed browser window only. There is no OS screenshot, window
  control, Start-menu launcher, or calculator/text-editor automation.
