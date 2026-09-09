/**
 * ask_question backing store — in-memory pending questionnaires.
 *
 * Flow: harness tool `ask_question` creates a questionnaire and awaits
 * the promise; the docked QuestionPanel polls /api/ask-user/pending and
 * submits via /api/ask-user/respond, which resolves the promise so the
 * agent continues with real answers. Stale entries are purged on read.
 */

export type QuestionDef = {
  id: string;
  question: string;
  header?: string;
  options?: string[];
  multiSelect?: boolean;
};

export type PendingQuestionnaire = {
  requestId: string;
  threadId: string;
  questions: QuestionDef[];
  createdAt: number;
  answered: boolean;
};

export type QuestionAnswers = Record<string, string | string[]>;

type QuestionResolver = {
  resolve: (value: QuestionAnswers) => void;
  reject: (error: Error) => void;
};

const pendingResolvers = new Map<string, QuestionResolver>();
const questionnaireStore = new Map<string, PendingQuestionnaire>();
let requestCounter = 0;

// Unanswered entries older than this are treated as stale (surfaced once,
// then dropped so the panel never sticks on dead runs).
const STALE_MS = 30 * 60 * 1000;

function generateRequestId(): string {
  return `q_${Date.now().toString(36)}_${++requestCounter}`;
}

export function normalizeQuestions(
  input: unknown,
): QuestionDef[] | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "questions must be a non-empty array" };
  }
  const out: QuestionDef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(input.length, 6); i++) {
    const q = input[i] as Record<string, unknown>;
    if (!q || typeof q.question !== "string" || !q.question.trim()) continue;
    let id =
      typeof q.id === "string" && q.id.trim()
        ? q.id.trim().slice(0, 64)
        : `q${i + 1}`;
    // De-dupe ids so answers stay keyed unambiguously.
    let suffix = 2;
    while (seen.has(id)) id = `${id}_${suffix++}`;
    seen.add(id);
    const options = Array.isArray(q.options)
      ? (q.options as unknown[])
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => o.trim().slice(0, 200))
          .slice(0, 8)
      : undefined;
    out.push({
      id,
      question: q.question.trim().slice(0, 1000),
      header:
        typeof q.header === "string" && q.header.trim()
          ? q.header.trim().slice(0, 120)
          : undefined,
      options: options && options.length > 0 ? options : undefined,
      multiSelect: q.multiSelect === true,
    });
  }
  if (out.length === 0) return { error: "no valid questions provided" };
  return out;
}

function purgeStale() {
  const now = Date.now();
  for (const [id, q] of questionnaireStore) {
    if (q.answered || now - q.createdAt > STALE_MS) {
      questionnaireStore.delete(id);
      pendingResolvers.delete(id);
    }
  }
}

export function createQuestionnaire(
  threadId: string,
  questions: QuestionDef[],
): { requestId: string; promise: Promise<QuestionAnswers> } {
  purgeStale();
  const requestId = generateRequestId();
  questionnaireStore.set(requestId, {
    requestId,
    threadId,
    questions,
    createdAt: Date.now(),
    answered: false,
  });
  const promise = new Promise<QuestionAnswers>((resolve, reject) => {
    pendingResolvers.set(requestId, { resolve, reject });
  });
  return { requestId, promise };
}

export function resolveQuestionnaire(
  requestId: string,
  answers: QuestionAnswers,
): boolean {
  const stored = questionnaireStore.get(requestId);
  const resolver = pendingResolvers.get(requestId);
  if (!stored || stored.answered) return false;
  stored.answered = true;
  questionnaireStore.delete(requestId);
  pendingResolvers.delete(requestId);
  if (resolver) resolver.resolve(answers);
  return true;
}

/** Legacy single-question resolve (kept for API backward compat). */
export function resolveQuestion(requestId: string, answer: any): boolean {
  const stored = questionnaireStore.get(requestId);
  if (!stored || stored.answered) return false;
  const firstId = stored.questions[0]?.id ?? "answer";
  const answers: QuestionAnswers =
    typeof answer === "string"
      ? { [firstId]: answer }
      : answer && typeof answer === "object"
        ? (answer as QuestionAnswers)
        : {};
  return resolveQuestionnaire(requestId, answers);
}

export function getPendingQuestions(threadId?: string): PendingQuestionnaire[] {
  purgeStale();
  const out: PendingQuestionnaire[] = [];
  for (const q of questionnaireStore.values()) {
    if (q.answered) continue;
    if (threadId && q.threadId !== threadId) continue;
    out.push(q);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function createAskUserTool(threadId: string): any {
  // Kept for API compat — the harness builds the real `ask_question`
  // tool in lib/pi/tools.ts; this is not on the execution path.
  return { threadId, interactive: true };
}
