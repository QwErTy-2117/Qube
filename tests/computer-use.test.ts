import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  CUA_ACTION_TOOLS,
  CUA_READ_ONLY_QUBE_TOOLS,
  QUBE_COMPUTER_TOOLS,
  cuaCursorMotionConfig,
  cuaDriverTimeoutMs,
  cuaSessionLabel,
  cuaToolFromQubeTool,
  isComputerUseDisabled,
  isReadOnlyComputerTool,
  qubeComputerToolName,
  resolveCuaDriverCommand,
} from "../lib/cua/config";
import {
  CuaDriver,
  CuaDriverError,
  CuaToolError,
  cuaErrorCode,
  cuaErrorPayload,
  cuaErrorMessage,
  parseCuaOutput,
  pngDimensions,
  translateCuaFailure,
  type ParsedCuaOutput,
} from "../lib/cua/driver";
import {
  CuaEventHub,
  CuaFrameStore,
  cuaEventHub,
  cuaFrameStore,
  cuaSnapshot,
  resetCuaRuntimeForHardReset,
} from "../lib/cua/events";
import {
  dragFromLegacy,
  normalizeElementIndex,
  parseKeyChord,
  scrollFromLegacy,
  translateLegacyAction,
  validateSequenceCalls,
} from "../lib/cua/sequence";
import { CuaService } from "../lib/cua/service";
import {
  isPressed,
  impactsAt,
  planActionAnimation,
  planSpeed,
  sampleCursor,
  travelDuration,
} from "../lib/computer-use/visualization/timeline";
import { easeOutCubic } from "../lib/computer-use/visualization/easing";
import { createComputerTools } from "../lib/pi/computer-tools";
import { classifyLocalTool } from "../lib/permissions/sensitive";
import { computerControlInstructions } from "../lib/pi/prompt-context";
import { buildPiSystemPrompt } from "../lib/pi/system-prompt";
import { friendlyToolLabel } from "../components/assistant-ui/tools/tool-labels";
import { describeAction } from "../lib/computer-use/catalog";
import { isFinalOrDestructiveAction } from "../lib/proactivity/heartbeat-work";
import type { CuaActionEvent } from "../lib/cua/types";

function event(partial: Partial<CuaActionEvent> = {}): CuaActionEvent {
  return {
    id: 1,
    at: Date.now(),
    threadId: "t1",
    session: "qube-t1",
    kind: "click",
    tool: "computer_click",
    ok: true,
    app: "Text Editor",
    scope: "window",
    x: 120,
    y: 80,
    frameWidth: 1280,
    frameHeight: 800,
    ...partial,
  };
}

function actionInput(partial: Partial<CuaActionEvent> = {}): Omit<CuaActionEvent, "id" | "at"> {
  const { id: _id, at: _at, ...rest } = event(partial);
  void _id;
  void _at;
  return rest;
}

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** Fake driver: records calls and returns queued outputs, no daemon needed. */
class FakeDriver extends CuaDriver {
  calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  responses = new Map<string, ParsedCuaOutput | Error>();
  constructor() {
    super({ command: "cua-driver", extraArgs: [], source: "env", available: true });
  }
  override async call(
    tool: string,
    args: Record<string, unknown> = {},
  ): Promise<ParsedCuaOutput> {
    this.calls.push({ tool, args });
    const queued = this.responses.get(tool);
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    if (tool === "start_session" || tool === "set_agent_cursor_motion") {
      return { data: { ok: true }, text: "", raw: "{}", isError: false };
    }
    if (tool === "run_steps") {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      return {
        data: {
          steps: steps.map((step, index) => ({
            index,
            tool: (step as Record<string, unknown>).tool,
            ok: true,
          })),
        },
        text: "",
        raw: "{}",
        isError: false,
      };
    }
    return { data: { ok: true }, text: "", raw: "{}", isError: false };
  }
  override async status() {
    return { running: true, raw: "daemon is running" };
  }
  override async doctor() {
    return { raw: "ok", data: { ok: true } };
  }
  override async listToolDescriptions() {
    return [{ name: "click", description: "Click" }];
  }
}

