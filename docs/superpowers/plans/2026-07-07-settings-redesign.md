# Settings Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar-based settings dialog with a top-tab layout (Preferences | Memories | Advanced) using the assistant-ui Tabs component, and add user name/about fields that feed into the agent's system prompt.

**Architecture:** Install assistant-ui tabs component, rewrite `settings-dialog.tsx` to use `Tabs` + `TabsContent`, extend the request chain (runtime provider → API route → agent) to carry `userName`/`userAbout` into the system prompt.

**Tech Stack:** Next.js 16, React 19, assistant-ui tabs, localStorage, next-themes

---

### Task 1: Install assistant-ui tabs component

**Files:**
- Create: `components/assistant-ui/tabs.tsx`

- [ ] **Step 1: Install the tabs component**

Run:
```bash
npx shadcn@latest add https://r.assistant-ui.com/tabs.json
```

This creates `components/assistant-ui/tabs.tsx`. If it prompts, consent to install.

- [ ] **Step 2: Verify the file exists**

Run: `ls -la components/assistant-ui/tabs.tsx`

If the CLI command fails (e.g., network issue), manually copy the tabs component from the assistant-ui repo source at https://raw.githubusercontent.com/assistant-ui/assistant-ui/main/packages/ui/src/components/assistant-ui/tabs.tsx

```bash
curl -sSL -o components/assistant-ui/tabs.tsx \
  https://raw.githubusercontent.com/assistant-ui/assistant-ui/main/packages/ui/src/components/assistant-ui/tabs.tsx
```

- [ ] **Step 3: Commit**

```bash
git add components/assistant-ui/tabs.tsx
git commit -m "feat: add assistant-ui tabs component"
```

---

### Task 2: Add `userName`/`userAbout` to agent runtime provider

**Files:**
- Modify: `components/assistant-ui/agent-runtime-provider.tsx`

- [ ] **Step 1: Extend the `body()` function to read `qube-user-name` and `qube-user-about`**

In the `body` function, add reads for the two new localStorage keys:

```tsx
body: () => {
  if (typeof window === "undefined") return {};
  const customSystemPrompt = localStorage.getItem("qube-custom-system-prompt") || undefined;
  const temperatureRaw = localStorage.getItem("qube-temperature");
  const temperature = temperatureRaw ? parseFloat(temperatureRaw) : undefined;
  const userName = localStorage.getItem("qube-user-name") || undefined;
  const userAbout = localStorage.getItem("qube-user-about") || undefined;
  return {
    ...(customSystemPrompt ? { customSystemPrompt } : {}),
    ...(temperature !== undefined && !isNaN(temperature) ? { temperature } : {}),
    ...(userName ? { userName } : {}),
    ...(userAbout ? { userAbout } : {}),
  };
},
```

- [ ] **Step 2: Commit**

```bash
git add components/assistant-ui/agent-runtime-provider.tsx
git commit -m "feat: pass userName/userAbout from localStorage to chat API"
```

---

### Task 3: Pass `userName`/`userAbout` through the chat API route

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Destructure `userName` and `userAbout` from the request body**

In the `POST` function at line 155, add `userName` and `userAbout` to the destructuring:

```tsx
const { messages, threadId, config, customSystemPrompt, temperature, userName, userAbout } = body;
```

- [ ] **Step 2: Pass them to `createAgent`**

In the `createAgent` call at line 217-223, add `userName` and `userAbout`:

```tsx
const agent = await createAgent({
  messages: modelMessages,
  threadId: currentThreadId,
  modelName,
  customSystemPrompt,
  temperature: temperature !== undefined ? Number(temperature) : undefined,
  userName,
  userAbout,
});
```

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: accept userName/userAbout in chat API and forward to agent"
```

---

### Task 4: Inject `userName`/`userAbout` into the system prompt

**Files:**
- Modify: `lib/agent/agent.ts`

- [ ] **Step 1: Add `userName`/`userAbout` to `AgentConfig`**

```tsx
export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  userName?: string;
  userAbout?: string;
};
```

- [ ] **Step 2: Build the user info section and append it**

After the `systemPrompt` line (line 56-58), insert user info:

```tsx
let userInfoSection = "";
if (config.userName || config.userAbout) {
  const parts: string[] = [];
  if (config.userName) parts.push(`User name: ${config.userName}`);
  if (config.userAbout) parts.push(`About the user: ${config.userAbout}`);
  userInfoSection = `\n\n## User Context\n\n${parts.join("\n")}`;
}

