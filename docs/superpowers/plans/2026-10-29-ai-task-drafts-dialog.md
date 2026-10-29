# AI Task Drafts + New-Task Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The New task popup starts from a natural-language pill that the default model turns into a full draft, with the pill + green tick at the bottom of the review form.

**Architecture:** New pure prompt/validation module `lib/scheduler/task-draft.ts` plus `POST /api/scheduler/draft` using `createPiModelClientForRequest`; `SchedulingTab` dialog becomes a 3-state (`prompt`/`generating`/`review`) flow with a new `PromptPill`; save path and `none` plan wiring reused unchanged.

**Tech Stack:** TypeScript, `node:test` + `tsx`, Next.js route handlers, `motion/react`, Tailwind tokens already in repo.

**Depends on:** Plan 2 (`none-schedule-tasks`) for the `none` kind, null-`nextRunAt` handling, server-side heartbeat linking, and recap string. Implement after Plan 2. This plan owns ALL dialog changes for `none`: third Run button, timing hint, `canCreate`/`handleCreate`, varying `DialogDescription`, plus the prompt → generating → review flow.

---

### Task 1: Draft prompt builder + validator

**Files:**
- Create: `lib/scheduler/task-draft.ts`
- Create: `tests/task-draft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDraftPrompt, validateDraft, type TaskDraft, type DraftInput } from "@/lib/scheduler/task-draft";

describe("buildDraftPrompt", () => {
  it("includes the user prompt, current draft, date and timezone", () => {
    const current: DraftInput = { name: "Report", instructions: "Old.", scheduleKind: "interval", intervalMinutes: 1440 };
    const p = buildDraftPrompt("every morning at 6 send it", current);
    assert.match(p, /every morning at 6 send it/);
    assert.match(p, /"name": "Report"/);
    assert.match(p, /"scheduleKind": "interval"/);
    assert.match(p, /current date/i);
  });

  it("works without a current draft", () => {
    const p = buildDraftPrompt("remind me Friday", null);
    assert.match(p, /remind me Friday/);
  });
});

describe("validateDraft", () => {
  const good: TaskDraft = { name: "Report", instructions: "Send it.", scheduleKind: "interval", intervalMinutes: 1440 };

  it("accepts a good draft", () => {
    assert.deepEqual(validateDraft(good).ok, true);
  });

  it("rejects empty name/instructions", () => {
    assert.equal(validateDraft({ ...good, name: " " }).ok, false);
    assert.equal(validateDraft({ ...good, instructions: "" }).ok, false);
  });

  it("rejects unknown schedule kinds", () => {
    assert.equal(validateDraft({ ...good, scheduleKind: "yearly" }).ok, false);
  });

  it("checks timing ranges", () => {
    assert.equal(validateDraft({ ...good, hour: 25 }).ok, false);
    assert.equal(validateDraft({ ...good, minute: 60 }).ok, false);
    assert.equal(validateDraft({ ...good, weekdays: [7] }).ok, false);
    assert.equal(validateDraft({ ...good, intervalMinutes: 0 }).ok, false);
    assert.equal(validateDraft({ name: "X", instructions: "Y", scheduleKind: "once", runAt: "not-a-date" }).ok, false);
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(validateDraft({ name: "X", instructions: "Y", scheduleKind: "once", runAt: past }).ok, false);
  });

  it("trims strings and passes none through", () => {
    const r = validateDraft({ name: "  T  ", instructions: " Do. ", scheduleKind: "none" });
    assert.equal(r.ok, true);
    assert.equal((r as { draft: TaskDraft }).draft.name, "T");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/task-draft.test.ts`
Expected: FAIL with "Cannot find module '@/lib/scheduler/task-draft'".

- [ ] **Step 3: Write minimal implementation**

