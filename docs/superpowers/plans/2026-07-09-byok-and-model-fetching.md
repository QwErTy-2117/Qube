# BYOK + Model Auto-Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded OpenCode Zen with fully BYOK architecture where users configure their own AI providers with auto-fetched models.

**Architecture:** Frontend stores provider configs in localStorage and syncs to `POST /api/providers/sync`. Backend stores in-memory `ProviderStore`. All agents (chat, memory, scheduler) use `createModelClient(qualifiedModelId)` to dynamically create OpenAI-compatible clients per request. Model IDs are qualified as `providerId:modelId`. Default models are removed — graceful empty state when no providers configured.

**Tech Stack:** Next.js 16 App Router, AI SDK v6, `@ai-sdk/openai`, `@lobehub/icons`, Zustand (localStorage), Tauri v2

---

### Task 1: Create ProviderStore (`lib/agent/provider-store.ts`)

**Files:**
- Create: `lib/agent/provider-store.ts`

In-memory singleton store for synced provider configs. Keyed by provider ID. Also holds the `defaultModelId` for background/scheduler use.

- [ ] **Step 1: Write ProviderStore**

```typescript
import type { ProviderConfig } from "@/components/shared/settings-dialog";

class ProviderStore {
  private providers = new Map<string, ProviderConfig>();
  private defaultModelId: string | null = null;

  sync(providers: ProviderConfig[], defaultModelId?: string | null) {
    this.providers.clear();
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
    if (defaultModelId !== undefined) {
      this.defaultModelId = defaultModelId || null;
    }
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  getProviderByModel(qualifiedModelId: string): { provider: ProviderConfig; modelId: string } | null {
    const colonIdx = qualifiedModelId.indexOf(":");
    if (colonIdx < 0) return null;
    const providerId = qualifiedModelId.slice(0, colonIdx);
    const modelId = qualifiedModelId.slice(colonIdx + 1);
    const provider = this.providers.get(providerId);
    if (!provider) return null;
    return { provider, modelId };
  }

  getDefaultModelId(): string | null {
    return this.defaultModelId;
  }

  hasProviders(): boolean {
    return this.providers.size > 0;
  }
}

export const providerStore = new ProviderStore();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (or errors unrelated to this file)

- [ ] **Step 3: Commit**

```bash
git add lib/agent/provider-store.ts
git commit -m "feat: add ProviderStore for server-side provider config cache"
```

---

### Task 2: Create ModelClient (`lib/agent/model-client.ts`)

**Files:**
- Create: `lib/agent/model-client.ts`

Creates an OpenAI-compatible client on the fly from a qualified model ID by looking up the provider in ProviderStore.

- [ ] **Step 1: Write ModelClient**

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { providerStore } from "./provider-store";
import type { ChatModel } from "@ai-sdk/openai";

export function createModelClient(qualifiedModelId: string): ChatModel {
  const result = providerStore.getProviderByModel(qualifiedModelId);
  if (!result) {
    throw new Error(
      `No provider found for model "${qualifiedModelId}". Make sure the provider is configured and synced.`
    );
  }
  const { provider, modelId } = result;
  const client = createOpenAI({
    apiKey: provider.apiKey || "",
    baseURL: provider.baseURL,
  });
  return client.chat(modelId);
}
```