describe("cua: naming and configuration", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of [
      "CUA_DRIVER_COMMAND",
      "COMPUTER_USE_COMMAND",
      "COMPUTER_USE_DISABLED",
      "COMPUTER_USE_TIMEOUT_MS",
      "CUA_CURSOR_STYLE",
      "CUA_CURSOR_TIMING",
      "CUA_CURSOR_EFFECTS",
      "CUA_CURSOR_IDLE_HIDE_MS",
    ]) {
      saved[key] = process.env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps the model-facing computer_* surface and maps it to CUA tools", () => {
    for (const name of QUBE_COMPUTER_TOOLS) assert.ok(name.startsWith("computer_"), name);
    assert.equal(cuaToolFromQubeTool("computer_click"), "click");
    assert.equal(cuaToolFromQubeTool("computer_get_app_state"), "get_window_state");
    assert.equal(cuaToolFromQubeTool("computer_secondary_action"), "right_click");
    assert.equal(cuaToolFromQubeTool("computer_activate_window"), "bring_to_front");
    assert.equal(cuaToolFromQubeTool("computer_nope"), null);
    assert.equal(qubeComputerToolName("drag"), "computer_drag");
    assert.ok(CUA_ACTION_TOOLS.includes("press_key"));
    for (const name of QUBE_COMPUTER_TOOLS) {
      assert.ok(!["click", "type", "press_key", "browser_act"].includes(name));
    }
  });

  it("classifies the read-only surface", () => {
    for (const name of [
      "computer_list_apps",
      "computer_get_app_state",
      "computer_list_windows",
      "computer_get_window",
      "computer_get_window_state",
      "computer_get_desktop_state",
      "computer_doctor",
      "computer_capabilities",
      "computer_clipboard_read",
    ]) {
      assert.ok(CUA_READ_ONLY_QUBE_TOOLS.has(name), name);
      assert.ok(isReadOnlyComputerTool(name), name);
    }
    for (const name of [
      "computer_click",
      "computer_secondary_action",
      "computer_scroll",
      "computer_drag",
      "computer_type_text",
      "computer_press_key",
      "computer_set_value",
      "computer_launch_app",
      "computer_activate_window",
      "computer_clipboard_write",
      "computer_run_sequence",
    ]) {
      assert.equal(isReadOnlyComputerTool(name), false, name);
    }
  });

  it("resolves env overrides, timeouts and the disabled flag", () => {
    delete process.env.CUA_DRIVER_COMMAND;
    delete process.env.COMPUTER_USE_COMMAND;
    const resolved = resolveCuaDriverCommand();
    assert.ok(resolved.command.endsWith("cua-driver") || resolved.command === "cua-driver");
    process.env.CUA_DRIVER_COMMAND = "cua-driver --profile test";
    const custom = resolveCuaDriverCommand();
    assert.equal(custom.command, "cua-driver");
    assert.deepEqual(custom.extraArgs, ["--profile", "test"]);
    process.env.COMPUTER_USE_DISABLED = "1";
    assert.equal(isComputerUseDisabled(), true);
    process.env.COMPUTER_USE_DISABLED = "0";
    assert.equal(isComputerUseDisabled(), false);
    process.env.COMPUTER_USE_TIMEOUT_MS = "12000";
    assert.equal(cuaDriverTimeoutMs(), 12000);
    process.env.COMPUTER_USE_TIMEOUT_MS = "1";
    assert.equal(cuaDriverTimeoutMs(), 60000);
  });

  it("builds a stable, sanitized per-thread session label", () => {
    const a = cuaSessionLabel("thread/With Spaces & Symbols");
    const b = cuaSessionLabel("thread/With Spaces & Symbols");
    const c = cuaSessionLabel("another-thread");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^qube-[a-z0-9-]+-[0-9a-f]{6}$/);
    assert.ok(a.length <= 48);
  });

  it("enables a visible native cinematic cursor by default", () => {
    delete process.env.CUA_CURSOR_STYLE;
    delete process.env.CUA_CURSOR_TIMING;
    delete process.env.CUA_CURSOR_EFFECTS;
    delete process.env.CUA_CURSOR_IDLE_HIDE_MS;
    const motion = cuaCursorMotionConfig();
    assert.equal(motion.style, "adaptive");
    assert.equal(motion.timing, "fitts");
    assert.equal(motion.idle_hide_ms, 0);
    for (const effect of ["trail", "glow", "magnet", "ripple", "squish"] as const) {
      assert.equal(motion.effects[effect], "on");
    }
    process.env.CUA_CURSOR_EFFECTS = "trail,ripple";
    const trimmed = cuaCursorMotionConfig();
    assert.equal(trimmed.effects.trail, "on");
    assert.equal(trimmed.effects.glow, "off");
    process.env.CUA_CURSOR_EFFECTS = "off";
    assert.equal(cuaCursorMotionConfig().effects.trail, "off");
  });
});

