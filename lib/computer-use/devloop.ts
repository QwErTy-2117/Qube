import { spawn, type ChildProcess } from "node:child_process";

export interface DevServer {
  pid: number;
  url: string;
  log: string[];
  proc: ChildProcess;
}

const servers = new Map<string, DevServer>();

function keyFor(cwd: string, command: string): string {
  return `${cwd}\n${command}`;
}

/** Wait until GET url responds (any status < 500) or timeout. */
export async function waitForHttp(url: string, timeoutMs = 30000): Promise<{ ok: boolean; status?: number; ms: number }> {
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      lastStatus = res.status;
      if (res.status < 500) return { ok: true, status: res.status, ms: Date.now() - t0 };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, status: lastStatus, ms: Date.now() - t0 };
}

/** Test-only: replace the spawn implementation (avoids real shells in CI). */
let spawnImpl: typeof spawn = spawn;
export function setSpawnForTests(fn: typeof spawn): void { spawnImpl = fn; }

/** Start a dev server once per (cwd, command); reuse the running one. */
export function startDevServer(cwd: string, command: string, url: string): DevServer {
  const key = keyFor(cwd, command);
  const existing = servers.get(key);
  if (existing && existing.proc.exitCode === null && !(existing.proc as any).killed) return existing;
  const proc = spawnImpl(command, { cwd, shell: true, detached: false, windowsHide: true });
  const srv: DevServer = { pid: proc.pid ?? -1, url, log: [], proc };
  const push = (chunk: unknown) => {
    const s = String(chunk ?? "");
    for (const line of s.split("\n")) {
      if (!line.trim()) continue;
      srv.log.push(line.slice(0, 500));
      if (srv.log.length > 200) srv.log.splice(0, srv.log.length - 200);
    }
  };
  try { proc.stdout?.on("data", push); } catch {}
  try { proc.stderr?.on("data", push); } catch {}
  try { proc.on("exit", () => { servers.delete(key); }); } catch {}
  servers.set(key, srv);
  return srv;
}

export function devServerLog(cwd: string, command: string, tail = 60): string[] {
  const srv = servers.get(keyFor(cwd, command));
  if (!srv) return [];
  return srv.log.slice(-Math.max(1, Math.min(tail, 200)));
}

export function stopDevServer(cwd: string, command: string): boolean {
  const srv = servers.get(keyFor(cwd, command));
  if (!srv) return false;
  try { srv.proc.kill(); } catch {}
  servers.delete(keyFor(cwd, command));
  return true;
}

export function listDevServers(): Array<{ pid: number; url: string; lines: number }> {
  return [...servers.values()].map((s) => ({ pid: s.pid, url: s.url, lines: s.log.length }));
}

/** Test-only: clear the registry (does not kill procs). */
export function resetDevServersForTests(): void {
  servers.clear();
}
