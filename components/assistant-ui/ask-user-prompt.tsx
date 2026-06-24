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
    <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-800/50 dark:bg-blue-950/20">
      <div className="flex items-start gap-3">
        <HelpCircleIcon className="mt-0.5 size-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
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
              className="h-8 gap-1.5 rounded-full border-blue-200 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-800/50 dark:text-blue-300 dark:hover:bg-blue-900/30"
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
            className="flex-1 rounded-full border border-blue-200 bg-white px-4 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-100 dark:placeholder-blue-300/50 dark:focus:border-blue-500"
            autoFocus
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              if (customAnswer.trim()) onRespond(customAnswer.trim());
            }}
            disabled={!customAnswer.trim()}
            className="h-8 gap-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:text-blue-950 dark:hover:bg-blue-400"
          >
            <SendHorizonalIcon className="size-3.5" />
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
