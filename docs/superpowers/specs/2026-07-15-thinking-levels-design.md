# Thinking Levels Selector

## Goal

Add a thinking/reasoning level selector at the bottom of the model selector popup,
auto-detect which models support thinking from provider API capabilities, and show
a brain icon in the manage-models popup for thinking-capable models.

## Design

### 1. Schema — `reasoning` field on model config

Each model in `ProviderConfig.models[]` gains an optional `reasoning` field:

```typescript
interface ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
  icon?: string;
  imageInput?: boolean;
  reasoning?: {
    supported: boolean;
    effortLevels?: string[];  // e.g. ["minimal","low","medium","high"]
  };
}
```

Persisted alongside existing model config in `localStorage("qube-providers")` and
synced to the provider store.

### 2. Flexible API detection

In `settings-dialog.tsx` `fetchProviderModels()`, detect reasoning alongside vision:

- `m.capabilities?.reasoning?.supported === true` (OpenAI Responses API format)
- `m.capabilities?.reasoning === true` (simpler boolean)
- `m.reasoning?.supported === true` (Anthropic-like format)
- `m.reasoning === true`
- `m.architecture?.reasoning === true`

Fallback heuristic via new `detectModelThinkingSupport()` in a new file
`lib/agent/thinking-support.ts`:
- `o1`, `o3`, `o4-mini` (OpenAI reasoning models)
- `gpt-5.x` / `gpt-5.6` (OpenAI reasoning-capable)
- `claude-sonnet-4.6+` / `claude-opus-4.5+` (Anthropic extended thinking)
- `claude-fable-5` / `claude-mythos-5`
- `gemini-2.5-pro` / `gemini-thinking`
- `deepseek-r1`
- `deepseek-v3`

When the API reports `effort_levels`, use them; otherwise default to
`["low", "medium", "high"]`.

### 3. Brain icon in manage-models popup

In `settings-dialog.tsx` manage-models popup, next to the existing `<EyeIcon>`:

```tsx
{m.reasoning?.supported ? (
  <BrainIcon className="size-3.5 text-muted-foreground/50 shrink-0" />
) : null}
```

Same styling as the `EyeIcon` — `size-3.5 text-muted-foreground/50 shrink-0`.

### 4. Model selector effort UI

The existing `ModelSelectorEffort` component (at bottom of popup) becomes reactive:

- When the selected model has `reasoning.supported === false`:
  - Show a single "Off" button, disabled
- When `reasoning.supported === true`:
  - Show "Low / Medium / High" toggle buttons, one active
  - Default: "Medium"
- `ModelSelectorValue` component shows a small `<BrainIcon>` when thinking is enabled
  (effort !== "off"), next to the model name
- `ModelOption` type gets `reasoning?: { supported: boolean; effortLevels?: string[] }`

The `ModelPicker` in `base.tsx` passes `reasoning` from the provider model config
into the `ModelOption` when building the model list.

### 5. Wire reasoningEffort to streamText()

`reasoningEffort` already flows from the UI to the server:
- `ModelSelectorModelContext` registers it with assistant-ui's `modelContext`
- `AssistantChatTransport` reads `context.config` and includes it in the POST
  body as `config.reasoningEffort`
- The API route already receives `config` but only destructures `config?.modelName`

Changes needed:

**`app/api/chat/route.ts`** — destructure `reasoningEffort` from `config` and
pass to `createAgent()`:

```typescript
const { messages, threadId, config, ... } = body;
const modelName = config?.modelName;
const reasoningEffort = config?.reasoningEffort;  // NEW
// ...
const agent = await createAgent({
  messages: modelMessages,
  threadId: currentThreadId,
  modelName,
  reasoningEffort,  // NEW
  // ...
});
```

**`lib/agent/agent.ts`** — add `reasoningEffort` to `AgentConfig` and pass to
`streamText()`:

```typescript
const result = streamText({
  model: createModelClient(config.modelName || ""),
  system: systemPrompt,
  messages: config.messages as any,
  reasoningEffort: config.reasoningEffort,  // NEW
  ...
});
```

The AI SDK passes this through to the provider as `reasoning_effort` (OpenAI),
`thinking` (Anthropic), or the provider's equivalent. Providers that don't
support reasoning silently ignore it.

**`lib/scheduler/task-executor.ts`** — no change needed. Scheduled tasks run
without reasoning by default (no user-facing selector).

### Files Changed

| File | Change |
|---|---|
| `lib/agent/thinking-support.ts` | NEW — `detectModelThinkingSupport()` heuristic |
| `components/shared/settings-dialog.tsx` | Add `reasoning` to `FetchedModel`, fetch detection logic, add `BrainIcon` in manage-models popup |
| `lib/agent/provider-store.ts` | No change needed (schema is interface-only, stored as JSON) |
| `components/assistant-ui/model-selector.tsx` | Add `reasoning` to `ModelOption`, make `ModelSelectorEffort` reactive, add brain icon to `ModelSelectorValue` |
| `components/examples/base.tsx` | Pass `reasoning` from provider config into `ModelOption` |
| `app/api/chat/route.ts` | Destructure `reasoningEffort` from `config`, pass to `createAgent()` |
| `lib/agent/agent.ts` | Accept `reasoningEffort` in `AgentConfig`, pass to `streamText()` |

### Non-goals

- No separate toggle button in composer bar (supersedes `2026-07-06-thinking-toggle-design.md`)
- No per-thread persistence — global model-level setting
- No per-provider reasoning config in provider settings (future concern)
