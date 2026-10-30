import { NextResponse } from "next/server";
import { createPiModelClientForRequest } from "@/lib/pi/model-client";
import { buildDraftPrompt, buildDraftSystemPrompt, validateDraft, type DraftInput } from "@/lib/scheduler/task-draft";

/** Extract the first {...} JSON object (models love fences/preambles) and validate it. Pure. */
export function parseDraftResponse(text: string): ReturnType<typeof validateDraft> {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The model did not return a draft." };
  try {
    return validateDraft(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return { ok: false, error: "The model did not return a draft." };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const current = (body?.current ?? null) as DraftInput | null;

    let model: ReturnType<typeof createPiModelClientForRequest>;
    try {
      model = createPiModelClientForRequest(null, req);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "No model is configured. Set a default model first." },
        { status: 400 },
      );
    }

    const { streamText } = await import("ai");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const result: any = await (streamText as any)({
        model,
        system: buildDraftSystemPrompt(),
        prompt: buildDraftPrompt(prompt, current),
        maxRetries: 0,
        temperature: 0.3,
        abortSignal: controller.signal,
      });
      try { await result.consumeStream(); } catch {}
      const text = String((await result.text) ?? "");
      const parsed = parseDraftResponse(text);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 502 });
      return NextResponse.json({ draft: parsed.draft });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
