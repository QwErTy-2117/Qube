// Stub observability — Pi harness handles tracing via console + task-log + stream events.
// Kept for backward compat with scheduler/old imports (no-op).
export function getExecutionId(): string { return `exec_${Date.now()}`; }
export async function logEvent(_event: any): Promise<void> {}
export async function logToolCall(..._args: any[]): Promise<void> {}
export async function logToolResult(..._args: any[]): Promise<void> {}
export async function logToolRetry(..._args: any[]): Promise<void> {}
export async function logCheckpoint(..._args: any[]): Promise<void> {}
export async function logRecovery(..._args: any[]): Promise<void> {}
export async function logStopReason(..._args: any[]): Promise<void> {}
export function queryObservability(_threadId: string): any[] { return []; }
export function getGlobalRecent(): any[] { return []; }
export function getStats(): any { return {}; }
