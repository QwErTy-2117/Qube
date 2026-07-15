# Thinking Levels Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thinking/reasoning level selector in the model picker popup, auto-detect thinking support from API capabilities, show brain icon in manage-models popup.

**Architecture:** Extends the existing `ModelOption.efforts` mechanism (already supports effort selection) with a `reasoning` capability field detected during model fetching. A new `detectModelThinkingSupport` heuristic function handles flexible API detection. The effort flows to the backend via the existing assistant-ui model context → `AssistantChatTransport` → `config.reasoningEffort` pipeline; only `route.ts` and `agent.ts` need minor changes to forward it to `streamText()`.

**Tech Stack:** assistant-ui model-selector, shadcn, lucide-react BrainIcon, Vercel AI SDK

---

### Task 1: `detectModelThinkingSupport` heuristic + BrainIcon

**Files:**
- Create: `lib/agent/thinking-support.ts`
- Modify: `components/shared/settings-dialog.tsx` (FetchedModel type, fetchProviderModels, BrainIcon in manage-models popup)

- [ ] **Step 1: Create `lib/agent/thinking-support.ts`**

```typescript
export function detectModelThinkingSupport(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (
    // OpenAI reasoning models
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.includes("gpt-5") ||
    lower.includes("gpt-5.5") ||
    lower.includes("gpt-5.6") ||
    // Anthropic extended thinking models
    (lower.includes("claude") && /sonnet.*4\.\d|opus.*4\.\d|fable|mythos/.test(lower)) ||
    lower.includes("claude-4") ||
    lower.includes("claude-5") ||
    // Google reasoning
    lower.includes("gemini-2.5-pro") ||
    lower.includes("gemini-thinking") ||
    // DeepSeek
    lower.includes("deepseek-r1") ||
    lower.includes("deepseek-v3")
  ) {
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Update FetchedModel type and fetchProviderModels in settings-dialog.tsx**

Add `reasoning` to the type and detection logic alongside imageInput:

```typescript
interface FetchedModel {
  id: string;
  imageInput: boolean;
  reasoning: boolean;
}
```

In the model loop (around line 370-374), add reasoning detection:

```typescript
const reasoning =
  m.capabilities?.reasoning?.supported === true ||
  m.capabilities?.reasoning === true ||
  m.reasoning?.supported === true ||
  m.reasoning === true ||
  m.architecture?.reasoning === true ||
  detectModelThinkingSupport(m.id);
