/**
 * Clip Download — Filename builder and URL accessor
 * Canonical source used by ClipCandidatesStudio and tests.
 */

export interface DownloadableClip {
  beat_index?: number;
  candidate_index?: number | null;
  public_url?: string | null;
}

/** Build a deterministic download filename from clip metadata. */
export function buildClipFilename(clip: DownloadableClip): string {
  return `clip-beat${clip.beat_index ?? 0}-${clip.candidate_index || 1}.mp4`;
}

/** Return the persisted download URL (public_url), or null if unavailable. */
export function getDownloadUrl(clip: DownloadableClip): string | null {
  return clip.public_url ?? null;
}