```ts
export type TaskDraftScheduleKind = "once" | "interval" | "none";

export interface TaskDraft {
  name: string;
  instructions: string;
  scheduleKind: TaskDraftScheduleKind;
  intervalMinutes?: number;
  runAt?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  monthDay?: number;
}

export interface DraftInput {
  name: string;
  instructions: string;
  scheduleKind: TaskDraftScheduleKind;
  intervalMinutes?: number;
  runAt?: string;
  hour?: number;
  minute?: number;
  weekdays?: number[];
  monthDay?: number;
}

const KINDS: TaskDraftScheduleKind[] = ["once", "interval", "none"];

/** System prompt for the drafting model. Pure — no I/O, no date mocking inside. */
export function buildDraftSystemPrompt(): string {
  return [
    "You turn a short task request into a scheduled-task draft.",
    'Reply with ONE JSON object only: {"name": string, "instructions": string,',
    ' "scheduleKind": "once"|"interval"|"none", "intervalMinutes"?: number, "runAt"?: string (ISO future),',
    ' "hour"?: 0-23, "minute"?: 0-59, "weekdays"?: [0-6 Sun-Sat], "monthDay"?: 1-31}.',
    "Rules: explicit timing wins; recurring language means interval or wall-clock fields;",
    "a one-off reminder with no time means scheduleKind none;",
    "ambiguous means a sensible default, never an empty schedule.",
    "Name is short (<= 60 chars); instructions tell the agent exactly what to do.",
  ].join(" ");
}

/** User message: request + current draft + current date/time context. */
export function buildDraftPrompt(prompt: string, current: DraftInput | null): string {
  const now = new Date();
  const lines = [
    `Current date/time: ${now.toISOString()} (local timezone offset ${-now.getTimezoneOffset()} minutes).`,
    `Request: ${prompt.trim()}`,
  ];
  if (current) lines.push(`Current draft (revise it per the request): ${JSON.stringify(current)}`);
  return lines.join("\n");
}

export type ValidateResult = { ok: true; draft: TaskDraft } | { ok: false; error: string };

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

/** Strict shape/range check for model output. Never throws. */
export function validateDraft(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Draft must be a JSON object." };
  const d = raw as Record<string, unknown>;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const instructions = typeof d.instructions === "string" ? d.instructions.trim() : "";
  if (!name) return { ok: false, error: "Draft needs a non-empty name." };
  if (!instructions) return { ok: false, error: "Draft needs non-empty instructions." };
  if (typeof d.scheduleKind !== "string" || !(KINDS as string[]).includes(d.scheduleKind)) {
    return { ok: false, error: "Draft needs scheduleKind once|interval|none." };
  }
  const draft: TaskDraft = { name: name.slice(0, 120), instructions, scheduleKind: d.scheduleKind as TaskDraftScheduleKind };
  if (d.intervalMinutes !== undefined) {
    if (typeof d.intervalMinutes !== "number" || !(d.intervalMinutes > 0)) return { ok: false, error: "intervalMinutes must be positive." };
    draft.intervalMinutes = d.intervalMinutes;
  }
  if (d.runAt !== undefined) {
    if (typeof d.runAt !== "string" || Number.isNaN(Date.parse(d.runAt))) return { ok: false, error: "runAt must be an ISO date." };
    if (Date.parse(d.runAt) <= Date.now()) return { ok: false, error: "runAt must be in the future." };
    draft.runAt = d.runAt;
  }
  if (d.hour !== undefined) {
    if (!isInt(d.hour) || d.hour < 0 || d.hour > 23) return { ok: false, error: "hour must be 0-23." };
    draft.hour = d.hour;
  }
  if (d.minute !== undefined) {
    if (!isInt(d.minute) || d.minute < 0 || d.minute > 59) return { ok: false, error: "minute must be 0-59." };
    draft.minute = d.minute;
  }
  if (d.weekdays !== undefined) {
    if (!Array.isArray(d.weekdays) || !d.weekdays.every((w) => isInt(w) && w >= 0 && w <= 6)) {
      return { ok: false, error: "weekdays must be 0-6." };
    }
    draft.weekdays = [...d.weekdays];
  }
  if (d.monthDay !== undefined) {
    if (!isInt(d.monthDay) || d.monthDay < 1 || d.monthDay > 31) return { ok: false, error: "monthDay must be 1-31." };
    draft.monthDay = d.monthDay;
  }
  return { ok: true, draft };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/task-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/task-draft.ts tests/task-draft.test.ts
git commit -m "feat: task draft prompt builder and validator"
```

