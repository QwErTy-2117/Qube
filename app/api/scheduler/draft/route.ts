import { NextResponse } from "next/server";
import { createPiModelClientForRequest } from "@/lib/pi/model-client";
import {
  buildDraftPrompt,
  buildDraftSystemPrompt,
  buildTitlePrompt,
  buildTitleSystemPrompt,
  draftFromInstructions,
  extractJsonObject,
  parseJsonLoose,
  titleFromInstructions,
  validateDraft,
  validateTitleDraft,
  type DraftInput,
} from "@/lib/scheduler/task-draft";

/** Extract the first JSON object (models love fences/preambles) and validate it. Pure. */
export function parseDraftResponse(
  text: string,
  opts?: { allowManual?: boolean },
): ReturnType<typeof validateDraft> {
  const candidate = extractJsonObject(text);
  if (!candidate) return { ok: false, error: "The model did not return a draft." };
  const parsed = parseJsonLoose(candidate);
  if (parsed == null) return { ok: false, error: "The model did not return a draft." };
  return validateDraft(parsed, opts);
}

/** Extract and validate the title-only JSON object. Pure. */
export function parseTitleResponse(text: string): ReturnType<typeof validateTitleDraft> {
  const candidate = extractJsonObject(text);
  if (!candidate) return { ok: false, error: "The model did not return a title." };
  const parsed = parseJsonLoose(candidate);
  if (parsed == null) return { ok: false, error: "The model did not return a title." };
  return validateTitleDraft(parsed);
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

    const { generateText } = await import("ai");
    const system = titleOnly
      ? buildTitleSystemPrompt()
      : buildDraftSystemPrompt({ allowManual });
    const userPrompt = titleOnly
      ? buildTitlePrompt(prompt)
      : buildDraftPrompt(prompt, current);

    // One fast pass. The deterministic fallback below is intentionally used
    // instead of a repair retry: a second model call doubled worst-case
    // latency and the UI only needs a usable draft.
    const run = async (promptText: string): Promise<string> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), titleOnly ? 8_000 : 20_000);
      try {
        const result: any = await (generateText as any)({
          model,
          system,
          prompt: promptText,
          maxRetries: 0,
          maxOutputTokens: titleOnly ? 80 : 900,
          temperature: 0.1,
          abortSignal: controller.signal,
        });
        const text = String(result?.text ?? "").trim();
        if (text) return text;
        // Thinking models occasionally leave the answer in the reasoning
        // channel when the text budget is exhausted.
        return String(result?.reasoning ?? "").trim();
      } catch (e: any) {
        const reason = e?.name === "AbortError" ? "timed out" : e?.message || String(e);
        console.warn("[scheduler/draft] model call ended early:", String(reason).slice(0, 300));
        return "";
      } finally {
        clearTimeout(timeout);
      }
    };

    const text = await run(userPrompt);
    const parsed = titleOnly
      ? parseTitleResponse(text)
      : parseDraftResponse(text, { allowManual });

    if (titleOnly) {
      if (!parsed.ok || !("name" in parsed)) {
        // Never block a save on a malformed model reply; derive a short
        // title from the instructions instead.
        console.warn(
          "[scheduler/draft] title model returned no usable JSON; using fallback title",
        );
        return NextResponse.json({
          name: titleFromInstructions(prompt),
          fallback: true,
        });
      }
      return NextResponse.json({ name: parsed.name });
    }

    if (!parsed.ok || !("draft" in parsed)) {
      console.warn(
        "[scheduler/draft] draft model returned no usable JSON; using deterministic fallback",
      );
      return NextResponse.json({
        draft: draftFromInstructions(prompt, { allowManual }),
        fallback: true,
      });
    }
    return NextResponse.json({ draft: parsed.draft });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
