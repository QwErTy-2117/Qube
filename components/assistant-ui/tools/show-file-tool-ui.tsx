"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

/**
 * Inline present_file rendering is disabled: all presented files render
 * once in the slim PresentedFiles list at the bottom of the message
 * (never stacked on top of the reply). This stays registered so no
 * fallback UI renders for present_file parts.
 */
export const ShowFileToolUI: ToolCallMessagePartComponent = () => {
  return null;
};
