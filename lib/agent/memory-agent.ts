import { generateText } from "ai";
import { cerebras, resolveCerebrasModel } from "./cerebras";
import {
  addMemoryEntry,
  getMemoryEntries,
  getRelevantContext,
} from "@/lib/memory/memory-store";

const MEMORY_MODEL = process.env.MEMORY_MODEL || "zai-glm-4.7";

export async function extractAndStoreMemories(
  transcript: string,
): Promise<void> {
  if (!transcript || transcript.length < 10) return;

  const prompt = `Read the following conversation transcript and extract important facts, preferences, and context worth remembering long-term.

Focus on:
- User preferences (e.g., preferred technologies, coding style, communication style)
- Project details (e.g., what they're building, architecture decisions)
- Personal context (e.g., their experience level, goals)
- Recurring patterns or requests

For each fact, assign a category from: preference, project, personal, pattern, technology, decision

Output format: one fact per line, with category and content separated by "||"
Example:
preference||The user prefers TypeScript over JavaScript
project||The user is building a chat application with Next.js

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
      const separatorIndex = line.indexOf("||");
      if (separatorIndex === -1) continue;
      const category = line.slice(0, separatorIndex).trim().toLowerCase();
      const content = line.slice(separatorIndex + 2).trim();
      if (category && content && content.length > 10) {
        await addMemoryEntry(category, content, 0.7);
      }
    }
  } catch {
    // Memory extraction is best-effort; failures should not affect the main flow
  }
}

export async function generateMemoryContext(): Promise<string> {
  const context = await getRelevantContext();
  if (!context) return "";

  const prompt = `Below are facts extracted from past conversations. Write a short, natural paragraph that summarizes what is known about the user, their preferences, and their projects. Use "you" to refer to the user.

Facts:
${context}

Write a single paragraph, no more than 3-4 sentences. Do not mention file paths, storage formats, or implementation details.`;

  try {
    const result = await generateText({
      model: cerebras.chat(resolveCerebrasModel(MEMORY_MODEL)),
      prompt,
      temperature: 0.4,
    });

    return result.text.trim();
  } catch {
    return "";
  }
}
