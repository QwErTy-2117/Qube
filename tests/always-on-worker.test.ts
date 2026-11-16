/**
 * Always-on worker regression guards.
 *
 * These are STRUCTURAL checks: they pin the prompt contract that makes Qube
 * behave like a continuous worker (initiative, background monitoring, memory,
 * autonomy, completion, connectors, self-correction) instead of a chatbot.
 * End-to-end behavior still needs live model evaluation.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/always-on-worker.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildPiSystemPrompt } from "@/lib/pi/system-prompt";
import { buildQubePromptSection } from "@/lib/pi/durable-prompt";

const MAIN = buildPiSystemPrompt({ skills: [], connectors: [] });
const DURABLE = buildQubePromptSection();

describe("always-on worker contract", () => {
  it("states the seven worker rules in the main prompt", () => {
    assert.match(MAIN, /## Always-on worker contract/);
    assert.match(MAIN, /1\. Initiative:/);
    assert.match(MAIN, /2\. Background:/);
    assert.match(MAIN, /3\. Memory:/);
    assert.match(MAIN, /4\. Autonomy:/);
    assert.match(MAIN, /5\. Completion:/);
    assert.match(MAIN, /6\. Connected apps:/);
    assert.match(MAIN, /7\. Self-correction:/);
  });

  it("runs a silent pre-flight instead of asking what to do", () => {
    assert.match(MAIN, /Silent pre-flight on every turn/);
    assert.match(MAIN, /what is the obvious next step/);
    assert.match(MAIN, /what is already running/);
    assert.match(MAIN, /what did I already tell them/);
  });

  it("describes continuous background monitoring with quiet ticks", () => {
    assert.match(MAIN, /scheduler starts with the app, ticks every 60 seconds/);
    assert.match(MAIN, /default heartbeat checks in every 30 minutes/);
    assert.match(MAIN, /A quiet check stays quiet/);
    assert.match(MAIN, /never send "nothing to report"/);
  });

  it("keeps memory behavioral and avoids re-announcing delivered facts", () => {
    assert.match(MAIN, /Memory is behavior, not trivia/);
    assert.match(MAIN, /Never make the user restate something already saved/);
    assert.match(MAIN, /never present a delivered fact as new/);
  });

  it("defaults to acting without asking and leaves sensitive review invisible", () => {
    assert.match(MAIN, /Act first, explain later/);
    assert.match(MAIN, /the reviewer is the checkpoint/);
    assert.match(MAIN, /never ask for a second confirmation in text/);
  });

  it("uses connected apps by default and still delivers without them", () => {
    assert.match(MAIN, /connected apps: Gmail, calendar, chat, project, and storage connectors are the default surface/i);
    assert.match(MAIN, /still do the closest file\/web version of the job now/);
    assert.match(MAIN, /then do the closest file\/web version now/);
  });

  it("self-corrects quietly without apology loops", () => {
    assert.match(MAIN, /## Self-correction/);
    assert.match(MAIN, /fix it with a tool and state the corrected result in one line/i);
    assert.match(MAIN, /No apology loop/);
    assert.match(MAIN, /change the approach once/);
    assert.match(MAIN, /Never repeat a completed action/);
  });

  it("ends with results, not menus or let-me-know closers", () => {
    assert.match(MAIN, /No menus, no "let me know"/);
    assert.match(MAIN, /never a question about what to do next when the next step is yours/);
  });
});

describe("durable prompt mirror", () => {
  it("carries the compact worker contract", () => {
    assert.match(DURABLE, /## Always-on worker contract/);
    assert.match(DURABLE, /monitoring is continuous while Qube is open/i);
    assert.match(DURABLE, /scheduled tasks tick every minute/i);
    assert.match(DURABLE, /never make the user restate them/i);
    assert.match(DURABLE, /connected apps: use Gmail, calendar, chat, project, and storage connectors/i);
    assert.match(DURABLE, /fix mistakes quietly/i);
  });

  it("acts first and requires only the real approval for sensitive actions", () => {
    assert.match(DURABLE, /Act first/);
    assert.match(DURABLE, /wait ONLY for the approval itself/);
    assert.match(DURABLE, /never add a second confirmation for an action the user already requested/);
  });
});
