import { NextRequest } from "next/server";
import {
  resolveQuestion,
  resolveQuestionnaire,
  type QuestionAnswers,
} from "@/lib/agent/tools/ask-user-tool";

export async function POST(req: NextRequest) {
  try {
    const { requestId, answer, answers } = await req.json();
    if (!requestId) {
      return Response.json(
        { error: "requestId is required" },
        { status: 400 },
      );
    }
    // Preferred: full answer map keyed by question id.
    if (answers && typeof answers === "object") {
      const resolved = resolveQuestionnaire(
        requestId,
        answers as QuestionAnswers,
      );
      if (!resolved) {
        return Response.json(
          { error: "Question not found or already answered" },
          { status: 404 },
        );
      }
      return Response.json({ success: true, answers });
    }
    // Legacy: single free-text answer for the first question.
    if (typeof answer !== "string") {
      return Response.json(
        { error: "answers or answer is required" },
        { status: 400 },
      );
    }
    const resolved = resolveQuestion(requestId, answer);
    if (!resolved) {
      return Response.json(
        { error: "Question not found or already answered" },
        { status: 404 },
      );
    }
    return Response.json({ success: true, answer });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
