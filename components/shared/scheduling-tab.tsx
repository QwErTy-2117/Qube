"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Switch } from "radix-ui";
import { cn } from "@/lib/utils";
import {
  Clock,
  Plus,
  Play,
  Trash2,
  Edit3,
  Loader2,
  CheckIcon,
  XIcon,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/assistant-ui/tabs";

interface ScheduledTask {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: "interval" | "once";
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: {
    runCommands: boolean;
    destructiveCommands: boolean;
    externalFiles: boolean;
    webAccess: boolean;
    browserAccess: boolean;
  };
  lastRunAt: number | null;
  nextRunAt: number;
}

interface LogEntry {
  timestamp: number;
  taskId: string;
  name: string;
  status: "success" | "error";
  output: string;
  duration: number;
}

type PermissionKey = keyof ScheduledTask["permissions"];

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  runCommands: "Run commands",
  destructiveCommands: "Destructive commands",
  externalFiles: "Access external files",
  webAccess: "Web search & fetch",
  browserAccess: "Browser automation",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SwitchToggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        "h-6 w-11",
        checked ? "bg-emerald-500" : "bg-input/40"
      )}
    >
      <Switch.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        )}
      />
    </Switch.Root>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-3 shrink-0 mb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {action}
    </div>
  );
}

function Calendar({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(value?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(value?.getMonth() ?? today.getMonth());
  const [viewHour, setViewHour] = useState(value?.getHours() ?? 12);
  const [viewMinute, setViewMinute] = useState(value?.getMinutes() ?? 0);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  const handleDayClick = (day: number) => {
    const d = new Date(viewYear, viewMonth, day, viewHour, viewMinute);
    onChange(d);
  };

  const isSelected = (day: number) =>
    value !== null &&
    value.getFullYear() === viewYear &&
    value.getMonth() === viewMonth &&
    value.getDate() === day;

  const isToday = (day: number) => {
    const d = new Date();
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth && d.getDate() === day;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <button onClick={prevMonth} className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground">
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="size-7 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-[11px] font-medium text-muted-foreground/60 py-1">{d}</div>
        ))}
        {Array.from({ length: startOffset }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              className={cn(
                "size-8 rounded-full text-xs transition-all",
                isSelected(day)
                  ? "bg-primary text-primary-foreground font-semibold"
                  : isToday(day)
                    ? "border border-primary/40 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/60"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 justify-center">
        <select
          value={viewHour}
          onChange={(e) => { const h = parseInt(e.target.value); setViewHour(h); if (value) onChange(new Date(viewYear, viewMonth, value.getDate(), h, viewMinute)); }}
          className="px-2 py-1 rounded-lg border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{i.toString().padStart(2, "0")}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">:</span>
        <select
          value={viewMinute}
          onChange={(e) => { const m = parseInt(e.target.value); setViewMinute(m); if (value) onChange(new Date(viewYear, viewMonth, value.getDate(), viewHour, m)); }}
          className="px-2 py-1 rounded-lg border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          {[0, 15, 30, 45].map((m) => (
            <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RecurringSchedule({
  value,
  onChange,
}: {
  value: { intervalMinutes: number; hour?: number; weekdays?: number[]; monthDay?: number };
  onChange: (v: { intervalMinutes: number; hour?: number; weekdays?: number[]; monthDay?: number }) => void;
}) {
  const [recurTab, setRecurTab] = useState(
    value.intervalMinutes === 1440 ? "daily"
    : value.intervalMinutes === 10080 ? "weekly"
    : value.intervalMinutes === 43200 ? "monthly"
    : "daily"
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(value.weekdays ?? [1]);
  const [selectedMonthDay, setSelectedMonthDay] = useState(value.monthDay ?? 1);
  const [selectedHour, setSelectedHour] = useState(value.hour ?? 9);
  const [customMinutes, setCustomMinutes] = useState(
    value.intervalMinutes && ![1440, 10080, 43200].includes(value.intervalMinutes)
      ? value.intervalMinutes
      : 1440
  );

  const handleRecurTabChange = (tab: string) => {
    setRecurTab(tab);
    if (tab === "daily") onChange({ intervalMinutes: 1440, hour: selectedHour });
    else if (tab === "weekly") onChange({ intervalMinutes: 10080, weekdays: selectedWeekdays, hour: selectedHour });
    else if (tab === "monthly") onChange({ intervalMinutes: 43200, monthDay: selectedMonthDay, hour: selectedHour });
  };

  const handleWeekdayToggle = (idx: number) => {
    const next = selectedWeekdays.includes(idx)
      ? selectedWeekdays.filter((d) => d !== idx)
      : [...selectedWeekdays, idx].sort();
    setSelectedWeekdays(next);
    onChange({ intervalMinutes: 10080, weekdays: next, hour: selectedHour });
  };

  const handleMonthDayChange = (d: number) => {
    const clamped = Math.max(1, Math.min(28, d));
    setSelectedMonthDay(clamped);
    onChange({ intervalMinutes: 43200, monthDay: clamped, hour: selectedHour });
  };

  const handleHourChange = (h: number) => {
    setSelectedHour(h);
    if (recurTab === "daily") onChange({ intervalMinutes: 1440, hour: h });
    else if (recurTab === "weekly") onChange({ intervalMinutes: 10080, weekdays: selectedWeekdays, hour: h });
    else onChange({ intervalMinutes: 43200, monthDay: selectedMonthDay, hour: h });
  };

  return (
    <div className="space-y-4">
      <Tabs value={recurTab} onValueChange={handleRecurTabChange}>
        <TabsList variant="pills" className="bg-muted/60 rounded-full p-0.5 w-full">
          <TabsTrigger value="daily" className="flex-1 !h-7 !min-w-0 !p-0 rounded-full text-xs">Daily</TabsTrigger>
          <TabsTrigger value="weekly" className="flex-1 !h-7 !min-w-0 !p-0 rounded-full text-xs">Weekly</TabsTrigger>
          <TabsTrigger value="monthly" className="flex-1 !h-7 !min-w-0 !p-0 rounded-full text-xs">Monthly</TabsTrigger>
        </TabsList>
      </Tabs>

      {recurTab === "daily" && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Time of day</label>
          <div className="flex flex-wrap gap-1.5">
            {HOURS.filter((_, i) => i % 3 === 0).map((h, i) => (
              <button
                key={h}
                onClick={() => handleHourChange(i * 3)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                  selectedHour === i * 3
                    ? "border-primary/60 bg-primary/5 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {recurTab === "weekly" && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Days of the week</label>
          <div className="flex gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <button
                key={d}
                onClick={() => handleWeekdayToggle(i)}
                className={cn(
                  "flex-1 py-2 rounded-lg border text-xs transition-all",
                  selectedWeekdays.includes(i)
                    ? "border-primary/60 bg-primary/5 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-muted-foreground">Time of day</label>
          <div className="flex flex-wrap gap-1.5">
            {HOURS.filter((_, i) => i % 3 === 0).map((h, i) => (
              <button
                key={h}
                onClick={() => handleHourChange(i * 3)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                  selectedHour === i * 3
                    ? "border-primary/60 bg-primary/5 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {recurTab === "monthly" && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground">Day of the month</label>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                onClick={() => handleMonthDayChange(d)}
                className={cn(
                  "size-8 rounded-full text-xs transition-all",
                  selectedMonthDay === d
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/60 border border-transparent"
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-muted-foreground">Time of day</label>
          <div className="flex flex-wrap gap-1.5">
            {HOURS.filter((_, i) => i % 3 === 0).map((h, i) => (
              <button
                key={h}
                onClick={() => handleHourChange(i * 3)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                  selectedHour === i * 3
                    ? "border-primary/60 bg-primary/5 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  scheduleKind,
  recurSchedule,
  runOnceDate,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleKind: "interval" | "once";
  recurSchedule: { intervalMinutes: number; hour?: number; weekdays?: number[]; monthDay?: number };
  runOnceDate: Date | null;
  onSave: (data: { scheduleKind: "interval" | "once"; recurSchedule: typeof recurSchedule; runOnceDate: Date | null }) => void;
}) {
  const [kind, setKind] = useState(scheduleKind);
  const [recur, setRecur] = useState(recurSchedule);
  const [onceDate, setOnceDate] = useState(runOnceDate);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setKind(scheduleKind);
      setRecur(recurSchedule);
      setOnceDate(runOnceDate);
      setConfirming(false);
    }
  }, [open, scheduleKind, recurSchedule, runOnceDate]);

  const handleDone = () => {
    setConfirming(true);
    setTimeout(() => {
      onSave({ scheduleKind: kind, recurSchedule: kind === "interval" ? recur : ({} as any), runOnceDate: kind === "once" ? onceDate : null });
      setConfirming(false);
    }, 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
          <DialogDescription>
            Configure when this task should run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-h-[340px]">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "interval" | "once")}>
            <TabsList variant="pills" className="bg-muted/60 rounded-full p-0.5 w-full">
              <TabsTrigger value="interval" className="flex-1 !h-8 !min-w-0 !p-0 rounded-full text-xs">Recurring</TabsTrigger>
              <TabsTrigger value="once" className="flex-1 !h-8 !min-w-0 !p-0 rounded-full text-xs">Run once</TabsTrigger>
            </TabsList>
          </Tabs>

          {kind === "interval" ? (
            <RecurringSchedule value={recur} onChange={setRecur} />
          ) : (
            <Calendar value={onceDate} onChange={setOnceDate} />
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleDone}
            className={cn("rounded-full font-semibold transition-all", confirming && "bg-emerald-600 hover:bg-emerald-700")}
          >
            {confirming ? <CheckIcon className="size-4" /> : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function scheduleSummary(kind: "interval" | "once", recur?: { intervalMinutes: number; hour?: number; weekdays?: number[]; monthDay?: number }, date?: Date | null): string {
  if (kind === "once" && date) {
    return `Once on ${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (kind === "interval" && recur) {
    const hourStr = recur.hour !== undefined ? ` at ${recur.hour.toString().padStart(2, "0")}:00` : "";
    if (recur.intervalMinutes === 1440) return `Every day${hourStr}`;
    if (recur.intervalMinutes === 10080) {
      const days = recur.weekdays?.map((d) => WEEKDAYS[d]).join(", ") || "";
      return `Every week on ${days}${hourStr}`;
    }
    if (recur.intervalMinutes === 43200) {
      return `Every month on day ${recur.monthDay || 1}${hourStr}`;
    }
    return `Every ${recur.intervalMinutes} min`;
  }
  return "Not configured";
}

function TaskFormDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<ScheduledTask>;
  onSave: (data: any) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [instructions, setInstructions] = useState(initial?.instructions || "");
  const [scheduleKind, setScheduleKind] = useState<"interval" | "once">(initial?.schedule?.kind || "interval");
  const [recurSchedule, setRecurSchedule] = useState({
    intervalMinutes: initial?.schedule?.intervalMinutes ?? 1440,
  });
  const [runOnceDate, setRunOnceDate] = useState<Date | null>(
    initial?.schedule?.runAt ? new Date(initial.schedule.runAt) : null
  );
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>(
    initial?.permissions || {
      runCommands: false,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: false,
      browserAccess: false,
    }
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setInstructions(initial?.instructions || "");
      setScheduleKind(initial?.schedule?.kind || "interval");
      setRecurSchedule({ intervalMinutes: initial?.schedule?.intervalMinutes ?? 1440 });
      setRunOnceDate(initial?.schedule?.runAt ? new Date(initial.schedule.runAt) : null);
      setPermissions(
        initial?.permissions || {
          runCommands: false,
          destructiveCommands: false,
          externalFiles: false,
          webAccess: false,
          browserAccess: false,
        }
      );
      setSaving(false);
      setSaved(false);
      setScheduleOpen(false);
    }
  }, [open, initial]);

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaved(true);
    await new Promise((r) => setTimeout(r, 600));
    onSave({
      name,
      instructions,
      scheduleKind,
      intervalMinutes: scheduleKind === "interval" ? recurSchedule.intervalMinutes : undefined,
      runAt: scheduleKind === "once" && runOnceDate ? runOnceDate.toISOString() : undefined,
      permissions,
    });
    setSaving(false);
    setSaved(false);
  };

  const handleDelete = () => {
    onSave({ _delete: true });
  };

  const handleScheduleSave = (data: { scheduleKind: "interval" | "once"; recurSchedule: any; runOnceDate: Date | null }) => {
    setScheduleKind(data.scheduleKind);
    if (data.scheduleKind === "interval") setRecurSchedule(data.recurSchedule);
    if (data.scheduleKind === "once") setRunOnceDate(data.runOnceDate);
    setScheduleOpen(false);
  };

  const allPermissionsOn = (Object.keys(PERMISSION_LABELS) as PermissionKey[]).every((k) => permissions[k]);

  const toggleAllPermissions = () => {
    const next = !allPermissionsOn;
    const updated: Record<PermissionKey, boolean> = {} as any;
    (Object.keys(PERMISSION_LABELS) as PermissionKey[]).forEach((k) => { updated[k] = next; });
    setPermissions(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Task" : "Create Task"}</DialogTitle>
          <DialogDescription>
            {initial ? "Update the task details below." : "Configure a new automated task."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Task Name</label>
            <input
              type="text"
              placeholder="My Scheduled Task"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Instructions</label>
            <textarea
              placeholder="What should the agent do when this task runs?"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Schedule</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {scheduleSummary(scheduleKind, recurSchedule, runOnceDate)}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)} className="h-7 text-xs rounded-full">
              Edit
            </Button>
          </div>

          <ScheduleDialog
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
            scheduleKind={scheduleKind}
            recurSchedule={recurSchedule}
            runOnceDate={runOnceDate}
            onSave={handleScheduleSave}
          />

          <div>
            <p className="text-xs text-muted-foreground mb-2">What the task is allowed to do. Keep locked down unless needed.</p>
            <div className="rounded-xl border border-border/60 divide-y divide-border/40">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm font-semibold text-foreground">Permissions</span>
                <SwitchToggle checked={allPermissionsOn} onCheckedChange={toggleAllPermissions} />
              </div>
              {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span className="text-sm text-foreground">{PERMISSION_LABELS[key]}</span>
                  <SwitchToggle
                    checked={permissions[key]}
                    onCheckedChange={(v) => setPermissions((p) => ({ ...p, [key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5">
          {initial ? (
            <button
              onClick={handleDelete}
              className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <Trash2 className="size-4" />
            </button>
          ) : (
            <button
              onClick={() => onOpenChange(false)}
              className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors"
              title="Cancel"
            >
              <XIcon className="size-4" />
            </button>
          )}
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
                <motion.div
                  key="save"
                  initial={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Button
                    onClick={handleSave}
                    disabled={saving || !name.trim() || !instructions.trim()}
                    className="rounded-full font-semibold"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>{initial ? "Save" : "Create"} Task</>
                    )}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulingTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, logRes] = await Promise.all([
        fetch("/api/scheduler/tasks"),
        fetch("/api/scheduler/log"),
      ]);
      const tasksData = await tasksRes.json();
      const logData = await logRes.json();
      setTasks(tasksData.tasks || []);
      setLog(logData.entries || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateTask = async (data: any) => {
    if (data._delete) return;
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...data }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => [...prev, result.task]);
        setCreating(false);
      }
    } catch {}
  };

  const handleUpdateTask = async (id: string, data: any) => {
    try {
      if (data._delete) {
        await handleDeleteTask(id);
        return;
      }
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...data }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => prev.map((t) => (t.id === id ? result.task : t)));
        setEditingTaskId(null);
      }
    } catch {}
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setEditingTaskId(null);
    } catch {}
  };

  const handleTriggerTask = async (id: string) => {
    try {
      await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", id }),
      });
    } catch {}
  };

  const handleToggleTask = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, enabled }),
      });
      const result = await res.json();
      if (result.task) {
        setTasks((prev) => prev.map((t) => (t.id === id ? result.task : t)));
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const scheduledTasks = tasks.filter((t) => t.type === "scheduled");
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.2 }}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="flex-1 flex flex-col overflow-hidden space-y-6 pr-1">
        {/* Execution Log Section */}
        <div className="shrink-0">
          <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">Execution Log</h3>
              {log.length > 0 && (
                <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded-full">
                  {log.length}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLog(true)}
              className="h-8 text-xs rounded-full"
            >
              <FileText className="size-3.5 mr-1" />
              View Log
            </Button>
          </div>

          {/* Log Dialog */}
          <Dialog open={showLog} onOpenChange={setShowLog}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col rounded-3xl">
              <DialogHeader>
                <DialogTitle>Execution Log</DialogTitle>
                <DialogDescription>
                  Recent task execution history.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto min-h-0">
                {log.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="size-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground/60">No executions yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {log.map((entry, i) => (
                      <div key={i} className="flex items-start gap-3 py-3">
                        <div className={cn(
                          "size-2.5 rounded-full mt-1.5 shrink-0",
                          entry.status === "success" ? "bg-emerald-500" : "bg-red-500"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{entry.name}</span>
                            <span className="text-xs text-muted-foreground/60">
                              {formatDate(entry.timestamp)}
                            </span>
                            <span className="text-xs text-muted-foreground/60">
                              {(entry.duration / 1000).toFixed(1)}s
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
                            {entry.output}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Scheduled Tasks Section */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <SectionHeader
            title="Scheduled Tasks"
            action={
              <Button
                size="sm"
                onClick={() => setCreating(true)}
                className="h-8 text-xs rounded-full"
              >
                <Plus className="size-3.5 mr-1" />
                Create Task
              </Button>
            }
          />

          <TaskFormDialog
            open={creating}
            onOpenChange={setCreating}
            onSave={handleCreateTask}
          />

          <TaskFormDialog
            open={!!editingTaskId}
            onOpenChange={(v) => { if (!v) setEditingTaskId(null); }}
            initial={editingTask || undefined}
            onSave={(data) => editingTaskId && handleUpdateTask(editingTaskId, data)}
          />

          <div className="flex-1 overflow-y-auto min-h-0">
          {scheduledTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-border/60 bg-muted/10">
              <Clock className="size-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-semibold text-foreground/70">No scheduled tasks</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-[240px]">
                Create a task to run the agent on a schedule — daily reports, health checks, file cleanup.
              </p>
            </div>
          ) : (
            <div className="space-y-2 pr-1">
              {scheduledTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3 shrink-0 pt-0.5">
                    <SwitchToggle
                      checked={task.enabled}
                      onCheckedChange={(v) => handleToggleTask(task.id, v)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{task.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.instructions}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60 mt-1.5">
                      <span>
                        {task.schedule.kind === "interval"
                          ? task.schedule.intervalMinutes === 1440
                            ? "Every day"
                            : task.schedule.intervalMinutes === 10080
                              ? "Every week"
                              : task.schedule.intervalMinutes === 43200
                                ? "Every month"
                                : `Every ${task.schedule.intervalMinutes || 1440} min`
                          : `Once on ${formatDate(task.schedule.runAt || null)}`}
                      </span>
                      <span>Next: {formatDate(task.nextRunAt)}</span>
                      <span>Last: {formatDate(task.lastRunAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleTriggerTask(task.id)}
                      className="size-8 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/60 hover:text-foreground"
                      title="Run now"
                    >
                      <Play className="size-4" />
                    </button>
                    <button
                      onClick={() => setEditingTaskId(task.id)}
                      className="size-8 flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground/60 hover:text-foreground"
                      title="Edit"
                    >
                      <Edit3 className="size-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(task.id)}
                      className="size-8 flex items-center justify-center rounded-lg transition-colors text-muted-foreground/60 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* Delete confirmation dialog */}
        <Dialog open={!!deleteConfirmId} onOpenChange={(v) => { if (!v) setDeleteConfirmId(null); }}>
          <DialogContent className="sm:max-w-sm rounded-3xl">
            <DialogHeader>
              <DialogTitle>Delete Task</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this task? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirmId(null)} className="rounded-full h-8 px-4">
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (deleteConfirmId) handleDeleteTask(deleteConfirmId);
                    setDeleteConfirmId(null);
                  }}
                  className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </motion.div>
  );
}
