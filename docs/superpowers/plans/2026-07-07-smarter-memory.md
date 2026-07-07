# Smarter & More Selective Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memory extraction deductive (infer implicit facts) and more selective (dedup at source, confidence scoring, relevance decay).

**Architecture:** Add `confidence` field to schema, rewrite extraction prompt to infer + dedup in one LLM call, apply age-based decay when reading memories.

**Tech Stack:** TypeScript, AI SDK (`generateText`), JSON file storage.

---

### Task 1: Memory Store — Add `confidence` + Relevance Decay

**Files:**
- Modify: `lib/memory/memory-store.ts`

- [ ] **Step 1: Add `confidence` to `MemoryEntry` type and update default store version**

```typescript
export type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  relevance: number;
  confidence: number;   // NEW: 0.0-1.0, how sure we are about this fact
};

type MemoryStore = {
  entries: MemoryEntry[];
  version: number;
};

function defaultStore(): MemoryStore {
  return { entries: [], version: 3 };   // Bump from 2 to 3
}
```

- [ ] **Step 2: Update `migrateEntry` to handle v2→v3 migration (default `confidence = relevance`)**

```typescript
function migrateEntry(e: Record<string, unknown>): MemoryEntry {
  return {
    id: String(e.id ?? `mem_${Date.now()}`),
    category: String(e.category ?? "general"),
    content: String(e.content ?? ""),
    createdAt: Number(e.createdAt ?? Date.now()),
    updatedAt: Number(e.updatedAt ?? Date.now()),
    relevance: e.relevance !== undefined ? Number(e.relevance) : e.confidence !== undefined ? Number(e.confidence) : 0.5,
    confidence: e.confidence !== undefined ? Number(e.confidence) : Number(e.relevance ?? 0.5),
  };
}
```

- [ ] **Step 3: Update `readStore` and `replaceAllEntries` to use version 3**

In `readStore()`, change `return { entries, version: 2 }` to `return { entries, version: 3 }`.

In `replaceAllEntries()`, change `await writeStore({ entries, version: 2 })` to `await writeStore({ entries, version: 3 })`.

- [ ] **Step 4: Update `addMemoryEntry` and `updateMemoryEntry` to accept `confidence`**

```typescript
export async function addMemoryEntry(
  category: string,
  content: string,
  relevance = 0.5,
  confidence?: number,   // NEW
): Promise<MemoryEntry> {
  const store = await readStore();
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    relevance,
    confidence: confidence ?? relevance,
  };
  store.entries.push(entry);
  await writeStore(store);
  return entry;
}

export async function updateMemoryEntry(
  id: string,
  updates: Partial<Pick<MemoryEntry, "content" | "category" | "relevance" | "confidence">>,
): Promise<boolean> {
  const store = await readStore();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return false;
  if (updates.content !== undefined) entry.content = updates.content;
  if (updates.category !== undefined) entry.category = updates.category;
  if (updates.relevance !== undefined) entry.relevance = updates.relevance;
  if (updates.confidence !== undefined) entry.confidence = updates.confidence;
  entry.updatedAt = Date.now();
  await writeStore(store);
  return true;
}
```

- [ ] **Step 5: Apply relevance decay in `getRelevantContext()`**

