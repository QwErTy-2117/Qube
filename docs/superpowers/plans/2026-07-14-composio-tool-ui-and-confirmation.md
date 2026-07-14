# Composio Tool UI & Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic composio tool call UI with branded per-connector components, add pre-execution confirmation for destructive actions, fix account isolation so settings/agent share the same Composio user.

**Architecture:** A single smart `ConnectorToolUI` component detects the connector from tool name prefix and renders branded UI with confirmation for destructive tools. A confirmation middleware wraps composio tool executions server-side (parallels existing permission middleware). A per-instance UUID replaces the two hardcoded Composio user IDs.

**Tech Stack:** Next.js 16, @assistant-ui/react, @composio/core, Zustand/localStorage

---

### Task 1: Account Isolation — Instance ID Plumbing

**Files:**
- Modify: `components/assistant-ui/agent-runtime-provider.tsx`
- Modify: `app/api/chat/route.ts`
- Modify: `lib/agent/agent.ts`
- Modify: `lib/connectors/composio.ts`
- Modify: `app/api/connectors/list/route.ts`
- Modify: `app/api/connectors/link/route.ts`
- Modify: `app/api/connectors/status/route.ts`
- Modify: `app/api/connectors/disconnect/route.ts`
- Modify: `components/shared/connectors-tab.tsx`

- [ ] **Step 1: Generate instance ID in AgentRuntimeProvider**

```typescript
// components/assistant-ui/agent-runtime-provider.tsx — add in the useEffect
useEffect(() => {
  let instanceId = localStorage.getItem("qube-instance-id");
  if (!instanceId) {
    instanceId = crypto.randomUUID();
    localStorage.setItem("qube-instance-id", instanceId);
  }
  // ...existing code...
}, []);
```

- [ ] **Step 2: Send instanceId in chat API body**

```typescript
// components/assistant-ui/agent-runtime-provider.tsx — add to body() function
body: () => {
  if (typeof window === "undefined") return {};
  const instanceId = localStorage.getItem("qube-instance-id") || undefined;
  // ...existing fields...
  return {
    instanceId,
    ...(customSystemPrompt ? { customSystemPrompt } : {}),
    ...(temperature !== undefined && !isNaN(temperature) ? { temperature } : {}),
    ...(userName ? { userName } : {}),
    ...(userAbout ? { userAbout } : {}),
  };
},
```

- [ ] **Step 3: Extract instanceId in chat route and pass to createAgent**

```typescript
// app/api/chat/route.ts line 213 — destructure instanceId
const { messages, threadId, config, customSystemPrompt, temperature, userName, userAbout, instanceId } = body;

// line 284 — pass to createAgent
const agent = await createAgent({
  messages: modelMessages,
  threadId: currentThreadId,
  modelName,
  customSystemPrompt,
  temperature: temperature !== undefined ? Number(temperature) : undefined,
  userName,
  userAbout,
  instanceId,
});
```

- [ ] **Step 4: Add instanceId to AgentConfig and pass to getConnectorTools**

```typescript
// lib/agent/agent.ts line 85
export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  userName?: string;
  userAbout?: string;
  instanceId?: string;  // NEW
};

// line 145 — pass instanceId
composioTools = await getConnectorTools(config.instanceId);
```

- [ ] **Step 5: Update getConnectorTools to accept userId**

```typescript
// lib/connectors/composio.ts line 196
export async function getConnectorTools(userId?: string) {
  const client = getClient();
  const uid = userId || "qube-default-user";  // fallback
  const toolkits = Object.values(COMPOSIO_TOOLKIT_MAP).flat();
  const session = await client.sessions.create(uid, {
    toolkits,
    manageConnections: true,
  });
  // ...rest unchanged...
}
```

- [ ] **Step 6: Update settings API routes to use instanceId**