describe("cua: driver output normalization and errors", () => {
  it("parses structuredContent, MCP content, and plain text", () => {
    const structured = parseCuaOutput(
      JSON.stringify({ structuredContent: { elements: [{ element_index: 1 }], tree_markdown: "root" } }),
    );
    assert.equal(structured.text, "root");
    assert.equal(structured.isError, false);
    assert.deepEqual(structured.data?.elements, [{ element_index: 1 }]);

    const mcp = parseCuaOutput(
      JSON.stringify({ content: [{ type: "text", text: "tree" }], isError: true }),
    );
    assert.equal(mcp.isError, true);
    assert.equal(mcp.text, "tree");

    const plain = parseCuaOutput("not json at all");
    assert.equal(plain.data, null);
    assert.equal(plain.text, "not json at all");
    assert.equal(plain.isError, false);
  });

  it("reads PNG dimensions from the header", () => {
    assert.deepEqual(pngDimensions(png(1280, 800)), { width: 1280, height: 800 });
    assert.equal(pngDimensions(Buffer.from("nope")), null);
  });

  it("translates actionable CUA failures", () => {
    const stale = translateCuaFailure("stale snapshot: element token superseded");
    assert.equal(stale.code, "stale_snapshot");
    assert.match(stale.hint ?? "", /computer_get_app_state/);

    const display = translateCuaFailure("Capture error: $DISPLAY variable not set");
    assert.equal(display.code, "no_display");

    const perms = translateCuaFailure("Accessibility permission denied", { code: "permissions" });
    assert.equal(perms.code, "permissions");
    assert.match(perms.hint ?? "", /Screen Recording/);

    const background = translateCuaFailure("background_unavailable: app ignores background input");
    assert.equal(background.code, "background_unavailable");
    assert.match(background.hint ?? "", /delivery_mode/);

    const target = translateCuaFailure("app not found: TextEdit");
    assert.equal(target.code, "target_not_found");

    const unknown = translateCuaFailure("");
    assert.equal(unknown.code, "cua_error");
    assert.match(unknown.message, /reported an error/);
  });

  it("wraps tool errors without throwing and keeps the code", () => {
    const parsed = parseCuaOutput(
      JSON.stringify({ structuredContent: { error: "stale snapshot", code: "stale_snapshot" }, isError: true }),
    );
    const err = new CuaToolError("click", parsed);
    assert.equal(err.code, "stale_snapshot");
    assert.equal(cuaErrorCode(err), "stale_snapshot");
    assert.match(cuaErrorMessage(err), /stale snapshot/);
    const payload = JSON.parse(cuaErrorPayload("computer_click", err));
    assert.equal(payload.error, true);
    assert.equal(payload.code, "stale_snapshot");
    assert.ok(payload.hint);
  });

  it("refuses to run when computer use is disabled", async () => {
    const prev = process.env.COMPUTER_USE_DISABLED;
    process.env.COMPUTER_USE_DISABLED = "1";
    try {
      const driver = new CuaDriver({
        command: "cua-driver",
        extraArgs: [],
        source: "env",
        available: true,
      });
      await assert.rejects(
        () => driver.call("list_apps", {}),
        (error: unknown) => error instanceof CuaDriverError && error.code === "disabled",
      );
    } finally {
      if (prev === undefined) delete process.env.COMPUTER_USE_DISABLED;
      else process.env.COMPUTER_USE_DISABLED = prev;
    }
  });
});

describe("cua: legacy sequence translation", () => {
  it("validates calls before touching the driver", () => {
    assert.equal(validateSequenceCalls(null).ok, false);
    assert.equal(validateSequenceCalls([]).ok, false);
    const unknown = validateSequenceCalls([{ tool: "nuke_desktop", args: {} }]);
    assert.equal(unknown.ok, false);
    const missingArgs = validateSequenceCalls([{ tool: "click" }]);
    assert.equal(missingArgs.ok, false);
    const tooMany = validateSequenceCalls(
      Array.from({ length: 17 }, () => ({ tool: "get_app_state", args: { app: "x" } })),
    );
    assert.equal(tooMany.ok, false);
    const good = validateSequenceCalls([{ tool: "get_app_state", args: { app: "Text Editor" } }]);
    assert.equal(good.ok, true);
  });

  it("normalizes element indexes and key chords", () => {
    assert.equal(normalizeElementIndex(12), 12);
    assert.equal(normalizeElementIndex("[12]"), 12);
    assert.equal(normalizeElementIndex("row 3"), 3);
    assert.equal(normalizeElementIndex(-1), null);
    assert.equal(normalizeElementIndex("nope"), null);
    assert.deepEqual(parseKeyChord("ctrl+shift+t"), { key: "t", modifiers: ["ctrl", "shift"] });
    assert.deepEqual(parseKeyChord("cmd+s"), { key: "s", modifiers: ["super"] });
    assert.deepEqual(parseKeyChord("esc"), { key: "escape", modifiers: [] });
    assert.deepEqual(parseKeyChord("page_up"), { key: "pageup", modifiers: [] });
  });

  it("maps scroll deltas and drag aliases", () => {
    assert.deepEqual(scrollFromLegacy({ direction: "up", amount: 5 }), {
      direction: "up",
      amount: 5,
      by: "line",
    });
    assert.deepEqual(scrollFromLegacy({ pages: 2 }), { direction: "down", amount: 2, by: "page" });
    assert.equal(scrollFromLegacy({ delta_y: -480 }).direction, "up");
    assert.equal(scrollFromLegacy({ delta_y: -480 }).amount, 4);
    assert.equal(scrollFromLegacy({ delta_x: 600 }).direction, "right");
    assert.deepEqual(dragFromLegacy({ start_x: 1, start_y: 2, end_x: 3, end_y: 4 }), {
      from_x: 1,
      from_y: 2,
      to_x: 3,
      to_y: 4,
    });
    assert.equal(dragFromLegacy({ from_x: 1 }), null);
  });

  it("produces valid CUA step shapes with no unsupported fields", () => {
    const click = translateLegacyAction("click", { x: 10, y: 20, button: "left", count: 2 }, "s12345678:4");
    assert.equal(click.tool, "click");
    assert.deepEqual(
      { element_token: click.args.element_token, x: click.args.x, y: click.args.y, count: click.args.count },
      { element_token: "s12345678:4", x: 10, y: 20, count: 2 },
    );

    const dbl = translateLegacyAction("double_click", { x: 1, y: 2 }, "s12345678:4");
    assert.equal(dbl.tool, "double_click");
    assert.equal("count" in dbl.args, false);
    assert.equal("button" in dbl.args, false);

    const right = translateLegacyAction("perform_secondary_action", { x: 1, y: 2 });
    assert.equal(right.tool, "right_click");
    assert.equal("button" in right.args, false);

    const hotkey = translateLegacyAction("press_key", { key: "ctrl+s" });
    assert.equal(hotkey.tool, "hotkey");
    assert.deepEqual(hotkey.args.keys, ["ctrl", "s"]);
    assert.equal("modifier" in hotkey.args, false);

    const press = translateLegacyAction("press_key", { key: "return" });
    assert.equal(press.tool, "press_key");
    assert.equal(press.args.key, "enter");

    const scroll = translateLegacyAction("scroll", { pages: 1, modifier: ["shift"] });
    assert.equal(scroll.tool, "scroll");
    assert.equal("modifier" in scroll.args, false);
    assert.equal(scroll.args.by, "page");

    const drag = translateLegacyAction("drag", {
      from_x: 1,
      from_y: 2,
      to_x: 3,
      to_y: 4,
      element_index: 2,
    });
    assert.equal(drag.tool, "drag");
    assert.equal("element_token" in drag.args, false);
    assert.equal("x" in drag.args, false);

    const set = translateLegacyAction("set_value", { value: "hello", x: 4, y: 5 }, "s12345678:2");
    assert.equal(set.tool, "set_value");
    assert.equal("x" in set.args, false);
    assert.equal(set.args.value, "hello");

    const type = translateLegacyAction("type_text", { text: "hi" });
    assert.equal(type.tool, "type_text");
    assert.equal("modifier" in type.args, false);
    assert.throws(() => translateLegacyAction("type_text", { text: "" }));
    assert.throws(() => translateLegacyAction("set_value", { value: "x" }));
    assert.throws(() => translateLegacyAction("drag", { from_x: 1 }));
  });
});

