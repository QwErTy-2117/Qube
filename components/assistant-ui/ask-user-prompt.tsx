"use client";

import { useEffect, useState, useCallback } from "react";
import { HelpCircleIcon, SendHorizonalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type PendingQuestion = {
  requestId: string;
  question: string;
  options?: string[];
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

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <HelpCircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">
            {question.question}
          </p>
        </div>
      </div>
      {question.options && question.options.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {question.options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              onClick={() => onRespond(option)}
              className="h-8 gap-1.5 rounded-full"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customAnswer.trim()) {
                onRespond(customAnswer.trim());
              }
            }}
            placeholder="Type your answer..."
            className="bg-muted text-foreground placeholder:text-muted-foreground/60 flex-1 rounded-full border border-border px-4 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              if (customAnswer.trim()) onRespond(customAnswer.trim());
            }}
            disabled={!customAnswer.trim()}
            className="h-8 gap-1.5 rounded-full"
          >
            <SendHorizonalIcon className="size-3.5" />
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
