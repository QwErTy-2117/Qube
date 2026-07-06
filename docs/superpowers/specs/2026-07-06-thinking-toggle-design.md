# Thinking Toggle Button

## Goal

Add a toggle button near the model selector in the composer bar to enable/disable
reasoning/chain-of-thought ("thinking") mode for supported models.

## Design

### UI: `ThinkingToggle` button

- A `Sparkles` icon button rendered next to `ModelPicker` in `ComposerAction`
- **Active state**: icon highlighted (accent/filled color) — thinking is ON
- **Inactive state**: muted outline icon — thinking is OFF
- Click toggles between on/off
- Renders a tooltip on hover ("Thinking: On" / "Thinking: Off")

### State persistence

- `localStorage("qube-thinking")` stores `"on"` or `"off"`
- On mount: reads from localStorage, defaults to `"off"`
- Does NOT need per-thread persistence — it's a user preference

### Data flow

```
ThinkingToggle (onClick)
  → localStorage("qube-thinking") = "on" | "off"
  → api.modelContext().register({ config: { reasoningEffort: "medium" } })
    (merges with ModelSelectorModelContext's modelName config)
  → POST /api/chat body includes { config: { modelName, reasoningEffort } }
  → route.ts destructures config.reasoningEffort
  → createAgent({ reasoningEffort })
  → streamText({ reasoningEffort })
  → provider handles or silently ignores
```

The `reasoningEffort` value is always `"medium"` when the toggle is on. The
OpenAI-compatible `reasoning_effort` parameter is passed to `streamText` — the
provider ignores it for models that don't support it, and activates thinking
for models that do (e.g., o-series, reasoning models).

### Backend

| File | Change |
|---|---|
| `lib/agent/agent.ts` | Add `reasoningEffort?: string` to `AgentConfig`; pass to `streamText` |
| `app/api/chat/route.ts` | Destructure `reasoningEffort` from `config`, pass to `createAgent` |

### Frontend

| File | Change |
|---|---|
| `components/assistant-ui/thinking-toggle.tsx` | NEW — toggle button component |
| `components/examples/base.tsx` | Import `ThinkingToggle`, render in `ComposerAction` next to `ModelPicker` |

### Non-goals

- No low/medium/high selector — just on/off with `"medium"` as the fixed effort level
- No per-thread persistence — global user preference
- No model-specific logic — parameter is passed to all models; providers that
  don't support it ignore it