describe("cua: event hub and frame store", () => {
  beforeEach(() => resetCuaRuntimeForHardReset());
  afterEach(() => resetCuaRuntimeForHardReset());

  it("publishes real actions with ids and filters by thread", () => {
    const hub = new CuaEventHub();
    const seen: string[] = [];
    const unsubscribe = hub.subscribe((envelope) => {
      if (envelope.type === "action") seen.push(`${envelope.event.threadId}:${envelope.event.id}`);
    });
    const first = hub.publishAction(actionInput({ threadId: "a" }));
    const second = hub.publishAction(actionInput({ threadId: "b", kind: "scroll", tool: "computer_scroll" }));
    assert.equal(first.id, 1);
    assert.equal(second.id, 2);
    assert.deepEqual(seen, ["a:1", "b:2"]);
    assert.equal(hub.latest("a")?.id, 1);
    assert.equal(hub.latest("missing"), null);
    assert.equal(hub.lastId("b"), 2);
    assert.deepEqual(hub.eventsSince("a", 0).map((e) => e.id), [1]);
    unsubscribe();
    hub.publishAction(actionInput({ threadId: "a" }));
    assert.equal(seen.length, 2);
  });

  it("stores versioned frames and emits metadata only", () => {
    const hub = new CuaEventHub();
    const store = new CuaFrameStore(hub);
    const frames: number[] = [];
    hub.subscribe((envelope) => {
      if (envelope.type === "frame") frames.push(envelope.frame.version);
    });
    const meta = store.put({
      threadId: "a",
      scope: "window",
      width: 100,
      height: 50,
      mime: "image/png",
      base64: png(100, 50).toString("base64"),
    });
    assert.equal(meta?.version, 1);
    assert.equal(store.meta("a")?.width, 100);
    assert.deepEqual(frames, [1]);
    assert.equal(
      store.put({
        threadId: "a",
        scope: "window",
        width: 100,
        height: 50,
        mime: "image/png",
        base64: png(100, 50).toString("base64"),
      })?.version,
      2,
    );
    assert.equal(
      store.put({
        threadId: "a",
        scope: "window",
        width: 100,
        height: 50,
        mime: "image/png",
        base64: "",
      }),
      null,
    );
    assert.equal(store.get("missing"), null);
  });

  it("builds a reconnect snapshot", () => {
    const hub = cuaEventHub;
    const store = cuaFrameStore;
    hub.publishAction(actionInput({ threadId: "t1", kind: "click", x: 1, y: 2 }));
    store.put({
      threadId: "t1",
      scope: "window",
      width: 10,
      height: 10,
      mime: "image/png",
      base64: png(10, 10).toString("base64"),
    });
    const snap = cuaSnapshot("t1");
    assert.equal(snap.threadId, "t1");
    assert.equal(snap.latest?.kind, "click");
    assert.equal(snap.lastEventId, snap.latest?.id);
    assert.equal(snap.frame?.threadId, "t1");
  });
});

