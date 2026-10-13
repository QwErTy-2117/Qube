import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { Todos } from "@/lib/pi/durable-docs";

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
