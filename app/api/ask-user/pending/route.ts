import { NextRequest } from "next/server";
import { getPendingQuestions } from "@/lib/agent/tools/ask-user-tool";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId") || undefined;
  const questions = getPendingQuestions(threadId);
  return Response.json({ questions });
}