### Task 2: `POST /api/scheduler/draft` endpoint

**Files:**
- Create: `app/api/scheduler/draft/route.ts`
- Create: `tests/task-draft-route.test.ts`

- [ ] **Step 1: Write the failing test**

The route needs `Request` (ChatGPT passthrough) and a model client; test the thin handler pieces by extracting them? Keep it simple: test that the route module exports POST and rejects bad input without a model. Because route handlers run in Next runtime, test via direct import with a stubbed model client is brittle. Instead write the route so ALL logic except the model call lives in `lib/scheduler/task-draft.ts` (done) plus a tiny `parseDraftResponse` helper — and test that helper here:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseDraftResponse } from "@/app/api/scheduler/draft/route";

describe("parseDraftResponse", () => {
  it("parses a clean JSON object", () => {
    const r = parseDraftResponse('{"name":"T","instructions":"Do.","scheduleKind":"none"}');
    assert.equal(r.ok, true);
  });

  it("strips code fences", () => {
    const r = parseDraftResponse('```json\n{"name":"T","instructions":"Do.","scheduleKind":"none"}\n```');
    assert.equal(r.ok, true);
  });

  it("fails on garbage", () => {
    assert.equal(parseDraftResponse("hello world").ok, false);
  });
});
```

Export `parseDraftResponse` from the route module (pure, no Next imports at module top that break `tsx` — keep `next/server` import but only use types at module scope; `NextResponse.json` is only called inside POST, which tests never invoke).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/task-draft-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/scheduler/draft/route'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { NextResponse } from "next/server";
import { createPiModelClientForRequest } from "@/lib/pi/model-client";
import { buildDraftPrompt, buildDraftSystemPrompt, validateDraft, type DraftInput } from "@/lib/scheduler/task-draft";

/** Extract the first {...} JSON object (models love fences/preambles) and validate it. Pure. */
export function parseDraftResponse(text: string): ReturnType<typeof validateDraft> {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The model did not return a draft." };
  try {
    return validateDraft(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return { ok: false, error: "The model did not return a draft." };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const current = (body?.current ?? null) as DraftInput | null;

    let model: ReturnType<typeof createPiModelClientForRequest>;
    try {
      model = createPiModelClientForRequest(null, req);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No model is configured. Set a default model first." },
        { status: 400 },
      );
    }

    const { streamText } = await import("ai");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const result: any = await (streamText as any)({
        model,
        system: buildDraftSystemPrompt(),
        prompt: buildDraftPrompt(prompt, current),
        maxRetries: 0,
        temperature: 0.3,
        abortSignal: controller.signal,
      });
      try { await result.consumeStream(); } catch {}
      const text = String((await result.text) ?? "");
      const parsed = parseDraftResponse(text);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 502 });
      return NextResponse.json({ draft: parsed.draft });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/task-draft-route.test.ts tests/task-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/scheduler/draft/route.ts tests/task-draft-route.test.ts
git commit -m "feat: task draft endpoint with default model"
```

### Task 3: `PromptPill` component (idle + three-dot states)

**Files:**
- Create: `components/shared/prompt-pill.tsx`

No test file: presentational component reusing the exact `DocComposer` layout/animation tokens. Verify visually + via typecheck.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpIcon } from "lucide-react";