describe("cua: timeline mirrors real coordinates", () => {
  it("never animates failed, observation, or ungrounded actions", () => {
    assert.equal(planActionAnimation(event({ ok: false }), null), null);
    assert.equal(planActionAnimation(event({ kind: "observe", tool: "computer_get_app_state" }), null), null);
    assert.equal(planActionAnimation(event({ x: undefined, y: undefined }), null), null);
    assert.equal(
      planActionAnimation(event({ kind: "drag", x: undefined, y: undefined, fromX: undefined }), null),
      null,
    );
    assert.equal(
      planActionAnimation(event({ kind: "scroll", x: undefined, y: undefined }), null),
      null,
    );
  });

  it("lands exactly on the real click point", () => {
    const animation = planActionAnimation(event({ x: 400, y: 300 }), { x: 20, y: 20 });
    assert.ok(animation);
    assert.ok(animation.segments.length === 1);
    assert.deepEqual(sampleCursor(animation, animation.totalDuration), { x: 400, y: 300 });
    const start = sampleCursor(animation, 0);
    assert.deepEqual(start, { x: 20, y: 20 });
    const middle = sampleCursor(animation, animation.moveDuration / 2);
    assert.ok(middle && middle.x > 20 && middle.x < 400);
    assert.ok(isPressed(animation, animation.moveDuration + 10));
    assert.ok(!isPressed(animation, 0));
    assert.equal(impactsAt(animation, 0).length, 0);
    assert.equal(impactsAt(animation, animation.totalDuration).length, 1);
  });

  it("appears in place when there is no previous cursor", () => {
    const animation = planActionAnimation(event({ x: 50, y: 60 }), null);
    assert.ok(animation);
    assert.equal(animation.segments.length, 0);
    assert.equal(animation.totalDuration, 140);
    assert.deepEqual(sampleCursor(animation, 0), { x: 50, y: 60 });
  });

  it("draws double-click two impacts and uses the exact press count", () => {
    const animation = planActionAnimation(event({ kind: "double_click", x: 10, y: 10 }), null);
    assert.ok(animation);
    assert.equal(animation.impacts.length, 2);
    assert.ok(animation.impacts[1].at > animation.impacts[0].at);
  });

  it("follows the real drag path from and to", () => {
    const animation = planActionAnimation(
      event({ kind: "drag", x: undefined, y: undefined, fromX: 10, fromY: 20, toX: 200, toY: 220 }),
      { x: 0, y: 0 },
    );
    assert.ok(animation);
    assert.deepEqual(sampleCursor(animation, animation.totalDuration), { x: 200, y: 220 });
    assert.ok(animation.pressStart > 0);
    assert.ok(animation.pressEnd > animation.pressStart);
    assert.equal(animation.impacts[0].kind, "drag");
  });

  it("keeps keyboard actions at the current focus when they have no coordinates", () => {
    const animation = planActionAnimation(
      event({ kind: "key", x: undefined, y: undefined, key: "enter" }),
      { x: 33, y: 44 },
    );
    assert.ok(animation);
    assert.equal(animation.segments.length, 0);
    assert.deepEqual(sampleCursor(animation, animation.totalDuration), { x: 33, y: 44 });
    assert.equal(animation.impacts[0].label, "enter");
  });

  it("bounded, Fitts-like travel and queue catch-up", () => {
    assert.equal(travelDuration(null, { x: 0, y: 0 }), 0);
    assert.equal(travelDuration({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }), 0);
    const short = travelDuration({ x: 0, y: 0 }, { x: 40, y: 0 });
    const long = travelDuration({ x: 0, y: 0 }, { x: 1200, y: 0 });
    assert.ok(long > short);
    assert.ok(long <= 430);
    assert.ok(short >= 110);
    assert.ok(travelDuration({ x: 0, y: 0 }, { x: 1200, y: 0 }, 2) < long);
    assert.equal(planSpeed(0), 1);
    assert.ok(planSpeed(3) > 1);
    assert.ok(planSpeed(9) > planSpeed(1));
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
  });
});

