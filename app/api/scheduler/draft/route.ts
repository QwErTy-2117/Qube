import { NextResponse } from "next/server";
import { createPiModelClientForRequest } from "@/lib/pi/model-client";
import {
  buildTitlePrompt,
  buildTitleSystemPrompt,
  extractJsonObject,
  parseJsonLoose,
  titleFromInstructions,
  validateTitleDraft,
} from "@/lib/scheduler/task-draft";

/** Extract and validate the title-only JSON object. Pure. */
export function parseTitleResponse(text: string): ReturnType<typeof validateTitleDraft> {
  const candidate = extractJsonObject(text);
  if (!candidate) return { ok: false, error: "The model did not return a title." };
  const parsed = parseJsonLoose(candidate);
  if (parsed == null) return { ok: false, error: "The model did not return a title." };
  return validateTitleDraft(parsed);
}

/**
 * Generate a short title from the instructions text. There is deliberately no
 * draft mode here: the schedule and instructions always come from what the
 * user entered, and only a missing title is filled in.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

    let model: ReturnType<typeof createPiModelClientForRequest>;
    try {
      model = createPiModelClientForRequest(null, req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No model is configured. Set a default model first.";
      return NextResponse.json({ error: msg.slice(0, 300) }, { status: 400 });
    }

    const { generateText } = await import("ai");
    const system = buildTitleSystemPrompt();
    const userPrompt = buildTitlePrompt(prompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let text = "";
    try {
      const result: any = await (generateText as any)({
        model,
        system,
        prompt: userPrompt,
        maxRetries: 0,
        maxOutputTokens: 80,
        temperature: 0.1,
        abortSignal: controller.signal,
      });
      text = String(result?.text ?? "").trim();
      // Thinking models occasionally leave the answer in the reasoning
      // channel when the text budget is exhausted.
      if (!text) text = String(result?.reasoning ?? "").trim();
    } catch (e: any) {
      const reason = e?.name === "AbortError" ? "timed out" : e?.message || String(e);
      console.warn("[scheduler/draft] title model call ended early:", String(reason).slice(0, 300));
    } finally {
      clearTimeout(timeout);
    }

    const parsed = parseTitleResponse(text);
    if (!parsed.ok) {
      // Never block a save on a malformed model reply; derive a short title
      // from the instructions instead.
      console.warn(
        "[scheduler/draft] title model returned no usable JSON; using fallback title",
      );
      return NextResponse.json({
        name: titleFromInstructions(prompt),
        fallback: true,
      });
    }
    return NextResponse.json({ name: parsed.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
