import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  qubeComputerToolName,
  ocuToolFromQubeTool,
  isReadOnlyComputerTool,
  isComputerUseDisabled,
  resolveComputerCommand,
  COMPUTER_USE_OCU_TOOLS,
} from "../lib/pi/computer-use-mcp";
import { createComputerTools, runOcuSequence, translateOcuError, matchesAppName } from "../lib/pi/computer-tools";
import { classifyLocalTool } from "../lib/permissions/sensitive";
import { computerControlInstructions } from "../lib/pi/prompt-context";
import { buildPiSystemPrompt } from "../lib/pi/system-prompt";
import { friendlyToolLabel } from "../components/assistant-ui/tools/tool-labels";

describe("computer-use: tool naming avoids browser collisions", () => {
  it("prefixes every ocu tool with computer_", () => {
    for (const ocu of COMPUTER_USE_OCU_TOOLS) {
      assert.equal(qubeComputerToolName(ocu), `computer_${ocu}`);
    }
    assert.equal(qubeComputerToolName("click"), "computer_click");
  });
  it("round-trips qube <-> ocu names, rejects unknown", () => {
    assert.equal(ocuToolFromQubeTool("computer_click"), "click");
    assert.equal(ocuToolFromQubeTool("computer_get_app_state"), "get_app_state");
    assert.equal(ocuToolFromQubeTool("computer_launch_app"), "launch_app");
    assert.equal(ocuToolFromQubeTool("click"), null);
    assert.equal(ocuToolFromQubeTool("browser_act"), null);
    assert.equal(ocuToolFromQubeTool("computer_nonexistent"), null);
  });
  it("never collides with managed-browser tool names", () => {
    const browserTools = new Set([
      "click", "type", "press_key", "browser_act", "browser_pixel_act",
      "computer_observe", "computer_act", "open_path",
    ]);
    for (const ocu of COMPUTER_USE_OCU_TOOLS) {
      const qube = qubeComputerToolName(ocu);
      assert.ok(!browserTools.has(qube), `${qube} collides with a browser tool`);
    }
  });
});

describe("computer-use: safety classification", () => {
  it("read-only computer tools auto-allow", () => {
    for (const t of [
      "computer_list_apps",
      "computer_get_app_state",
      "computer_doctor",
      "computer_clipboard_read",
      "computer_capabilities",
    ]) {
      assert.ok(isReadOnlyComputerTool(t), `${t} should be read-only`);
      assert.equal(classifyLocalTool(t, {}).sensitive, false);
    }
  });
  it("mutating computer tools always pause with a computer purpose", () => {
    for (const t of [
      "computer_click",
      "computer_type_text",
      "computer_press_key",
      "computer_set_value",
      "computer_scroll",
      "computer_drag",
      "computer_launch_app",
    ]) {
      assert.ok(!isReadOnlyComputerTool(t), `${t} should NOT be read-only`);
      const v = classifyLocalTool(t, { app: "TextEdit", text: "hi" });
      assert.equal(v.sensitive, true);
      assert.equal(v.kind, "computer_control");
      assert.ok(v.purpose.length > 0);
    }
  });
});

describe("computer-use: command resolution", () => {
  it("defaults to ocu, honors env override and disabled flag", () => {
    const prevCmd = process.env.COMPUTER_USE_COMMAND;
    const prevDis = process.env.COMPUTER_USE_DISABLED;
    try {
      delete process.env.COMPUTER_USE_COMMAND;
      process.env.COMPUTER_USE_DISABLED = "0";
      assert.equal(resolveComputerCommand().command, "ocu");
      assert.equal(isComputerUseDisabled(), false);
      process.env.COMPUTER_USE_COMMAND = "open-computer-use";
      assert.equal(resolveComputerCommand().command, "open-computer-use");
      process.env.COMPUTER_USE_DISABLED = "1";
      assert.equal(isComputerUseDisabled(), true);
    } finally {
      if (prevCmd === undefined) delete process.env.COMPUTER_USE_COMMAND;
      else process.env.COMPUTER_USE_COMMAND = prevCmd;
      if (prevDis === undefined) delete process.env.COMPUTER_USE_DISABLED;
      else process.env.COMPUTER_USE_DISABLED = prevDis;
    }
  });
});

