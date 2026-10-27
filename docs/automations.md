# Automations

Qube can do things without you asking twice. There are two complementary
mechanisms: **scheduled tasks** for exact-timing work, and a periodic
**check-in** that quietly watches for things worth telling you. Both run
inside Qube itself, so they only execute while the app is open and running.

## Scheduled tasks

A scheduled task runs your instructions on a recurring schedule or once at a
future time. Create one by simply asking — *“every weekday at 8, summarize my
unread Gmail”*, *“remind me to submit expenses on the 25th”*, *“check this
page every hour and tell me if the price drops”* — or manage them manually in
**Settings → Scheduling**.

### Supported schedules

- **Intervals** — every N minutes (the UI offers hourly, daily, weekly and
  monthly presets).
- **Daily at a time** — choose an hour and minute.
- **Weekly patterns** — choose weekdays (for example every Friday).
- **Monthly** — a given day of the month.
- **One-shot** — run once at a future date and time.

Qube only creates a schedule when your request clearly implies one (“every…”,
“remind me…”, “keep an eye…”, “tell me when…”, “monitor…”). A one-off
question like “what does this cost right now?” is answered immediately rather
than turned into a task.

### Task permissions

Each task carries least-privilege switches: shell commands, destructive
commands, files outside the workspace, and web access. A task can only do what
its permissions allow — there is no interactive prompt to fall back on in the
background, so anything not granted is simply refused.

A user-created task **can** perform the sends or creates its instructions
explicitly request (creating the task is your authorization). The automatic
check-in, below, cannot.

### Results and logs

Every run is recorded in an execution log with status, duration and output.
Successful results become an **announcement** that Qube weaves into your next
conversation — it mentions each finished task exactly once, even if you only
open the chat to say hi. You can also run any task immediately (“trigger now”)
from the scheduling screen, which shows tasks as a To do / In progress / Done
board.

## The periodic check-in (heartbeat)

The check-in is a lightweight background inspection, every 30 minutes by
default, that looks for things you would want to know next time you talk. It
operates in three lanes:

1. **Monitor** — read-only checks of the workspace and connected apps (mail,
   calendar, Slack, GitHub) for fresh items.
2. **Prepare** — reversible in-workspace prep it's clearly allowed to do:
   compile a pending document, tidy a folder, build a comparison table, and
   save a note with the file path for your next chat.
3. **Hold** — sending, posting, deleting or purchasing never happens
   headless. Those are drafted and presented for your approval in the next
   conversation.

When nothing has changed, the check-in stays completely silent (no LLM call,
no notification) and simply records a quiet tick. You can change its interval,
rewrite its instructions, or disable it in **Settings → Scheduling** or by
asking Qube directly. It cannot be deleted, only switched off.

## Important limitation: Qube must be running

There is no cloud service behind automations — the scheduler lives in the
Qube process and ticks once a minute. If the app is closed, tasks don't run;
when it reopens, overdue tasks are detected and run once (deduplicated, never
bursted). For reliable daily schedules, enable **Settings → Advanced →
Startup & Background → Run on start** and **Keep server running** so Qube and
its local server stay active.

Background runs are also more constrained than an interactive chat: roughly
12 steps for check-in runs and 20 for scheduled tasks (with a few continuation
rounds), versus the fuller loop you get in a live conversation.

## Example requests

- “Every Friday at 5 pm, draft a weekly update from my recent docs and Git activity.”
- “Tell me when the price on this page drops below €800 — only message me if it actually changed.”
- “Remind me next Tuesday at 9 to call the dentist.”
- “Check my inbox every morning and prepare drafts for anything that needs a reply.”
- “What could you take off my plate?” — Qube reads memory, past chats and
  connected apps, then proposes a few concrete automations to choose from.

Proactive suggestions are conservative: each suggestion is surfaced at most
once, and if you ignore or reject one, Qube drops it rather than nagging.

## Related reading

- [Connected apps](./connectors.md) — approval rules for background connector actions
- [Permissions and privacy](./permissions-privacy.md) — what background runs can and cannot touch
