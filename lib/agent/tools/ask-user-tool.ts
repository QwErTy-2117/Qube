const pendingQuestions = new Map<
  string,
  {
    question: string;
    options?: string[];
    multiple?: boolean;
    resolve: (value: string) => void;
    threadId: string;
  }
>();

export type PendingQuestion = {
  requestId: string;
  question: string;
  options?: string[];
  multiple?: boolean;
  threadId: string;
};

export function createPendingQuestion(
  requestId: string,
  question: string,
  options: string[] | undefined,
  threadId: string,
  multiple?: boolean,
): Promise<string> {
  return new Promise<string>((resolve) => {
    pendingQuestions.set(requestId, {
      question,
      options,
      multiple,
      resolve,
      threadId,
    });
  });
}

export function resolveQuestion(requestId: string, answer: string): boolean {
  const entry = pendingQuestions.get(requestId);
  if (!entry) return false;
  entry.resolve(answer);
  pendingQuestions.delete(requestId);
  return true;
}

export function getPendingQuestions(threadId?: string): PendingQuestion[] {
  const questions: PendingQuestion[] = [];
  for (const [requestId, entry] of pendingQuestions) {
    if (threadId && entry.threadId !== threadId) continue;
    questions.push({
      requestId,
      question: entry.question,
      options: entry.options,
      multiple: entry.multiple,
      threadId: entry.threadId,
    });
  }
  return questions;
}
