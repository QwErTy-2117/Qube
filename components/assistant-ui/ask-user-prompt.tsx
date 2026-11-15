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
    if (!threadId) {
      setPending(null);
      return;
    }
    try {
      const params = `?threadId=${encodeURIComponent(threadId)}`;
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
    // Scope strictly to this thread: a questionnaire raised elsewhere must
    // never take over another chat's composer.
    if (!threadId) {
      setPending(null);
      return;
    }
    const interval = setInterval(check, 500);
    check();
    return () => clearInterval(interval);
  }, [check, threadId]);

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