export function PromptPill({
  placeholder = "Describe the task — timing optional…",
  busyLabel = "Drafting the task…",
  busy = false,
  onSend,
}: {
  placeholder?: string;
  busyLabel?: string;
  busy?: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  };

  return (
    <motion.div
      layout
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={
        busy
          ? "flex h-9 w-auto min-w-[68px] items-center justify-center rounded-full border border-border bg-popover/85 px-4 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-xl dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]"
          : "flex w-full items-center gap-2.5 rounded-full border border-border bg-popover/85 py-2 pr-2 pl-4 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-[border-color] focus-within:border-ring/50 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]"
      }
    >
      {busy ? (
        <span className="typing-dots text-muted-foreground" aria-live="polite" aria-label={busyLabel}>
          <span />
          <span />
          <span />
        </span>
      ) : (
        <>
          <textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={placeholder}
            rows={1}
            aria-label={placeholder}
            className="max-h-28 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <button
            onClick={send}
            disabled={!value.trim() || busy}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" strokeWidth={2.5} />
          </button>
        </>
      )}
    </motion.div>
  );
}
```

Remove the unused `AnimatePresence` import — change the import line to:

```tsx
import { motion } from "motion/react";
```

- [ ] **Step 2: Typecheck the new component**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors naming `prompt-pill`.

- [ ] **Step 3: Commit**

```bash
git add components/shared/prompt-pill.tsx
git commit -m "feat: prompt pill with idle and three-dot states"
```

### Task 4: SchedulingTab three-state dialog flow

**Files:**
- Modify: `components/shared/scheduling-tab.tsx` (create dialog section)

- [ ] **Step 1: Add dialog flow state**

Add next to the existing create-form state (lines 64-71):

```tsx
// AI draft flow: prompt -> generating -> review (prefilled form).
const [draftStage, setDraftStage] = useState<"prompt" | "generating" | "review">("prompt");
const [draftError, setDraftError] = useState<string | null>(null);
const [drafting, setDrafting] = useState(false);
```

Update `resetCreateForm` to also set `setDraftStage("prompt"); setDraftError(null); setDrafting(false);`.

Build a `DraftInput` from the current form for edit passes (place near `handleCreate`):

```tsx
function currentDraftInput() {
  const base = { name: createName, instructions: createInstructions, scheduleKind: createKind };
  return createKind === "once"
    ? { ...base, runAt: createRunAt ? new Date(createRunAt).toISOString() : undefined }
    : createKind === "none"
      ? { ...base }
      : { ...base, intervalMinutes: createInterval, ...(createClock ?? {}) };
}
```

Add the draft request helper:

```tsx
async function runDraft(prompt: string, current: unknown) {
  setDrafting(true);
  setDraftError(null);
  setDraftStage("generating");
  try {
    const res = await fetch("/api/scheduler/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, current }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.draft) throw new Error(data?.error || "Could not draft the task.");
    applyDraft(data.draft as DraftFromServer);
    setDraftStage("review");
  } catch (e) {
    setDraftError(e instanceof Error ? e.message : String(e));
    setDraftStage("prompt");
  } finally {
    setDrafting(false);
  }
}

type DraftFromServer = { name: string; instructions: string; scheduleKind: "once" | "interval" | "none"; intervalMinutes?: number; runAt?: string; hour?: number; minute?: number; weekdays?: number[]; monthDay?: number };

function applyDraft(d: DraftFromServer) {
  setCreateName(d.name);
  setCreateInstructions(d.instructions);
  setCreateKind(d.scheduleKind === "none" ? "none" : d.scheduleKind);
  if (typeof d.intervalMinutes === "number") setCreateInterval(d.intervalMinutes);
  if (d.hour !== undefined || d.minute !== undefined || d.weekdays !== undefined || d.monthDay !== undefined) {
    setCreateClock({
      ...(d.hour !== undefined ? { hour: d.hour } : {}),
      ...(d.minute !== undefined ? { minute: d.minute } : {}),
      ...(d.weekdays !== undefined ? { weekdays: d.weekdays } : {}),
      ...(d.monthDay !== undefined ? { monthDay: d.monthDay } : {}),
    });
  } else {
    setCreateClock(null);
  }
  if (d.runAt) {
    const t = new Date(d.runAt);
    if (!Number.isNaN(t.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      setCreateRunAt(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`);
    }
  }
}
```

Widen `createKind` state to `"once" | "interval" | "none"` (this plan owns it — Plan 2 only widens the store-shape interface), and add the third Run button + timing UI:

```tsx
const [createKind, setCreateKind] = useState<"once" | "interval" | "none">("once");
```

- Run segmented control: `{["once", "interval", "none"].map(...)}` with labels Once / Recurring / None (reuse the existing button classes).
- Timing area: `createKind === "once"` → Run-at picker (today); `"interval"` → interval presets (today); `"none"` → static hint "No schedule — sits in To do until run from the board or picked up by the next heartbeat."
- `canCreate`: name + instructions required; the `runAt`-future check applies only when `createKind === "once"`; `none` needs nothing else.
- `handleCreate`: for `none` send `{ action: "create", name, instructions, scheduleKind: "none" }` (server links the heartbeat reminder — Plan 2, Task 6).
- Wall-clock drafts: the endpoint can return `hour`/`minute`/`weekdays`/`monthDay`, which the current form cannot display. Add `createClock` state (`{ hour?: number; minute?: number; weekdays?: number[]; monthDay?: number } | null`, default `null`), set it in `applyDraft` when those fields are present (and clear it when the user switches Run kind manually), and include it in `currentDraftInput` and the create body.

- [ ] **Step 2: Swap the dialog body for the three stages**

In the `DialogContent`, keep `DialogHeader` but make the description vary:
Once/Recurring keep today's copy; when `createKind === "none"` show:
"No schedule: the card sits in To do until you run it from the board, and the
next heartbeat picks it up with full task powers. It lands in Done when
finished."

Below the header:

- `draftStage === "prompt"`: render only `<PromptPill busy={false} onSend={(t) => runDraft(t, null)} />` plus `draftError` text when set. Hide the manual fields and Create button entirely.
- `draftStage === "generating"`: render only `<PromptPill busy onSend={() => {}} />`.
- `draftStage === "review"`: render today's full form (name/instructions/Once-Recurring-None/timing fields) prefilled from state, then at the bottom `<PromptPill busy={false} onSend={(t) => runDraft(t, currentDraftInput())} />` with the green tick save button to its right:

```tsx
<div className="flex items-center gap-2">
  <div className="min-w-0 flex-1">
    <PromptPill busy={false} onSend={(t) => runDraft(t, currentDraftInput())} placeholder="Describe an edit…" />
  </div>
  <button
    onClick={handleCreate}
    disabled={!canCreate || creating}
    aria-label="Save task"
    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
  >
    {creating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />}
  </button>
</div>
```

Add `Check` to the `lucide-react` import and import `PromptPill`. While generating (`drafting`), edits are disabled because the pill unmounts in the `generating` stage. `handleCreate` must spread `createClock` into the create body for `interval` tasks so wall-clock drafts survive the save (for `once`, send `runAt` as today; for `none`, name + instructions + scheduleKind only). Fallback: if the draft endpoint fails with no usable default model, `runDraft` sets `draftError` and returns to `prompt` stage — and a "Fill in manually instead" text button sets `setDraftStage("review")` so the user gets today's fully-manual form untouched. The original bottom "Create task" `Button` moves into the review stage only.

Manual fallback text button (prompt stage, below the pill):

```tsx
<button type="button" onClick={() => setDraftStage("review")} className="text-xs font-medium text-muted-foreground hover:text-foreground">
  Fill in manually instead
</button>
```

- [ ] **Step 3: Typecheck + run related suites**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors naming `scheduling-tab` or `prompt-pill`.

Run: `npx tsx --test tests/task-draft.test.ts tests/task-draft-route.test.ts tests/none-schedule.test.ts tests/board-status.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/shared/scheduling-tab.tsx
git commit -m "feat: AI-drafted new-task dialog with prompt pill and save tick"
```

## Self-review note (plan author)

Spec section 5 coverage: endpoint (Task 2), prompt/validation (Task 1), three states + same morph animation via layout pill (Tasks 3-4), edits replace whole draft (runDraft sends current + prompt), hand-edit preserved (form fields stay live), green tick = save only (tick calls `handleCreate`), no-model fallback = manual form (text button), no auto-save (endpoint has no persistence). Depends on Plan 2 for the `none` kind, server-side link, and recap string. `createKind` union widening (`"once" | "interval" | "none"`) happens here in dialog Task 4; Plan 2 only widens the UI-local store interface. No placeholders: all code inline. `parseDraftResponse` export is used by both route and test.
   ...
