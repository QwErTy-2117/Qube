# Composio Tool UI & Confirmation Design

## Problem

1. Composio tool calls render with generic `ToolFallback` instead of branded per-connector UI
2. Tool labels are descriptive/"serious" instead of playful like built-in tools
3. Destructive composio actions (send email, post message, etc.) execute immediately without user confirmation
4. Settings/agent use different Composio user IDs (`"qube-user"` vs `"qube-default-user"`), forcing re-auth
5. All app instances share the same Composio account

## Solution

### 1. Account Isolation

**Root cause**: Settings APIs hardcode `"qube-user"`; agent session hardcodes `"qube-default-user"`. Different Composio users — connections don't transfer.

**Fix**: Generate a unique per-instance UUID on first launch, use it everywhere.

| Layer | Current | Fixed |
|-------|---------|-------|
| Settings APIs | `"qube-user"` hardcoded | `instanceId` from query param |
| Agent session | `"qube-default-user"` hardcoded | `instanceId` from chat API body |
| Multiple instances | Shared account | Each instance gets unique user |

**Changes**:

- **`AgentRuntimeProvider`**: On mount, check `localStorage` for `qube-instance-id`. If missing, generate UUID via `crypto.randomUUID()` and store it.
- **Chat API body**: Add `instanceId` field, read from `localStorage`.
- **`app/api/chat/route.ts`**: Destructure `instanceId` from body, pass to `createAgent()`.
- **`lib/agent/agent.ts`**: Add `instanceId` to `AgentConfig`. Pass to `getConnectorTools(instanceId)`.
- **`lib/connectors/composio.ts`**: `getConnectorTools(userId?)` uses passed userId, defaults to `"qube-default-user"`.
- **Settings API routes** (`list`, `link`, `disconnect`, `status`): Accept `?instanceId=` query param. Use as userId instead of hardcoded `"qube-user"`.
- **`connectors-tab.tsx`**: Read `instanceId` from `localStorage`, append to API calls.

### 2. Confirmation Middleware — Server

**`lib/connectors/composio.ts`**:

```typescript
const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];
```

- After getting tools from composio session, wrap each tool's `execute` function
- If tool name contains any destructive keyword → wrap with confirmation middleware
- Confirmation middleware: stores pending request in a `Map<threadId, pending[]>` in module scope. Returns a `Promise` that blocks execution until the user confirms/cancels.
- Same pattern as existing `permission-middleware.ts`.

**`app/api/connectors/confirm/route.ts`** (NEW):

```
POST /api/connectors/confirm
Body: { confirmationId, action: "confirm" | "cancel" }
```

Resolves or rejects the pending promise. Returns `{ success: true }`.

**`app/api/connectors/pending/route.ts`** (NEW):

```
GET /api/connectors/pending?threadId=xxx
Returns: { pending: Array<{ confirmationId, toolName, args, connectorName }> }
```

### 3. Confirmation Polling — Client

**`ConnectorToolUI`**:

- When `status.type === "requires-action"`: poll `GET /api/connectors/pending?threadId=` every 500ms
- When pending confirmation found: render confirmation card
- When user clicks Confirm: `POST /api/connectors/confirm { confirmationId, action: "confirm" }`
- When user clicks Cancel: `POST /api/connectors/confirm { confirmationId, action: "cancel" }`

### 4. ConnectorToolUI Component

Replaces null stub at `components/assistant-ui/tools/connector-tool-ui.tsx`.

**States**:

| Status | Render |
|--------|--------|
| `requires-action` | Confirmation card: connector icon + brand color header, content preview extracted from `args`, Confirm + Cancel buttons |
| `running` | Branded spinner with "Working..." |
| `complete` | Branded result card showing what happened |
| `error` | Branded error card |

**Connector detection**: Same prefix matching as current `ToolFallback` (`getConnectorMeta()`). Each connector gets brand color + icon.

**Content preview**: Parse common arg shapes:
- Email: `to`, `subject`, `body` (truncated)
- Message: `channel`, `message` (truncated)
- Issue: `title`, `description` (truncated)
- Generic: JSON summary of args

**Confirmation card layout**:
```
[Connector Icon] [Connector Name]
─────────────────────────────
To: john@example.com
Subject: Hello
Body: Just checking in...

[Cancel] [Confirm]
```

### 5. System Prompt & Labels

**`lib/agent/system-prompt.ts`** (line 45):

