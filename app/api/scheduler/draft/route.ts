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

    const { streamText } = await import("ai");
    const system = titleOnly
      ? buildTitleSystemPrompt()
      : buildDraftSystemPrompt({ allowManual });
    const userPrompt = titleOnly
      ? buildTitlePrompt(prompt)
      : buildDraftPrompt(prompt, current);

    const run = async (promptText: string): Promise<string> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const result: any = await (streamText as any)({
          model,
          system,
          prompt: promptText,
          maxRetries: 0,
          // Generous budget: reasoning models spend part of this on thinking
          // before they emit the JSON answer.
          maxOutputTokens: 2000,
          temperature: 0.2,
          abortSignal: controller.signal,
        });
        try {
          await result.consumeStream();
        } catch {}
        const text = String((await result.text) ?? "");
        if (text.trim()) return text;
        // Thinking models sometimes leave the answer in the reasoning channel
        // when the text budget is exhausted; try it before giving up.
        try {
          return String((await result.reasoning) ?? "");
        } catch {
          return text;
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    let text = await run(userPrompt);
    let parsed = titleOnly
      ? parseTitleResponse(text)
      : parseDraftResponse(text, { allowManual });

    if (!parsed.ok) {
      // One repair attempt. Models that ignored the JSON instruction once
      // usually comply when shown the exact failure.
      const retryPrompt = `${userPrompt}\n\nYour previous reply was not valid JSON. Reply again with ONE JSON object only, no prose and no code fences.`;
      try {
        text = await run(retryPrompt);
        parsed = titleOnly
          ? parseTitleResponse(text)
          : parseDraftResponse(text, { allowManual });
      } catch {
        // Keep the first parse result; the deterministic fallback below
        // still lets the user save the task.
      }
    }

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
