/**
 * Hard-reset regression tests.
 *
 * A hard reset must remove every persistent state location — including the
 * global announcement ledger and heartbeat work/approval state — and clear
 * in-memory caches so running background work cannot resurrect old data.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "qube-hard-reset-test-"));
process.env.QUBE_DATA_DIR = dataDir;

const {
  performHardReset,
  hardResetPaths,
} = await import("@/lib/system/hard-reset");
const { POST } = await import("@/app/api/reset/route");
const announcements = await import("@/lib/scheduler/announcements");
const work = await import("@/lib/proactivity/heartbeat-work");
const heartbeatState = await import("@/lib/scheduler/heartbeat-state");
const taskStore = await import("@/lib/scheduler/task-store");
const { stopScheduler } = await import("@/lib/scheduler/scheduler");
const goals = await import("@/lib/goals/store");
const proactive = await import("@/lib/proactivity/store");
const memory = await import("@/lib/memory/memory-store");
const { buildHeartbeatBrief } = await import("@/lib/proactivity/heartbeat-brief");
const { providerStore } = await import("@/lib/pi/provider-store");
const { settingsStore } = await import("@/lib/settings-store");
const { mcpStore } = await import("@/lib/pi/mcp-store");
const { skillStore } = await import("@/lib/skills/store");
const { allowedDirsStore } = await import("@/lib/permissions/allowed-dirs");
const { composioKeyStore } = await import("@/lib/connectors/composio-key-store");

const memoryDir = join(dataDir, ".memory");
const fact = "Hard reset test: the quarterly budget report has a verified remaining variance of twelve percent and needs a new owner.";

function seedFiles(): void {
  mkdirSync(join(memoryDir, "sessions"), { recursive: true });
  mkdirSync(join(memoryDir, "thread-messages"), { recursive: true });
  mkdirSync(join(memoryDir, "scratchpads"), { recursive: true });
  mkdirSync(join(memoryDir, "observability"), { recursive: true });
  mkdirSync(join(dataDir, ".browser-profile"), { recursive: true });
  mkdirSync(join(dataDir, "workspace"), { recursive: true });

  writeFileSync(join(memoryDir, "app-settings.json"), JSON.stringify({ userName: "Old user" }));
  writeFileSync(join(memoryDir, "providers.json"), JSON.stringify({ providers: [{ id: "old" }], defaultModelId: "old:model" }));
  writeFileSync(join(memoryDir, "chatgpt-sessions.json"), JSON.stringify({ session: "old" }));
  writeFileSync(join(memoryDir, "composio.json"), JSON.stringify({ mode: "custom", customKey: "sk-reset-test" }));
  writeFileSync(join(memoryDir, "scheduled-tasks.json"), JSON.stringify([
    { id: "task-old", type: "scheduled", name: "Old custom task", enabled: true, nextRunAt: Date.now() - 1000 },
  ]));
  writeFileSync(join(memoryDir, "sessions", "old.json"), JSON.stringify({ messages: ["old"] }));
  writeFileSync(join(memoryDir, "thread-messages", "old-thread.json"), JSON.stringify({ messages: ["old"] }));
  writeFileSync(join(memoryDir, "scratchpads", "old.md"), "old scratchpad");
  writeFileSync(join(memoryDir, "observability", "old.jsonl"), '{"old":true}\n');
  writeFileSync(join(memoryDir, "task-log.jsonl"), '{"taskId":"task-old"}\n');
  writeFileSync(join(memoryDir, "skills.json"), JSON.stringify({ skills: [] }));
  writeFileSync(join(memoryDir, "mcp-servers.json"), JSON.stringify({ servers: [] }));
  writeFileSync(join(memoryDir, "allowed-directories.json"), JSON.stringify({ dirs: [] }));
  writeFileSync(join(dataDir, "agent.sqlite"), "sqlite old state");
  writeFileSync(join(dataDir, "agent.sqlite-wal"), "sqlite wal old state");
  writeFileSync(join(dataDir, ".browser-profile", "Cookies"), "old cookie");
  writeFileSync(join(dataDir, "sidecar.log"), "keep this diagnostic log");
  writeFileSync(join(dataDir, "workspace", "keep.txt"), "keep this deliverable");
}

async function seedLiveState(): Promise<void> {
  const delivered = await announcements.recordAnnouncement({
    taskId: "scheduled-reset",
    taskName: "Quarterly budget report",
    topic: "Quarterly budget report",
    source: "scheduled",
    output: fact,
  });
  assert.ok(delivered);
  await announcements.markAnnouncementsDelivered([delivered!.id], { threadId: "chat-before-reset" });
  assert.equal(await announcements.hasAnnouncementBeenDelivered(fact), true);

  await work.queueHeartbeatApproval({
    topic: "Send vendor update",
    action: "send email",
    purpose: "The vendor asked for revised delivery dates; a draft is ready for approval.",
    toolName: "GMAIL_SEND_EMAIL",
    args: { to: "vendor@example.com", body: "Revised dates" },
    draftRefs: ["documents/vendor-update-draft.md"],
  });
  await heartbeatState.addPendingAction("Finish the old quarterly report before the reset.");
  await goals.upsertGoal({ topic: "Old durable goal", source: "test" });
  await proactive.recordSuggestion({
    topic: "Old suggestion",
    scope: "global",
    kind: "idea",
    decision: "suggest",
    evidence: ["old"],
    confidence: 0.8,
  } as any);
  await memory.remember("general", "Old durable memory fact from before the hard reset.");

  providerStore.sync([{ id: "old", name: "Old", baseURL: "https://old.example", enabled: true, hasApiKey: true, apiKey: "old-key", models: [] } as any], "old:model", false);
  settingsStore.update({ userName: "Old user" });
  mcpStore.sync([{ id: "old", name: "Old MCP", command: "node", args: [], env: {} }], false);
  skillStore.upsert({ name: "custom-reset-skill", description: "Old custom skill", instructions: "Do old work." } as any);
  allowedDirsStore.add(dataDir, "read", "settings");
  composioKeyStore.setCustomKey("sk-reset-test");
}

after(() => {
  stopScheduler();
});

describe("hard reset", () => {
  it("removes all durable state, clears live caches, and preserves workspace/log files", async () => {
    seedFiles();
    await seedLiveState();
    assert.ok(existsSync(announcements.announcementLedgerPath()));
    assert.ok((await work.listPendingHeartbeatApprovals()).length > 0);

    const response = await POST();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.errors, []);

    for (const path of hardResetPaths(dataDir)) {
      assert.equal(existsSync(path), false, `${path} must be removed`);
    }
    assert.equal(existsSync(join(dataDir, "sidecar.log")), true, "diagnostic log is preserved");
    assert.equal(readFileSync(join(dataDir, "sidecar.log"), "utf-8"), "keep this diagnostic log");
    assert.equal(existsSync(join(dataDir, "workspace", "keep.txt")), true, "workspace deliverable is preserved");

    // Ledgers are empty in memory, not merely unlinked on disk.
    assert.deepEqual(await announcements.getPendingAnnouncements(50), []);
    assert.equal(await announcements.hasAnnouncementBeenDelivered(fact), false);
    assert.deepEqual(await work.listActionableHeartbeatWork(), []);
    assert.deepEqual(await work.listPendingHeartbeatApprovals(), []);
    const brief = await buildHeartbeatBrief({ query: "quarterly budget" });
    assert.equal(brief.announcementsBlock, undefined);
    assert.equal(brief.workBlock, undefined);
    assert.equal(brief.approvalBlock, undefined);
    assert.equal(brief.announcementHistoryBlock, undefined);

    // Other persisted automation/personal state is fresh.
    const freshHeartbeatState = await heartbeatState.loadHeartbeatState();
    assert.equal(freshHeartbeatState.totalTicks, 0);
    assert.deepEqual(freshHeartbeatState.pendingActions, []);
    assert.deepEqual(freshHeartbeatState.failedActions, []);
    assert.equal((await goals.listOpenGoals()).length, 0);
    assert.equal((await proactive.loadProactiveState()).suggestions.length, 0);
    assert.equal((await memory.getMemoryEntries()).length, 0);

    const tasks = await taskStore.getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, "heartbeat");
    assert.equal(tasks.some((t) => t.name === "Old custom task"), false);
    assert.ok((tasks[0].nextRunAt ?? 0) > Date.now());
    assert.equal(existsSync(join(memoryDir, "scheduled-tasks.json")), false, "fresh task cache must not rewrite the deleted file");

    // In-memory singleton caches cannot resurrect deleted state.
    assert.deepEqual(providerStore.getAllProviders(), []);
    assert.equal(providerStore.getDefaultModelId(), null);
    assert.equal(settingsStore.getAll().userName, undefined);
    assert.equal(mcpStore.hasServers(), false);
    assert.equal(skillStore.getByName("custom-reset-skill"), null);
    assert.deepEqual(allowedDirsStore.getAll(), []);
    assert.equal(composioKeyStore.getActiveCustomKey(), null);
  
    // A genuinely new fact after reset is not suppressed by old fingerprints.
    const freshAnnouncement = await announcements.recordAnnouncement({
      taskId: "scheduled-reset-after",
      taskName: "Quarterly budget report",
      topic: "Quarterly budget report",
      source: "scheduled",
      output: fact,
    });
    assert.ok(freshAnnouncement);
    assert.equal(freshAnnouncement!.status, "pending");
    assert.ok((await announcements.getPendingAnnouncements(50)).some((a) => a.id === freshAnnouncement!.id));
    const freshWork = await work.upsertHeartbeatWork({
      topic: "Fresh work after reset",
      source: "workspace",
      sourceRef: "workspace:fresh-after-reset",
      summary: "A new draft is ready to continue.",
      nextStep: "Verify the draft.",
    });
    assert.equal(freshWork.status, "open");
  });

  it("is idempotent and serializes concurrent reset requests", async () => {
    seedFiles();
    await seedLiveState();
    const [first, second] = await Promise.all([performHardReset(), performHardReset()]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    assert.equal(existsSync(memoryDir), false);
    assert.equal(existsSync(join(dataDir, "agent.sqlite")), false);

    const again = await performHardReset();
    assert.equal(again.ok, true);
    assert.deepEqual(again.errors, []);
  });
});
