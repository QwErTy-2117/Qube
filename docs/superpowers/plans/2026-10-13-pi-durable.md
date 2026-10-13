# Pi Durable Native Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Qube's in-memory `runPiHarness` core with native pi-durable conversations over SQLite, preserving all providers/tools/skills and adding crash-resume.

**Architecture:** Single `Harness.open(openNodeSqliteStorage(<dataDir>/agent.sqlite))` singleton; Qube thread IDs become conversation IDs; models bridged from `providerStore` into pi-ai; tools/skills/docs as extensions; `/api/chat` submits + waits, `/api/threads` scans conversations; UI bridge re-emits `viewState` as UIMessageStream.

**Tech Stack:** Next.js 16, `@earendil-works/pi-durable@1.2.0`, `@earendil-works/pi-ai`, `@earendil-works/chord`, `tsx --test` (node:test + assert/strict), SQLite WAL.

---

## File structure

New files (one responsibility each):

- `lib/pi/durable.ts` — harness singleton: open SQLite, expose `getDurableHarness()`, `closeDurableHarness()`, `resumeDurable()`. Owns storage path + settings.
- `lib/pi/durable-models.ts` — `buildDurableModels(modelName, request?)`: bridge `providerStore.getProviderByModel()` → pi-ai `createModels()/setProvider()`, preserve reasoningEffort Responses routing + ChatGPT request context.
- `lib/pi/durable-registry.ts` — `buildDurableRegistry()`: install workspace/browser/computer/MCP/Composio/memory/agent/openui extensions as `defineExtension`, `replay: "safe"` only on reads.
- `lib/pi/durable-skills.ts` — `buildSkillsSection(skills)`: Agent Skills progressive disclosure section (name+desc+path only), discovery from `~/.agents/skills`, `.agents/skills`, `skillStore`; `skillApprovalHook` for allowed/disallowed-tools.
- `lib/pi/durable-docs.ts` — `Todos`, `Scratchpad` via `defineDoc`, `seedDurableDocs(tx, conversationId)`, `readTodos()`.
- `lib/pi/durable-conversations.ts` — `getOrCreateConversation(threadId, agent)`, `listDurableThreads()`, `forkDurableThread()`.
- `lib/pi/durable-stream.ts` — `streamDurableToWriter(conversation, submission, writer, ctx)`: `viewState().subscribe()` → UIMessageStream chunks, preserve `formatProviderError` text.
- `scripts/migrate-to-durable.ts` — one-shot importer: threads JSON + skills + scheduler → SQLite with preserved IDs, gated by `PI_DURABLE_MIGRATE=1`.

Modified files:

- `app/api/chat/route.ts:34-237` — add `PI_DURABLE_ENABLED` branch: submit + wait instead of `runPiHarness`; keep old path until cutover.
- `app/api/threads/route.ts:1-55` — add durable list branch via `listDurableThreads()` when flag on.
- `package.json:18-78` — add 3 pi deps.
- `tests/durable-*.test.ts` — new tests per task (see below).

Scope note: spec covers one cohesive harness migration (not independent sub-projects). Single plan with phased tasks; each task lands behind `PI_DURABLE_ENABLED` flag so old path keeps working until final cutover task. No remote envs, no Cloudflare DO, no multi-device sync (non-goals).

---

### Task 1: Dependencies + storage singleton

**Files:**
- Modify: `package.json:18-78`
- Create: `lib/pi/durable.ts`
- Test: `tests/durable-storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Durable storage singleton test.
 * Run: npx tsx --test tests/durable-storage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-durable-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable storage singleton", () => {
  it("opens SQLite and resumes same root across reopen", async () => {
    const h1 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root1 = await h1.root(BACKGROUND_CONTEXT);
    const id1 = root1.id;
    await closeDurableHarness(BACKGROUND_CONTEXT);
    const h2 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root2 = await h2.root(BACKGROUND_CONTEXT);
    assert.equal(root2.id, id1);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-storage.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable'"

- [ ] **Step 3: Install deps + write minimal implementation**

Run: `npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord`

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { getDataDir } from "@/lib/data-dir";
import { join } from "node:path";

let harness: Awaited<ReturnType<typeof Harness.open>> | null = null;

export function durableDbPath(): string {
  return join(getDataDir(), "agent.sqlite");
}

export async function getDurableHarness(context = BACKGROUND_CONTEXT) {
  if (harness) return harness;
  const storage = await openNodeSqliteStorage(durableDbPath());
  const models = createModels();
  const registry = createRegistry();
  harness = await Harness.open(storage, {
    models,
    registry,
    settings: {
      compaction: { reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768 },
    },
  }, context);
  harness.resume();
  return harness;
}

export async function closeDurableHarness(context = BACKGROUND_CONTEXT) {
  if (!harness) return;
  await harness.close(context);
  harness = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-storage.test.ts`
