import { generateText } from "ai";
import { cerebras, resolveCerebrasModel } from "./cerebras";
import {
  addMemoryEntry,
  getMemoryEntries,
  getRelevantContext,
  replaceAllEntries,
  type MemoryEntry,
} from "@/lib/memory/memory-store";

const MEMORY_MODEL = process.env.MEMORY_MODEL || "zai-glm-4.7";

export async function extractAndStoreMemories(
  transcript: string,
): Promise<void> {
  if (!transcript || transcript.length < 10) return;

  const prompt = `Read the following conversation transcript and extract important facts, preferences, and personal context worth remembering long-term.

CRITICAL: Always extract the user's name, location, job, and any personal identifiers mentioned.

Focus on:
- User's name, location, job, experience level, goals (personal)
- Technology preferences, coding style, communication style (preference)
- Project details, architecture decisions (project)
- Recurring patterns or requests (pattern)

For each fact, assign a category from: preference, project, personal, pattern, technology, decision

Also assign a relevance score from 0.0 to 1.0 indicating how important this fact is:
- 1.0 = critical, always-relevant (user's name, core project architecture)
- 0.7 = important, frequently useful (technology preferences)
- 0.5 = somewhat useful context (minor preferences)
- 0.2 = low relevance, may not be worth remembering

Output format: one fact per line, with category, content, and relevance separated by "||"
Example:
preference||The user prefers TypeScript over JavaScript||0.8
personal||The user's name is Luca||1.0
project||The user is building a chat application with Next.js||0.9

Conversation:
${transcript.slice(0, 10000)}`;

  try {
    const result = await generateText({
      model: cerebras.chat(resolveCerebrasModel(MEMORY_MODEL)),
      prompt,
      temperature: 0.3,
    });

    const lines = result.text.trim().split("\n");
    for (const line of lines) {
      const parts = line.split("||");
      if (parts.length < 2) continue;
      const category = parts[0].trim().toLowerCase();
      const content = parts[1].trim();
      const relevance = parts[2] ? Math.max(0, Math.min(1, parseFloat(parts[2]) || 0.5)) : 0.5;
      if (category && content && content.length > 10) {
        await addMemoryEntry(category, content, relevance);
      }
    }
  } catch {
    // Memory extraction is best-effort; failures should not affect the main flow
  }
}

export async function cleanupMemories(): Promise<void> {
  const entries = await getMemoryEntries();
  if (entries.length < 2) return;

  const factsText = entries
    .map((e) => `[${e.id}] ${e.category} (relevance:${e.relevance}): ${e.content}`)
    .join("\n");

  const prompt = `You are a memory curator. Review these saved facts and clean them up:

1. Merge duplicate or overlapping facts into a single, more complete fact
2. Remove facts that are clearly outdated or irrelevant (relevance < 0.3)
3. Improve phrasing for clarity
4. Keep the most relevant version when facts conflict

Return ONLY a JSON array of objects with fields: id, category, content, relevance
- id: keep the original id if merging, or "new" for new merged facts
- category: preference, project, personal, pattern, technology, decision
- content: the cleaned fact text
- relevance: number 0.0-1.0

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

    const cleaned: Array<{ id: string; category: string; content: string; relevance: number }> = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
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
          updatedAt: now,
        });
      } else {
        newEntries.push({
          id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
          category: item.category || "general",
          content: item.content || "",
          createdAt: now,
          updatedAt: now,
          relevance: item.relevance ?? 0.5,
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
