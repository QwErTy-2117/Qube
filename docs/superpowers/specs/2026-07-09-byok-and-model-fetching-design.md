# BYOK + Model Auto-Fetch Design

## Problem

1. **OpenCode Zen** is hardcoded as the only AI provider — all inference routes through `zen.chat()`. Users cannot use their own API keys for actual inference.
2. **Models are hardcoded** in `DEFAULT_PROVIDERS` — stale lists that don't reflect what each provider actually offers.
3. **External providers are decorative** — configuring an API key in settings has no effect on actual model calls.

## Solution

Remove OpenCode Zen entirely. Make the app fully BYOK (Bring Your Own Key) with auto-fetched models and dynamic client creation.

## Architecture

```
Frontend (localStorage)
  │
  │  qube-providers (ProviderConfig[])
  │  qube-default-model ("providerId:modelId")
  │
  ├──► POST /api/providers/sync ──► Server-side ProviderStore (Map)
  │       (called on every save)
  │
  ├──► POST /api/chat  ──► createAgent()
  │       modelName = "openai:gpt-4o"     │
  │                                        ▼
  │                              createModelClient("openai:gpt-4o")
  │                              → looks up provider in ProviderStore
  │                              → creates OpenAI client with apiKey+baseURL
  │                              → returns chat model
  │                                        │
  │                              agent.ts / memory-agent.ts / task-executor.ts
  │
  └──► ModelPicker reads providers → builds ModelOption[] with qualified IDs
```

## Detailed Design

### 1. Provider Model Auto-Fetch & Validation

- `DEFAULT_PROVIDERS` loses all hardcoded model arrays (`models: []` for all)
- When "Configure Provider" dialog opens, call `GET {baseURL}/models` with `Authorization: Bearer {apiKey}`
- Parse OpenAI-compatible response: `{ data: [{ id, object: "model" }, ...] }`
- Each fetched model → `{ id: "providerId:modelId", name: modelId, enabled: true, icon?: detectModelIcon(modelId, providerId) }`
- **Refresh button** in dialog to re-fetch
- **Provider validation on confirm**: When the user clicks "Confirm" in the Configure Provider dialog, first make a test call to `GET {baseURL}/models` to validate the credentials. If the call fails (network error, 401/403), show an inline error message below the inputs and block saving. If it succeeds, proceed with save.
- **Silent failure** for initial auto-fetch on open — if fetch fails, show empty list, not an error toast. The validation on confirm is the gatekeeper.
- Stores like Ollama/LM Studio (no API key) still pass `Authorization: Bearer ` (empty) — their `/v1/models` responds without auth

### 2. Qualified Model IDs

- Format: `{providerId}:{modelId}` — e.g. `openai:gpt-4o`, `custom:my-model`, `ollama:llama3`
- Display name in UI: the part after `:` (the model name)
- `detectModelIcon(modelId, providerId)` uses `providerId` to pick Lobe icon
- `qube-default-model` stores qualified ID
- No migration — existing saved selections will reset (pre-release)

### 3. Provider Sync Endpoint

**`POST /api/providers/sync`**

Request:
```json
{
  "providers": [
    { "id": "openai", "name": "OpenAI", "baseURL": "https://api.openai.com/v1", "apiKey": "sk-...", "hasApiKey": true, "enabled": true, "models": [...] },
    ...
  ],
  "defaultModelId": "openai:gpt-4o"
}
```

Response: `{ "ok": true }`

**Server-side `ProviderStore`** (`lib/agent/provider-store.ts`):
- In-memory `Map<string, ProviderConfig>` keyed by provider ID
- `defaultModelId: string | null`
- `sync(providers, defaultModelId?)` — replace all entries + default model
- `getProvider(providerId)` — return single provider config
- `getProviderByModel(qualifiedModelId)` — parse `providerId:modelId`, return provider + modelId
- `getDefaultModelId()` — return the default model ID (for scheduler/background use)

**Called from** `settings-dialog.tsx` `saveProviders()` after `localStorage.setItem()`, also sending `qube-default-model` value.

### 4. Dynamic Model Client — `lib/agent/model-client.ts`

```typescript
function createModelClient(qualifiedModelId: string): ChatModel | null
```

- Parses `providerId:modelId` from the qualified ID
- Looks up provider config from `ProviderStore`
- Calls `createOpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })`
- Returns `client.chat(modelId)`
- Returns `null` if provider not found (caller handles error)

Replaces every `zen.chat(...)` call.

### 5. Agent Changes

**`agent.ts`**:
- Remove `zen`, `resolveZenModel` import
- `createAgent()` calls `createModelClient(config.modelName)` instead
- Passes the chat model to `streamText({ model })`

**`memory-agent.ts`**:
- Remove `zen`, `resolveZenModel` import
- Remove `MEMORY_MODEL` env var
- `extractAndStoreMemories()` and `cleanupMemories()` take a `model: ChatModel` parameter
- Callers in `chat/route.ts` pass the model from the current agent

**`task-executor.ts`**:
- Remove `zen`, `resolveZenModel` import
- Calls `createModelClient(ProviderStore.getDefaultModelId())` at the start
- If no default model is configured, throws a clear error ("No AI provider configured")

**`chat/route.ts`**:
- Import `createModelClient` for `verifyCompletion`
- Remove `zen` import
- Pass model to `extractAndStoreMemories` and `cleanupMemories`

### 6. UI Changes

- **Delete** `components/docs/assistant/docs-model-options.tsx`
- **Delete** `constants/model.ts`
- **Modify** `components/examples/base.tsx`:
  - Remove `docsModelOptions` import and fallback
  - If no models from localStorage, show empty array
  - ModelSelector shows disabled state when no models
- **Modify** `components/shared/settings-dialog.tsx`:
  - All `DEFAULT_PROVIDERS` models → `[]`
  - Add fetch logic + validation in Configure Provider dialog (test call on confirm)
  - `saveProviders()` → also calls `POST /api/providers/sync`
  - Delete Provider button: change from icon-only circle to a styled button with `<Trash2Icon className="size-4" /> Delete` text, matching the app's button style

### 7. Files to Delete

- `lib/agent/zen.ts`
- `components/docs/assistant/docs-model-options.tsx`
- `constants/model.ts`

### 8. Files to Clean

- `.env` — remove `OPENCODE_API_KEY` line
- `.env.example` — remove example
- `README.md` — remove OpenCode Zen references

## Data Flow Example

1. User opens Settings → Advanced → clicks "Add Model" → enables OpenAI → fills API key
2. Configure dialog opens → auto-fetches `GET https://api.openai.com/v1/models` → populates model list
3. User enables `gpt-4o` → qualified ID: `openai:gpt-4o`
4. `saveProviders()` → writes to localStorage + syncs to `POST /api/providers/sync`
5. User selects `openai:gpt-4o` in model picker
6. Chat request → `/api/chat` with `modelName: "openai:gpt-4o"`
7. `createAgent()` → `createModelClient("openai:gpt-4o")` → looks up provider → creates OpenAI client → `streamText({ model: client.chat("gpt-4o") })`

## Error Handling

- **No providers configured**: Model picker shows empty/disabled state. Chat returns "No AI provider configured. Please add one in Settings."
- **Provider not found for model**: Chat returns error message. This shouldn't happen if sync is working.
- **Model fetch fails**: Empty model list, user can still type model IDs manually via "Add Custom Model"
- **API key invalid during fetch**: Empty list, user sees no models and can infer the key is wrong