const systemPrompt = (config.customSystemPrompt
  ? `${basePrompt}${userInfoSection}\n\n## Custom System Instructions\n\n${config.customSystemPrompt}`
  : `${basePrompt}${userInfoSection}`);
```

- [ ] **Step 3: Commit**

```bash
git add lib/agent/agent.ts
git commit -m "feat: inject userName/userAbout into agent system prompt"
```

---

### Task 5: Rewrite the settings dialog with top tabs

**Files:**
- Modify: `components/shared/settings-dialog.tsx`

This is the largest change. The entire file gets rewritten.

- [ ] **Step 1: Replace all imports**

Remove the sidebar nav imports. Add the tabs component import:

```tsx
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/assistant-ui/tabs";
import { Settings2Icon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
```

- [ ] **Step 2: Add state for new preferences**

After temperature state, add:

```tsx
const [userName, setUserName] = useState("");
const [userAbout, setUserAbout] = useState("");
```

- [ ] **Step 3: Add save handler for new preferences**

```tsx
const handleSavePreferences = () => {
  localStorage.setItem("qube-default-model", defaultModel);
  localStorage.setItem("qube-custom-system-prompt", customSystemPrompt);
  localStorage.setItem("qube-temperature", String(temperature));
  localStorage.setItem("qube-user-name", userName);
  localStorage.setItem("qube-user-about", userAbout);
  setSavedPrefs(true);
  setTimeout(() => setSavedPrefs(false), 2000);
};
```

- [ ] **Step 4: Update the load effect**

In the `useEffect` that loads preferences when dialog opens (line 180-188), add:

```tsx
setUserName(localStorage.getItem("qube-user-name") || "");
setUserAbout(localStorage.getItem("qube-user-about") || "");
```

- [ ] **Step 5: Build the Tabs header**

Replace everything between `<DialogContent>` open tag and the `<main>` content area. The entire inner structure becomes:

```tsx
<DialogContent
  showCloseButton={true}
  className="sm:max-w-4xl max-w-4xl w-full p-0 flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
  style={{ height: "min(660px, 90vh)" }}
>
  <Tabs defaultValue="preferences" className="flex flex-col flex-1 overflow-hidden">
    <div className="shrink-0 px-6 pt-5 pb-0 border-b border-border/60">
      <TabsList variant="line">
        <TabsTrigger value="preferences">
          <SlidersIcon className="size-4" />
          Preferences
        </TabsTrigger>
        <TabsTrigger value="memories">
          <BrainIcon className="size-4" />
          Memories
          {(memories.length + sessions.length) > 0 && (
            <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
              {memories.length + sessions.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="advanced">
          <Settings2Icon className="size-4" />
          Advanced
        </TabsTrigger>
      </TabsList>
    </div>

    {/* ── PREFERENCES TAB ── */}
    <TabsContent value="preferences" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
      ...
    </TabsContent>

    {/* ── MEMORIES TAB ── */}
    <TabsContent value="memories" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
      ...
    </TabsContent>

    {/* ── ADVANCED TAB ── */}
    <TabsContent value="advanced" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
      ...
    </TabsContent>
  </Tabs>
</DialogContent>
```

- [ ] **Step 6: Build the Preferences tab content**

```tsx
<TabsContent value="preferences" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
  <SectionHeader title="Preferences" />
  <div className="flex-1 overflow-y-auto space-y-5 pr-1">

    {/* Your Name */}
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">Your Name</label>
      <p className="text-xs text-muted-foreground">Qube will refer to you by this name.</p>
      <input
        type="text"
        placeholder="Enter your name"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </div>

    {/* About You */}
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">About You</label>
      <p className="text-xs text-muted-foreground">Tell Qube about your background, goals, and preferences so it can tailor responses.</p>
      <textarea
        placeholder="E.g. I'm a full-stack developer working on a SaaS product. I prefer concise answers and care about best practices..."
        value={userAbout}
        onChange={(e) => setUserAbout(e.target.value)}
        rows={4}
        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
      />
    </div>

    {/* Theme */}
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">Theme</label>
      <p className="text-xs text-muted-foreground">Choose your preferred appearance.</p>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {[
          { id: "light", icon: SunIcon, label: "Light" },
          { id: "dark", icon: MoonIcon, label: "Dark" },
          { id: "system", icon: MonitorIcon, label: "System" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "flex flex-col items-center gap-2 p-3.5 rounded-xl border text-center transition-all",
              theme === t.id
                ? "border-primary/60 bg-primary/5 shadow-xs"
                : "border-border hover:border-border/80 hover:bg-muted/40"
            )}
          >
            <t.icon className="size-5" />
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>
    </div>

  </div>

  {/* Save button */}
  <div className="pt-4 border-t border-border/60 mt-4 flex justify-end shrink-0">
    <Button
      onClick={() => {
        localStorage.setItem("qube-user-name", userName);
        localStorage.setItem("qube-user-about", userAbout);
        setSavedPrefs(true);
        setTimeout(() => setSavedPrefs(false), 2000);
      }}
      className={cn("font-semibold px-5 transition-all", savedPrefs && "bg-emerald-600 hover:bg-emerald-700")}
    >
      {savedPrefs ? <><CheckIcon className="size-4 mr-1.5" />Saved!</> : "Save Preferences"}
    </Button>
  </div>
</TabsContent>
```

Need to import `MonitorIcon` and `useTheme`:
```tsx
import { MonitorIcon } from "lucide-react";
import { useTheme } from "next-themes";
```

And destructure at top of component:
```tsx
const { theme, setTheme } = useTheme();
```

- [ ] **Step 7: Build the Memories tab content (merge current memories + sessions)**

The Memories tab stacks both sections vertically:

```tsx
<TabsContent value="memories" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
  <div className="flex-1 overflow-y-auto space-y-6">

    {/* Long-Term Memories */}
    <div>
      <SectionHeader
        title="Long-Term Memories"
        action={
          memories.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleClearMemories} className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
              <Trash2Icon className="size-3 mr-1" />
              Clear All
            </Button>
          ) : undefined
        }
      />
      <p className="text-xs text-muted-foreground -mt-2 mb-4">
        Facts and preferences Qube has automatically learned from your conversations.
      </p>

      <div className="rounded-xl border border-border/60 bg-muted/10">
        {loadingMemories ? (
          <div className="flex items-center justify-center py-16">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : memories.length === 0 ? (
          <EmptyState
            icon={BrainIcon}
            title="No memories yet"
            description="Start chatting and Qube will automatically extract key facts and preferences to remember."
          />
        ) : (
          <div className="divide-y divide-border/50">
            {memories.map((entry) => (
              <div key={entry.id} className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <CategoryBadge category={entry.category} />
                  <p className="text-sm text-foreground leading-relaxed">{entry.content}</p>
                  <RelevanceBar relevance={entry.relevance} />
                </div>
                <Button variant="ghost" size="icon" disabled={deletingMemoryId === entry.id} onClick={() => handleDeleteMemory(entry.id)} className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-lg mt-0.5">
                  {deletingMemoryId === entry.id ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* Past Sessions */}
    <div>
      <SectionHeader
        title="Past Sessions"
        action={
          sessions.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleClearSessions} className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
              <Trash2Icon className="size-3 mr-1" />
              Clear All
            </Button>
          ) : undefined
        }
      />
      <p className="text-xs text-muted-foreground -mt-2 mb-4">
        Your conversation history, stored locally. Qube uses these for long-term context.
      </p>

      <div className="rounded-xl border border-border/60 bg-muted/10">
        {loadingSessions ? (
          <div className="flex items-center justify-center py-16">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No sessions recorded"
            description="Start a conversation and it will be saved here for reference."
          />
        ) : (
          <div className="divide-y divide-border/50">
            {sessions.map((session) => {
              const date = new Date(session.updatedAt);
              const isToday = date.toDateString() === new Date().toDateString();
              const dateStr = isToday
                ? `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
              return (
                <div key={session.id} className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0 space-y-1">
                    <h4 className="text-sm font-semibold text-foreground truncate">{session.title || "Untitled Conversation"}</h4>
                    {session.summary && <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{session.summary}</p>}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-medium pt-0.5">
                      <CalendarIcon className="size-3" />
                      {dateStr}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" disabled={deletingSessionId === session.id} onClick={() => handleDeleteSession(session.id)} className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-lg mt-0.5">
                    {deletingSessionId === session.id ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </div>
</TabsContent>
```

- [ ] **Step 8: Build the Advanced tab content (current preferences content moved here)**

The entire current Preferences tab content (model selection, temperature, custom system instructions + save button), with the `SectionHeader` reading "Advanced" instead:

```tsx
<TabsContent value="advanced" className="flex-1 flex flex-col overflow-hidden p-6 mt-0">
  <SectionHeader title="Advanced" />
  <div className="flex-1 overflow-y-auto space-y-6 pr-1">

    {/* Default model */}
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">Default Model</label>
      <p className="text-xs text-muted-foreground">Which Cerebras model to load by default for new chats.</p>
      <div className="grid grid-cols-1 gap-2 mt-2">
        {[
          { id: "zai-glm-4.7", name: "GLM 4.7", desc: "355B Z.ai flagship — reasoning, coding & agentic workflows" },
          { id: "gpt-oss-120b", name: "GPT-OSS 120B", desc: "Production MoE with 120B params — fast & capable" },
          { id: "gemma-4-31b", name: "Gemma 4 31B", desc: "Efficient 31B Google model — strong reasoning" },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setDefaultModel(m.id)}
            className={cn(
              "flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all",
              defaultModel === m.id
                ? "border-primary/60 bg-primary/5 shadow-xs"
                : "border-border hover:border-border/80 hover:bg-muted/40"
            )}
          >
            <div className={cn(
              "size-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0 transition-all",
              defaultModel === m.id ? "border-primary bg-primary" : "border-muted-foreground/30"
            )}>
              {defaultModel === m.id && <div className="size-1.5 rounded-full bg-white" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{m.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>

    {/* Temperature */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground">Temperature</label>
        <span className="text-sm font-mono font-bold bg-muted px-2 py-0.5 rounded-md">{temperature.toFixed(1)}</span>
      </div>
      <p className="text-xs text-muted-foreground">Higher values = more creative, lower values = more focused.</p>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-xs text-muted-foreground w-10 text-right">Focus</span>
        <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
        <span className="text-xs text-muted-foreground w-14">Creative</span>
      </div>
    </div>

    {/* Custom system instructions */}
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">Custom System Instructions</label>
      <p className="text-xs text-muted-foreground">Additional instructions appended to Qube's core agent prompt on every request.</p>
      <textarea
        placeholder="E.g. Always respond in Italian. Prefer functional programming patterns. Never use semicolons in JS…"
        value={customSystemPrompt}
        onChange={(e) => setCustomSystemPrompt(e.target.value)}
        rows={5}
        className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
      />
    </div>
  </div>

  {/* Save button */}
  <div className="pt-4 border-t border-border/60 mt-4 flex justify-end shrink-0">
    <Button onClick={handleSavePreferences} className={cn("font-semibold px-5 transition-all", savedPrefs && "bg-emerald-600 hover:bg-emerald-700")}>
      {savedPrefs ? <><CheckIcon className="size-4 mr-1.5" />Saved!</> : "Save Preferences"}
    </Button>
  </div>
</TabsContent>
```

- [ ] **Step 9: Remove unused state and imports**

The `activeTab` state and `tabs` array are no longer needed. Remove them. Remove the `"Qube Settings"` sidebar and the footer text entirely.

Also remove `Settings2Icon` and replace with the proper icon. The final imports should include:
- From lucide-react: `BrainIcon, HistoryIcon, SlidersIcon, Trash2Icon, CheckIcon, Loader2Icon, TagIcon, CalendarIcon, MonitorIcon, SunIcon, MoonIcon`
- Keep the `useTheme` import from next-themes

- [ ] **Step 10: Clean up data-fetching logic**

The current `useEffect` fetches memories on tab change. Since memories and sessions are now on the same tab, update to fetch both when the memories tab becomes active. Change the effect at line 191 to fetch both:

```tsx
useEffect(() => {
  if (!open) return;
  if (activeTab === "memories") {
    fetchMemories();
    fetchSessions();
  }
}, [open, activeTab, fetchMemories, fetchSessions]);
```

Wait — we're removing `activeTab` entirely since Tabs is now controlled. Instead of `activeTab`, we use the tabs `onValueChange` to track which tab is active, and fetch data accordingly. Add a `tabValue` state:

```tsx
const [tabValue, setTabValue] = useState("preferences");
```

And pass it to Tabs:
```tsx
<Tabs value={tabValue} onValueChange={setTabValue} ...>
```

The data-fetching effect becomes:
```tsx
useEffect(() => {
  if (!open) return;
  if (tabValue === "memories") {
    fetchMemories();
    fetchSessions();
  }
}, [open, tabValue, fetchMemories, fetchSessions]);
```

- [ ] **Step 11: Commit**

```bash
git add components/shared/settings-dialog.tsx
git commit -m "feat: redesign settings dialog with top tabs (preferences/memories/advanced)"
```

---

### Task 6: Build and verify

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Success. If type errors occur, fix them.

- [ ] **Step 2: Manual verification**

Open the app, click the settings gear icon, verify:
1. Three tabs at the top: Preferences, Memories, Advanced
2. Preferences tab shows name input, about textarea, theme selector
3. Memories tab shows memories + sessions stacked
4. Advanced tab shows model, temperature, custom instructions
5. Setting name/about and saving works, then start a new chat to confirm agent receives the info
6. Theme toggle works (light/dark/system)