describe("cua: service integration with a fake driver", () => {
  let driver: FakeDriver;
  let service: CuaService;

  beforeEach(() => {
    resetCuaRuntimeForHardReset();
    driver = new FakeDriver();
    service = new CuaService("thread-1", { driver, session: "qube-thread-1" });
  });
  afterEach(() => resetCuaRuntimeForHardReset());

  it("starts a named session with the native cursor config", async () => {
    await service.ensureSession();
    const start = driver.calls.find((c) => c.tool === "start_session");
    assert.ok(start);
    assert.equal(start.args.session, "qube-thread-1");
    assert.ok(start.args.cursor_motion);
    const motion = driver.calls.find((c) => c.tool === "set_agent_cursor_motion");
    assert.ok(motion);
    assert.equal(motion.args.session, "qube-thread-1");
    assert.ok(motion.args.effects);
  });

  it("does not need a display for window listing", async () => {
    driver.responses.set("list_windows", {
      data: {
        windows: [
          { pid: 42, window_id: 7, app_name: "Text Editor", title: "Draft", bounds: { x: 0, y: 0, width: 800, height: 600 } },
        ],
      },
      text: "",
      raw: "{}",
      isError: false,
    });
    const windows = await service.listWindows({ app: "Text Editor" });
    assert.equal(windows.length, 1);
    assert.equal(windows[0].pid, 42);
    assert.equal(windows[0].window_id, 7);
  });

  it("resolves app names to a concrete window and explains missing apps", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 9, window_id: 3, app_name: "Notes", title: "Groceries" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    const target = await service.resolveTarget({ app: "Notes" });
    assert.equal(target?.pid, 9);
    assert.equal(target?.windowId, 3);

    driver.responses.set("list_windows", { data: { windows: [] }, text: "", raw: "{}", isError: false });
    driver.responses.set("list_apps", {
      data: { apps: [{ name: "Calculator", pid: 5, running: true }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    await assert.rejects(
      () => service.resolveTarget({ app: "Calculator" }),
      (error: unknown) => error instanceof CuaDriverError && error.code === "target_not_found",
    );
    await assert.rejects(
      () => service.resolveTarget({ app: "NoSuchApp" }),
      (error: unknown) => error instanceof CuaDriverError && /list_apps/.test(error.hint ?? ""),
    );
  });

  it("rejects window actions without a target", async () => {
    await assert.rejects(
      () => service.click({ x: 10, y: 20 }),
      (error: unknown) => error instanceof CuaDriverError && error.code === "target_not_found",
    );
  });

  it("translates a click by element_index into a CUA token call", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 9, window_id: 3, app_name: "Notes" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set("get_window_state", {
      data: {
        pid: 9,
        window_id: 3,
        snapshot_id: "s12345678",
        elements: [
          {
            element_index: 4,
            element_token: "s12345678:4",
            role: "button",
            label: "Save",
            screenshot_frame: { x: 100, y: 50, w: 80, h: 30 },
          },
        ],
      },
      text: "tree",
      raw: "{}",
      isError: false,
    });
    const observed = await service.observeWindow({ app: "Notes" });
    assert.equal(observed.elements.length, 1);
    assert.equal(observed.width, undefined);

    const result = await service.click({ app: "Notes", element_index: 4 });
    assert.equal(result.data.ok, true);
    const click = driver.calls.find((c) => c.tool === "click");
    assert.ok(click);
    assert.equal(click.args.element_token, "s12345678:4");
    assert.equal(click.args.pid, 9);
    assert.equal(click.args.window_id, 3);
    assert.equal("x" in click.args, false);
  });

  it("maps click variants to the right CUA tools", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 2, window_id: 1, app_name: "App" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    await service.click({ app: "App", x: 5, y: 6, count: 2 });
    await service.click({ app: "App", x: 7, y: 8 }, { button: "right" });
    await service.click({ app: "App", x: 9, y: 10 });
    const tools = driver.calls.filter((c) => ["click", "double_click", "right_click"].includes(c.tool));
    assert.deepEqual(tools.map((c) => c.tool), ["double_click", "right_click", "click"]);
    assert.equal("count" in tools[0].args, false);
    assert.equal("button" in tools[1].args, false);
    assert.equal(tools[2].args.count, 1);
    assert.equal(tools[2].args.button, "left");
  });

  it("maps press_key chords to hotkey and plain keys to press_key", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 2, window_id: 1, app_name: "App" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    await service.pressKey({ app: "App", key: "ctrl+s" });
    await service.pressKey({ app: "App", key: "return" });
    await service.pressKey({ app: "App", key: "k", modifiers: ["shift"] });
    const calls = driver.calls.filter((c) => c.tool === "hotkey" || c.tool === "press_key");
    assert.equal(calls[0].tool, "hotkey");
    assert.deepEqual(calls[0].args.keys, ["ctrl", "s"]);
    assert.equal(calls[1].tool, "press_key");
    assert.equal(calls[1].args.key, "enter");
    assert.equal(calls[2].tool, "hotkey");
    assert.deepEqual(calls[2].args.keys, ["shift", "k"]);
  });

  it("batches a legacy sequence into run_steps and mirrors each real step", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 9, window_id: 3, app_name: "Notes" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set("get_window_state", {
      data: {
        pid: 9,
        window_id: 3,
        snapshot_id: "s12345678",
        elements: [
          {
            element_index: 1,
            element_token: "s12345678:1",
            role: "textfield",
            screenshot_frame: { x: 10, y: 20, w: 100, h: 20 },
          },
        ],
      },
      text: "tree",
      raw: "{}",
      isError: false,
    });
    const seen: CuaActionEvent[] = [];
    resetCuaRuntimeForHardReset();
    const { cuaEventHub } = await import("../lib/cua/events");
    cuaEventHub.subscribe((envelope) => {
      if (envelope.type === "action") seen.push(envelope.event);
    });

    const out = await service.runSequence({
      calls: [
        { tool: "get_app_state", args: { app: "Notes" } },
        { tool: "click", args: { app: "Notes", element_index: 1 } },
        { tool: "type_text", args: { app: "Notes", element_index: 1, text: "milk" } },
        { tool: "press_key", args: { app: "Notes", key: "ctrl+return" } },
      ],
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, out.slice(0, 2000));
    const batch = driver.calls.find((c) => c.tool === "run_steps");
    assert.ok(batch);
    const steps = batch.args.steps as Array<{ tool: string; args: Record<string, unknown> }>;
    assert.deepEqual(steps.map((s) => s.tool), ["click", "type_text", "hotkey"]);
    assert.equal(steps[0].args.element_token, "s12345678:1");
    assert.equal(steps[0].args.pid, 9);
    assert.equal(steps[2].args.keys instanceof Array, true);

    const actionEvents = seen.filter((e) => e.kind !== "observe");
    assert.equal(actionEvents.length, 3, JSON.stringify({ out: out.slice(0, 1200), seen: seen.map((e) => [e.kind, e.tool, e.ok]) }));
    assert.equal(actionEvents[0].kind, "click");
    assert.deepEqual([actionEvents[0].x, actionEvents[0].y], [60, 30]);
    assert.equal(actionEvents[0].batchId, actionEvents[1].batchId);
    assert.equal(actionEvents[1].kind, "type");
    assert.equal(actionEvents[2].kind, "key");
  });

  it("returns the observation text for a read-only sequence", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 9, window_id: 3, app_name: "Notes" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set("get_window_state", {
      data: { pid: 9, window_id: 3, snapshot_id: "s12345678", elements: [] },
      text: "App: Notes\n[1] Button Save",
      raw: "{}",
      isError: false,
    });
    const out = await service.runSequence({
      calls: [{ tool: "get_app_state", args: { app: "Notes" } }],
    });
    assert.match(out, /App: Notes/);
    assert.match(out, /Button Save/);
    assert.equal(driver.calls.some((c) => c.tool === "run_steps"), false);
  });

  it("rejects a sequence whose step reports failure without throwing", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 2, window_id: 1, app_name: "App" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set("run_steps", {
      data: {
        steps: [
          { index: 0, tool: "click", ok: true },
          { index: 1, tool: "click", ok: false, error: "element moved" },
        ],
      },
      text: "",
      raw: "{}",
      isError: false,
    });
    const out = await service.runSequence({
      calls: [
        { tool: "click", args: { app: "App", x: 1, y: 2 } },
        { tool: "click", args: { app: "App", x: 3, y: 4 } },
      ],
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /element moved/);
  });

  it("keeps desktop actions out of the window default", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 9, window_id: 3, app_name: "Notes" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set("get_desktop_state", {
      data: { width: 1920, height: 1080 },
      text: "",
      raw: "{}",
      isError: false,
    });
    await service.observeDesktop();
    await service.runSequence({
      calls: [
        { tool: "click", args: { app: "Notes", scope: "desktop", x: 500, y: 400 } },
      ],
    });
    const batch = driver.calls.find((c) => c.tool === "run_steps");
    assert.ok(batch);
    const step = (batch.args.steps as Array<{ args: Record<string, unknown> }>)[0];
    assert.equal(step.args.scope, "desktop");
    assert.equal("pid" in step.args, false);
    assert.equal("window_id" in step.args, false);
    assert.equal("pid" in batch.args, false);
    assert.equal("window_id" in batch.args, false);
  });

  it("reports a batch failure with the failing step", async () => {
    driver.responses.set("list_windows", {
      data: { windows: [{ pid: 2, window_id: 1, app_name: "App" }] },
      text: "",
      raw: "{}",
      isError: false,
    });
    driver.responses.set(
      "run_steps",
      new CuaToolError(
        "run_steps",
        parseCuaOutput(
          JSON.stringify({
            structuredContent: {
              error: "step 2 failed: stale snapshot",
              steps: [{ ok: true }, { ok: false, error: "stale snapshot" }],
            },
            isError: true,
          }),
        ),
      ),
    );
    const out = await service.runSequence({
      calls: [
        { tool: "click", args: { app: "App", x: 1, y: 2 } },
        { tool: "click", args: { app: "App", x: 3, y: 4 } },
      ],
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /stale snapshot/);
    assert.equal(parsed.steps.length, 2);
    assert.equal(parsed.steps[1].ok, false);
  });
});

