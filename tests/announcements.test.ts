/**
 * Pending-announcements regression tests.
 *
 * Bug: a scheduled task ("Daily AI News Report") finished successfully, but
 * the next chat opened with a generic greeting and only mentioned the report
 * when the user explicitly asked ("don't you have anything to tell me?").
 * Completed scheduled-task results must be volunteered at the start of the
 * next chat — announced exactly once.
 *
 * Run: npx tsx --test tests/announcements.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isMeaningfulResult,
  recordAnnouncement,
  getPendingAnnouncements,
  markAnnouncementsDelivered,
} from "@/lib/scheduler/announcements";

const REPORT =
  "Daily AI News Report for October 2nd: 1) New open-weights model released... 2) Agent benchmarks updated... Full report saved to documents/ai-news-2026-10-02.md";

describe("announcement gating (meaningless results stay silent)", () => {
  it("rejects empty / placeholder / heartbeat / cancelled outputs", () => {
    assert.equal(isMeaningfulResult(""), false);
    assert.equal(isMeaningfulResult("   "), false);
    assert.equal(isMeaningfulResult("(no output)"), false);
    assert.equal(isMeaningfulResult("HEARTBEAT_OK"), false);
    assert.equal(isMeaningfulResult("heartbeat_ok, nothing new"), false);
    assert.equal(isMeaningfulResult("Cancelled: Pi task cancelled"), false);
    assert.equal(isMeaningfulResult("ok"), false);
  });

  it("accepts real task output", () => {
    assert.equal(isMeaningfulResult(REPORT), true);
  });

  it("recordAnnouncement returns null for meaningless output", async () => {
    assert.equal(await recordAnnouncement({ taskId: "t1", taskName: "T", output: "(no output)" }), null);
    assert.equal(await recordAnnouncement({ taskId: "t1", taskName: "T", output: "HEARTBEAT_OK" }), null);
  });
});

describe("announcement lifecycle (announce exactly once)", () => {
  it("records, lists oldest-first, and delivers", async () => {
    const taskId = `t-news-${Date.now()}`;
    const rec = await recordAnnouncement({ taskId, taskName: "Daily AI News Report", output: REPORT });
    assert.ok(rec && rec.id);
    assert.equal(rec.deliveredAt, null);

    const pending = await getPendingAnnouncements();
    assert.ok(pending.some((a) => a.id === rec.id));

    await markAnnouncementsDelivered([rec.id]);
    const after = await getPendingAnnouncements();
    assert.ok(!after.some((a) => a.id === rec.id));
  });

  it("dedups identical re-runs (same task + same output)", async () => {
    const taskId = `t-dupe-${Date.now()}`;
    const first = await recordAnnouncement({ taskId, taskName: "Daily Digest", output: REPORT });
    const second = await recordAnnouncement({ taskId, taskName: "Daily Digest", output: REPORT });
    assert.ok(first && second);
    assert.equal(second.id, first!.id);
    const pending = (await getPendingAnnouncements(50)).filter((a) => a.taskId === taskId);
    assert.equal(pending.length, 1);
    await markAnnouncementsDelivered([first!.id]);
  });

  it("records a new announcement when the output changes", async () => {
    const taskId = `t-changed-${Date.now()}`;
    const first = await recordAnnouncement({ taskId, taskName: "Daily Digest", output: REPORT });
    const second = await recordAnnouncement({ taskId, taskName: "Daily Digest", output: REPORT + " 3) Extra story added late." });
    assert.ok(first && second);
    assert.notEqual(second!.id, first!.id);
    await markAnnouncementsDelivered([first!.id, second!.id]);
  });

  it("marking unknown ids is a safe no-op", async () => {
    await markAnnouncementsDelivered(["ann_does_not_exist"]);
    await markAnnouncementsDelivered([]);
  });
});

describe("brief injection (must-lead directive)", () => {
  it("buildHeartbeatBrief includes pending announcements with the directive", async () => {
    const taskId = `t-brief-${Date.now()}`;
    const rec = await recordAnnouncement({ taskId, taskName: "Daily AI News Report", output: REPORT });
    assert.ok(rec);
    const { buildHeartbeatBrief } = await import("@/lib/proactivity/heartbeat-brief");
    const brief = await buildHeartbeatBrief();
    assert.ok(brief.announcementsBlock, "expected an announcements block");
    assert.match(brief.announcementsBlock!, /pending_announcements/);
    assert.match(brief.announcementsBlock!, /MUST open your next reply/);
    assert.ok(brief.announcementsBlock!.includes("Daily AI News Report"));
    await markAnnouncementsDelivered([rec!.id]);
    const after = await buildHeartbeatBrief();
    assert.equal(after.announcementsBlock, undefined);
  });
});
