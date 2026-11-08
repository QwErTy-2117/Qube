import { NextResponse } from "next/server";
import { createPiModelClientForRequest } from "@/lib/pi/model-client";
import {
  buildDraftPrompt,
  buildDraftSystemPrompt,
  buildTitlePrompt,
  buildTitleSystemPrompt,
  validateDraft,
  validateTitleDraft,
  type DraftInput,
} from "@/lib/scheduler/task-draft";

/** Extract the first {...} JSON object (models love fences/preambles) and validate it. Pure. */
export function parseDraftResponse(
  text: string,
  opts?: { allowManual?: boolean },
): ReturnType<typeof validateDraft> {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The model did not return a draft." };
  try {
    return validateDraft(JSON.parse(cleaned.slice(start, end + 1)), opts);
  } catch {
    return { ok: false, error: "The model did not return a draft." };
  }
}

/** Extract and validate the title-only JSON object. Pure. */
export function parseTitleResponse(text: string): ReturnType<typeof validateTitleDraft> {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The model did not return a title." };
  try {
    return validateTitleDraft(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return { ok: false, error: "The model did not return a title." };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const titleOnly = body?.mode === "title";
    const allowManual = body?.allowManual === true;
    let current: DraftInput | null = null;
    try {
      current = body?.current == null ? null : (JSON.parse(JSON.stringify(body.current)) as DraftInput | null);
    } catch {
      return NextResponse.json({ error: "current must be JSON-serializable" }, { status: 400 });
    }

    let model: ReturnType<typeof createPiModelClientForRequest>;
    try {
      model = createPiModelClientForRequest(null, req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No model is configured. Set a default model first.";
      return NextResponse.json(
        { error: msg.slice(0, 300) },
        { status: 400 },
      );
    }

    const { streamText } = await import("ai");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const result: any = await (streamText as any)({
        model,
        system: titleOnly
          ? buildTitleSystemPrompt()
          : buildDraftSystemPrompt({ allowManual }),
        prompt: titleOnly
          ? buildTitlePrompt(prompt)
          : buildDraftPrompt(prompt, current),
        maxRetries: 0,
        maxOutputTokens: 800,
        temperature: 0.3,
        abortSignal: controller.signal,
      });
      try { await result.consumeStream(); } catch {}
      const text = String((await result.text) ?? "");
      if (titleOnly) {
        const parsed = parseTitleResponse(text);
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 502 });
        return NextResponse.json({ name: parsed.name });
      }
      const parsed = parseDraftResponse(text, { allowManual });
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