Change from:
```
Every tool call MUST include `label` — a short friendly title shown in the UI. Use natural language.
```

To:
```
Every tool call MUST include `label` — a playful, fun short title shown in the UI (e.g. "Sneaking a peek" instead of "Reading file", "Slacking off" instead of "Posting to Slack"). Be creative and informal. Do NOT use the tool name as the label.
```

**`lib/connectors/composio.ts`** (line 209):

Change from:
```
"Short friendly label — say what you're doing in plain language"
```

To:
```
"Fun, playful label for the UI (e.g. 'Slacking off', 'Dabbling in spreadsheets'). Keep it light. Never mention 'composio'."
```

### 6. Client Rendering Changes

**`components/examples/base.tsx`**:

- Remove lines 1001-1003 (composio special bypass that skips `ToolGroupRoot`)
- Composio tools now flow through the normal `ToolGroupRoot` + `ToolGroupTrigger` + `ToolGroupContent` path
- Add detection: if tool is destructive → set `defaultOpen={true}` on `ToolGroupRoot` (so confirmation card is visible)
- Remove `COMPOSIO_TOOL_PREFIXES` array and `composioToolPrefix()` function (no longer needed — `ConnectorToolUI` handles detection internally)

**`TOOL_GROUP_TITLES`**: Remove `composio_search_tools` and `composio_multi_execute_tool` entries. Add per-connector fallback titles:
```
gmail: "Fiddling with your inbox",
slack: "Slacking off",
linear: "Organizing chaos",
github: "Poking the repo",
googlecalendar: "Rearranging your life",
googledrive: "Digging through files",
notion: "Notion-ing around",
hubspot: "CRM-ing it up",
asana: "Asana-ing tasks",
trello: "Carding things",
airtable: "Databasing casually",
dropbox: "Dropping files",
jira: "Ticketing around",
composio: "Rooting around your apps",
```

**`components/assistant-ui/tool-fallback.tsx`**: Simplify. For known connectors, delegate to `ConnectorToolUI`. For unknown tools, keep generic fallback.

**`components/assistant-ui/agent-runtime-provider.tsx`**: Dynamic registration of composio tool UIs is handled by making `ConnectorToolUI` the renderer for composio tools. Since composio tool names are dynamic, the registration uses the `COMPOSIO_TOOL_PREFIXES` to register `ConnectorToolUI` for all known prefixes (or we can use a catch-all approach).

### 7. Settings Connection Verification

**`components/shared/connectors-tab.tsx`**:

After opening OAuth popup, poll `GET /api/connectors/status?instanceId=xxx` every 2s:
```typescript
const statusRes = await fetch(`/api/connectors/status?instanceId=${instanceId}`);
const { connected } = await statusRes.json();
// connected = ["gmail", "slack", ...] — array of connected toolkit slugs
```

Check if the connector's toolkit(s) appear in `connected`. More direct than checking the full list response.

## Files Changed

| File | Action |
|------|--------|
| `lib/connectors/composio.ts` | Add destructive detection + confirmation middleware; accept userId param |
| `lib/agent/agent.ts` | Pass `instanceId` to `getConnectorTools()` |
| `lib/agent/system-prompt.ts` | Update label instruction |
| `app/api/chat/route.ts` | Extract `instanceId` from body, pass to `createAgent()` |
| `app/api/connectors/confirm/route.ts` | **NEW** |
| `app/api/connectors/pending/route.ts` | **NEW** |
| `app/api/connectors/list/route.ts` | Accept `?instanceId=` query param |
| `app/api/connectors/link/route.ts` | Accept `?instanceId=` query param |
| `app/api/connectors/status/route.ts` | Accept `?instanceId=` query param |
| `app/api/connectors/disconnect/route.ts` | Accept `?instanceId=` query param |
| `components/assistant-ui/tools/connector-tool-ui.tsx` | Full implementation (replaces null stub) |
| `components/assistant-ui/tool-fallback.tsx` | Simplify/delegate to ConnectorToolUI |
| `components/examples/base.tsx` | Remove composio special-casing; add destructive detection for defaultOpen; update TOOL_GROUP_TITLES |
| `components/shared/connectors-tab.tsx` | Use instanceId, poll `/status` for connection check |
| `components/assistant-ui/agent-runtime-provider.tsx` | Register ConnectorToolUI; generate instanceId |

## Open Questions

- None — design approved.
