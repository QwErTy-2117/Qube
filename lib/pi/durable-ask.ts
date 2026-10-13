import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

function textOut(payload: unknown) {
  return { output: [{ type: "text", text: JSON.stringify(payload) }] as Array<{ type: "text"; text: string }> };
}

export type AskUserContext = {
  /** Background/scheduled runs have no interactive user. */
  background?: boolean;
};

/**
 * ask_user for the durable path: single clarifying question answered in
 * the docked questionnaire panel. Delegates to the same questionnaire
 * API the foreground harness uses. Background runs never block.
 */
export function buildAskUserTool(ctx?: AskUserContext) {
  const background = ctx?.background === true;
  return defineTool({
    name: "ask_user",
    description:
      "Ask the user ONE clarifying question (multiple choice or free text). Use only when genuinely blocked on a decision only the user can make. " +
      "In background runs there is no user — the call returns immediately with available=false; proceed autonomously there.",
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask" }),
      options: Type.Optional(Type.Array(Type.String(), { description: "Clickable options (omit for free-text)" })),
    }),
    execute: async (args, api) => {
      if (background) {
        return textOut({ available: false, message: "No interactive user in background runs. Proceed autonomously with best judgment." });
      }
      try {
        const { normalizeQuestions, createQuestionnaire } = await import("@/lib/agent/tools/ask-user-tool");
        const normalized = normalizeQuestions([{ id: "answer", question: args.question, options: args.options }]);
        if ("error" in normalized) return textOut({ available: true, error: normalized.error });
        const threadId = String(api.conversationId);
        const { promise, requestId } = createQuestionnaire(threadId, normalized);
        console.log(`[ask-user] Question ${requestId} for thread ${threadId}: ${String(args.question).slice(0, 120)}`);
        const timeoutMs = parseInt(process.env.ASK_USER_TIMEOUT_MS || "300000", 10);
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const answers = await Promise.race([promise, timeout]);
        if (answers === null) {
          return textOut({ available: true, timedOut: true, message: "User did not answer in time. Proceed with best judgment." });
        }
        const first = Object.values(answers)[0];
        const answer = Array.isArray(first) ? first.join(", ") : String(first ?? "");
        return textOut({ available: true, answer });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return textOut({ available: false, error: msg });
      }
    },
  });
}

export function buildAskExtension(ctx?: AskUserContext) {
  return defineExtension({ name: "ask", tools: [buildAskUserTool(ctx)] });
}