Note: If `ChatModel` doesn't export from `@ai-sdk/openai`, check the actual type by inspecting `node_modules/@ai-sdk/openai/dist/index.d.ts`. The function `createOpenAI().chat()` returns a model compatible with `streamText()` and `generateText()` from `ai`.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors. If `ChatModel` type is wrong, use `ReturnType<ReturnType<typeof createOpenAI>["chat"]>` as the return type.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/model-client.ts
git commit -m "feat: add createModelClient for dynamic OpenAI client creation"
```

---

### Task 3: Create Provider Sync Endpoint

**Files:**
- Create: `app/api/providers/sync/route.ts`

- [ ] **Step 1: Write the sync endpoint**

```typescript
import { providerStore } from "@/lib/agent/provider-store";
import type { ProviderConfig } from "@/components/shared/settings-dialog";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { providers, defaultModelId } = body as {
      providers: ProviderConfig[];
      defaultModelId?: string | null;
    };

    if (!Array.isArray(providers)) {
      return Response.json({ ok: false, error: "providers must be an array" }, { status: 400 });
    }

    providerStore.sync(providers, defaultModelId);

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/providers/sync/route.ts
git commit -m "feat: add POST /api/providers/sync endpoint"
```

---

### Task 4: Update `agent.ts` to use createModelClient

**Files:**
- Modify: `lib/agent/agent.ts` (lines 3, 106-109)

- [ ] **Step 1: Replace zen import with model-client import**

Replace line 3:
```typescript
import { zen, resolveZenModel } from "./zen";
```
with:
```typescript
import { createModelClient } from "./model-client";
```

- [ ] **Step 2: Replace model resolution + streamText call**

Remove line 106:
```typescript
const resolvedModel = resolveZenModel(config.modelName);
```

Change line 108-109:
```typescript
  const result = streamText({
    model: zen.chat(resolvedModel),
```
to:
```typescript
  const result = streamText({
    model: createModelClient(config.modelName || ""),
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/agent/agent.ts
git commit -m "refactor: replace zen.chat with createModelClient in agent"
```

---

### Task 5: Update `memory-agent.ts` to use passed model

**Files:**
- Modify: `lib/agent/memory-agent.ts` (lines 1-2, 12, 83-84, 163-164)

- [ ] **Step 1: Remove zen import, add generateText type import**

Replace lines 1-2:
```typescript
import { generateText } from "ai";
import { zen, resolveZenModel } from "./zen";
```
with:
```typescript
import { generateText, type LanguageModel } from "ai";
```

- [ ] **Step 2: Remove MEMORY_MODEL env var**

Delete line 12:
```typescript
const MEMORY_MODEL = process.env.MEMORY_MODEL || "deepseek-v4-flash-free";
```

- [ ] **Step 3: Add model parameter to extractAndStoreMemories**

Change line 20:
```typescript
export async function extractAndStoreMemories(
  transcript: string,
): Promise<void> {
```
to:
```typescript
export async function extractAndStoreMemories(
  transcript: string,
  model: LanguageModel,
): Promise<void> {
```

- [ ] **Step 4: Replace zen.chat call in extractAndStoreMemories**

Change line 83-84:
```typescript
    const result = await generateText({
      model: zen.chat(resolveZenModel(MEMORY_MODEL)),
```
to:
```typescript
    const result = await generateText({
      model,
```

- [ ] **Step 5: Add model parameter to cleanupMemories**

Change line 134:
```typescript
export async function cleanupMemories(): Promise<void> {
```
to:
```typescript
export async function cleanupMemories(model: LanguageModel): Promise<void> {
```

- [ ] **Step 6: Replace zen.chat call in cleanupMemories**

Change lines 163-164:
```typescript
    const result = await generateText({
      model: zen.chat(resolveZenModel(MEMORY_MODEL)),
```
to:
```typescript
    const result = await generateText({
      model,
```

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. Note: there may be existing errors in `base.tsx` where `docsModelOptions` is used — those will be fixed in a later task.

- [ ] **Step 8: Commit**

```bash
git add lib/agent/memory-agent.ts
git commit -m "refactor: memory-agent now accepts model param instead of using zen"
```

---

### Task 6: Update `task-executor.ts` to use ProviderStore

**Files:**
- Modify: `lib/scheduler/task-executor.ts` (around lines 3, 556)

- [ ] **Step 1: Replace zen import with model-client + provider-store**

Replace line 3:
```typescript
import { zen, resolveZenModel } from "@/lib/agent/zen";
```
with:
```typescript
import { createModelClient } from "@/lib/agent/model-client";
import { providerStore } from "@/lib/agent/provider-store";
```

- [ ] **Step 2: Replace model creation in streamText call**

Change lines 554-556:
```typescript
  try {
    const result = streamText({
      model: zen.chat(resolveZenModel()),
```
to:
```typescript
  try {
    const defaultModelId = providerStore.getDefaultModelId();
    if (!defaultModelId) {
      return { status: "error", output: "No AI provider configured. Add one in Settings -> Advanced.", steps: [], toolCount: 0, duration: 0 };
    }
    const result = streamText({
      model: createModelClient(defaultModelId),
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/scheduler/task-executor.ts
git commit -m "refactor: task-executor uses ProviderStore default model instead of zen"
```

---

### Task 7: Update `chat/route.ts`

**Files:**
- Modify: `app/api/chat/route.ts` (lines 3, 118, 130)

- [ ] **Step 1: Replace zen import with model-client**

Replace line 3:
```typescript
import { zen } from "@/lib/agent/zen";
```
with:
```typescript
import { createModelClient } from "@/lib/agent/model-client";
```

- [ ] **Step 2: Replace zen.chat in verifyCompletion**

Change line 130:
```typescript
      model: zen.chat("deepseek-v4-flash-free"),
```
to:
```typescript
      model: createModelClient(modelName),
```

- [ ] **Step 3: Pass model to memory functions**

Find the `extractAndStoreMemories` call (around line 164):
```typescript
        extractAndStoreMemories(prevSession.transcript).catch(() => {});
        cleanupMemories().catch(() => {});
```
Replace with:
```typescript
        try {
          const memModel = createModelClient(modelName);
          extractAndStoreMemories(prevSession.transcript, memModel).catch(() => {});
          cleanupMemories(memModel).catch(() => {});
        } catch {}
```

Also find the later `extractAndStoreMemories` call (after the agent loop ends). Look for the call that stores the current session's transcript. Replace similarly.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "refactor: chat route uses createModelClient instead of zen"
```

---

### Task 8: Update settings dialog — auto-fetch, validation, sync, model IDs, delete button

**Files:**
- Modify: `components/shared/settings-dialog.tsx`

This is the largest change. Steps:
1. Remove hardcoded models from DEFAULT_PROVIDERS
2. Add fetch/validation in Configure Provider dialog
3. Update saveProviders to also POST /api/providers/sync with defaultModelId
4. Update model ID format to qualified IDs
5. Fix delete provider button with text

- [ ] **Step 8a: Strip hardcoded models from DEFAULT_PROVIDERS**

For each provider entry in `DEFAULT_PROVIDERS` (lines 145-278), set `models: []`. Example:
```typescript
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    enabled: false,
    hasApiKey: true,
    models: [],  // was: [{ id: "gpt-4o", ... }, ...]
  },
```
Apply to all 12 non-custom providers.

- [ ] **Step 8b: Add fetchModels helper + provider validation**

Add this after the `detectModelIcon` function (after line 336):

```typescript
async function fetchProviderModels(baseURL: string, apiKey: string): Promise<string[]> {
  const url = baseURL.replace(/\/+$/, "") + "/models";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (body?.data && Array.isArray(body.data)) {
    return body.data
      .filter((m: any) => m.object === "model" || !m.object)
      .map((m: any) => m.id);
  }
  throw new Error("Unexpected response format from /v1/models");
}
```

- [ ] **Step 8c: Add config error state**

In the component state declarations (near the top of the SettingsDialog component), add:
```typescript
const [configError, setConfigError] = useState<string | null>(null);
```

- [ ] **Step 8d: Update Configure Provider dialog — add validation + auto-fetch**

Replace the current "Configure Provider" dialog content (lines 1117-1155) with content that:
1. On open, auto-fetches models using `fetchProviderModels`
2. Shows a loading state while fetching
3. Shows fetched models in a list with toggles
4. On "Confirm", validates by calling `fetchProviderModels` again (or using cached result)
5. Shows `configError` inline if validation fails

The dialog before the confirm button should show the error:
```typescript
{configError && (
  <div className="text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">
    {configError}
  </div>
)}
```

The confirm handler (`handleSaveConfigure`) should:
1. Call `fetchProviderModels(configBaseUrl, configApiKey)`
2. If it throws, set `configError` and return without saving
3. If it succeeds, proceed with save, clear error

Add a refresh button next to the model list header.

- [ ] **Step 8e: Update saveProviders to sync to backend**

In `saveProviders` (around line 521), after `localStorage.setItem("qube-providers", JSON.stringify(updated))`, add:
```typescript
const defaultModel = localStorage.getItem("qube-default-model") || null;
fetch("/api/providers/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ providers: updated, defaultModelId: defaultModel }),
}).catch(() => {
  // Sync is best-effort — localStorage is the source of truth
});
```

- [ ] **Step 8f: Update model ID storage to qualified format**

When models are fetched and saved, the `id` should be `{providerId}:{modelId}`. In the Configure Provider dialog's save handler, when storing models:
```typescript
const providerId = configureProvider?.id || "";
const fetchedModels = modelIds.map((mid) => ({
  id: `${providerId}:${mid}`,
  name: mid,
  enabled: true,
  icon: detectModelIcon(mid, providerId) || undefined,
}));
```

- [ ] **Step 8g: Update delete provider button with text**

Replace lines 1255-1263:
```typescript
          <DialogFooter className="pt-2 flex items-center justify-between">
            <button
              onClick={handleDeleteProvider}
              type="button"
              className="flex items-center justify-center size-8 rounded-full border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Delete Provider"
            >
              <Trash2Icon className="size-4" />
            </button>
```
with:
```typescript
          <DialogFooter className="pt-2 flex items-center justify-between">
            <Button
              onClick={handleDeleteProvider}
              variant="outline"
              size="sm"
              className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </Button>
```

- [ ] **Step 8h: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 8i: Commit**

```bash
git add components/shared/settings-dialog.tsx
git commit -m "feat: auto-fetch models on provider config, validate on save, sync to backend, update delete button"
```

---

### Task 9: Update `base.tsx` model picker

**Files:**
- Modify: `components/examples/base.tsx` (lines 101-102, 156-195)

- [ ] **Step 1: Remove docsModelOptions import**

Delete line 101:
```typescript
import { docsModelOptions } from "@/components/docs/assistant/docs-model-options";
```

Remove line 102:
```typescript
import { DEFAULT_MODEL_ID } from "@/constants/model";
```

- [ ] **Step 2: Use empty model array fallback**

In the `syncModels` function (lines 156-195), replace the fallback at line 185:
```typescript
setModels(docsModelOptions());
```
with:
```typescript
setModels([]); // no providers configured — empty state
```

- [ ] **Step 3: Update model ID parsing for qualified IDs**

Inside the `syncModels` function, where models are pushed (around line 167-172):
```typescript
prov.forEach((prov) => {
  if (prov.enabled) {
    prov.models.forEach((m) => {
      if (m.enabled) {
        const iconName = m.icon || detectModelIcon(m.id, prov.id);
        toggledModels.push({
          id: m.id,
          name: m.name,
          icon: renderLobeIcon(iconName, 16),
        });
      }
    });
  }
});
```

Update the `detectModelIcon` call to extract the plain model name from the qualified ID:
```typescript
prov.models.forEach((m) => {
  if (m.enabled) {
    const iconName = m.icon || detectModelIcon(m.id, prov.id);
    toggledModels.push({
      id: m.id,
      name: m.name,
      icon: renderLobeIcon(iconName, 16),
    });
  }
});
```

- [ ] **Step 4: Update default model state**

Replace line 153:
```typescript
const [model, setModel] = useState(DEFAULT_MODEL_ID);
```
with:
```typescript
const [model, setModel] = useState("");
```

And update the effect at lines 197-200:
```typescript
useEffect(() => {
  const saved = localStorage.getItem("qube-default-model") || "";
  setModel(saved);
}, []);
```

- [ ] **Step 5: Handle empty model list in ModelSelector**

When `models` is empty, the `ModelSelector` should show disabled state. Check if `ModelSelector` already handles an empty list. If not, wrap it:
```typescript
{models.length > 0 ? (
  <ModelSelector
    models={models}
    value={model}
    onValueChange={handleValueChange}
    variant="ghost"
    className="h-7 rounded-full text-sm"
    arrowInverted={hasMessages}
  />
) : (
  <span className="text-xs text-muted-foreground/50 px-2">No model</span>
)}
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add components/examples/base.tsx
git commit -m "refactor: remove docsModelOptions fallback, handle empty provider state"
```

---

### Task 10: Delete old files

**Files:**
- Delete: `lib/agent/zen.ts`
- Delete: `components/docs/assistant/docs-model-options.tsx`
- Delete: `constants/model.ts`

- [ ] **Step 1: Delete files**

```bash
rm lib/agent/zen.ts
rm components/docs/assistant/docs-model-options.tsx
rm constants/model.ts
```

- [ ] **Step 2: Verify no remaining references**

Run: `rg -l "zen" --type ts lib/ app/` — should return no results (only false positives in comments/docs)
Run: `rg -l "docsModelOptions" --type ts components/` — should return no results
Run: `rg -l "DEFAULT_MODEL_ID" --type ts components/ app/ lib/` — should return no results

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git rm lib/agent/zen.ts components/docs/assistant/docs-model-options.tsx constants/model.ts
git commit -m "chore: remove OpenCode Zen files, docs-model-options, model constants"
```

---

### Task 11: Clean environment files and README

**Files:**
- Modify: `.env`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Remove OPENCODE_API_KEY from .env**

Edit `.env`:
- Remove lines 1-2 (the comment and OPENCODE_API_KEY line)
- Remove the legacy commented line if present

- [ ] **Step 2: Remove OPENCODE_API_KEY from .env.example**

Edit `.env.example` to be empty or remove the line.

- [ ] **Step 3: Update README.md**

Search for "OpenCode Zen" references and remove them. Remove the prerequisite and config sections that reference it.

- [ ] **Step 4: Commit**

```bash
git add .env .env.example README.md
git commit -m "chore: remove OpenCode Zen environment config and docs references"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit --pretty 2>&1
```
Expected: No errors

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```
Expected: Build succeeds

- [ ] **Step 3: Verify no zen references remain**

```bash
rg -r "" "zen" --type ts lib/ app/ components/ --glob '!node_modules/**'
```
Expected: Only `@opencode/zen` or unrelated matches

```bash
rg -r "" "OPENCODE_API_KEY" --type ts --type tsx --type js lib/ app/ components/
```
Expected: No results
