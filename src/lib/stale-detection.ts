/**
 * Stale Detection Helper
 * 
 * Checks if a document version is stale relative to the current resolver hash.
 */

export interface DocVersionDependency {
  depends_on?: string[];
  depends_on_resolver_hash?: string | null;
}

/**
 * Returns true if the document version was generated with a different resolver hash
 * than the current one (meaning canonical qualifications have changed).
 */
export function isDocStale(
  docVersion: DocVersionDependency | null | undefined,
  currentResolverHash: string | null | undefined
): boolean {
  if (!docVersion) return false;
  if (!docVersion.depends_on_resolver_hash) return false; // no hash tracked = can't determine staleness
  if (!currentResolverHash) return false; // no current hash = can't compare
  return docVersion.depends_on_resolver_hash !== currentResolverHash;
}