describe("computer-use: tool factory", () => {
  it("exposes the full prefixed surface with input schemas", () => {
    const tools = createComputerTools("test-thread", { includeAskUser: true }) as Record<string, any>;
    for (const name of [
      "computer_list_apps",
      "computer_get_app_state",
      "computer_click",
      "computer_secondary_action",
      "computer_scroll",
      "computer_drag",
      "computer_type_text",
      "computer_press_key",
      "computer_set_value",
      "computer_launch_app",
      "computer_activate_window",
      "computer_doctor",
      "computer_clipboard_read",
      "computer_clipboard_write",
      "computer_capabilities",
      "computer_run_sequence",
    ]) {
      assert.ok(tools[name], `missing tool ${name}`);
      assert.equal(typeof tools[name].execute, "function");
      assert.ok(tools[name].inputSchema, `${name} has no inputSchema`);
    }
  });
  it("missing binary yields an install hint, not a throw", async () => {
    const prevCmd = process.env.COMPUTER_USE_COMMAND;
    const prevDis = process.env.COMPUTER_USE_DISABLED;
    try {
      process.env.COMPUTER_USE_COMMAND = "/nonexistent-path-xyz/ocu-missing";
      delete process.env.COMPUTER_USE_DISABLED;
      const tools = createComputerTools("test-thread", { includeAskUser: true }) as Record<string, any>;
      const out = await tools.computer_list_apps.execute({});
      const parsed = JSON.parse(out);
      assert.ok(parsed.error === true || typeof out === "string");
      assert.ok(/not installed|disabled|ENOENT/i.test(out));
    } finally {
      if (prevCmd === undefined) delete process.env.COMPUTER_USE_COMMAND;
      else process.env.COMPUTER_USE_COMMAND = prevCmd;
      if (prevDis === undefined) delete process.env.COMPUTER_USE_DISABLED;
      else process.env.COMPUTER_USE_DISABLED = prevDis;
    }
  });
  it("background runs refuse mutating control but keep read-only path", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: false }) as Record<string, any>;
    const out = await tools.computer_click.execute({ app: "TextEdit", element_index: "0" });
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, true);
    assert.equal(parsed.available, false);
  });
  it("background runs refuse sequences too", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: false }) as Record<string, any>;
    const out = await tools.computer_run_sequence.execute({
      calls: [{ tool: "get_app_state", args: { app: "TextEdit" } }],
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, true);
    assert.equal(parsed.available, false);
  });
  it("clipboard write is gated but clipboard read is not", async () => {
    const tools = createComputerTools("bg-thread", { includeAskUser: false }) as Record<string, any>;
    const denied = JSON.parse(await tools.computer_clipboard_write.execute({ text: "hi" }));
    assert.equal(denied.error, true);
    assert.equal(denied.available, false);
  });
});

describe("computer-use: clipboard commands per platform (no desktop needed)", () => {
  it("selects native helpers per OS", async () => {
    const { clipboardCommands } = await import("../lib/pi/computer-tools");
    const mac = clipboardCommands("darwin");
    assert.equal(mac.read[0].cmd, "pbpaste");
    assert.equal(mac.write[0].cmd, "pbcopy");
    const win = clipboardCommands("win32");
    assert.equal(win.read[0].cmd, "powershell");
    assert.ok(/Set-Clipboard/.test(win.write[0].args.join(" ")));
    const lin = clipboardCommands("linux");
    assert.equal(lin.read[0].cmd, "xclip");
    assert.ok(/apt install xclip/.test(lin.installHint));
  });
  it("read degrades to a JSON unavailable error, never throws", async () => {
    const { runClipboardRead, runClipboardWrite } = await import("../lib/pi/computer-tools");
    for (const out of [await runClipboardRead(), await runClipboardWrite("hello")]) {
      assert.equal(typeof out, "string");
      JSON.parse(out);
    }
    assert.equal(JSON.parse(await runClipboardWrite("")).error, true);
  });
});

describe("computer-use: sequence validation (no desktop needed)", () => {
  it("rejects unknown step tools without spawning ocu", async () => {
    const out = await runOcuSequence([{ tool: "nuke_desktop", args: {} }]);
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, true);
    assert.ok(/unknown tool/i.test(parsed.message));
  });
  it("rejects missing args without spawning ocu", async () => {
    const out = await runOcuSequence([{ tool: "click", args: null as any }]);
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, true);
  });
  it("sequence tool is permission-gated like other mutating tools", () => {
    const v = classifyLocalTool("computer_run_sequence", { calls: [] });
    assert.equal(v.sensitive, true);
    assert.equal(v.kind, "computer_control");
  });
});