```typescript
// app/api/connectors/list/route.ts — accept query param
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const instanceId = searchParams.get("instanceId") || "qube-user";
  const connectors = await listConnectors(instanceId);
  return NextResponse.json({ connectors });
}

// app/api/connectors/link/route.ts
export async function POST(req: NextRequest) {
  const { connectorId } = await req.json();
  const { searchParams } = new URL(req.url);
  const instanceId = searchParams.get("instanceId") || "qube-user";
  // ...use instanceId instead of "qube-user" in initiateConnection...
}

// app/api/connectors/status/route.ts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const instanceId = searchParams.get("instanceId") || "qube-user";
  const connected = await getConnectedToolkits(instanceId);
  return NextResponse.json({ connected });
}

// app/api/connectors/disconnect/route.ts
export async function POST(req: NextRequest) {
  const { connectorId } = await req.json();
  const { searchParams } = new URL(req.url);
  const instanceId = searchParams.get("instanceId") || "qube-user";
  const client = getClient();
  const accounts = await client.connectedAccounts.list({
    userIds: [instanceId],
  });
  // ...rest unchanged...
}
```

Note: `link/route.ts` and `list/route.ts` use `NextRequest` (from `next/server`). Import it.

```typescript
// app/api/connectors/list/route.ts
import { NextRequest, NextResponse } from "next/server";
```

- [ ] **Step 7: Update connectors-tab to send instanceId**

```typescript
// components/shared/connectors-tab.tsx — add helper at top
function getInstanceId(): string {
  if (typeof window === "undefined") return "qube-user";
  return localStorage.getItem("qube-instance-id") || "qube-user";
}

// In fetchData — append instanceId
const res = await fetch(`/api/connectors/list?instanceId=${getInstanceId()}`);

// In handleConnect
const res = await fetch(`/api/connectors/link?instanceId=${getInstanceId()}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ connectorId }),
});
// ...and in the pollInterval inside handleConnect:
const res = await fetch(`/api/connectors/list?instanceId=${getInstanceId()}`);

