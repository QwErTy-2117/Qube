"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shared pill-shaped confirm control used by settings popups and the
 * task editor. Cancel sits in a red circle on the left; the confirm button
 * morphs into a green check when saved. Optional `leading` content (e.g. a
 * delete action) lives inside the same group.
 */
export function ConfirmGroup({
  onCancel,
  onConfirm,
  saving = false,
  saved = false,
  confirmDisabled = false,
  confirmLabel = "Confirm",
  leading,
  className,
}: {
  onCancel?: () => void;
  onConfirm: () => void;
  saving?: boolean;
  saved?: boolean;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "ml-auto flex w-fit shrink-0 items-center gap-2 rounded-full border border-border/60 bg-muted/10 px-1.5 py-1.5 transition-colors hover:bg-muted/20",
        className,
      )}
    >
      {leading}
      {onCancel ? (
        <button
          onClick={onCancel}
          type="button"
          className="flex size-8 cursor-pointer items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-500/10"
          title="Cancel"
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
      <div className="relative">
        <AnimatePresence mode="wait">
          {saved ? (
            <motion.div
              key="saved"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <CheckIcon className="size-4" />
            </motion.div>
          ) : (
            <motion.div
              key="save"
              initial={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
            >
              <Button
                onClick={onConfirm}
                disabled={saving || confirmDisabled}
                className="h-8 rounded-full px-4 font-semibold"
                size="sm"
              >
                {saving ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  confirmLabel
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
