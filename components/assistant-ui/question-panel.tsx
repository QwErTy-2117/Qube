"use client";

import { useEffect, useMemo, useState, type FC } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  ArrowUpIcon,
  HelpCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAskUserPoller } from "@/components/assistant-ui/ask-user-prompt";

type PerQuestionState = {
  selected: Set<string>;
  custom: string;
};

function emptyState(): PerQuestionState {
  return { selected: new Set(), custom: "" };
}

/**
 * QuestionPanel — docked interactive questionnaire above the composer.
 * Same visual language as GoalsPanel (rounded-2xl bordered card, header
 * row, expandable motion body). Shows ONE question at a time with a
 * stepper so the popup stays compact; answers accumulate and are sent
 * together, so the agent still receives them all at once.
 */
export const QuestionPanel: FC = () => {
  const { pending, respond } = useAskUserPoller();
  const [expanded, setExpanded] = useState(true);
  const [state, setState] = useState<Record<string, PerQuestionState>>({});
  const [index, setIndex] = useState(0);

  const questions = useMemo(
    () => (pending ? pending.questions : []),
    [pending]
  );

  // Reset answers whenever a new questionnaire arrives.
  useEffect(() => {
    setState({});
    setIndex(0);
    setExpanded(true);
  }, [pending?.requestId]);

  // Keep the step in range if the questionnaire changes underneath.
  const safeIndex = questions.length === 0 ? 0 : Math.min(index, questions.length - 1);
  const current = questions[safeIndex];

  if (!pending || questions.length === 0 || !current) return null;

  const get = (id: string): PerQuestionState => state[id] ?? emptyState();

  const toggleOption = (id: string, opt: string, multi: boolean) => {
    setState((prev) => {
      const cur = prev[id] ?? emptyState();
      const next = new Set(cur.selected);
      if (multi) {
        if (next.has(opt)) next.delete(opt);
        else next.add(opt);
      } else {
        next.clear();
        next.add(opt);
      }
      return { ...prev, [id]: { selected: next, custom: cur.custom } };
    });
  };

  const setCustom = (id: string, custom: string) => {
    setState((prev) => {
      const cur = prev[id] ?? emptyState();
      return { ...prev, [id]: { selected: cur.selected, custom } };
    });
  };

  const answerOf = (id: string): string | string[] | null => {
    const cur = get(id);
    const q = questions.find((x) => x.id === id);
    const picked = [...cur.selected];
    const custom = cur.custom.trim();
    if (q?.multiSelect) {
      const all = custom ? [...picked, custom] : picked;
      return all.length > 0 ? all : null;
    }
    if (custom) return custom;
    return picked.length > 0 ? picked[0] : null;
  };

  const currentAnswered = answerOf(current.id) !== null;
  const isLast = safeIndex === questions.length - 1;
  const singleQuestion = questions.length === 1;

  const goBack = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => {
    if (!currentAnswered) return;
    setIndex((i) => Math.min(questions.length - 1, i + 1));
  };

  const submit = () => {
    // Every step must be answered before the bundle goes out, so the
    // agent always receives the complete set at once.
    for (const q of questions) {
      if (answerOf(q.id) === null) {
        const missing = questions.findIndex((x) => x.id === q.id);
        if (missing >= 0) setIndex(missing);
        return;
      }
    }
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const a = answerOf(q.id);
      if (a !== null) answers[q.id] = a;
    }
    respond(answers);
  };

  return (
    <div
      data-slot="aui_question-panel"
      className="w-full overflow-hidden rounded-2xl border border-border bg-background shadow-lg"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 bg-background px-4 py-2.5 text-left transition-colors hover:bg-muted"
      >
        <HelpCircleIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Question {safeIndex + 1} of {questions.length}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-border/40 bg-background"
          >
            <div className="px-4 py-3">
              <div key={current.id}>
                {current.header && (
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
                    {current.header}
                  </p>
                )}
                <p className="mt-0.5 text-sm leading-snug text-foreground">
                  {current.question}
                </p>
                {current.options && current.options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {current.options.map((opt) => {
                      const cur = get(current.id);
                      const isSelected = cur.selected.has(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            toggleOption(current.id, opt, current.multiSelect === true)
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-muted/30 text-foreground hover:bg-muted/50"
                          )}
                        >
                          {current.multiSelect && (
                            <span
                              className={cn(
                                "flex size-4 items-center justify-center rounded-sm border",
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/30"
                              )}
                            >
                              {isSelected && (
                                <CheckIcon className="size-3" />
                              )}
                            </span>
                          )}
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  type="text"
                  value={get(current.id).custom}
                  onChange={(e) => setCustom(current.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (!isLast) goNext();
                      else submit();
                    }
                  }}
                  placeholder={
                    current.options && current.options.length > 0
                      ? "Or type your own answer…"
                      : "Type your answer…"
                  }
                  aria-label={`Answer for question ${safeIndex + 1}`}
                  className="mt-2 min-h-9 w-full rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-1.5 px-4 pb-3">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {questions.map((q, i) => (
                  <div
                    key={q.id}
                    className={`size-2 rounded-full transition-all duration-300 ${
                      i === safeIndex ? "w-5 bg-primary" : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              {singleQuestion ? (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!currentAnswered}
                    aria-label="Send answer"
                    className="flex !size-7 items-center justify-center !rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] hover:bg-primary/90 disabled:opacity-40"
                  >
                    <ArrowUpIcon className="size-4.5" />
                  </button>
                </div>
              ) : (
              <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/60 backdrop-blur-sm px-1.5 py-1.5">
                {safeIndex > 0 && (
                  <button
                    type="button"
                    onClick={goBack}
                    title="Go Back"
                    className="flex items-center justify-center size-7 rounded-full text-foreground/70 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </button>
                )}
                {!isLast ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!currentAnswered}
                    title="Next"
                    className="flex items-center justify-center size-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronRightIcon className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!currentAnswered}
                    aria-label="Send answers"
                    className="flex !size-7 items-center justify-center !rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] hover:bg-primary/90 disabled:opacity-40"
                  >
                    <ArrowUpIcon className="size-4.5" />
                  </button>
                )}
              </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