// In handleDisconnect
await fetch(`/api/connectors/disconnect?instanceId=${getInstanceId()}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ connectorId }),
});
```

- [ ] **Step 8: Commit**

```bash
git add lib/connectors/composio.ts lib/agent/agent.ts app/api/chat/route.ts app/api/connectors/list/route.ts app/api/connectors/link/route.ts app/api/connectors/status/route.ts app/api/connectors/disconnect/route.ts components/assistant-ui/agent-runtime-provider.tsx components/shared/connectors-tab.tsx
git commit -m "feat: per-instance composio account isolation"
```

---

### Task 2: Confirmation Middleware

**Files:**
- Modify: `lib/connectors/composio.ts`

- [ ] **Step 1: Add pending confirmations store and destructive detection**

```typescript
// lib/connectors/composio.ts — add at top after imports

const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];

function isDestructiveTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some(kw => lower.includes(kw));
}

const pendingConfirmations = new Map<string, {
  resolve: (value: string) => void;
  reject: (reason: string) => void;
  toolName: string;
  args: any;
}>();

export function getPendingConfirmations(threadId: string): Array<{
  confirmationId: string;
  toolName: string;
  args: any;
}> {
  const result: Array<any> = [];
  for (const [key, val] of pendingConfirmations) {
    if (key.startsWith(threadId)) {
      result.push({
        confirmationId: key,
        toolName: val.toolName,
        args: val.args,
      });
    }
  }
  return result;
}

export function resolveConfirmation(confirmationId: string, action: "confirm" | "cancel"): boolean {
  const pending = pendingConfirmations.get(confirmationId);
  if (!pending) return false;
  if (action === "confirm") {
    pending.resolve(JSON.stringify({ confirmed: true, message: "User approved" }));
  } else {
    pending.reject("User cancelled this action");
  }
  pendingConfirmations.delete(confirmationId);
  return true;
}
```

- [ ] **Step 2: Wrap destructive tool execution with confirmation**

Inside `getConnectorTools()`, after the `for (const [name, tool] of Object.entries(tools))` loop that adds the label parameter, add a second loop to wrap execute:

```typescript
// lib/connectors/composio.ts — at end of getConnectorTools, before return tools;

for (const [name, tool] of Object.entries(tools)) {
  if (isDestructiveTool(name) && tool.execute) {
    const originalExecute = tool.execute.bind(tool);
    tool.execute = async (args: any, extra?: any) => {
      const threadId = extra?.threadId || args?.threadId || "default";
      return new Promise<string>((resolve, reject) => {
        const confirmationId = `composio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        pendingConfirmations.set(confirmationId, {
          resolve, reject, toolName: name, args,
        });
        // Timeout after 5 minutes
        setTimeout(() => {
          if (pendingConfirmations.has(confirmationId)) {
            pendingConfirmations.delete(confirmationId);
            reject("Confirmation timed out");
          }
        }, 300_000);
      });
    };
  }
}
```

Note: The Vercel AI SDK tool.execute receives `(args, extra)` where `extra` has `{ messages, abortSignal, toolCallId, threadId }`. We use `extra?.threadId` for the confirmation key.

- [ ] **Step 3: Commit**

```bash
git add lib/connectors/composio.ts
git commit -m "feat: composio destructive tool confirmation middleware"
```

---

### Task 3: Confirmation API Endpoints

**Files:**
- Create: `app/api/connectors/confirm/route.ts`
- Create: `app/api/connectors/pending/route.ts`

- [ ] **Step 1: Create confirm endpoint**

```typescript
// app/api/connectors/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveConfirmation } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { confirmationId, action } = await req.json();
    if (!confirmationId || !action) {
      return NextResponse.json({ error: "Missing confirmationId or action" }, { status: 400 });
    }
    if (action !== "confirm" && action !== "cancel") {
      return NextResponse.json({ error: "Action must be 'confirm' or 'cancel'" }, { status: 400 });
    }
    const ok = resolveConfirmation(confirmationId, action);
    if (!ok) {
      return NextResponse.json({ error: "Confirmation not found or expired" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[connectors/confirm] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create pending endpoint**

```typescript
// app/api/connectors/pending/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPendingConfirmations } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId") || "default";
    const pending = getPendingConfirmations(threadId);
    return NextResponse.json({ pending });
  } catch (e) {
    console.error("[connectors/pending] Error:", e);
    return NextResponse.json({ pending: [], error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/connectors/confirm/route.ts app/api/connectors/pending/route.ts
git commit -m "feat: composio confirmation API endpoints"
```

---

### Task 4: ConnectorToolUI Component

**Files:**
- Modify: `components/assistant-ui/tools/connector-tool-ui.tsx`
- Modify: `components/assistant-ui/tools/index.ts`

- [ ] **Step 1: Implement full ConnectorToolUI**

```typescript
// components/assistant-ui/tools/connector-tool-ui.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { Loader2Icon, CheckIcon, XIcon, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONNECTOR_PREFIXES: Record<string, { id: string; name: string }> = {
  linear: { id: "linear", name: "Linear" },
  jira: { id: "atlassian", name: "Jira" },
  trello: { id: "trello", name: "Trello" },
  airtable: { id: "airtable", name: "Airtable" },
  notion: { id: "notion", name: "Notion" },
  slack: { id: "slack", name: "Slack" },
  github: { id: "github", name: "GitHub" },
  gmail: { id: "google", name: "Gmail" },
  googlecalendar: { id: "google", name: "Google Calendar" },
  googledrive: { id: "google", name: "Google Drive" },
  hubspot: { id: "hubspot", name: "HubSpot" },
  asana: { id: "asana", name: "Asana" },
  dropbox: { id: "dropbox", name: "Dropbox" },
};

const COLORS: Record<string, string> = {
  linear: "#5E6AD2", atlassian: "#0052CC", trello: "#0052CC",
  airtable: "#FFBF00", notion: "currentColor", slack: "#4A154B",
  github: "currentColor", google: "#4285F4", hubspot: "#FF7A59",
  asana: "#F06A6A", dropbox: "#0061FF",
};

function getMeta(toolName: string): { id: string; name: string } | null {
  const lower = toolName.toLowerCase();
  for (const [prefix, meta] of Object.entries(CONNECTOR_PREFIXES)) {
    if (lower.startsWith(prefix)) return meta;
  }
  return null;
}

function extractContent(args: any): Record<string, string> {
  if (!args || typeof args !== "object") return {};
  const fields: Record<string, string> = {};
  if (args.to) fields["To"] = String(args.to);
  if (args.subject) fields["Subject"] = String(args.subject);
  if (args.channel) fields["Channel"] = String(args.channel);
  if (args.message) fields["Message"] = String(args.message).slice(0, 500);
  if (args.body) fields["Body"] = String(args.body).slice(0, 500);
  if (args.content) fields["Content"] = String(args.content).slice(0, 500);
  if (args.title) fields["Title"] = String(args.title);
  if (args.description) fields["Description"] = String(args.description).slice(0, 500);
  if (args.text) fields["Text"] = String(args.text).slice(0, 500);
  if (args.comment) fields["Comment"] = String(args.comment).slice(0, 500);
  if (args.name) fields["Name"] = String(args.name);
  return fields;
}

export const ConnectorToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args: rawArgs,
  result,
  status,
}) => {
  const meta = getMeta(toolName);
  const args = (rawArgs || {}) as any;
  const isRunning = status?.type === "running";
  const isComplete = status?.type === "complete";
  const isError = status?.type === "error";
  const needsConfirmation = status?.type === "requires-action";
  const icon = meta ? renderConnectorIcon(meta.id, 18) : null;
  const color = meta ? (COLORS[meta.id] || "#888") : "#888";

  const [confirming, setConfirming] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pollPending = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/pending?threadId=default");
      const data = await res.json();
      const match = (data.pending || []).find(
        (p: any) => p.toolName === toolName && JSON.stringify(p.args) === JSON.stringify(args)
      );
      if (match) {
        setPendingId(match.confirmationId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [toolName, args]);

  useEffect(() => {
    if (!needsConfirmation) return;
    const interval = setInterval(async () => {
      const found = await pollPending();
      if (found) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [needsConfirmation, pollPending]);

  const handleConfirm = useCallback(async () => {
    if (!pendingId) return;
    setConfirming(true);
    try {
      await fetch("/api/connectors/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationId: pendingId, action: "confirm" }),
      });
    } catch {}
  }, [pendingId]);

  const handleCancel = useCallback(async () => {
    if (!pendingId) return;
    setConfirming(true);
    try {
      await fetch("/api/connectors/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationId: pendingId, action: "cancel" }),
      });
    } catch {}
  }, [pendingId]);

  const contentFields = extractContent(args);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-3 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        {icon && (
          <div className="size-5 flex items-center justify-center shrink-0" style={{ color }}>
            {icon}
          </div>
        )}
        <span className="text-xs font-medium text-foreground/80" style={{ color: meta ? color : undefined }}>
          {meta?.name || toolName}
        </span>
        {isRunning && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0 ml-auto" />}
        {isComplete && <CheckIcon className="size-3.5 text-emerald-500 shrink-0 ml-auto" />}
        {isError && <AlertTriangleIcon className="size-3.5 text-red-500 shrink-0 ml-auto" />}
      </div>

      {/* Confirmation view */}
      {needsConfirmation && (
        <div className="space-y-2">
          <div className="rounded-lg bg-muted/30 p-2.5 space-y-1 font-mono text-[11px]">
            {Object.entries(contentFields).length > 0 ? (
              Object.entries(contentFields).map(([label, val]) => (
                <div key={label} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{label}:</span>
                  <span className="text-foreground/90 break-words">{val}</span>
                </div>
              ))
            ) : (
              <pre className="text-muted-foreground overflow-auto max-h-32">
                {JSON.stringify(args, null, 2)}
              </pre>
            )}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={handleCancel}
              disabled={confirming}
            >
              <XIcon className="size-3 mr-1" />
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              style={{
                borderColor: color === "currentColor" ? undefined : `${color}40`,
                color: color === "currentColor" ? undefined : color,
              }}
              onClick={handleConfirm}
              disabled={confirming}
            >
              <CheckIcon className="size-3 mr-1" />
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Running view */}
      {isRunning && !needsConfirmation && (
        <p className="text-[11px] text-muted-foreground/60">Working...</p>
      )}

      {/* Complete view */}
      {isComplete && result && (
        <div className="text-[11px] text-muted-foreground/70">
          {typeof result === "string"
            ? result.slice(0, 200)
            : JSON.stringify(result).slice(0, 200)}
        </div>
      )}

      {/* Error view */}
      {isError && (
        <div className="text-[11px] text-red-500/80">
          {typeof result === "string"
            ? result.slice(0, 200)
            : "Tool execution failed"}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Export ConnectorToolUI from tools index**

```typescript
// components/assistant-ui/tools/index.ts — add export
export { ConnectorToolUI } from "./connector-tool-ui";
```

- [ ] **Step 3: Commit**

```bash
git add components/assistant-ui/tools/connector-tool-ui.tsx components/assistant-ui/tools/index.ts
git commit -m "feat: ConnectorToolUI component with confirmation UI"
```

---

### Task 5: Client Rendering Changes

**Files:**
- Modify: `components/examples/base.tsx`
- Modify: `components/assistant-ui/tool-fallback.tsx`
- Modify: `components/assistant-ui/agent-runtime-provider.tsx`

- [ ] **Step 1: Remove composio special-casing from base.tsx**

Remove the `COMPOSIO_TOOL_PREFIXES` array (lines 837-841), the `composioToolPrefix()` function (lines 843-849), and the special composio bypass in the tool-call case (lines 1001-1003).

Also remove the import of `ToolFallback` if it's no longer used directly (it may still be used as the `??` fallback in line 1013 — keep it for that).

The tool-call case becomes:
```typescript
case "tool-call":
  const isDestructive = DESTRUCTIVE_KEYWORDS.some(kw =>
    part.toolName.toLowerCase().includes(kw)
  );
  return (
    <ToolGroupRoot variant="ghost" defaultOpen={isDestructive}>
      <ToolGroupTrigger
        count={1}
        active={part.status.type === "running"}
        label={getToolLabel(part)}
      />
      <ToolGroupContent>
        {part.toolUI ?? <ToolFallback {...part} />}
      </ToolGroupContent>
    </ToolGroupRoot>
  );
```

Add `DESTRUCTIVE_KEYWORDS` at top of file (or import from composio.ts):
```typescript
const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];
```

- [ ] **Step 2: Update TOOL_GROUP_TITLES in base.tsx**

Replace composio entries with per-connector fallback titles:
```typescript
// Replace lines 833-835 (composio_search_tools, composio_multi_execute_tool)
// with per-connector entries:

const TOOL_GROUP_TITLES: Record<string, string> = {
  read_file: "Sneaking a peek",
  write_file: "Doodling something up",
  edit_file: "Tweaking things",
  delete_file: "Sending to the void",
  list_directory: "Nosing around",
  run_command: "Making magic happen",
  web_search: "Going down a rabbit hole",
  web_fetch: "Grabbing a page",
  list_sessions: "Checking the logbook",
  read_session_summary: "Skimming the past",
  read_session: "Reading the tea leaves",
  read_memory: "Scratching the brain",
  ask_user: "Poking the human",

  // Per-connector fallbacks
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
};
```

Update `getToolLabel` to also check connector prefix fallbacks:
```typescript
function getToolLabel(part: ToolCallMessagePart): string {
  const label = (part.args as any)?.label;
  if (label) return label;
  const title = TOOL_GROUP_TITLES[part.toolName];
  if (title) return title;
  // Check prefix-based fallback
  const lower = part.toolName.toLowerCase();
  for (const [prefix, title] of Object.entries(TOOL_GROUP_TITLES)) {
    if (lower.startsWith(prefix)) return title;
  }
  return part.toolName;
}
```

- [ ] **Step 3: Simplify tool-fallback.tsx**

```typescript
// components/assistant-ui/tool-fallback.tsx
// Simplified — delegates to ConnectorToolUI for known connectors, keeps generic fallback for unknown
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ConnectorToolUI } from "@/components/assistant-ui/tools/connector-tool-ui";

const CONNECTOR_PREFIXES = [
  "linear", "jira", "trello", "airtable", "notion", "slack",
  "github", "gmail", "googlecalendar", "googledrive",
  "hubspot", "asana", "dropbox",
];

function isConnectorTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return CONNECTOR_PREFIXES.some(p => lower.startsWith(p));
}

