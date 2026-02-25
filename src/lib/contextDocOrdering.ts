/**
 * contextDocOrdering — Deterministic reordering of fetched documents
 * to match the caller-specified includeDocumentIds order.
 *
 * Shared between frontend and edge functions (drift-locked).
 */

/**
 * reorderByIncludeIds — Given an array of objects with an `id` field and
 * the original includeDocumentIds order, return the objects sorted to match
 * the includeDocumentIds order. Items not in includeDocumentIds are appended
 * at the end sorted by id asc for determinism. Items in includeDocumentIds
 * but missing from the fetched array are silently skipped.
 */
export function reorderByIncludeIds<T extends { id: string }>(
  items: T[],
  includeDocumentIds: string[],
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }

  const ordered: T[] = [];
  const seen = new Set<string>();

  // First: items in includeDocumentIds order
  for (const id of includeDocumentIds) {
    const item = map.get(id);
    if (item) {
      ordered.push(item);
      seen.add(id);
    }
  }

  // Then: any remaining items not in includeDocumentIds, sorted by id asc
  const remaining = items
    .filter(i => !seen.has(i.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.push(...remaining);

  return ordered;
}
