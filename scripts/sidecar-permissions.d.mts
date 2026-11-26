export interface NormalizeResult {
  checked: number;
  changed: number;
  skipped: boolean;
}

export interface WorldReadabilityResult {
  checked: number;
  failures: string[];
  skipped: boolean;
}

export function normalizeSidecarPermissions(root: string): NormalizeResult;
export function assertWorldReadable(root: string): WorldReadabilityResult;
