import { generateText, type LanguageModel } from "ai";
import {
  addMemoryEntry,
  getMemoryEntries,
  getRelevantContext,
  replaceAllEntries,
  updateMemoryEntry,
  type MemoryEntry,
} from "@/lib/memory/memory-store";



function parseScore(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const val = parseFloat(raw);
  return isNaN(val) ? fallback : Math.max(0, Math.min(1, val));
}

export async function extractAndStoreMemories(
  transcript: string,
  model: LanguageModel,
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
      model,
      prompt,
      temperature: 0.3,
    });

    const lines = result.text.trim().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "skip") continue;

      const mergeMatch = trimmed.match(/^merge:(\S+?)\|\|/);
      if (mergeMatch) {
        const parts = trimmed.slice(mergeMatch[0].length).split("||");
        const mergeId = mergeMatch[1];
        if (parts.length < 2) continue;
        const category = parts[0].trim().toLowerCase();
        const content = parts[1].trim();
        const relevance = parseScore(parts[2], 0.5);
        const confidence = parseScore(parts[3], relevance);
        if (category && content) {
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
      const relevance = parseScore(parts[2], 0.5);
      const confidence = parseScore(parts[3], relevance);
      if (category && content) {
        await addMemoryEntry(category, content, relevance, confidence);
      }
    }
  } catch {
    // Memory extraction is best-effort; failures should not affect the main flow
  }
}

export async function cleanupMemories(model: LanguageModel): Promise<void> {
  const entries = await getMemoryEntries();
  if (entries.length < 2) return;

  const factsText = entries
    .map((e) => `[${e.id}] ${e.category} (relevance:${e.relevance}, confidence:${e.confidence}): ${e.content}`)
    .join("\n");

  const prompt = `You are a memory curator. Review these saved facts and clean them up:

1. Merge duplicate or overlapping facts into a single, more complete fact
2. Remove facts that are clearly outdated or irrelevant (relevance < 0.3 AND confidence < 0.3)
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
      model,
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

export async function generateMemoryContext(): Promise<string> {
  const context = await getRelevantContext();
  return context;
}