describe("cua: tool factory and gating", () => {
  it("exposes every computer_* tool with a schema", () => {
    const tools = createComputerTools("test-thread", { includeAskUser: true }) as Record<string, any>;
    for (const name of QUBE_COMPUTER_TOOLS) {
      assert.ok(tools[name], `missing ${name}`);
      assert.equal(typeof tools[name].execute, "function");
      assert.ok(tools[name].inputSchema, `${name} has no schema`);
    }
  });

  it("background runs refuse mutations but allow read-only sequences", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: false }) as Record<string, any>;
    const denied = JSON.parse(await tools.computer_click.execute({ app: "Text Editor", element_index: 1 }));
    assert.equal(denied.error, true);
    assert.equal(denied.available, false);

    const readOnly = await tools.computer_run_sequence.execute({
      calls: [{ tool: "get_app_state", args: { app: "Text Editor" } }],
    });
    assert.equal(typeof readOnly, "string");
    // The read-only path really ran (and failed only because this machine has
    // no display/driver output), never the background refusal.
    assert.ok(!/"available":false/.test(readOnly));
  });

  it("clipboard writes are gated, reads are not", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: false }) as Record<string, any>;
    const denied = JSON.parse(await tools.computer_clipboard_write.execute({ text: "hi" }));
    assert.equal(denied.error, true);
    assert.equal(denied.available, false);
    const read = await tools.computer_clipboard_read.execute({});
    assert.ok(typeof read === "string" && JSON.parse(read));
  });

  it("invalid sequences fail before any OS call", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: true }) as Record<string, any>;
    const out = JSON.parse(
      await tools.computer_run_sequence.execute({ calls: [{ tool: "nuke_desktop", args: {} }] }),
    );
    assert.equal(out.error, true);
    assert.match(out.message, /unknown tool/i);
  });
});

