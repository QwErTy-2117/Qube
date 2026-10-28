/** Pending, failed or revoked authorizations must not count as connected. */
export function activeToolkitSlugs(accounts: Array<{
  status?: string | null;
  toolkit?: { slug?: string | null } | null;
  app?: string | null;
}>): Set<string> {
  const slugs = new Set<string>();
  for (const account of accounts) {
    if (account.status !== "ACTIVE") continue;
    const slug = account.toolkit?.slug || account.app?.toLowerCase();
    if (slug) slugs.add(slug);
  }
  return slugs;
}
