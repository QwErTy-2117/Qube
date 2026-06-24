import { NextRequest } from "next/server";
import { resolveQuestion } from "@/lib/agent/tools/ask-user-tool";

export async function POST(req: NextRequest) {
  try {
    const { requestId, answer } = await req.json();
    if (!requestId || typeof answer !== "string") {
      return Response.json(
        { error: "requestId and answer are required" },
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
