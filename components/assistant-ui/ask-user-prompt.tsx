"use client";

import { useEffect, useState, useCallback } from "react";

export type PanelQuestion = {
  id: string;
  question: string;
  header?: string;
  options?: string[];
  multiSelect?: boolean;
};

export type PendingQuestionnaire = {
  requestId: string;
  threadId: string;
  questions: PanelQuestion[];
  createdAt: number;
};

export function useAskUserPoller(threadId?: string) {
  const [pending, setPending] = useState<PendingQuestionnaire | null>(null);

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
    async (answers: Record<string, string | string[]>) => {
      if (!pending) return;
      try {
        await fetch("/api/ask-user/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: pending.requestId,
            answers,
          }),
        });
      } catch {}
      setPending(null);
    },
    [pending],
  );

  return { pending, respond, clear: () => setPending(null) };
}
