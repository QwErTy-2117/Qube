"use client";

import { useEffect, useState, useCallback } from "react";
import { HelpCircleIcon, ArrowUpIcon, CheckIcon } from "lucide-react";

type PendingQuestion = {
  requestId: string;
  question: string;
  options?: string[];
  multiple?: boolean;
  threadId: string;
};

export function useAskUserPoller(threadId?: string) {
  const [pending, setPending] = useState<PendingQuestion | null>(null);

  const check = useCallback(async () => {
    try {
      const params = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
      const res = await fetch(`/api/ask-user/pending${params}`);
      const data = await res.json();
      if (data.questions && data.questions.length > 0) {
        setPending(data.questions[0]);
        return;
      }
      setPending(null);
    } catch {
      setPending(null);
    }
  }, [threadId]);

  useEffect(() => {
    const interval = setInterval(check, 500);
    check();
    return () => clearInterval(interval);
  }, [check]);

  const respond = useCallback(
    async (answer: string) => {
      if (!pending) return;
      try {
        await fetch("/api/ask-user/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: pending.requestId,
            answer,
          }),
        });
      } catch {}
      setPending(null);
    },
    [pending],
  );

  return { pending, respond, clear: () => setPending(null) };
}

export function AskUserBar({
  question,
  onRespond,
}: {
  question: PendingQuestion;
  onRespond: (answer: string) => void;
}) {
  const [customAnswer, setCustomAnswer] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());

  const toggleOption = useCallback((opt: string) => {
    if (question.multiple) {
      setSelectedOptions((prev) => {
        const next = new Set(prev);
        if (next.has(opt)) next.delete(opt);
        else next.add(opt);
        return next;
      });
    } else {
      setSelectedOptions(new Set([opt]));
    }
  }, [question.multiple]);

  const sendAnswer = useCallback(() => {
    const answer = question.options && question.options.length > 0
      ? [...selectedOptions].join(", ")
      : customAnswer.trim();
    if (!answer) return;
    onRespond(answer);
  }, [question.options, selectedOptions, customAnswer, onRespond]);

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <HelpCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground">{question.question}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {question.options && question.options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {question.options.map((opt) => {
              const isSelected = selectedOptions.has(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleOption(opt)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-foreground hover:bg-muted/50"
                  }`}
                >
                  {question.multiple && (
                    <span className={`flex size-4 items-center justify-center rounded-sm border ${
                      isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                    }`}>
                      {isSelected && <CheckIcon className="size-3" />}
                    </span>
                  )}
                  {opt}
                </button>
              );
            })}
          </div>
        )}
        {(!question.options || question.options.length === 0) && (
          <input
            type="text"
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customAnswer.trim()) sendAnswer();
            }}
            placeholder="Type your answer..."
            className="min-h-10 flex-1 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1 text-base text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-1 focus:ring-ring"
            autoFocus
          />
        )}
        <div className="flex justify-end">
          <button
            onClick={sendAnswer}
            disabled={question.options && question.options.length > 0 ? selectedOptions.size === 0 : !customAnswer.trim()}
            className="flex !size-7 items-center justify-center !rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUpIcon className="size-4.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