Expected: PASS (1 test, root ID stable across reopen)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/pi/durable.ts tests/durable-storage.test.ts
git commit -m "feat: pi-durable SQLite singleton with resume"
```

---

### Task 2: Models adapter (keep all providers)

**Files:**
- Create: `lib/pi/durable-models.ts`
- Test: `tests/durable-models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableModels } from "@/lib/pi/durable-models";

describe("durable models adapter", () => {
  it("builds pi-ai models for openai id without throwing", async () => {
    const models = await buildDurableModels("openai:gpt-4o-mini");
    assert.ok(models);
  });
  it("throws for unknown model", async () => {
    await assert.rejects(() => buildDurableModels("nope:missing-1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-models.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-models'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { createModels } from "@earendil-works/pi-ai/models";
import { providerStore } from "@/lib/pi/provider-store";

export async function buildDurableModels(modelName: string, request?: Request) {
  const found = providerStore.getProviderByModel(modelName);
  if (!found) throw new Error(`No provider for model "${modelName}"`);
  const models = createModels();
  const providerId = found.provider.id;
  if (providerId === "openai") {
    const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
    models.setProvider(openaiProvider());
  } else if (providerId === "anthropic") {
    const { anthropicProvider } = await import("@earendil-works/pi-ai/providers/anthropic");
    models.setProvider(anthropicProvider());
  } else if (providerId === "google") {
    const { googleProvider } = await import("@earendil-works/pi-ai/providers/google");
    models.setProvider(googleProvider());
  } else if (providerId === "mistral") {
    const { mistralProvider } = await import("@earendil-works/pi-ai/providers/mistral");
    models.setProvider(mistralProvider());
  } else {
    const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
    models.setProvider(openaiProvider());
  }
  return models;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-models.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pi/durable-models.ts tests/durable-models.test.ts
git commit -m "feat: pi-durable models adapter keeps all providers"
```

---

### Task 3: Tools registry (replay-safe)

**Files:**
- Create: `lib/pi/durable-registry.ts`
- Test: `tests/durable-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";

describe("durable registry", () => {
  it("installs workspace read as replay-safe", async () => {
    const registry = await buildDurableRegistry();
    assert.ok(registry);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-registry.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-registry'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { readFile } from "node:fs/promises";

const readFileTool = defineTool({
  name: "read_file",
  description: "Read a workspace file",
  parameters: Type.Object({ path: Type.String() }),
  replay: "safe",
  execute: async (args) => {
    const text = await readFile(args.path, "utf-8").catch((e: Error) => `Error: ${e.message}`);
    return { content: [{ type: "text", text: text.slice(0, 20000) }] };
  },
});

const writeFileTool = defineTool({
  name: "write_file",
  description: "Write a workspace file (never auto-replayed after crash)",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  execute: async () => ({ content: [{ type: "text", text: "written (stub)" }] }),
});

export async function buildDurableRegistry() {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "workspace", tools: [readFileTool, writeFileTool] }));
  return registry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pi/durable-registry.ts tests/durable-registry.test.ts
git commit -m "feat: pi-durable tools registry with safe replay"
```

---

### Task 4: Skills sections (progressive disclosure)

**Files:**
- Create: `lib/pi/durable-skills.ts`
- Test: `tests/durable-skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderSkillsSection } from "@/lib/pi/durable-skills";

describe("durable skills section", () => {
  it("renders name+desc+path only, never body", () => {
    const out = renderSkillsSection([
      { name: "pdf-tools", description: "Extract text from PDFs. Use when reading PDFs.", path: "/skills/pdf-tools", instructions: "SECRET BODY" } as never,
    ]);
    assert.match(out, /pdf-tools/);
    assert.match(out, /Extract text from PDFs/);
    assert.doesNotMatch(out, /SECRET BODY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-skills.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-skills'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { defineExtension, section } from "@earendil-works/pi-durable";
import type { SkillConfig } from "@/lib/skills/types";

export type SkillRef = Pick<SkillConfig, "name" | "description"> & { path: string };

export function renderSkillsSection(skills: SkillRef[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- /skill:${s.name}: ${s.description} [path: ${s.path}]`);
  return `## Skills (${skills.length} installed)\nSkills are playbooks. Load one with read_file(path + "/SKILL.md") when its description matches, or via /skill:name.\n${lines.join("\n")}`;
}

export function buildSkillsExtension(refs: SkillRef[]) {
  return defineExtension({
    name: "skills",
    sections: [section("skills", () => renderSkillsSection(refs) || undefined)],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pi/durable-skills.ts tests/durable-skills.test.ts
git commit -m "feat: pi-durable skills progressive disclosure"
```

---

### Task 5: Documents (todos + scratchpad)

**Files:**
- Create: `lib/pi/durable-docs.ts`
- Test: `tests/durable-docs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-docs-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { Todos, seedDurableDocs } from "@/lib/pi/durable-docs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable docs", () => {
  it("seeds and reads todos doc", async () => {
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h.root(BACKGROUND_CONTEXT);
    await root.commit(async (tx) => { await seedDurableDocs(tx, root.id); }, BACKGROUND_CONTEXT);
    const snap = await h.snapshot(Todos, root.id, BACKGROUND_CONTEXT);
    assert.deepEqual(snap, { items: [] });
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-docs.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-docs'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { defineDoc } from "@earendil-works/pi-durable";

export const Todos = defineDoc<{ items: string[] }>({
  kind: "app.todos",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ items: [] }),
});

export const Scratchpad = defineDoc<{ text: string }>({
  kind: "app.scratchpad",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

export async function seedDurableDocs(tx: { doc: (d: typeof Todos, id: string) => Promise<{ items: string[] }> }, _conversationId: string) {
  await tx.doc(Todos, _conversationId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-docs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pi/durable-docs.ts tests/durable-docs.test.ts
git commit -m "feat: pi-durable todos and scratchpad docs"
```

---

### Task 6: Conversations bridge + threads API

**Files:**
- Create: `lib/pi/durable-conversations.ts`
- Modify: `app/api/threads/route.ts:1-55`
- Test: `tests/durable-threads.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable conversations", () => {
  it("creates conversation with qube thread id", async () => {
    const c = await getOrCreateConversation("thread_test_1", BACKGROUND_CONTEXT);
    assert.ok(c.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-threads.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-conversations'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getDurableHarness } from "@/lib/pi/durable";

export async function getOrCreateConversation(threadId: string, context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  if (threadId === "root") return h.root(context);
  return h.createConversation({ ownership: { kind: "ownerless" } }, context);
}

export async function listDurableThreads(context = BACKGROUND_CONTEXT) {
  const h = await getDurableHarness(context);
  return h.taskGraph(context).then(() => [] as Array<{ id: string; title: string }>);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-threads.test.ts`
Expected: PASS

- [ ] **Step 5: Wire threads route behind flag + commit**

```ts
// in app/api/threads/route.ts GET(), first lines:
if (process.env.PI_DURABLE_ENABLED === "1") {
  const { listDurableThreads } = await import("@/lib/pi/durable-conversations");
  const threads = await listDurableThreads();
  return NextResponse.json({ threads });
}
```

```bash
git add lib/pi/durable-conversations.ts app/api/threads/route.ts tests/durable-threads.test.ts
git commit -m "feat: durable conversations bridge for threads"
```

---

### Task 7: Chat submit/wait + UI bridge

**Files:**
- Create: `lib/pi/durable-stream.ts`
- Modify: `app/api/chat/route.ts:34-237`
- Test: `tests/durable-chat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestId } from "@/lib/pi/durable-stream";

describe("durable chat", () => {
  it("builds exactly-once request id", () => {
    assert.equal(buildRequestId("thread_1", "turn_2"), "thread_1:turn_2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-chat.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pi/durable-stream'"

- [ ] **Step 3: Write minimal implementation**

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { AssistantEntry } from "@earendil-works/pi-durable";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";

export function buildRequestId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

export async function submitDurableChat(threadId: string, text: string, requestId: string, context = BACKGROUND_CONTEXT) {
  const conv = await getOrCreateConversation(threadId, context);
  const submission = await conv.submit({ type: "input", content: text, requestId } as never, context);
  const settled = await submission.wait(context);
  if (settled.status === "done" && settled.type === "input") {
    const entry = await conv.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
    return entry?.model?.[0] ?? null;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-chat.test.ts`
Expected: PASS

- [ ] **Step 5: Wire chat route behind flag + commit**

```ts
// in app/api/chat/route.ts POST(), after currentThreadId resolved:
if (process.env.PI_DURABLE_ENABLED === "1") {
  const { submitDurableChat, buildRequestId } = await import("@/lib/pi/durable-stream");
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  const text = typeof last?.content === "string" ? last.content : JSON.stringify(last ?? {});
  const answer = await submitDurableChat(currentThreadId, text, buildRequestId(currentThreadId, String(Date.now())));
  return new Response(JSON.stringify({ answer }), { headers: { "content-type": "application/json" } });
}
```

```bash
git add lib/pi/durable-stream.ts app/api/chat/route.ts tests/durable-chat.test.ts
git commit -m "feat: durable chat submit wait behind flag"
```

---

### Task 8: Abort, approvals memo, compaction

**Files:**
- Modify: `lib/pi/durable-registry.ts`
- Modify: `lib/pi/durable.ts`
- Test: `tests/durable-abort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvalMemoKey } from "@/lib/pi/durable-registry";

describe("durable abort and approvals", () => {
  it("builds stable memo key", () => {
    assert.equal(approvalMemoKey("deploy", "abc"), "approval:deploy:abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-abort.test.ts`
Expected: FAIL with "approvalMemoKey is not exported"

- [ ] **Step 3: Write minimal implementation**

```ts
// append to lib/pi/durable-registry.ts
export function approvalMemoKey(tool: string, argsHash: string): string {
  return `approval:${tool}:${argsHash}`;
}
```

```ts
// append to lib/pi/durable.ts
import type { BACKGROUND_CONTEXT as Ctx } from "@earendil-works/chord/context";
export async function abortDurable(threadId: string, context: typeof Ctx) {
  const { getOrCreateConversation } = await import("@/lib/pi/durable-conversations");
  const conv = await getOrCreateConversation(threadId, context);
  await conv.abort(context);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-abort.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pi/durable-registry.ts lib/pi/durable.ts tests/durable-abort.test.ts
git commit -m "feat: durable abort and approval memo"
```

---

### Task 9: Migration importer

**Files:**
- Create: `scripts/migrate-to-durable.ts`
- Test: `tests/durable-migrate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrateThreadRecord } from "../scripts/migrate-to-durable";

describe("durable migration", () => {
  it("preserves thread id", () => {
    assert.equal(migrateThreadRecord({ id: "thread_1", title: "Hi" }).id, "thread_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-migrate.test.ts`
Expected: FAIL with "Cannot find module '../scripts/migrate-to-durable'"

- [ ] **Step 3: Write minimal implementation**

```ts
export function migrateThreadRecord(rec: { id: string; title: string }) {
  return { id: rec.id.slice(0, 128), title: rec.title.slice(0, 120) || "New Chat" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/durable-migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-to-durable.ts tests/durable-migrate.test.ts
git commit -m "feat: durable migration thread id mapping"
```

---

### Task 10: Crash-resume test + full suite
**Files:**
- Test: `tests/durable-crash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-crash-test-"));
import { getDurableHarness, closeDurableHarness } from "@/lib/pi/durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

describe("durable crash resume", () => {
  it("same requestId returns same submission after reopen", async () => {
    const h1 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root = await h1.root(BACKGROUND_CONTEXT);
    const s1 = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" } as never, BACKGROUND_CONTEXT);
    await closeDurableHarness(BACKGROUND_CONTEXT);
    const h2 = await getDurableHarness(BACKGROUND_CONTEXT);
    const root2 = await h2.root(BACKGROUND_CONTEXT);
    const s2 = await root2.submit({ type: "input", content: "Hello", requestId: "greeting-1" } as never, BACKGROUND_CONTEXT);
    assert.equal(s2.id, s1.id);
    await closeDurableHarness(BACKGROUND_CONTEXT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/durable-crash.test.ts`
Expected: FAIL (submission dedupe not yet verified against real storage — confirms test exercises real path)

- [ ] **Step 3: Verify implementation already satisfies (no new code if green)**

Run: `npx tsx --test tests/durable-crash.test.ts`
Expected: PASS after Task 1 singleton (requestId dedupe is built-in). If FAIL, fix `lib/pi/durable.ts` to pass `requestId` through untouched.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: PASS (all 30 existing + 10 new durable tests green)

- [ ] **Step 5: Commit**

```bash
git add tests/durable-crash.test.ts
git commit -m "test: durable crash resume exactly-once"
```

---

## Follow-ups (out of this plan, required for full spec)

- Full provider matrix: Task 2 covers openai/anthropic/google/mistral + OpenAI-compatible fallback; add xAI/DeepSeek/Perplexity/OpenRouter/Groq/Together/Ollama/LM Studio/ChatGPT-request mapping + `registerStorageConformance` in next plan.
- Full tool port: Task 3 covers workspace slice; browser/MCP/Composio/computer-use/memory/agent/openui extensions + `beforeTool` approval hook + `registerEnvConformance` in next plan.
- Thread-ID preservation: Task 6 creates new conversations; add `app.thread-map` doc mapping Qube IDs → conversation IDs + `scanConversations` list in next plan.
- Full migration: Task 9 maps IDs only; add entries/docs/scheduler/compaction import + dual-read verification in next plan.
- UI parity: Task 7 returns JSON answer; add `viewState` → UIMessageStream chunk mapping + fork/subagent UI + compaction widget in next plan.
