import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Scratchpad, Todos } from "@/lib/pi/durable-docs";

export type GoalItem = { content: string; status: string; activeForm?: string };

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

function normalizeItems(todos: GoalItem[]): Array<{ content: string; status: string; activeForm: string }> {
  return (todos ?? []).slice(0, 50).map((t) => ({
    content: String(t?.content ?? "").slice(0, 300),
    status: VALID_STATUSES.has(t?.status) ? t.status : "pending",
    activeForm: String(t?.activeForm ?? "").slice(0, 300),
  }));
}

export const todoWriteTool = defineTool({
  name: "TodoWrite",
  description:
    "Your task checklist AND the user's progress UI. Call first for work with 3+ distinct steps; pass the COMPLETE list each call with exactly one in_progress. Flip items to completed the moment each finishes. Stored durably with the transcript, so it survives restarts.",
  parameters: Type.Object({
    todos: Type.Array(Type.Object({
      content: Type.String({ description: "Task description" }),
      status: Type.String({ description: "pending | in_progress | completed | cancelled" }),
      activeForm: Type.Optional(Type.String({ description: "Present-continuous label, e.g. 'Writing tests'" })),
    })),
  }),
  replay: "safe",
  execute: async (args, api, context) => {
    const items = normalizeItems(args.todos as GoalItem[]);
    await api.commit(async (tx) => {
      const doc = await tx.doc(Todos, api.conversationId);
      doc.items = items.map((t) => `${t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.content}`);
    }, context);
    const done = items.filter((t) => t.status === "completed").length;
    return { output: [{ type: "text", text: `Checklist saved: ${done}/${items.length} done.` }] as const };
  },
});

export function buildGoalsExtension() {  return defineExtension({
    name: "goals",
    tools: [todoWriteTool],
    sections: [
      section("todos", async (input, context) => {
        const snap = await input.read.snapshot(Todos, input.conversationId, context);
        const items = snap?.items ?? [];
        if (items.length === 0) return undefined;
        return `Open checklist:\n${items.slice(0, 20).join("\n")}`;
      }),
    ],
  });
}

const MAX_SCRATCH_CHARS = 20000;

export const readScratchpadTool = defineTool({
  name: "read_scratchpad",
  description: "Read your per-thread scratchpad (notes for multi-step work). Cheap, outside context, survives restarts. Read it JIT when resuming work, not every turn.",
  parameters: Type.Object({}),
  replay: "safe",
  execute: async (_args, api, context) => {
    const snap = await api.snapshot(Scratchpad, api.conversationId, context);
    const text = snap?.text ?? "";
    return { output: [{ type: "text", text: text || "(scratchpad is empty)" }] as Array<{ type: "text"; text: string }> };
  },
});

export const writeScratchpadTool = defineTool({
  name: "write_scratchpad",
  description: "Replace your per-thread scratchpad contents. Same content rewritten is harmless. (Overwrites are replay-safe; appends are not — see append_scratchpad.)",
  parameters: Type.Object({ content: Type.String({ description: "Full new scratchpad content" }) }),
  replay: "safe",
  execute: async (args, api, context) => {
    const content = String(args.content ?? "").slice(0, MAX_SCRATCH_CHARS);
    await api.commit(async (tx) => {
      const doc = await tx.doc(Scratchpad, api.conversationId);
      doc.text = content;
    }, context);
    return { output: [{ type: "text", text: `Scratchpad saved (${content.length} chars).` }] as Array<{ type: "text"; text: string }> };
  },
});

export const appendScratchpadTool = defineTool({
  name: "append_scratchpad",
  description: "Append a chunk to your per-thread scratchpad. (Never auto-replayed after a crash — a rerun would duplicate the chunk; the model is told it was interrupted instead.)",
  parameters: Type.Object({ chunk: Type.String({ description: "Text to append" }) }),
  execute: async (args, api, context) => {
    const chunk = String(args.chunk ?? "").slice(0, MAX_SCRATCH_CHARS);
    const total = await api.commit(async (tx) => {
      const doc = await tx.doc(Scratchpad, api.conversationId);
      doc.text = doc.text ? `${doc.text}\n${chunk}` : chunk;
      return doc.text.length;
    }, context);
    return { output: [{ type: "text", text: `Appended (${total} chars total).` }] as Array<{ type: "text"; text: string }> };
  },
});

export function buildNotesExtension() {
  return defineExtension({ name: "notes", tools: [readScratchpadTool, writeScratchpadTool, appendScratchpadTool] });
}
