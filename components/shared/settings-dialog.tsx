"use client";

import React, { useState, useEffect, type ReactNode, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BrainIcon,
  SlidersIcon,
  Trash2Icon,
  CheckIcon,
  Loader2Icon,
  TagIcon,
  CalendarIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  Settings2Icon,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/assistant-ui/tabs";
import { DEFAULT_MODEL_ID } from "@/constants/model";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { motion } from "motion/react";

interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  relevance: number;
}

interface SessionRecord {
  id: string;
  title: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  project: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  personal: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  decision: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  technology: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  pattern: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider", color)}>
      <TagIcon className="size-2.5" />
      {category}
    </span>
  );
}

function RelevanceBar({ relevance }: { relevance: number }) {
  const pct = Math.round(relevance * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium w-7 text-right">{pct}%</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.FC<any>; title: string; description: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
      <div className="size-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
        <Icon className="size-7 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-semibold text-foreground/70">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[220px] leading-relaxed">{description}</p>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 shrink-0 border-b border-border/60 mb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {action}
    </div>
  );
}

export function SettingsDialog({ children }: { children: ReactNode }) {
  const { setTheme } = useTheme();
  const [themePref, setThemePref] = useState("light");
  const [open, setOpen] = useState(false);
  const [tabValue, setTabValue] = useState("preferences");

  useEffect(() => {
    const sync = () => {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemePref(stored);
      } else {
        setThemePref(document.documentElement.classList.contains("dark") ? "dark" : "light");
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Memory state
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Preferences state
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL_ID);
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [userName, setUserName] = useState("");
  const [userAbout, setUserAbout] = useState("");
  const [savedPrefs, setSavedPrefs] = useState(false);

  const fetchMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const res = await fetch("/api/settings/memory");
      const data = await res.json();
      if (data.entries) setMemories(data.entries);
    } catch { /* ignore */ }
    finally { setLoadingMemories(false); }
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/settings/sessions");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
    finally { setLoadingSessions(false); }
  }, []);

  const handleDeleteMemory = async (id: string) => {
    setDeletingMemoryId(id);
    try {
      const res = await fetch(`/api/settings/memory?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.entries) setMemories(data.entries);
    } catch { /* ignore */ }
    finally { setDeletingMemoryId(null); }
  };

  const handleClearMemories = async () => {
    if (!confirm("Delete all long-term memories? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/settings/memory", { method: "DELETE" });
      const data = await res.json();
      if (data.entries !== undefined) setMemories([]);
    } catch { /* ignore */ }
  };

  const handleDeleteSession = async (id: string) => {
    setDeletingSessionId(id);
    try {
      const res = await fetch(`/api/settings/sessions?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch { /* ignore */ }
    finally { setDeletingSessionId(null); }
  };

  const handleClearSessions = async () => {
    if (!confirm("Delete all past sessions? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/settings/sessions", { method: "DELETE" });
      const data = await res.json();
      if (data.sessions !== undefined) setSessions([]);
    } catch { /* ignore */ }
  };

  const handleSavePreferences = () => {
    localStorage.setItem("qube-default-model", defaultModel);
    localStorage.setItem("qube-custom-system-prompt", customSystemPrompt);
    localStorage.setItem("qube-temperature", String(temperature));
    localStorage.setItem("qube-user-name", userName);
    localStorage.setItem("qube-user-about", userAbout);
    setSavedPrefs(true);
    setTimeout(() => setSavedPrefs(false), 2000);
  };

  const handleSaveUserPreferences = () => {
    localStorage.setItem("qube-user-name", userName);
    localStorage.setItem("qube-user-about", userAbout);
    setSavedPrefs(true);
    setTimeout(() => setSavedPrefs(false), 2000);
  };

  // Load prefs when dialog opens
  useEffect(() => {
    if (!open) return;
    if (typeof window !== "undefined") {
      setDefaultModel(localStorage.getItem("qube-default-model") || DEFAULT_MODEL_ID);
      setCustomSystemPrompt(localStorage.getItem("qube-custom-system-prompt") || "");
      const t = localStorage.getItem("qube-temperature");
      if (t) setTemperature(parseFloat(t));
      setUserName(localStorage.getItem("qube-user-name") || "");
      setUserAbout(localStorage.getItem("qube-user-about") || "");
    }
  }, [open]);

  // Load data when tab changes
  useEffect(() => {
    if (!open) return;
    if (tabValue === "memories") {
      fetchMemories();
      fetchSessions();
    }
  }, [open, tabValue, fetchMemories, fetchSessions]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent
        showCloseButton={true}
        className="sm:max-w-4xl max-w-4xl w-full p-0 flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        style={{ height: "min(660px, 90vh)" }}
      >
        <Tabs value={tabValue} onValueChange={setTabValue} className="flex flex-col flex-1 overflow-hidden">
    <div className="flex justify-center px-6 pt-5 pb-0">
      <TabsList variant="pills" className="bg-muted rounded-full p-1">
        <TabsTrigger value="preferences">
          <SlidersIcon className="size-4" />
          Preferences
        </TabsTrigger>
        <TabsTrigger value="memories">
          <BrainIcon className="size-4" />
          Memories
        </TabsTrigger>
        <TabsTrigger value="advanced">
          <Settings2Icon className="size-4" />
          Advanced
        </TabsTrigger>
      </TabsList>
    </div>

          {/* Preferences Tab */}
          <TabsContent value="preferences" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
            <div className="flex-1 overflow-y-auto space-y-6 pr-1">
              {/* Your Name */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Your Name</label>
                <p className="text-xs text-muted-foreground">What Qube should call you.</p>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* About You */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">About You</label>
                <p className="text-xs text-muted-foreground">Tell Qube about yourself for personalized responses.</p>
                <textarea
                  placeholder="E.g. I'm a full-stack developer who loves Rust and TypeScript..."
                  value={userAbout}
                  onChange={(e) => setUserAbout(e.target.value)}
                  rows={4}
                  className="w-full px-3.5 py-2.5 mt-1 rounded-xl border border-border bg-muted/10 text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
                />
              </div>

              {/* Theme */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-base font-semibold text-foreground">Theme</label>
          <p className="text-sm text-muted-foreground">Choose your preferred appearance.</p>
        </div>
        <Tabs value={themePref} onValueChange={(v) => setTheme(v)}>
          <TabsList variant="pills" size="sm" className="bg-muted rounded-full p-0.5">
            <TabsTrigger value="light"><SunIcon className="size-3.5" /> Light</TabsTrigger>
            <TabsTrigger value="dark"><MoonIcon className="size-3.5" /> Dark</TabsTrigger>
            <TabsTrigger value="system"><MonitorIcon className="size-3.5" /> System</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  </div>

            {/* Save button */}
            <div className="pt-4 border-t border-border/60 mt-4 flex justify-end shrink-0">
              <Button
                onClick={handleSaveUserPreferences}
                className={cn("font-semibold px-5 transition-all", savedPrefs && "bg-emerald-600 hover:bg-emerald-700")}
              >
                {savedPrefs
                  ? <><CheckIcon className="size-4 mr-1.5" />Saved!</>
                  : "Save Preferences"
                }
              </Button>
            </div>
            </motion.div>
          </TabsContent>

          {/* Memories Tab */}
          <TabsContent value="memories" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
            <div className="flex-1 overflow-y-auto space-y-8 pr-1">
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
                <p className="text-xs text-muted-foreground -mt-2 mb-4 shrink-0">
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
                        <div
                          key={entry.id}
                          className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CategoryBadge category={entry.category} />
                            </div>
                            <p className="text-sm text-foreground leading-relaxed">{entry.content}</p>
                            <RelevanceBar relevance={entry.relevance} />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deletingMemoryId === entry.id}
                            onClick={() => handleDeleteMemory(entry.id)}
                            className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-lg mt-0.5"
                          >
                            {deletingMemoryId === entry.id
                              ? <Loader2Icon className="size-3.5 animate-spin" />
                              : <Trash2Icon className="size-3.5" />
                            }
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
                <p className="text-xs text-muted-foreground -mt-2 mb-4 shrink-0">
                  Your conversation history, stored locally. Qube uses these for long-term context.
                </p>

                <div className="rounded-xl border border-border/60 bg-muted/10">
                  {loadingSessions ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
                    </div>
                  ) : sessions.length === 0 ? (
                    <EmptyState
                      icon={CalendarIcon}
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
                          <div
                            key={session.id}
                            className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex-1 min-w-0 space-y-1">
                              <h4 className="text-sm font-semibold text-foreground truncate">
                                {session.title || "Untitled Conversation"}
                              </h4>
                              {session.summary && (
                                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                  {session.summary}
                                </p>
                              )}
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-medium pt-0.5">
                                <CalendarIcon className="size-3" />
                                {dateStr}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={deletingSessionId === session.id}
                              onClick={() => handleDeleteSession(session.id)}
                              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-lg mt-0.5"
                            >
                              {deletingSessionId === session.id
                                ? <Loader2Icon className="size-3.5 animate-spin" />
                                : <Trash2Icon className="size-3.5" />
                              }
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </motion.div>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
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
                  <span className="text-sm font-mono font-bold bg-muted px-2 py-0.5 rounded-md">
                    {temperature.toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Higher values = more creative, lower values = more focused.</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-muted-foreground w-10 text-right">Focus</span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
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
              <Button
                onClick={handleSavePreferences}
                className={cn("font-semibold px-5 transition-all", savedPrefs && "bg-emerald-600 hover:bg-emerald-700")}
              >
                {savedPrefs
                  ? <><CheckIcon className="size-4 mr-1.5" />Saved!</>
                  : "Save Preferences"
                }
              </Button>
            </div>
            </motion.div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
