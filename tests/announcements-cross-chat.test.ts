/**
 * Cross-chat announcement ledger regression tests.
 *
 * Covers normal-chat research, scheduled/heartbeat findings, verified
 * delivery, per-announcement claims across conversation ids, restarts,
 * genuinely new updates, and explicit follow-up questions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "qube-announcements-cross-chat-"));
process.env.QUBE_DATA_DIR = dataDir;

const ledger = await import("@/lib/scheduler/announcements");
const { buildHeartbeatBrief } = await import("@/lib/proactivity/heartbeat-brief");

function fact(prefix: string, detail: string): string {
  return `${prefix}: ${detail} This is a verified research finding with enough detail to be useful in another conversation.`;
}

describe("global announcement identity and normal-chat research", () => {
  it("does not re-announce the same fact from a different source, thread, or formatting", async () => {
    const output = fact("Model X", "supports structured tool calls and streaming responses");
    const scheduled = await ledger.recordAnnouncement({
      taskId: "scheduled-1", taskName: "AI capability report", topic: "Model X",
      source: "scheduled", output,
    });
    assert.ok(scheduled);
    await ledger.markAnnouncementsDelivered([scheduled!.id], { threadId: "chat-A" });

    const chatResearch = await ledger.recordAnnouncement({
      taskId: "chat:chat-B", taskName: "Research in chat B", topic: "Model X",
      source: "chat", threadId: "chat-B", output: `  ${output}  `,
    });
    assert.ok(chatResearch);
    assert.equal(chatResearch!.id, scheduled!.id, "same content must keep one identity across chats");
    assert.equal(chatResearch!.duplicate, true);
    const pending = await ledger.getPendingAnnouncements(50);
    assert.ok(!pending.some((a) => a.id === scheduled!.id));
  });

  it("records research actually communicated in a normal chat as already delivered", async () => {
    const reply = "I checked the primary source: Feature Y is available today, supports batch requests, and has a limit of 100 requests per minute.";
    const rec = await ledger.recordDeliveredChatFinding({
      threadId: "chat-research-A",
      topic: "Feature Y",
      summary: reply,
      replyText: reply,
    });
    assert.ok(rec);
    assert.ok(rec!.deliveredAt, "visible reply is the delivery proof");
    assert.equal(rec!.source, "chat");
    assert.equal(rec!.deliveredInThreadId, "chat-research-A");
    assert.equal(await ledger.hasAnnouncementBeenDelivered(reply), true);

    const heartbeatRepeat = await ledger.recordAnnouncement({
      taskId: "heartbeat:Feature-Y", taskName: "Feature Y", topic: "Feature Y",
      source: "heartbeat", output: reply,
    });
    assert.equal(heartbeatRepeat!.id, rec!.id);
    assert.ok(!(await ledger.getPendingAnnouncements(50)).some((a) => a.id === rec!.id));
  });

  it("serializes concurrent records so two chats cannot create duplicate identities", async () => {
    const output = fact("Concurrent release", "version 2.4 is available with a new local cache");
    const [a, b] = await Promise.all([
      ledger.recordAnnouncement({ taskId: "chat:one", taskName: "Release", topic: "Concurrent release", source: "chat", output }),
      ledger.recordAnnouncement({ taskId: "heartbeat:two", taskName: "Release", topic: "Concurrent release", source: "heartbeat", output }),
    ]);
    assert.ok(a && b);
    assert.equal(a!.id, b!.id);
    await ledger.markAnnouncementsDelivered([a!.id], { threadId: "chat-one" });
  });
});

describe("per-announcement verified delivery across chats and restarts", () => {
  it("claims separately, keeps generic replies pending, and delivers only after a verified mention", async () => {
    // Isolate the claim test from intentionally pending items in other tests.
    const previous = await ledger.getPendingAnnouncements(50);
    if (previous.length > 0) {
      await ledger.markAnnouncementsDelivered(previous.map((a) => a.id), { threadId: "test-cleanup" });
    }
    const rec = await ledger.recordAnnouncement({
      taskId: "scheduled-quarterly",
      taskName: "Quarterly Update Alpha",
      topic: "Quarterly numbers",
      source: "scheduled",
      output: fact("Quarterly numbers", "revenue grew twelve percent and churn fell to two percent"),
    });
    assert.ok(rec);

    const [claimsA, claimsB] = await Promise.all([
      ledger.claimPendingAnnouncements({ limit: 3, threadId: "chat-A" }),
      ledger.claimPendingAnnouncements({ limit: 3, threadId: "chat-B" }),
    ]);
    const aHas = claimsA.some((a) => a.id === rec!.id);
    const bHas = claimsB.some((a) => a.id === rec!.id);
    assert.notEqual(aHas, bHas, "only one chat may claim a pending item");
    const claimed = aHas ? claimsA : claimsB;
    const claimedThread = aHas ? "chat-A" : "chat-B";

    const generic = await ledger.markAnnouncementsDeliveredIfMentioned(
      claimed,
      "Hi! How can I help you today?",
      { threadId: claimedThread },
    );
    assert.deepEqual(generic, []);
    let pending = await ledger.getPendingAnnouncements(30);
    assert.ok(pending.some((a) => a.id === rec!.id), "generic greeting leaves item pending");
    assert.ok(!pending.find((a) => a.id === rec!.id)!.claimedBy, "claim released for another chat/restart");

    const claimsC = await ledger.claimPendingAnnouncements({ limit: 3, threadId: "chat-C" });
    assert.ok(claimsC.some((a) => a.id === rec!.id));
    const marked = await ledger.markAnnouncementsDeliveredIfMentioned(
      claimsC,
      "Your Quarterly Update Alpha is ready: revenue grew twelve percent and churn fell to two percent.",
      { threadId: "chat-C" },
    );
    assert.ok(marked.includes(rec!.id));
    pending = await ledger.getPendingAnnouncements(30);
    assert.ok(!pending.some((a) => a.id === rec!.id));
    const delivered = await ledger.getAnnouncement(rec!.id);
    assert.equal(delivered!.deliveredInThreadId, "chat-C");
    assert.equal(delivered!.deliveryCount, 1);
    const forChatD = await ledger.getPendingAnnouncementsForThread(3, "chat-D");
    assert.ok(!forChatD.some((a) => a.id === rec!.id));
  });

  it("persists pending and delivered state on disk across a simulated restart", async () => {
    const pendingRec = await ledger.recordAnnouncement({
      taskId: "restart-pending", taskName: "Restart Pending Gamma", topic: "Restart durability",
      source: "heartbeat", output: fact("Restart durability", "the queue survives process restarts"),
    });
    const deliveredRec = await ledger.recordAnnouncement({
      taskId: "restart-delivered", taskName: "Restart Delivered Delta", topic: "Restart delivery",
      source: "scheduled", output: fact("Restart delivery", "the receipt was written after the visible reply"),
    });
    await ledger.markAnnouncementsDelivered([deliveredRec!.id], { threadId: "chat-before-restart" });

    ledger.resetAnnouncementRuntimeForTests();
    const raw = JSON.parse(readFileSync(ledger.announcementLedgerPath(), "utf-8"));
    assert.equal(raw.version, 2);
    assert.ok(raw.items.some((a: any) => a.id === pendingRec!.id && a.status === "pending" && !a.deliveredAt));
    assert.ok(raw.items.some((a: any) => a.id === deliveredRec!.id && a.status === "delivered" && a.deliveredAt));
    assert.ok(raw.seen[pendingRec!.contentHash]);
    const pending = await ledger.getPendingAnnouncements(50);
    assert.ok(pending.some((a) => a.id === pendingRec!.id));
    assert.ok(!pending.some((a) => a.id === deliveredRec!.id));
    await ledger.markAnnouncementsDelivered([pendingRec!.id], { threadId: "chat-after-restart" });
  });

  it("allows a genuinely new update while still deduplicating that update", async () => {
    const topic = "Price watch Epsilon";
    const first = await ledger.recordAnnouncement({
      taskId: "price-watch", taskName: topic, topic,
      source: "scheduled", output: fact(topic, "Acme now costs 10 dollars per seat"),
    });
    const update = await ledger.recordAnnouncement({
      taskId: "price-watch", taskName: topic, topic,
      source: "heartbeat", output: fact(topic, "Acme now costs 8 dollars per seat"),
    });
    assert.ok(first && update);
    assert.notEqual(update!.id, first!.id, "new numeric fact is a genuine update");
    const pending = await ledger.getPendingAnnouncements(50);
    assert.ok(pending.some((a) => a.id === update!.id));
    const repeat = await ledger.recordAnnouncement({
      taskId: "chat:price", taskName: "Price research", topic,
      source: "chat", threadId: "chat-price", output: fact(topic, "Acme now costs 8 dollars per seat"),
    });
    assert.equal(repeat!.id, update!.id);
    await ledger.markAnnouncementsDelivered([first!.id, update!.id], { threadId: "chat-price" });
  });
});

describe("explicit follow-ups are answers, not duplicate announcements", () => {
  it("shows delivered history for a direct question without a fresh-news directive", async () => {
    const rec = await ledger.recordAnnouncement({
      taskId: "launch-watch", taskName: "Orbital Launch Zeta", topic: "Orbital launch",
      source: "scheduled", output: fact("Orbital launch", "the launch window opens at 09:30 UTC on Friday"),
    });
    await ledger.markAnnouncementsDelivered([rec!.id], { threadId: "chat-original" });

    const history = await ledger.buildAnnouncementHistoryBlock("What did you say about the orbital launch?");
    assert.ok(history);
    assert.match(history!, /answer normally/i);
    assert.match(history!, /Do NOT present it as new background news/i);
    assert.match(history!, /orbital launch/i);
    assert.doesNotMatch(history!, /MUST mention EACH/i);

    const brief = await buildHeartbeatBrief({ query: "What did you say about the orbital launch?", threadId: "chat-follow-up" });
    assert.ok(brief.announcementHistoryBlock);
    assert.ok(!(brief.announcementsBlock || "").includes("Orbital Launch Zeta"));
    assert.equal(ledger.isAnnouncementFollowUpQuery("hi"), false);
    assert.equal(ledger.isAnnouncementFollowUpQuery("Remind me what you found earlier"), true);
  });
});
