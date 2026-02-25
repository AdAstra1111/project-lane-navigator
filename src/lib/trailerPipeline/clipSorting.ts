/**
 * Clip Candidates — Deterministic sorting comparator
 * Canonical source for clip ordering used by ClipCandidatesStudio and tests.
 * Priority: selected first → technical_score desc → candidate_index asc → id asc (stable tie-breaker)
 */

export interface SortableClip {
  id?: string;
  selected?: boolean;
  technical_score?: number | null;
  candidate_index?: number | null;
}

/** Deterministic comparator for clip candidates within a beat. */
export function clipCandidateComparator(a: SortableClip, b: SortableClip): number {
  if (a.selected && !b.selected) return -1;
  if (!a.selected && b.selected) return 1;
  const scoreDiff = (b.technical_score ?? 0) - (a.technical_score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  const ciDiff = (a.candidate_index ?? 0) - (b.candidate_index ?? 0);
  if (ciDiff !== 0) return ciDiff;
  return (a.id || '').localeCompare(b.id || '');
}

/** Sort an array of clips using the canonical comparator (non-mutating). */
export function sortClips<T extends SortableClip>(clips: T[]): T[] {
  return [...clips].sort(clipCandidateComparator);
}
