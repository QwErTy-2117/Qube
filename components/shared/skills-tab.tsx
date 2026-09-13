"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  SearchIcon,
  Loader2Icon,
  XIcon,
  PlusIcon,
  CheckIcon,
  Trash2Icon,
  LockIcon,
  ChevronLeftIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/assistant-ui/tabs";
import { Button } from "@/components/ui/button";
import type { SkillConfig } from "@/lib/skills/types";

interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  allowedTools?: string;
  marketplace: string;
  marketplaceUrl: string;
  version: string;
}

const MARKETPLACE_COLORS: Record<string, string> = {
  "skills.sh": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  SkillsMP: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ClawHub: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Anthropic Official": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const NAME_RE = /^[a-z0-9-]+$/;

function emptyForm() {
  return {
    name: "",
    description: "",
    instructions: "",
    allowedTools: "",
    disallowedTools: "",
    userInvocable: true,
    disableModelInvocation: false,
  };
}

function toForm(s: SkillConfig) {
  return {
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    allowedTools: s.allowedTools || "",
    disallowedTools: s.disallowedTools || "",
    userInvocable: s.userInvocable !== false,
    disableModelInvocation: s.disableModelInvocation === true,
  };
}

type FormState = ReturnType<typeof emptyForm>;

/** Marketplace entry → read-only preview form (flags fall back to install defaults). */
function marketplaceToForm(mp: MarketplaceSkill): FormState {
  return {
    name: mp.name,
    description: mp.description,
    instructions: mp.instructions,
    allowedTools: mp.allowedTools || "",
    disallowedTools: "",
    userInvocable: true,
    disableModelInvocation: false,
  };
}

/** Every static Pi harness tool, grouped like the task-permissions list. */
const TOOL_GROUPS: Array<{ label: string; tools: Array<{ name: string; hint: string }> }> = [
  {
    label: "Files",
    tools: [
      { name: "read_file", hint: "Read workspace files" },
      { name: "write_file", hint: "Create / overwrite files" },
      { name: "edit_file", hint: "Edit files by exact match" },
      { name: "delete_file", hint: "Delete files" },
      { name: "list_directory", hint: "List folders" },
      { name: "present_file", hint: "Show file cards in chat" },
    ],
  },
  {
    label: "Shell",
    tools: [{ name: "run_command", hint: "Run shell commands" }],
  },
  {
    label: "Web",
    tools: [
      { name: "web_search", hint: "Search the web" },
      { name: "web_fetch", hint: "Fetch page content" },
    ],
  },
  {
    label: "Agent",
    tools: [
      { name: "subagent", hint: "Spawn helper subagents" },
      { name: "TodoWrite", hint: "Session goals checklist" },
      { name: "schedule_task", hint: "Manage scheduled tasks" },
      { name: "update_heartbeat", hint: "Manage heartbeat" },
      { name: "ask_user", hint: "Ask you a question" },
      { name: "ask_question", hint: "Questionnaire panel" },
    ],
  },
  {
    label: "Browser",
    tools: [
      { name: "browser_navigate", hint: "Open pages" },
      { name: "browser_snapshot", hint: "Read page structure" },
      { name: "browser_screenshot", hint: "Capture the page" },
      { name: "browser_click", hint: "Click elements" },
      { name: "browser_hover", hint: "Hover elements" },
      { name: "browser_drag", hint: "Drag elements" },
      { name: "browser_type", hint: "Type into fields" },
      { name: "browser_fill", hint: "Fill fields" },
      { name: "browser_fill_form", hint: "Fill whole forms" },
      { name: "browser_press_key", hint: "Press keys" },
      { name: "browser_select_option", hint: "Pick dropdown options" },
      { name: "browser_file_upload", hint: "Upload files" },
      { name: "browser_evaluate", hint: "Run page scripts" },
      { name: "browser_wait_for", hint: "Wait for content" },
      { name: "browser_navigate_back", hint: "Go back" },
      { name: "browser_navigate_forward", hint: "Go forward" },
      { name: "browser_search", hint: "Search within the browser" },
      { name: "browser_read", hint: "Read page text" },
      { name: "browser_console_messages", hint: "Read console output" },
      { name: "browser_network_requests", hint: "Inspect network" },
      { name: "browser_tabs", hint: "Manage tabs" },
      { name: "browser_close", hint: "Close the browser" },
      { name: "browser_handle_dialog", hint: "Handle dialogs" },
      { name: "browser_back", hint: "Back navigation" },
    ],
  },
];

function MiniSwitch({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors h-6 w-11 disabled:cursor-default disabled:opacity-60",
        checked ? "bg-emerald-500" : "bg-input/40"
      )}
    >
      <span
        className={cn(
          "block h-5 w-5 rounded-full bg-white shadow-lg transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
      />
    </button>
  );
}

function SkillFormFields({
  form,
  setForm,
  nameLocked,
  error,
  readOnly = false,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  nameLocked: boolean;
  error: string | null;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState("general");

  const toggleTool = (tool: string, which: "allowed" | "disallowed") => {
    const parse = (s: string) => new Set(s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean));
    const allowed = parse(form.allowedTools);
    const disallowed = parse(form.disallowedTools);
    if (which === "allowed") {
      if (allowed.has(tool)) allowed.delete(tool);
      else {
        allowed.add(tool);
        disallowed.delete(tool);
      }
    } else {
      if (disallowed.has(tool)) disallowed.delete(tool);
      else {
        disallowed.add(tool);
        allowed.delete(tool);
      }
    }
    setForm({ ...form, allowedTools: [...allowed].join(" "), disallowedTools: [...disallowed].join(" ") });
  };

  const renderToolChecklist = (which: "allowed" | "disallowed") => {
    const parse = (s: string) => new Set(s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean));
    const selected = which === "allowed" ? parse(form.allowedTools) : parse(form.disallowedTools);
    return (
      <div className="space-y-4">
        {TOOL_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.label}</p>
            <div className="rounded-xl border border-border/60 divide-y divide-border/40">
              {group.tools.map((tool) => {
                const on = selected.has(tool.name);
                return (
                  <button
                    key={tool.name}
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleTool(tool.name, which)}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-2 text-left transition-colors",
                      readOnly ? "cursor-default" : "hover:bg-muted/30 cursor-pointer"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-foreground">{tool.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{tool.hint}</span>
                    </span>
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                        on ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/30"
                      )}
                    >
                      {on && <CheckIcon className="size-3 text-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            Other {which === "allowed" ? "allowed" : "disallowed"} tools
          </label>
          <input
            type="text"
            placeholder="custom-mcp-tool another-tool"
            disabled={readOnly}
            value={which === "allowed" ? form.allowedTools : form.disallowedTools}
            onChange={(e) => {
              const v = e.target.value;
              // Keep checklist-known tools in sync, preserve the rest verbatim.
              const known = new Set(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name)));
              const rest = v.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).filter((t) => !known.has(t));
              const kept = (which === "allowed" ? form.allowedTools : form.disallowedTools)
                .split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).filter((t) => known.has(t));
              const merged = [...kept, ...rest.filter((t) => !kept.includes(t))].join(" ");
              setForm({ ...form, [which === "allowed" ? "allowedTools" : "disallowedTools"]: merged });
            }}
            className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-ring font-mono disabled:opacity-60"
          />
          <p className="text-[11px] text-muted-foreground">For dynamic MCP / connector tools not listed above.</p>
        </div>
      </div>
    );
  };

  return (
    <div className="py-2">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="flex justify-center pb-3">
          <TabsList variant="pills" className="bg-muted rounded-full p-1">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
        </div>

        <div className="h-[380px] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-0.5">
        <TabsContent value="general" className="space-y-4 mt-0">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Name</label>
            <input
              type="text"
              placeholder="my-skill"
              value={form.name}
              disabled={nameLocked || readOnly}
              onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring font-mono disabled:opacity-60"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">Description</label>
              <span className="text-[10px] text-muted-foreground/60">{form.description.length}/1024</span>
            </div>
            <textarea
              placeholder="Does X. Use when the user asks for Y…"
              value={form.description}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 1024) })}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed disabled:opacity-60"
            />
          </div>
        </TabsContent>

        <TabsContent value="details" className="space-y-4 mt-0">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Instructions (SKILL.md body)</label>
            <textarea
              placeholder="## Procedure&#10;1. …&#10;&#10;## Rules&#10;- …"
              value={form.instructions}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              rows={10}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed font-mono disabled:opacity-60"
            />
          </div>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-5 mt-0">
          <div className="rounded-xl border border-border/60 divide-y divide-border/40">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-foreground">Show in / menu</p>
                <p className="text-[11px] text-muted-foreground">Off = background knowledge, auto-applied silently.</p>
              </div>
              <MiniSwitch checked={form.userInvocable} disabled={readOnly} onCheckedChange={(v) => setForm({ ...form, userInvocable: v })} />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-foreground">Manual only</p>
                <p className="text-[11px] text-muted-foreground">On = runs only when you type the skill name.</p>
              </div>
              <MiniSwitch checked={form.disableModelInvocation} disabled={readOnly} onCheckedChange={(v) => setForm({ ...form, disableModelInvocation: v })} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Allowed tools</p>
            <p className="text-[11px] text-muted-foreground">Pre-approved without asking while the skill runs.</p>
            {renderToolChecklist("allowed")}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Disallowed tools</p>
            <p className="text-[11px] text-muted-foreground">Removed from the pool while the skill runs.</p>
            {renderToolChecklist("disallowed")}
          </div>
        </TabsContent>
        </div>
      </Tabs>
      {error && (
        <div className="mt-3 text-xs text-red-500 bg-red-500/10 rounded-xl px-3 py-2 border border-red-500/20">{error}</div>
      )}
    </div>
  );
}

