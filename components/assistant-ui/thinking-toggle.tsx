"use client";

import { Sparkles } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { TooltipIconButton } from "./tooltip-icon-button";

export const ThinkingToggle: FC = () => {
  const [thinking, setThinking] = useState(false);
  const api = useAui();

  useEffect(() => {
    setThinking(localStorage.getItem("qube-thinking") === "on");
  }, []);

  const toggle = () => {
    const next = !thinking;
    setThinking(next);
    localStorage.setItem("qube-thinking", next ? "on" : "off");
  };

  useEffect(() => {
    return api.modelContext().register({
      getModelContext: () => ({
        config: {
          ...(thinking ? { reasoningEffort: "medium" } : undefined),
        },
      }),
    });
  }, [api, thinking]);

  return (
    <TooltipIconButton
      tooltip={thinking ? "Thinking: On" : "Thinking: Off"}
      side="bottom"
      variant="ghost"
      size="icon"
      className={`!size-7 rounded-full p-1 ${thinking ? "text-sky-500" : "text-muted-foreground"}`}
      aria-label={thinking ? "Disable thinking" : "Enable thinking"}
      onClick={toggle}
    >
      <Sparkles
        className="size-4"
        fill={thinking ? "currentColor" : "none"}
      />
    </TooltipIconButton>
  );
};
