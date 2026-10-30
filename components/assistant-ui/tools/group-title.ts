/**
 * Finished (non-running) tool-group title. Pure — unit-tested in
 * tests/group-title.test.ts. Callers pass precomputed group facts; running
 * titles ("Exploring", live verbs) are decided in base.tsx and untouched.
 */
export function finishedGroupTitle(opts: {
  /** Friendly labels of visible (non-hidden) tool calls, in order. */
  labels: string[];
  /** Visible tool calls + reasoning parts (today's counting rule). */
  visibleCount: number;
  /** True when every visible tool call is connector-backed. */
  connectorOnly: boolean;
  /** Distinct connector apps used (icons already de-duped by app). */
  connectorAppCount: number;
  /** True when any connector icon renders (mixed groups). */
  hasConnectorIcons?: boolean;
}): string {
  const { labels, connectorOnly, connectorAppCount } = opts;
  if (connectorOnly && connectorAppCount > 0) {
    return `used ${connectorAppCount} ${connectorAppCount === 1 ? "app" : "apps"}`;
  }
  if (labels.length === 1) {
    return labels[0] || "Working on it";
  }
  if (opts.hasConnectorIcons) {
    return labels[labels.length - 1] || "Working on it";
  }
  if (labels.length === 0) return "Working on it";
  return `used ${opts.visibleCount} ${opts.visibleCount === 1 ? "tool" : "tools"}`;
}