export function SkillsTab({ onDialogOpenChange }: { onDialogOpenChange?: (open: boolean) => void }) {
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [marketplace, setMarketplace] = useState<MarketplaceSkill[]>([]);
  const [mpLoading, setMpLoading] = useState(false);

  // detail / create / edit dialog state
  const [detail, setDetail] = useState<MarketplaceSkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SkillConfig | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillConfig | null>(null);

  const notify = useCallback(
    (open: boolean) => {
      try {
        onDialogOpenChange?.(open);
      } catch {}
    },
    [onDialogOpenChange]
  );

  useEffect(() => {
    notify(managerOpen || detail !== null || creating || editing !== null || deleteTarget !== null);
  }, [managerOpen, detail, creating, editing, deleteTarget, notify]);

  const persist = useCallback((next: SkillConfig[]) => {
    setSkills(next);
    try {
      localStorage.setItem("qube-skills", JSON.stringify(next));
    } catch {}
    fetch("/api/skills/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills: next }),
    }).catch(() => {});
    window.dispatchEvent(new Event("qube-skills-changed"));
  }, []);

  // Load installed: server first, fallback localStorage
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/skills/sync");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.skills) && data.skills.length > 0) {
            setSkills(data.skills);
            try {
              localStorage.setItem("qube-skills", JSON.stringify(data.skills));
            } catch {}
            setLoaded(true);
            return;
          }
        }
      } catch {}
      try {
        const stored = localStorage.getItem("qube-skills");
        if (stored) setSkills(JSON.parse(stored));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const [mpError, setMpError] = useState(false);

  const fetchMarketplace = useCallback(async () => {
    setMpLoading(true);
    setMpError(false);
    try {
      const res = await fetch("/api/skills/marketplace");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.skills)) {
          setMarketplace(data.skills);
          return;
        }
      }
      setMpError(true);
    } catch {
      setMpError(true);
    }
    finally {
      setMpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (managerOpen && marketplace.length === 0 && !mpLoading) fetchMarketplace();
  }, [managerOpen, marketplace.length, mpLoading, fetchMarketplace]);

  const installedNames = new Set(skills.map((s) => s.name));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? marketplace.filter(
        (s) =>
          s.slug.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.marketplace.toLowerCase().includes(q)
      )
    : marketplace;

  const validate = (f: FormState, isNew: boolean): string | null => {
    if (!f.name.trim()) return "Skill name is required.";
    if (!NAME_RE.test(f.name)) return "Name must be lowercase letters, numbers, and hyphens only.";
    if (f.name.length > 64) return "Name must be 64 characters or less.";
    if (isNew && installedNames.has(f.name)) return `A skill named “${f.name}” is already installed.`;
    if (!f.description.trim()) return "Description is required — the agent uses it to decide when to apply the skill.";
    if (!f.instructions.trim()) return "Instructions are required — this is the SKILL.md body.";
    return null;
  };

  const openCreate = () => {
    setForm(emptyForm());
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (s: SkillConfig) => {
    setForm(toForm(s));
    setFormError(null);
    setEditing(s);
  };

  const handleCreate = async () => {
    const err = validate(form, true);
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    const now = Date.now();
    const created: SkillConfig = {
      id: `${form.name}_${now.toString(36)}`,
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
      allowedTools: form.allowedTools.trim() || undefined,
      disallowedTools: form.disallowedTools.trim() || undefined,
      userInvocable: form.userInvocable,
      disableModelInvocation: form.disableModelInvocation,
      source: "custom",
      version: "1.0.0",
      installedAt: now,
      updatedAt: now,
    };
    await new Promise((r) => setTimeout(r, 350));
    persist([...skills, created]);
    setSaving(false);
    setSaved(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaved(false);
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const err = validate(form, false);
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 350));
    persist(
      skills.map((s) =>
        s.name === editing.name
          ? {
              ...s,
              description: form.description.trim(),
              instructions: form.instructions.trim(),
              allowedTools: form.allowedTools.trim() || undefined,
              disallowedTools: form.disallowedTools.trim() || undefined,
              userInvocable: form.userInvocable,
              disableModelInvocation: form.disableModelInvocation,
              updatedAt: Date.now(),
            }
          : s
      )
    );
    setSaving(false);
    setSaved(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaved(false);
    setEditing(null);
  };

  const handleAddMarketplace = async (mp: MarketplaceSkill) => {
    if (installedNames.has(mp.name)) {
      setDetail(null);
      return;
    }
    setSaving(true);
    const now = Date.now();
    const created: SkillConfig = {
      id: `${mp.name}_${now.toString(36)}`,
      name: mp.name,
      description: mp.description,
      instructions: mp.instructions,
      allowedTools: mp.allowedTools,
      source: "marketplace",
      marketplace: mp.marketplace,
      version: mp.version,
      installedAt: now,
      updatedAt: now,
    };
    await new Promise((r) => setTimeout(r, 350));
    persist([...skills, created]);
    setSaving(false);
    setSaved(true);
    await new Promise((r) => setTimeout(r, 600));
    setSaved(false);
    setDetail(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const next = skills.filter((s) => s.name !== deleteTarget.name);
    persist(next);
    setDeleteTarget(null);
    setEditing(null);
  };

  return (
    <div className="border-t border-border/40 pt-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Skills</h3>
          <p className="text-xs text-muted-foreground">
            Reusable playbooks the agent auto-applies by topic — research, coding, documents, and more.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setQuery("");
              setManagerOpen(true);
            }}
            variant="outline"
            className="rounded-full font-semibold px-4 h-8 flex items-center gap-1.5"
            size="sm"
          >
            <PlusIcon className="size-3.5" />
            {skills.length > 0 ? "Manage" : "Add Skill"}
          </Button>
        </div>
      </div>

      {loaded && skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <button
              key={s.name}
              onClick={() => openEdit(s)}
              title={s.description}
              className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[11px] font-semibold border border-border/60 bg-muted/20 hover:bg-muted/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#5E6AD2" }} />
              <span className="text-foreground/80">{s.name}</span>
              {s.isSystem && <LockIcon className="size-2.5 text-muted-foreground/60" />}
            </button>
          ))}
        </div>
      )}
      {loaded && skills.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">No skills installed yet — 3 system skills load automatically on first chat.</p>
      )}

      {/* Manager popup — search + marketplace list */}
      <Dialog open={managerOpen} onOpenChange={(v) => { if (!v) setManagerOpen(false); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Skills</DialogTitle>
            <DialogDescription>
              Browse skills from skills.sh, SkillsMP, ClawHub and Anthropic — or create your own.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills..."
                className="w-full h-9 rounded-full border border-border bg-background pl-9 pr-8 text-xs outline-none focus:border-ring transition-colors placeholder:text-muted-foreground/40"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-5 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>
            <button
              onClick={openCreate}
              title="Create your own skill"
              className="size-9 shrink-0 flex items-center justify-center rounded-full border border-border bg-background hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden min-h-0">
            {mpLoading && marketplace.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
              </div>
            ) : mpError && marketplace.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <p className="text-xs text-muted-foreground/60">Couldn’t load the skills catalog.</p>
                <Button variant="outline" size="sm" onClick={fetchMarketplace} className="rounded-full h-8 px-4">
                  Retry
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 text-center py-8">
                No skills match “{query}”
              </p>
            ) : (
              <div className="space-y-2 py-1">
                {filtered.map((mp) => {
                  const installed = installedNames.has(mp.name);
                  return (
                    <div
                      key={mp.slug}
                      onClick={() => {
                        if (!installed) setDetail(mp);
                      }}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-xl border border-border bg-muted/10 gap-3 transition-colors",
                        installed ? "opacity-60" : "hover:bg-muted/20 cursor-pointer"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{mp.name}</span>
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-semibold", MARKETPLACE_COLORS[mp.marketplace] || "bg-muted text-muted-foreground")}>
                            {mp.marketplace}
                          </span>
                          {installed && <CheckIcon className="size-3.5 text-emerald-500" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{mp.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Marketplace detail popup — read-only twin of create/edit, Add instead of Save */}
      <Dialog open={detail !== null} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            {detail && (
              <DialogDescription>
                From {detail.marketplace} · v{detail.version} — preview only, nothing here is editable.
              </DialogDescription>
            )}
          </DialogHeader>
          {detail && (
            <div className="flex items-center gap-1.5 px-1">
              <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-semibold", MARKETPLACE_COLORS[detail.marketplace] || "bg-muted text-muted-foreground")}>
                {detail.marketplace}
              </span>
            </div>
          )}
          {detail && (
            <SkillFormFields form={marketplaceToForm(detail)} setForm={() => {}} nameLocked readOnly error={null} />
          )}
          <DialogFooter className="pt-2">
            <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
              <button
                onClick={() => setDetail(null)}
                type="button"
                className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Cancel"
              >
                <XIcon className="size-4" />
              </button>
              <div className="relative">
                <AnimatePresence mode="wait">
                  {saved ? (
                    <motion.div
                      key="saved"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center justify-center size-8 rounded-full bg-emerald-500 text-white"
                    >
                      <CheckIcon className="size-4" />
                    </motion.div>
                  ) : (
                    <motion.div key="add" initial={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                      <Button
                        onClick={() => detail && handleAddMarketplace(detail)}
                        disabled={saving}
                        className="rounded-full font-semibold h-8 px-4"
                        size="sm"
                      >
                        {saving ? <Loader2Icon className="size-4 animate-spin" /> : "Add"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create popup — full SKILL.md configuration */}
      <Dialog open={creating} onOpenChange={(v) => { if (!v) setCreating(false); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <DialogHeader>
            <DialogTitle>Create Skill</DialogTitle>
            <DialogDescription>
              Configure a Claude Code compatible SKILL.md — name, routing description, and instructions.
            </DialogDescription>
          </DialogHeader>
          <SkillFormFields form={form} setForm={setForm} nameLocked={false} error={formError} />
          <DialogFooter className="pt-2">
            <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
              <button
                onClick={() => setCreating(false)}
                type="button"
                className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Cancel"
              >
                <XIcon className="size-4" />
              </button>
              <div className="relative">
                <AnimatePresence mode="wait">
                  {saved ? (
                    <motion.div
                      key="saved"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center justify-center size-8 rounded-full bg-emerald-500 text-white"
                    >
                      <CheckIcon className="size-4" />
                    </motion.div>
                  ) : (
                    <motion.div key="save" initial={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                      <Button onClick={handleCreate} disabled={saving} className="rounded-full font-semibold h-8 px-4" size="sm">
                        {saving ? <Loader2Icon className="size-4 animate-spin" /> : "Create"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit popup — badge click; Save + Delete (system: no delete) + back */}
      <Dialog open={editing !== null} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {managerOpen && (
                <button
                  onClick={() => setEditing(null)}
                  className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground"
                  title="Back to skills"
                >
                  <ChevronLeftIcon className="size-4" />
                </button>
              )}
              <div>
                <DialogTitle>{editing?.name}</DialogTitle>
                {editing?.isSystem && (
                  <DialogDescription>
                    System skill — editable, but can’t be deleted.
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>
          {editing && (
            <div className="flex items-center gap-1.5 px-1">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: editing.color || "#5E6AD2" }} />
              <span className="text-[11px] text-muted-foreground">
                {editing.isSystem ? "System" : editing.source === "marketplace" ? `From ${editing.marketplace}` : "Custom"} · v{editing.version || "1.0.0"}
              </span>
            </div>
          )}
          <SkillFormFields form={form} setForm={setForm} nameLocked error={formError} />
          <DialogFooter className="pt-2">
            <div className="flex w-full items-center justify-between">
              {!editing?.isSystem ? (
                <Button
                  onClick={() => editing && setDeleteTarget(editing)}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                >
                  <Trash2Icon className="size-3.5" />
                  Delete
                </Button>
              ) : (
                <div />
              )}
            <div className="w-fit flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 shrink-0">
              <button
                onClick={() => setEditing(null)}
                type="button"
                className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Cancel"
              >
                <XIcon className="size-4" />
              </button>
              <div className="relative">
                <AnimatePresence mode="wait">
                  {saved ? (
                    <motion.div
                      key="saved"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center justify-center size-8 rounded-full bg-emerald-500 text-white"
                    >
                      <CheckIcon className="size-4" />
                    </motion.div>
                  ) : (
                    <motion.div key="save" initial={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}>
                      <Button onClick={handleSaveEdit} disabled={saving} className="rounded-full font-semibold h-8 px-4" size="sm">
                        {saving ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            </div>
          </DialogFooter>

          <Dialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
            <DialogContent className="sm:max-w-sm rounded-3xl">
              <DialogHeader>
                <DialogTitle>Delete Skill</DialogTitle>
                <DialogDescription>
                  Remove {deleteTarget?.name}? The agent will no longer auto-apply it. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} className="rounded-full h-8 px-4">
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </div>
  );
}