describe("cua: permissions, prompts and labels", () => {
  it("read-only tools auto-allow and mutations pause", () => {
    for (const name of CUA_READ_ONLY_QUBE_TOOLS) {
      assert.equal(classifyLocalTool(name, {}).sensitive, false, name);
    }
    for (const name of [
      "computer_click",
      "computer_type_text",
      "computer_press_key",
      "computer_set_value",
      "computer_scroll",
      "computer_drag",
      "computer_launch_app",
      "computer_activate_window",
      "computer_clipboard_write",
    ]) {
      const verdict = classifyLocalTool(name, { app: "Text Editor", text: "hi" });
      assert.equal(verdict.sensitive, true, name);
      assert.equal(verdict.kind, "computer_control");
      assert.ok(verdict.purpose.length > 0);
    }
  });

  it("classifies sequences by whether every call is read-only", () => {
    const readOnly = classifyLocalTool("computer_run_sequence", {
      calls: [{ tool: "get_app_state", args: { app: "Notes" } }],
    });
    assert.equal(readOnly.sensitive, false);
    const mutating = classifyLocalTool("computer_run_sequence", {
      calls: [
        { tool: "get_app_state", args: { app: "Notes" } },
        { tool: "click", args: { app: "Notes", element_index: 1 } },
      ],
    });
    assert.equal(mutating.sensitive, true);
    assert.equal(mutating.kind, "computer_control");
    assert.equal(describeAction("computer_run_sequence", { calls: [] }).kind, "interact");
    assert.equal(
      describeAction("computer_RUN_SEQUENCE".toLowerCase(), {
        calls: [{ tool: "list_apps", args: {} }],
      }).kind,
      "observe",
    );
  });

  it("proactivity treats read-only computer work as non-final", () => {
    assert.equal(isFinalOrDestructiveAction("computer_get_app_state", {}), false);
    assert.equal(isFinalOrDestructiveAction("computer_click", {}), true);
    assert.equal(
      isFinalOrDestructiveAction("computer_run_sequence", {
        calls: [{ tool: "get_app_state", args: { app: "Notes" } }],
      }),
      false,
    );
    assert.equal(
      isFinalOrDestructiveAction("computer_run_sequence", {
        calls: [{ tool: "get_app_state", args: { app: "Notes" } }, { tool: "click", args: {} }],
      }),
      true,
    );
  });

  it("prompts teach CUA Driver semantics, not ocu per-process state", () => {
    const instructions = computerControlInstructions();
    assert.match(instructions, /CUA Driver/);
    assert.match(instructions, /computer_run_sequence/);
    assert.match(instructions, /re-read after/i);
    assert.doesNotMatch(instructions, /open-codex-computer-use|ocu keeps|PER PROCESS/);
    const prompt = buildPiSystemPrompt({});
    assert.match(prompt, /CUA Driver/);
    assert.match(prompt, /computer_list_apps/);
  });

  it("every computer tool has a friendly, jargon-free label", () => {
    for (const name of QUBE_COMPUTER_TOOLS) {
      const label = friendlyToolLabel(name, {});
      assert.ok(label.length > 0, name);
      assert.ok(!label.includes("_"), `${name} leaks snake_case: ${label}`);
      assert.ok(!/snapshot|cdp|pixel|takeover|heartbeat|mcp|composio|ocu/i.test(label), `${name}: ${label}`);
    }
  });
});