```

```typescript
models.push({ id: m.id, imageInput, reasoning });
```

Import `detectModelThinkingSupport` at the top of the file alongside `detectModelImageSupport`.

- [ ] **Step 3: Add BrainIcon to manage-models popup in settings-dialog.tsx**

Import `BrainIcon` from lucide-react (alongside existing EyeIcon import).

After line 1779 (`{m.imageInput ? <EyeIcon ... /> : null}`), add:

```typescript
{m.reasoning ? <BrainIcon className="size-3.5 text-muted-foreground/50 shrink-0" /> : null}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/thinking-support.ts components/shared/settings-dialog.tsx
git commit -m "feat: detect model thinking support from API capabilities + BrainIcon in provider popup"
```

---

### Task 2: Wire reasoning into ModelOption and ModelSelectorEffort

**Files:**
- Modify: `components/assistant-ui/model-selector.tsx`

- [ ] **Step 1: Update `ModelSelectorEffort` to show "Off" disabled for non-thinking models**

The component currently returns `null` when `efforts` is empty. Change it to show "Off" disabled instead, using a new optional prop `thinkingCapable` or by checking the selected model's capabilities.

Add a `ModelOption.reasoning` field:

```typescript
export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: readonly string[];
  efforts?: boolean | readonly ModelSelectorEffortOption[];
  reasoning?: {
    supported: boolean;
    effortLevels?: string[];
  };
};
```

- [ ] **Step 2: Wrap `ModelSelectorModelContext` to also pass `reasoning` into efforts**

Modify `getModelEfforts` to handle reasoning:

```typescript
function getModelEfforts(
  model: ModelOption | undefined,
): readonly ModelSelectorEffortOption[] | undefined {
  if (!model) return undefined;
  // If reasoning is explicitly unsupported, show just "Off" disabled
  if (model.reasoning?.supported === false) {
    return [{ id: "off", name: "Off" }];
  }
  if (!model.efforts) return undefined;
  return model.efforts === true ? DEFAULT_EFFORT_OPTIONS : model.efforts;
}
```

- [ ] **Step 3: Make effort buttons disable-able**

Modify `ModelSelectorEffort` to add `disabled` styling when effort is "off". Each button should get `disabled={effort === "off"}` and corresponding disabled styling:

```typescript
{efforts.map((option) => {
  const isActive = option.id === effort;
  const isDisabled = effort === "off";
  return (
    <button
      key={option.id}
      type="button"
      aria-pressed={isActive}
      data-state={isActive ? "on" : "off"}
      disabled={isDisabled}
      onClick={() => isDisabled ? undefined : setEffort(option.id)}
      className={cn(
        "focus-visible:ring-ring/50 rounded-md px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-2",
        isActive
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:text-foreground",
        isDisabled && "opacity-50 cursor-not-allowed",
      )}
    >
      {option.name}
    </button>
  );
})}
```

Also need to handle the `useModelSelectorEfforts` — when efforts has only ["off"], set the default effort to "off" automatically:

```typescript
// In ModelSelectorRoot, after deriving activeEffort:
const activeEffort = resolveEffort(efforts, effort);
// Auto-set "off" when model doesn't support reasoning
useEffect(() => {
  if (efforts?.length === 1 && efforts[0].id === "off" && effort !== "off") {
    setEffort("off");
  }
}, [efforts, effort, setEffort]);
```

- [ ] **Step 4: Show brain icon in `ModelSelectorValue` when thinking is active**

Import `BrainIcon` from `lucide-react`.

In `ModelSelectorValue`, after the model name span and before effortName, show a brain icon when effort is active and != "off":

```typescript
{selectedModel.reasoning?.supported && effort && effort !== "off" && (
  <BrainIcon className="size-3.5 text-muted-foreground/50 shrink-0" />
)}
```

Also add `reasoning` to the context value via `selectedModel`.

- [ ] **Step 5: Commit**

```bash
git add components/assistant-ui/model-selector.tsx
git commit -m "feat: reactive thinking effort selector with Off state and brain icon"
```

---

### Task 3: Pass reasoning from provider config into ModelOption

**Files:**
- Modify: `components/examples/base.tsx`

- [ ] **Step 1: In `base.tsx` `ModelPicker`, set `efforts` and `reasoning` on ModelOption**

When building the `toggledModels` array (around line 173-177), add:

```typescript
toggledModels.push({
  id: m.id,
  name: m.name,
  icon: renderLobeIcon(iconName, 16),
  efforts: m.reasoning?.supported ? true : undefined,
  reasoning: m.reasoning,
});
```

Now the `ModelPicker` tells the model selector whether the model supports thinking and what effort options to show.

- [ ] **Step 2: Commit**

```bash
git add components/examples/base.tsx
git commit -m "feat: pass reasoning capability from provider config into ModelOption"
```

---

### Task 4: Wire reasoningEffort to backend

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `lib/agent/agent.ts`

- [ ] **Step 1: Destructure reasoningEffort in route.ts and pass to createAgent**

In `app/api/chat/route.ts` around line 213-214:

```typescript
const { messages, threadId, config, customSystemPrompt, temperature, userName, userAbout, instanceId } = body;
const modelName = config?.modelName;
const reasoningEffort = config?.reasoningEffort;
```

Around line 284-287 where `createAgent` is called, add:

```typescript
const agent = await createAgent({
  messages: modelMessages,
  threadId: currentThreadId,
  modelName,
  reasoningEffort,
  customSystemPrompt,
  temperature: temperature !== undefined ? Number(temperature) : undefined,
  userName,
  userAbout,
  instanceId,
});
```

- [ ] **Step 2: Add reasoningEffort to AgentConfig in agent.ts and pass to streamText**

In `lib/agent/agent.ts`, add to the `AgentConfig` type (around line 85-95):

```typescript
export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  userName?: string;
  userAbout?: string;
  instanceId?: string;
  reasoningEffort?: string;
};
```

In the `streamText` call (around line 151-161), add:

```typescript
const result = streamText({
  model: createModelClient(config.modelName || ""),
  system: systemPrompt,
  messages: config.messages as any,
  maxRetries: 0,
  stopWhen: async ({ steps }: { steps: any[] }) => {
    if (steps.length >= 15) return true;
    return false;
  },
  temperature: config.temperature !== undefined ? config.temperature : 0.7,
  reasoningEffort: config.reasoningEffort,
  tools: ({/* ... */}) as any,
});
```

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts lib/agent/agent.ts
git commit -m "feat: wire reasoningEffort from UI to streamText in backend"
```
