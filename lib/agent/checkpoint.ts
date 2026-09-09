// Stub checkpoint — Pi harness manages session via provider messages + session-store; durable checkpoint not needed for Vercel path.
// Kept for backward compat (no-op). Pi uses in-memory activeRuns + session transcript persistence.
export type Checkpoint = any;
export async function saveCheckpoint(_args: any): Promise<any> { return { id: `chk_${Date.now()}` }; }
export async function loadCheckpoint(_threadId: string): Promise<any | null> { return null; }
export async function loadCheckpointHistory(_threadId: string): Promise<any[]> { return []; }
export async function buildResumePlan(_threadId: string): Promise<any> { return { shouldResume: false, reason: "", verificationNeeded: [], staleChecks: [] }; }
export function formatCheckpointForPrompt(_cp: any): string { return ""; }
export async function clearCheckpoint(_threadId: string): Promise<void> {}
export async function compactAndCheckpoint(_args: any): Promise<any> { return { compactedMessages: _args.messages }; }
