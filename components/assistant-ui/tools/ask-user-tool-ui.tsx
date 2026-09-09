"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { HelpCircleIcon, CheckIcon } from "lucide-react";

function safeParse(v: unknown): any {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v ?? null;
}

function formatAnswer(a: unknown): string {
  if (Array.isArray(a)) return a.map(String).join(", ");
  return String(a ?? "");
}

/**
 * Transcript record for ask_question. Renders nothing while the question
 * is still pending (the docked QuestionPanel owns the interaction);
 * once answered it shows each question with the user's answer.
 * Also understands the legacy single-question {question, options, answer}.
 */
export const AskUserToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const a = (args || {}) as any;
  const r = safeParse(result);
  const answers = r?.answers as Record<string, unknown> | undefined;

  const questions: Array<{
    id: string;
    header?: string;
    question: string;
    answer?: string;
  }> = [];

  if (Array.isArray(a.questions)) {
    for (let i = 0; i < a.questions.length; i++) {
      const q = a.questions[i] as any;
      if (!q || typeof q.question !== "string") continue;
      const id =
        typeof q.id === "string" && q.id ? q.id : `q${i + 1}`;
      questions.push({
        id,
        header: typeof q.header === "string" ? q.header : undefined,
        question: q.question,
        answer:
          answers && id in answers ? formatAnswer(answers[id]) : undefined,
      });
    }
  } else if (typeof a.question === "string") {
    // Legacy single-question shape.
    const legacy = r as any;
    questions.push({
      id: "q1",
      question: a.question,
      answer:
        answers && "q1" in answers
          ? formatAnswer(answers.q1)
          : typeof legacy?.answer === "string"
            ? legacy.answer
            : undefined,
    });
  }

  if (questions.length === 0) return null;
  const answeredCount = questions.filter((q) => q.answer).length;
  // Pending — the docked panel handles it; keep the transcript clean.
  if (answeredCount === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-background px-4 py-3 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <HelpCircleIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">
          {questions.length > 1
            ? `${answeredCount} of ${questions.length} questions answered`
            : "Question answered"}
        </span>
      </div>
      <div className="mt-2 space-y-2.5">
        {questions.map((q) => (
          <div key={q.id}>
            {q.header && (
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                {q.header}
              </p>
            )}
            <p className="text-sm text-foreground">{q.question}</p>
            {q.answer ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                <CheckIcon className="size-4 shrink-0 text-green-500" />
                <span className="text-muted-foreground">{q.answer}</span>
              </div>
            ) : (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/60">
                <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                Skipped
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