export const ToolFallback: ToolCallMessagePartComponent = (props) => {
  if (isConnectorTool(props.toolName)) {
    return <ConnectorToolUI {...props} />;
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{props.toolName}</div>
      {props.result ? (
        <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(props.result, null, 2)}</pre>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 4: Register ConnectorToolUI in agent-runtime-provider**

```typescript
// components/assistant-ui/agent-runtime-provider.tsx
import { ConnectorToolUI } from "@/components/assistant-ui/tools";

function ToolUIRegistrar() {
  // ...existing registrations...

  // Register for composio tools (dynamic — fallback handles the rest)
  useAssistantToolUI({ toolName: "composio_search_tools", render: ConnectorToolUI });
  useAssistantToolUI({ toolName: "composio_multi_execute_tool", render: ConnectorToolUI });

  return null;
}
```

Since composio tool names are dynamic and too many to register individually, we rely on the `ToolFallback` in `base.tsx` line 1013 (`part.toolUI ?? <ToolFallback {...part} />`) to catch all composio tools that don't have a registered UI. The `ToolFallback` now delegates to `ConnectorToolUI` for known connector prefixes.

- [ ] **Step 5: Commit**

```bash
git add components/examples/base.tsx components/assistant-ui/tool-fallback.tsx components/assistant-ui/agent-runtime-provider.tsx
git commit -m "feat: wire ConnectorToolUI into rendering pipeline"
```

---

### Task 6: Settings Connection Verification

**Files:**
- Modify: `components/shared/connectors-tab.tsx`

- [ ] **Step 1: Poll /api/connectors/status instead of /api/connectors/list after OAuth**

Replace the pollInterval inside `handleConnect` (lines 79-91):

```typescript
const pollInterval = setInterval(async () => {
  try {
    const statusRes = await fetch(`/api/connectors/status?instanceId=${getInstanceId()}`);
    const statusData = await statusRes.json();
    const connectedSlugs: string[] = statusData.connected || [];

    // Check if this connector's toolkit slugs are connected
    const connectorSlugs = getToolkitSlugs(connectorId);
    const isConnected = connectorSlugs.some((slug: string) => connectedSlugs.includes(slug));

    if (isConnected) {
      clearInterval(pollInterval);
      await fetchData(); // refresh the full list for display
      setConnectingId((prev) => (prev === connectorId ? null : prev));
      setStatusMsg("Connected!");
    }
  } catch {}
}, 2000);
```

Add the import for `getToolkitSlugs` at the top:

```typescript
import { getToolkitSlugs } from "@/lib/connectors/composio";
```

Note: `getToolkitSlugs` is a pure function that just looks up from a record — safe to import and use on the client side since it doesn't use any Node.js APIs.

- [ ] **Step 2: Commit**

```bash
git add components/shared/connectors-tab.tsx
git commit -m "feat: use /status endpoint for connection verification"
```

---

### Task 7: System Prompt & Labels

**Files:**
- Modify: `lib/agent/system-prompt.ts`
- Modify: `lib/connectors/composio.ts`

- [ ] **Step 1: Update system prompt label instruction**

```typescript
// lib/agent/system-prompt.ts line 43-46

// Replace:
// Every tool call MUST include `label` — a short friendly title shown in the UI. Use natural language.

// With:
// Every tool call MUST include \`label\` — a playful, fun short title shown in the UI (e.g. "Sneaking a peek" instead of "Reading file", "Slacking off" instead of "Posting to Slack"). Be creative and informal. Do NOT use the tool name as the label.
```

- [ ] **Step 2: Update composio label parameter description**

```typescript
// lib/connectors/composio.ts line 209

// Replace:
// "Short friendly label — say what you're doing in plain language"

// With:
// "Fun, playful label for the UI (e.g. 'Slacking off', 'Dabbling in spreadsheets'). Keep it light. Never mention 'composio'."
```

Same change for line 219 (the `parameterSchema` path).

- [ ] **Step 3: Commit**

```bash
git add lib/agent/system-prompt.ts lib/connectors/composio.ts
git commit -m "feat: playful tool call labels in system prompt"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All spec sections covered — account isolation (task 1), confirmation middleware (task 2), API endpoints (task 3), ConnectorToolUI (task 4), rendering (task 5), settings verify (task 6), labels (task 7).
- [x] **Placeholder scan**: No TBDs, TODOs, or vague instructions.
- [x] **Type consistency**: `instanceId` flows consistently as `string | undefined` through all layers. `getConnectorTools` accepts `userId` param. All API routes accept `?instanceId=` query param.
