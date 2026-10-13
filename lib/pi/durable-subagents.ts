import { Type } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { buildSubagentSystemPrompt } from "@/lib/pi/subagents";

export type SubagentAnswer = { status: string; text: string };

/** Extract plain text from an assistant entry's model messages. */
export function readAnswerText(entry: unknown): string {
  const model = (entry as { model?: unknown } | null | undefined)?.model;
  if (!Array.isArray(model)) return "";
  const out: string[] = [];
  for (const msg of model) {
    const content = (msg as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (part?.type === "text" && typeof part.text === "string") out.push(part.text);
    }
  }
  return out.join("");
}

export const subagentTool = defineTool({
  name: "subagent",
  description:
    "Delegate a self-contained task to a helper running in a FRESH isolated context (no parent history; the task must be self-contained). " +
    "Types: Explore (read-only recon), researcher (web/docs brief), reviewer (read-only review), general (full tools). " +
    "The helper runs in a conversation owned by this call, so aborting the call aborts it, and it survives crashes like any conversation. " +
    "Call multiple times in one turn for parallel work. (Safe to rerun after a crash: finds the same child and submission.)",
  parameters: Type.Object({
    task: Type.String({ description: "Self-contained task for the helper" }),
    description: Type.Optional(Type.String({ description: "Short label for progress UI" })),
    agentType: Type.Optional(Type.String({ description: "Explore | researcher | reviewer | general" })),
  }),
  replay: "safe",
  execute: async (args, api, context) => {
    const child = await api.commit(async (tx) => {
      const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
      if (existing !== undefined) return existing.id;
      const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
      await configure(tx, created.id, {
        instructions: buildSubagentSystemPrompt(args.agentType || "general"),
      });
      return created.id;
    }, context);
    await api.details({ conversationId: child }, context).catch(() => undefined);
    const sub = await api.conversation(child, context);
    if (!sub) {
      return { output: [{ type: "text", text: "Subagent conversation is gone." }] as Array<{ type: "text"; text: string }> };
    }
    const request = { type: "input", content: args.task, requestId: `subagent:${String(api.taskId)}` } as const;
    const settled = await (await sub.submit(request as never, context)).wait(context);
    if (settled.status !== "done" || settled.type !== "input") {
      const reason = settled.status === "unanswered" ? settled.reason : settled.status;
      return { output: [{ type: "text", text: `Subagent did not answer (${reason}).` }] as Array<{ type: "text"; text: string }> };
    }
    const entry = await api.commit((tx) => tx.entry(AssistantEntry, settled.answer!), context);
    const text = readAnswerText(entry ?? undefined).slice(0, 8000);
    return { output: [{ type: "text", text: text || "(empty answer)" }] as Array<{ type: "text"; text: string }> };
  },
});

export function buildSubagentsExtension() {
  return defineExtension({ name: "subagents", tools: [subagentTool] });
}