```typescript
export async function getRelevantContext(): Promise<string> {
  const store = await readStore();
  if (store.entries.length === 0) return "";
  const now = Date.now();
  const decayFactor = 0.95; // per day
  const relevant = store.entries
    .map((e) => {
      const ageInDays = (now - e.createdAt) / (1000 * 60 * 60 * 24);
      const adjustedRelevance = e.relevance * Math.pow(decayFactor, ageInDays);
      return { ...e, adjustedRelevance };
    })
    .filter((e) => e.adjustedRelevance >= 0.4)
    .sort((a, b) => b.adjustedRelevance - a.adjustedRelevance);
  if (relevant.length === 0) return "";
  const lines = relevant.map((e) => `- ${e.category}: ${e.content}`);
  return lines.join("\n");
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 2: Extraction Agent — Deductive Prompt + Combined Dedup

**Files:**
- Modify: `lib/agent/memory-agent.ts`

- [ ] **Step 1: Update `extractAndStoreMemories` to load existing entries, rewrite prompt**

Replace the function body with:

```typescript
export async function extractAndStoreMemories(
  transcript: string,
): Promise<void> {
  if (!transcript || transcript.length < 10) return;

  // Load existing entries for dedup context (up to 50 most relevant)
  const existingEntries = await getMemoryEntries();
  const sortedExisting = existingEntries
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 50);

  const existingContext =
    sortedExisting.length > 0
      ? `\n\nExisting memories (check these to avoid duplicates — merge instead of creating new facts):\n${sortedExisting.map((e) => `[${e.id}] ${e.category} (relevance:${e.relevance}, confidence:${e.confidence}): ${e.content}`).join("\n")}`
      : "";

  const prompt = `Read the following conversation transcript and extract important facts worth remembering long-term. Be deductive: infer implicit information from conversation patterns, not just explicit statements.

CRITICAL: Always extract the user's name, location, job, and any personal identifiers mentioned.

What to extract:
- Deduced personal context (name, location, job, experience level, goals, inferred interests) — category: personal
- Technology preferences, coding style, communication style — category: preference
- Project details, architecture decisions — category: project
- Recurring patterns or requests — category: pattern
- Technologies used or discussed — category: technology
- Key decisions made — category: decision

What to SKIP:
- Conversation-specific meta (e.g., "user asked about X", "user wanted help with Y")
- Facts that are already covered by existing memories (check the list below)
- Trivial or one-off details unlikely to matter in future sessions

For each fact, assign:
1. A category from: preference, project, personal, pattern, technology, decision
2. A relevance score (0.0-1.0) indicating how useful this will be in FUTURE sessions:
   - 1.0 = critical, always-relevant (user's name, core project architecture)
   - 0.7 = important, frequently useful (technology preferences)
   - 0.5 = somewhat useful context (minor preferences)
   - 0.2 = low relevance, may not be worth remembering
3. A confidence score (0.0-1.0) indicating how certain you are:
   - 1.0 = explicitly stated by the user
   - 0.8 = strongly implied from multiple statements
   - 0.6 = inferred from a single statement
   - 0.4 = weak inference from context
   - 0.2 = guess

Output format: one fact per line.
- New fact: category||content||relevance||confidence
- Merge into existing fact: merge:<id>||category||content||relevance||confidence
- Skip a fact (already covered, not worth saving): skip

Examples:
preference||The user prefers TypeScript over JavaScript||0.8||1.0
merge:mem_1234_abcd||preference||The user prefers dark themes and uses VS Code||0.7||0.9
personal||The user is a senior frontend developer with 5+ years of experience||0.9||0.8
personal||The user's name is Luca||1.0||1.0
skip

Conversation:
${transcript.slice(0, 10000)}${existingContext}`;

  try {
    const result = await generateText({
      model: cerebras.chat(resolveCerebrasModel(MEMORY_MODEL)),
      prompt,
      temperature: 0.3,
    });

    const lines = result.text.trim().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "skip") continue;

      const mergeMatch = trimmed.match(/^merge:(\S+?)\|\|/);
      if (mergeMatch) {
        const parts = trimmed.slice(mergeMatch[0].length - mergeMatch[1].length - 2).split("||");
        const mergeId = mergeMatch[1];
        if (parts.length < 2) continue;
        const category = parts[0].trim().toLowerCase();
        const content = parts[1].trim();
        const relevance = parts[2] ? Math.max(0, Math.min(1, parseFloat(parts[2]) || 0.5)) : 0.5;
        const confidence = parts[3] ? Math.max(0, Math.min(1, parseFloat(parts[3]) || relevance)) : relevance;
        if (category && content && content.length > 40) {
          const existing = existingEntries.find((e) => e.id === mergeId);
          if (existing) {
            await updateMemoryEntry(mergeId, {
              category,
              content,
              relevance: Math.max(existing.relevance, relevance),
              confidence: Math.max(existing.confidence, confidence),
            });
          } else {
            await addMemoryEntry(category, content, relevance, confidence);
          }
        }
        continue;
      }

      const parts = trimmed.split("||");
      if (parts.length < 2) continue;
      const category = parts[0].trim().toLowerCase();
      const content = parts[1].trim();
      const relevance = parts[2] ? Math.max(0, Math.min(1, parseFloat(parts[2]) || 0.5)) : 0.5;
      const confidence = parts[3] ? Math.max(0, Math.min(1, parseFloat(parts[3]) || relevance)) : relevance;
      if (category && content && content.length > 40) {
        await addMemoryEntry(category, content, relevance, confidence);
      }
    }
  } catch {
    // Memory extraction is best-effort; failures should not affect the main flow
  }
}
```

- [ ] **Step 2: Update `cleanupMemories()` to handle confidence**

Replace the cleanup prompt and logic:

```typescript
export async function cleanupMemories(): Promise<void> {
  const entries = await getMemoryEntries();
  if (entries.length < 2) return;

  const factsText = entries
    .map((e) => `[${e.id}] ${e.category} (relevance:${e.relevance}, confidence:${e.confidence}): ${e.content}`)
    .join("\n");

  const prompt = `You are a memory curator. Review these saved facts and clean them up:

1. Merge duplicate or overlapping facts into a single, more complete fact
2. Remove facts that are clearly outdated or irrelevant (relevance < 0.3 OR confidence < 0.3)
3. Improve phrasing for clarity
4. Keep the most relevant version when facts conflict
5. Adjust confidence scores: merged facts should use the max confidence of their sources

Return ONLY a JSON array of objects with fields: id, category, content, relevance, confidence
- id: keep the original id if merging, or "new" for new merged facts
- category: preference, project, personal, pattern, technology, decision
- content: the cleaned fact text
- relevance: number 0.0-1.0
- confidence: number 0.0-1.0

Current facts:
${factsText}

JSON array:`;

  try {
    const result = await generateText({
      model: cerebras.chat(resolveCerebrasModel(MEMORY_MODEL)),
      prompt,
      temperature: 0.2,
      maxOutputTokens: 2000,
    });

    const text = result.text.trim();
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    if (jsonStart === -1 || jsonEnd === -1) return;

    const cleaned: Array<{ id: string; category: string; content: string; relevance: number; confidence?: number }> = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(cleaned) || cleaned.length === 0) return;

    const idMap = new Map(entries.map((e) => [e.id, e]));
    const newEntries: MemoryEntry[] = [];
    const now = Date.now();

    for (const item of cleaned) {
      const existing = idMap.get(item.id);
      if (existing) {
        newEntries.push({
          ...existing,
          category: item.category || existing.category,
          content: item.content || existing.content,
          relevance: item.relevance ?? existing.relevance,
          confidence: item.confidence ?? existing.confidence,
          updatedAt: now,
        });
      } else {
        const conf = item.confidence ?? item.relevance ?? 0.5;
        newEntries.push({
          id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
          category: item.category || "general",
          content: item.content || "",
          createdAt: now,
          updatedAt: now,
          relevance: item.relevance ?? 0.5,
          confidence: conf,
        });
      }
    }

    if (newEntries.length > 0) {
      await replaceAllEntries(newEntries);
    }
  } catch {
    // Cleanup is best-effort
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 3: Settings API — Accept `confidence` in POST

**Files:**
- Modify: `app/api/settings/memory/route.ts`

- [ ] **Step 1: Pass `confidence` from POST body to `addMemoryEntry`**

Update the POST handler:

```typescript
export async function POST(req: Request) {
  try {
    const { category, content, confidence } = await req.json();
    if (!category || !content) {
      return NextResponse.json({ error: "Category and content are required" }, { status: 400 });
    }
    await addMemoryEntry(category, content, undefined, confidence);
    const entries = await getMemoryEntries();
    return NextResponse.json({ entries });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Verification

- [ ] **Final check: Run full type check**

```bash
npx tsc --noEmit
```

Expected: clean exit (no errors)
