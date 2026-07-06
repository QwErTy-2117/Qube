# Thinking Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle button near the model selector that enables/disables `reasoningEffort: "medium"` for supported models.

**Architecture:** A `ThinkingToggle` component uses `useAui().modelContext().register()` to inject `config.reasoningEffort` into the runtime's POST body. The backend passes it through to `streamText` as the OpenAI-compatible `reasoning_effort` parameter.

**Tech Stack:** React, assistant-ui (`useAui`, `modelContext`), `lucide-react` (`Sparkles` icon), localStorage

---

### Task 1: Create ThinkingToggle component

**Files:**
- Create: `components/assistant-ui/thinking-toggle.tsx`

- [ ] **Step 1: Create the component file**

```tsx
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
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/assistant-ui/thinking-toggle.tsx
git commit -m "feat: add ThinkingToggle component"
```

---

### Task 2: Wire ThinkingToggle into ComposerAction

**Files:**
- Modify: `components/examples/base.tsx:643-649`

- [ ] **Step 1: Add import**

Add after the `ComposerAddAttachment` import (line 4):
```tsx
import { ThinkingToggle } from "@/components/assistant-ui/thinking-toggle";
```

- [ ] **Step 2: Render next to ModelPicker**

Replace:
```tsx
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPicker />
      </div>
```

With:
```tsx
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPicker />
        <ThinkingToggle />
      </div>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add components/examples/base.tsx
git commit -m "feat: render ThinkingToggle in ComposerAction"
```

---

### Task 3: Pass reasoningEffort through backend

**Files:**
- Modify: `lib/agent/agent.ts:43-50` (AgentConfig type) and `lib/agent/agent.ts:75-85` (streamText call)
- Modify: `app/api/chat/route.ts:155` (destructure) and `route.ts:217-223` (pass to createAgent)

- [ ] **Step 1: Add reasoningEffort to AgentConfig**

In `lib/agent/agent.ts`, add `reasoningEffort?` to the type:
```typescript
export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  reasoningEffort?: string;
};
```

- [ ] **Step 2: Pass reasoningEffort to streamText**

In `lib/agent/agent.ts`, add `reasoningEffort` to the `streamText` options object (after the `temperature` line):
```typescript
    temperature: config.temperature !== undefined ? config.temperature : 0.7,
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
```

- [ ] **Step 3: Destructure reasoningEffort in route.ts**

Change:
```typescript
    const { messages, threadId, config, customSystemPrompt, temperature } = body;
    const modelName = config?.modelName;
```

To:
```typescript
    const { messages, threadId, config, customSystemPrompt, temperature } = body;
    const modelName = config?.modelName;
    const reasoningEffort = config?.reasoningEffort;
```

- [ ] **Step 4: Pass reasoningEffort to createAgent**

Change the `createAgent` call:
```typescript
            const agent = await createAgent({
              messages: modelMessages,
              threadId: currentThreadId,
              modelName,
              customSystemPrompt,
              temperature: temperature !== undefined ? Number(temperature) : undefined,
            });
```

To:
```typescript
            const agent = await createAgent({
              messages: modelMessages,
              threadId: currentThreadId,
              modelName,
              customSystemPrompt,
              temperature: temperature !== undefined ? Number(temperature) : undefined,
              reasoningEffort,
            });
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add lib/agent/agent.ts app/api/chat/route.ts
git commit -m "feat: wire reasoningEffort through backend to streamText"
```