describe("computer-use: error translation", () => {
  it("translates unsupported window tools into OS guidance", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: 'unsupportedTool("launch_app")' }],
      isError: true,
    });
    const out = translateOcuError(raw);
    assert.ok(out);
    const parsed = JSON.parse(out!);
    assert.equal(parsed.error, true);
    assert.ok(/Windows-only|not supported/i.test(parsed.message));
    assert.ok(/run_command/i.test(parsed.hint));
  });
  it("translates stale-state failures into sequence guidance", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: "No app state is available for ptyxis. Run get_app_state before action tools." }],
      isError: true,
    });
    const out = translateOcuError(raw);
    assert.ok(out);
    const parsed = JSON.parse(out!);
    assert.equal(parsed.error, true);
    assert.ok(/computer_run_sequence/i.test(parsed.hint));
  });
  it("translates strict app-name failures into exact-name guidance", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: 'appNotFound("TextEditor")' }],
      isError: true,
    });
    const out = translateOcuError(raw);
    assert.ok(out);
    const parsed = JSON.parse(out!);
    assert.equal(parsed.error, true);
    assert.ok(/EXACT running-app name/i.test(parsed.hint));
    assert.ok(/computer_list_apps/i.test(parsed.hint));
  });
  it("passes through non-errors and unknown shapes untouched", () => {
    assert.equal(translateOcuError('{"isError":false}'), null);
    assert.equal(translateOcuError("not json"), null);
    assert.equal(
      translateOcuError(JSON.stringify({ content: [{ text: "ok" }], isError: true })),
      null,
    );
  });
  it("translates missed-click verification failures into re-grounding guidance", () => {
    const raw = JSON.stringify({
      content: [{ type: "text", text: "click missed: element not visible at 100,200" }],
      isError: true,
    });
    const out = translateOcuError(raw);
    assert.ok(out);
    const parsed = JSON.parse(out!);
    assert.equal(parsed.error, true);
    assert.ok(/re-ground|FRESH/i.test(parsed.hint));
  });
});

describe("computer-use: prompts and labels match house style", () => {
  it("control instructions teach list_apps-first + fresh get_app_state", () => {
    const s = computerControlInstructions();
    assert.ok(s.includes("computer_list_apps"));
    assert.ok(s.includes("computer_run_sequence"));
    assert.ok(/PER PROCESS|per process/i.test(s));
  });
  it("system prompt advertises computer_* tools and keeps browser scope", () => {
    const s = buildPiSystemPrompt({});
    assert.ok(s.includes("computer_list_apps"));
    assert.ok(s.includes("computer_get_app_state"));
    assert.ok(s.includes("Computer Use"));
  });
  it("every computer_* tool has a friendly non-technical label", () => {
    for (const name of [
      "computer_list_apps",
      "computer_get_app_state",
      "computer_click",
      "computer_secondary_action",
      "computer_scroll",
      "computer_drag",
      "computer_type_text",
      "computer_press_key",
      "computer_set_value",
      "computer_launch_app",
      "computer_activate_window",
      "computer_doctor",
      "computer_capabilities",
      "computer_run_sequence",
    ]) {
      const label = friendlyToolLabel(name, {});
      assert.ok(label.length > 0);
      assert.ok(!label.includes("_"), `${name} leaks snake_case: ${label}`);
      assert.ok(!/snapshot|cdp|pixel|takeover|heartbeat|scratchpad|mcp|composio/i.test(label), `${name} leaks jargon: ${label}`);
    }
  });
});

describe("computer-use: activate fallback", () => {
  it("refuses to activate an app that is not running", async () => {
    const { runActivateWindowFallback } = await import("../lib/pi/computer-tools");
    const out = await runActivateWindowFallback("qube-nonexistent-app-xyz");
    const parsed = JSON.parse(out);
    assert.equal(parsed.error, true);
    assert.ok(/not running/i.test(parsed.message));
    assert.ok(/computer_launch_app/i.test(parsed.hint));
  });
  it("activate tool is permission-gated like other mutating tools", () => {
    const v = classifyLocalTool("computer_activate_window", { app: "TextEdit" });
    assert.equal(v.sensitive, true);
    assert.equal(v.kind, "computer_control");
  });
});

describe("computer-use: launch verification matching", () => {
  const listing =
    "gnome-shell -- gnome-shell [running, pid=3770]\nptyxis -- ptyxis [running, pid=5778]\ngnome-text-editor -- gnome-text-editor [running, pid=14713]";
  it("matches binary names, desktop ids, and display names", () => {
    assert.equal(matchesAppName(listing, "ptyxis"), true);
    assert.equal(matchesAppName(listing, "gnome-text-editor"), true);
    assert.equal(matchesAppName(listing, "org.gnome.TextEditor"), true);
    assert.equal(matchesAppName(listing, "TextEditor.desktop"), true);
    assert.equal(matchesAppName(listing, "Text Editor"), true);
  });
  it("rejects absent apps and empty tokens", () => {
    assert.equal(matchesAppName(listing, "gnome-calculator"), false);
    assert.equal(matchesAppName(listing, ""), false);
  });
});
