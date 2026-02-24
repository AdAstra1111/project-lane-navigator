/**
 * Deterministic warning deduplication utility.
 * Normalizes by trim + whitespace collapse + lowercase for key,
 * preserves first occurrence (stable).
 */
export function dedupeWarningsStable(warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const w of warnings) {
    if (typeof w !== "string") continue;

    const key = w.trim().replace(/\s+/g, " ").toLowerCase();
    if (!key) continue;

    if (!seen.has(key)) {
      seen.add(key);
      out.push(w.trim().replace(/\s+/g, " "));
    }
  }

  return out;
}
