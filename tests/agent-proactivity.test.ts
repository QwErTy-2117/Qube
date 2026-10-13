/**
 * Agent-vs-chatbot audit regression tests (fixes #1-#9).
 *
 * Covers the new behavior without any model call:
 * - one-shot vs recurring schedule gate (fix #1)
 * - verified announcement delivery (fix #6)
 * - heartbeat dedup + no-loss requeue (fix #4/#6)
 * - durable goals shared chat <-> background (fix #5)
 * - heartbeat engine decision (fix #4)
 * - discovery sweep worthiness (fix #9)
 * - background prompt lanes + headless plan (fix #2/#3)
 *
 * Run: npx tsx --test tests/agent-proactivity.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-agent-pro-test-"));

import { hasSchedulingCue } from "@/lib/pi/agent-tools";
import {
  announcementMentionedInReply,
  markAnnouncementsDeliveredIfMentioned,
  recordAnnouncement,
  getPendingAnnouncements,
  markAnnouncementsDelivered,
} from "@/lib/scheduler/announcements";

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

describe("schedule gate: one-shot reads run inline, recurring cues schedule (fix #1)", () => {
  it("rejects immediate price checks with no recurring cue", () => {
    assert.equal(hasSchedulingCue("Price check — check the price of headphones X right now"), false);
    assert.equal(hasSchedulingCue("What does the M4 MacBook cost?"), false);
  });

  it("accepts explicit recurring / monitor cues", () => {
    assert.equal(hasSchedulingCue("Tell me when the price drops below €800"), true);
    assert.equal(hasSchedulingCue("Keep an eye on GPU prices"), true);
    assert.equal(hasSchedulingCue("Every Friday send me the changelog"), true);
    assert.equal(hasSchedulingCue("Remind me tomorrow to call Ana"), true);
    assert.equal(hasSchedulingCue("Daily AI News Report with sources"), true);
  });
});

describe("verified announcement delivery (fix #6)", () => {
  it("generic greetings do not count as mentions", () => {
    const a = { taskName: "Daily AI News Report", excerpt: "New open-weights model released with benchmarks" };
    assert.equal(announcementMentionedInReply(a, "Hi! How can I help you today?"), false);
    assert.equal(announcementMentionedInReply(a, "hi"), false);
  });

  it("task-name or excerpt mentions count", () => {
    const a = { taskName: "Daily AI News Report", excerpt: "New open-weights model released with benchmarks" };
    assert.equal(announcementMentionedInReply(a, "Your Daily AI News Report is ready — top story inside."), true);
    assert.equal(announcementMentionedInReply(a, "Quick note: new open-weights model released with benchmarks today."), true);
  });

  it("only mentioned announcements are marked delivered", async () => {
    const t1 = `t-verify-a-${uid()}`;
    const t2 = `t-verify-b-${uid()}`;
    const r1 = await recordAnnouncement({ taskId: t1, taskName: "Morning Digest Alpha", output: "Alpha report body with enough length to be meaningful here." });
    const r2 = await recordAnnouncement({ taskId: t2, taskName: "Evening Digest Beta", output: "Beta report body with enough length to be meaningful here." });
    assert.ok(r1 && r2);
    const marked = await markAnnouncementsDeliveredIfMentioned(
      [r1!, r2!],
      "Here is your Morning Digest Alpha with today's headlines.",
    );
    assert.deepEqual(marked, [r1!.id]);
    const pending = await getPendingAnnouncements(50);
    assert.ok(!pending.some((a) => a.id === r1!.id), "mentioned announcement delivered");
    assert.ok(pending.some((a) => a.id === r2!.id), "unmentioned announcement stays pending");
    await markAnnouncementsDelivered([r2!.id]);
  });
});

describe("heartbeat dedup + no-loss requeue (fix #4/#6)", () => {
  it("duplicate notes are rejected, fileRefs are stored", async () => {
    const hb = await import("@/lib/scheduler/heartbeat-state");
    const note = `hb-dupe-${uid()} — 3 Gmail threads about Saturday + draft reply`;
    const first = await hb.addPendingAction(note, undefined, ["documents/party-plan.md"]);
    assert.equal(first.added, true);
    const second = await hb.addPendingAction(note);
    assert.equal(second.duplicate, true);
    const state = await hb.loadHeartbeatState();
    const stored = state.pendingActions.find((a) => a.description === note);
    assert.ok(stored, "note persisted");
    assert.deepEqual(stored!.fileRefs, ["documents/party-plan.md"]);
  });

  it("consumed dues are re-queued after a quiet tick instead of lost", async () => {
    const hb = await import("@/lib/scheduler/heartbeat-state");
    const note = `hb-requeue-${uid()} — pending paper to compile`;
    await hb.addPendingAction(note);
    const due = await hb.consumeDueActions();
    assert.ok(due.some((d) => d.description === note), "due consumed");
    const afterConsume = await hb.loadHeartbeatState();
    assert.ok(!afterConsume.pendingActions.some((a) => a.description === note), "removed on consume");
    await hb.requeueDueActions(due.filter((d) => d.description === note));
    const afterRequeue = await hb.loadHeartbeatState();
    assert.ok(afterRequeue.pendingActions.some((a) => a.description === note), "restored by requeue");
  });
});

describe("durable goals shared chat <-> background (fix #5)", () => {
  it("upsert dedups, mirror + brief round-trip", async () => {
    const goals = await import("@/lib/goals/store");
    const topic = `goal-topic-${uid()}`;
    const g1 = await goals.upsertGoal({ topic, lane: "prep", source: "test", fileRefs: ["documents/paper.pdf"] });
    const g2 = await goals.upsertGoal({ topic, lane: "prep", source: "test" });
    assert.equal(g1.id, g2.id, "same topic dedups to one goal");

    const thread = `thread_${uid()}`;
    await goals.mirrorChatPlan(thread, [
      { content: `chat-plan-item-${uid()}`, status: "in_progress", activeForm: "Working" },
    ]);
    const open = await goals.listOpenGoals(50);
    assert.ok(open.some((g) => g.threadId === thread), "chat plan mirrored to durable goals");

    const brief = await goals.buildGoalsBrief(5);
    assert.ok(brief && brief.includes("<open_goals>"), "brief renders open goals block");

    await goals.completeGoal(g1.id);
    const after = await goals.listOpenGoals(50);
    assert.ok(!after.some((g) => g.id === g1.id), "completed goal leaves the open list");
  });

  it("headless plan mirrors and syncs done", async () => {
    const goals = await import("@/lib/goals/store");
    const taskId = `task_${uid()}`;
    await goals.mirrorHeadlessPlan(taskId, "Test Task", [
      { content: `bg-plan-item-${uid()}`, status: "in_progress" },
    ]);
    const open = await goals.listOpenGoals(50);
    assert.ok(open.some((g) => g.taskId === taskId), "headless plan visible to chat");
    await goals.syncHeadlessPlanDone(taskId);
    const after = await goals.listOpenGoals(50);
    assert.ok(!after.some((g) => g.taskId === taskId), "headless goals close on run completion");
  });
});

describe("heartbeat engine decision (fix #4)", () => {
  it("fresh authorized-monitor findings proceed; repeats suppress as duplicates", async () => {
    const { decideHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-decide");
    const topic = `hb-decide-${uid()}`;
    const first = await decideHeartbeatFinding({ topic, detail: "3 fresh Gmail threads about Saturday with a draft reply" });
    assert.equal(first.proceed, true, `fresh finding proceeds (${first.reasons.join("; ")})`);
    assert.equal(first.duplicate, false);

    const { recordHeartbeatFinding } = await import("@/lib/proactivity/heartbeat-brief");
    const rec = await recordHeartbeatFinding({ topic, detail: "3 fresh Gmail threads about Saturday with a draft reply", evidence: ["heartbeat monitor"] });
    assert.ok(rec && !rec.duplicate, "first record stored");

    const second = await decideHeartbeatFinding({ topic, detail: "3 fresh Gmail threads about Saturday with a draft reply" });
    assert.equal(second.duplicate, true, "identical repeat is a duplicate");
    assert.equal(second.proceed, false);
  });
});

describe("discovery sweep worthiness (fix #9)", () => {
  it("same hash is not worthy; new activity is", async () => {
    const { isDiscoveryWorthy } = await import("@/lib/scheduler/discovery");
    const base = { summary: "s", hash: "h1", recentFiles: [] as string[], rootEntries: 10, openGoals: 0 };
    assert.equal(isDiscoveryWorthy(base, "h1"), false, "identical sweep stays silent");
    assert.equal(isDiscoveryWorthy({ ...base, hash: "h2", recentFiles: ["documents/new.md"] }, "h1"), true, "new files wake the LLM");
    assert.equal(isDiscoveryWorthy({ ...base, hash: "h2", openGoals: 2 }, "h1"), true, "open goals wake the LLM");
    assert.equal(isDiscoveryWorthy({ ...base, hash: "h2" }, "h1"), false, "hash-only drift without activity stays silent");
  });
});

describe("repaired tool schemas (fix #7)", () => {
  it("schedule_task exposes done-criteria, timing, and permission fields", async () => {
    const { createPiAgentTools } = await import("@/lib/pi/agent-tools");
    const tools = createPiAgentTools({ threadId: "test-schema" }) as any;
    const scheduleShape = tools.schedule_task.inputSchema.shape;
    for (const field of ["doneCriteria", "condition", "deliverablePath", "hour", "minute", "weekdays", "monthDay", "permissions"]) {
      assert.ok(scheduleShape[field], `schedule_task schema must expose ${field}`);
    }
    assert.match(tools.schedule_task.description, /ONE-SHOT READS ARE NOT SCHEDULES/);
    assert.match(tools.schedule_task.description, /only runs while Qube is open/);
  });

  it("update_heartbeat note accepts structured topic/evidence/draft/fileRefs", async () => {
    const { createPiAgentTools } = await import("@/lib/pi/agent-tools");
    const tools = createPiAgentTools({ threadId: "test-schema" }) as any;
    const noteShape = tools.update_heartbeat.inputSchema.shape;
    for (const field of ["topic", "evidence", "draft", "fileRefs", "deadline"]) {
      assert.ok(noteShape[field], `update_heartbeat schema must expose ${field}`);
    }
    assert.match(tools.update_heartbeat.description, /Lane B/);
  });
});

describe("background prompt lanes + headless plan (fix #2/#3)", () => {
  it("heartbeat prompt authorizes Lane B prep; scheduled prompt keeps approval semantics", async () => {
    const { buildPiTaskSystemPrompt } = await import("@/lib/pi/task-runner");
    const perms = { runCommands: true, destructiveCommands: false, externalFiles: false, webAccess: true };
    const hb = buildPiTaskSystemPrompt({ id: "heartbeat", type: "heartbeat", name: "Heartbeat", instructions: "Watch.", schedule: { kind: "interval", intervalMinutes: 30 }, enabled: true, permissions: perms, createdAt: 0, updatedAt: 0, lastRunAt: null, nextRunAt: 0 } as any);
    assert.match(hb, /Lane B/);
    assert.match(hb, /TodoWrite\(headless plan\)/);
    assert.match(hb, /do NOT create schedules from here/);
    const st = buildPiTaskSystemPrompt({ id: "t", type: "scheduled", name: "Report", instructions: "Send report.", schedule: { kind: "interval", intervalMinutes: 60 }, enabled: true, permissions: perms, createdAt: 0, updatedAt: 0, lastRunAt: null, nextRunAt: 0 } as any);
    assert.match(st, /Done criteria first/);
    assert.match(st, /Your instructions .* ARE your authorization/);
  });
});
