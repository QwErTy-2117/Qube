# Smarter & More Selective Memory

## Problem

Qube's memory system stores explicit facts extracted from conversation transcripts, but:
1. **No deduction**: Only explicit statements are stored; patterns and implications are missed.
2. **Duplicate accumulation**: Same fact can be stored across multiple sessions; no dedup check during extraction.
3. **Low filtering bar**: Minimum 10-char content threshold lets noisy/trivial facts through.
4. **Static relevance**: Relevance scores never decay; old facts persist at full weight forever.
5. **Separated extraction + cleanup**: Two LLM calls (extract, then cleanup later) when they could be combined.

## Design

### 1. Memory Schema — Add `confidence`

A new `confidence` field (0.0–1.0) alongside `relevance`. Confidence = how certain the LLM is about a deduced fact. Explicit statements get high confidence; inferred patterns get lower confidence.

```typescript
type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  relevance: number;    // 0.0-1.0 — how useful across sessions
  confidence: number;   // 0.0-1.0 — how sure we are about this fact (NEW)
};
```

**Migration**: Version 2 → 3. Existing entries get `confidence = relevance`.

### 2. Combined Extraction + Dedup (memory-agent.ts)

**Current flow**: Extract facts from transcript → save → cleanup (separate LLM call).

**New flow**: Load up to 50 most recent (or most relevant) existing memory entries and include them in the **same** extraction prompt. The LLM sees existing facts and can:
- **Skip**: Fact is already covered or not worth saving.
- **Merge**: Output `merge:<existing_id>||category||content||relevance||confidence` to update an existing entry.
- **New**: `category||content||relevance||confidence` to create fresh entry.

This eliminates duplicate pile-up at the source. The separate `cleanupMemories()` step still runs on thread switch but now focuses on confidence-based filtering and cross-session merging across all entries (beyond the 50-entry dedup window).

### 3. Deductive Extraction Prompt

Updated prompt instructs the LLM to:
- Infer implicit facts from conversation patterns (e.g., "user asked about React 3 times" → `user is learning React`)
- Rate each fact on **both** relevance (0.0–1.0) and confidence (0.0–1.0)
- Skip ephemeral/conversation-specific facts unlikely to matter across sessions
- Only extract facts with content > 40 characters
- When a fact is similar to an existing entry, merge instead of duplicate

### 4. Relevance Decay on Read (memory-store.ts)

In `getRelevantContext()`, apply time-based decay:

```
adjustedRelevance = relevance × 0.95^(days since creation)
```

Examples:
- Fresh fact (today): `× 1.0`
- 7 days old: `× 0.70`
- 14 days old: `× 0.49`
- 30 days old: `× 0.21`

The filter stays at `adjusted_relevance >= 0.4`. Old facts naturally phase out without explicit eviction logic.

### 5. Cleanup Uses Confidence

The `cleanupMemories()` LLM prompt now also considers `confidence`:
- Drop entries with confidence < 0.3
- Keep entries where either relevance or confidence is high

### Files Changed

| File | Changes |
|---|---|
| `lib/memory/memory-store.ts` | Add `confidence` to `MemoryEntry`, bump version to 3, migration from v2, decay in `getRelevantContext()`, update `addMemoryEntry`, `updateMemoryEntry` |
| `lib/agent/memory-agent.ts` | New extraction prompt (deductive), load existing entries for dedup, combined extraction flow, confidence scoring |
| `app/api/settings/memory/route.ts` | Handle `confidence` field in POST payload |

### Not Changed

| File | Reason |
|---|---|
| `lib/agent/system-prompt.ts` | Still consumes `memoryContext` string; no interface change |
| `lib/agent/agent.ts` | Still calls `generateMemoryContext` and provides `read_memory` tool |
| `lib/memory/session-store.ts` | No changes to session storage |
| `components/assistant-ui/tools/read-memory-tool-ui.tsx` | No UI changes needed |
| `app/api/chat/route.ts` | Trigger flow unchanged |

### Error Handling

- If extraction LLM call fails, fall back to existing behavior (no new memories stored, existing ones preserved)
- If LLM output parsing fails for a single line, skip that line rather than failing the whole batch
- Migration failure from v2→v3 is non-destructive: old entries are preserved with default confidence values
