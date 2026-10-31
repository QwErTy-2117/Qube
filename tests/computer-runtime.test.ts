/**
 * Qube Computer runtime: persistence, confinement, explicit reset.
 *
 * These are the guarantees the old browser-use/computer-use bridge never
 * made: state survives restarts, nothing is wiped implicitly, commands and
 * files cannot leave the runtime, and only an explicit reset deletes
 * anything.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "qube-computer-"));
process.env.QUBE_DATA_DIR = dataDir;

const { ensureComputer, getComputerStatus, readActivity, resetComputer } = await import("@/lib/computer/session");
const { getComputerPaths } = await import("@/lib/computer/paths");
const {
  ComputerPathError,
  listComputerDir,
  readComputerFile,
  resolveRuntimePath,
  sanitizeFilename,
  stageAttachmentFromHost,
  writeComputerFile,
} = await import("@/lib/computer/files");
const { computerEnv, runInComputer, shellCommand } = await import("@/lib/computer/exec");
const { createComputerTools, COMPUTER_TOOL_NAMES } = await import("@/lib/computer/tools");

describe("Qube Computer lifecycle", () => {
  before(() => {
    ensureComputer();
  });

  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates a persistent layout inside the data dir", () => {
    const paths = getComputerPaths();
    assert.ok(paths.root.startsWith(dataDir));
    for (const dir of [paths.home, paths.attachments, paths.downloads, paths.browserProfile, paths.logs, paths.tmp]) {
      assert.ok(existsSync(dir), `${dir} should exist`);
    }
    const state = JSON.parse(readFileSync(paths.stateFile, "utf-8"));
    assert.equal(state.version, 1);
    assert.equal(typeof state.id, "string");
  });

  it("keeps the same session across a simulated restart", () => {
    const first = ensureComputer().session;
    writeComputerFileSync(getComputerPaths().home, "notes.txt", "hello");
    const second = ensureComputer().session;
    assert.equal(first.id, second.id);
    assert.equal(readFileSync(join(getComputerPaths().home, "notes.txt"), "utf-8"), "hello");
  });

  it("never wipes state on status reads", () => {
    const status = getComputerStatus();
    assert.equal(status.persistent, true);
    assert.ok(status.usage.files >= 1);
    assert.ok(existsSync(join(getComputerPaths().home, "notes.txt")));
  });

  it("resets only when asked, and rotates the session", async () => {
    const before = ensureComputer().session;
    writeComputerFileSync(getComputerPaths().home, "scratch.txt", "x");
    writeComputerFileSync(getComputerPaths().attachments, "kept.txt", "attachment");
    const result = await resetComputer();
    assert.notEqual(result.session.id, before.id);
    assert.equal(result.session.resets, before.resets + 1);
    assert.ok(!existsSync(join(getComputerPaths().home, "scratch.txt")));
    assert.ok(existsSync(join(getComputerPaths().attachments, "kept.txt")), "attachments survive by default");
    const activity = readActivity(20);
    assert.ok(activity.some((entry) => entry.kind === "reset"));
  });

  it("can drop attachments too when explicitly told", async () => {
    writeComputerFileSync(getComputerPaths().attachments, "temp.bin", "x");
    await resetComputer({ keepAttachments: false });
    assert.ok(!existsSync(join(getComputerPaths().attachments, "temp.bin")));
  });
});

function writeComputerFileSync(dir: string, name: string, content: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf-8");
}

describe("path confinement", () => {
  it("refuses traversal and absolute paths", async () => {
    await assert.rejects(() => resolveRuntimePath("../escape.txt"), ComputerPathError);
    await assert.rejects(() => resolveRuntimePath("a/../../escape.txt"), ComputerPathError);
    await assert.rejects(() => resolveRuntimePath("/etc/passwd"), ComputerPathError);
    const ok = await resolveRuntimePath("projects/app/index.ts");
    assert.ok(ok.startsWith(getComputerPaths().home));
  });

  it("blocks symlinks that point outside the runtime", async () => {
    const paths = getComputerPaths();
    const link = join(paths.home, "sneaky");
    try {
      symlinkSync(tmpdir(), link);
    } catch {
      return; // platform without symlink permissions
    }
    await assert.rejects(() => resolveRuntimePath("sneaky/x.txt"), ComputerPathError);
  });

  it("reads, writes and lists inside the home", async () => {
    await writeComputerFile("docs/readme.md", "# hi");
    const read = await readComputerFile("docs/readme.md");
    assert.equal(read.content, "# hi");
    assert.equal(read.binary, false);
    const entries = await listComputerDir("docs");
    assert.equal(entries[0]?.name, "readme.md");
  });

  it("rejects writes outside the home", async () => {
    await assert.rejects(() => writeComputerFile("../outside.txt", "nope"), ComputerPathError);
  });
});

describe("attachment staging", () => {
  const hostFile = join(dataDir, "host-source.txt");

  before(() => {
    writeFileSync(hostFile, "staged bytes", "utf-8");
  });

  it("stages a host file and returns an absolute path inside the computer", async () => {
    const staged = await stageAttachmentFromHost(hostFile);
    assert.ok(staged.path.startsWith(getComputerPaths().attachments));
    assert.equal(readFileSync(staged.path, "utf-8"), "staged bytes");
    assert.equal(staged.relativePath.startsWith("attachments/"), true);
  });

  it("dedupes repeated names instead of overwriting", async () => {
    const a = await stageAttachmentFromHost(hostFile, "report.txt");
    const b = await stageAttachmentFromHost(hostFile, "report.txt");
    assert.equal(a.name, "report.txt");
    assert.equal(b.name, "report (2).txt");
    assert.notEqual(a.path, b.path);
  });

  it("preserves unicode and neutralises traversal names", async () => {
    assert.equal(sanitizeFilename("relazione-àè-2026.txt"), "relazione-àè-2026.txt");
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFilename(".."), "attachment");
    assert.equal(sanitizeFilename("CON.txt"), "_CON.txt");
    assert.equal(sanitizeFilename("bad\u0000name.txt"), "badname.txt");
  });

  it("reports a missing host file instead of crashing", async () => {
    await assert.rejects(() => stageAttachmentFromHost(join(dataDir, "nope.txt")), /not found/i);
  });
});

describe("command execution", () => {
  it("uses a platform shell", () => {
    const { shell, args } = shellCommand("echo hi");
    assert.ok(shell.length > 0);
    assert.equal(args[args.length - 1], "echo hi");
  });

  it("strips credentials from the environment and confines HOME", () => {
    const env = computerEnv(getComputerPaths(), {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      GITHUB_TOKEN: "ghp_secret",
      MY_PASSWORD: "hunter2",
      QUBE_DATA_DIR: "/host/data",
      HARMLESS: "1",
    });
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.MY_PASSWORD, undefined);
    assert.equal(env.QUBE_DATA_DIR, undefined);
    assert.equal(env.HARMLESS, "1");
    assert.equal(env.HOME, getComputerPaths().home);
    assert.equal(env.TMPDIR, getComputerPaths().tmp);
  });

  it("runs a command inside the home and records it", async () => {
    if (process.platform === "win32") return;
    const result = await runInComputer({ command: "pwd && echo in-computer" });
    assert.equal(result.ok, true);
    assert.match(result.stdout, /in-computer/);
    assert.ok(result.cwd.endsWith(".computer/home"));
    assert.ok(readActivity(20).some((entry) => entry.summary.includes("echo in-computer")));
  });

  it("refuses a cwd outside the computer", async () => {
    await assert.rejects(() => runInComputer({ command: "echo hi", cwd: ".." }), ComputerPathError);
  });

  it("times out and reports it", async () => {
    if (process.platform === "win32") return;
    const result = await runInComputer({ command: "sleep 5", timeoutMs: 1000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.ok, false);
    assert.ok(result.durationMs < 5000);
  });
});

describe("computer tools", () => {
  it("registers the documented tool set", () => {
    const tools = createComputerTools();
    for (const name of COMPUTER_TOOL_NAMES) {
      assert.ok(tools[name], `${name} should be registered`);
    }
  });

  it("writes, reads and lists through the tool surface", async () => {
    const tools = createComputerTools();
    const written = JSON.parse(await tools.computer_write.execute({ path: "tool/file.txt", content: "tool bytes" }));
    assert.equal(written.ok, true);
    const read = JSON.parse(await tools.computer_read.execute({ path: "tool/file.txt" }));
    assert.equal(read.content, "tool bytes");
    const listed = JSON.parse(await tools.computer_list.execute({ path: "tool" }));
    assert.equal(listed.entries[0].name, "file.txt");
  });

  it("refuses an unapproved host path in a background run", async () => {
    const tools = createComputerTools(undefined);
    const result = JSON.parse(await tools.computer_import.execute({ path: "/definitely/not/allowed/file.txt" }));
    assert.equal(result.ok, false);
    assert.match(result.error, /approval|not found/i);
  });

  it("requires an explicit confirmation to reset", async () => {
    const tools = createComputerTools();
    const result = JSON.parse(await tools.computer_reset.execute({ confirm: true }));
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.removed));
  });
});
