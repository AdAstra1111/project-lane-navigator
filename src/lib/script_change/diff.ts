/**
 * diff — deterministic line-based diff for screenplay text.
 * No external dependencies. Produces hunks with stats.
 */

export interface DiffHunk {
  op: 'replace' | 'insert' | 'delete';
  old_start: number;
  old_end: number;
  new_start: number;
  new_end: number;
  old_preview: string;
  new_preview: string;
}

export interface DiffStats {
  old_len: number;
  new_len: number;
  added: number;
  removed: number;
  change_pct: number;
  hunks: number;
}

export interface DiffResult {
  stats: DiffStats;
  hunks: DiffHunk[];
}

/**
 * Compute line-based diff hunks between old and new text.
 * Uses a simple LCS-free approach: split into lines, find common prefix/suffix,
 * then mark the middle as a single replace hunk. For small changes this is
 * sufficient and fully deterministic.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping prefix)
  let suffixLen = 0;
  while (
    suffixLen < (oldLines.length - prefixLen) &&
    suffixLen < (newLines.length - prefixLen) &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldDiffStart = prefixLen;
  const oldDiffEnd = oldLines.length - suffixLen;
  const newDiffStart = prefixLen;
  const newDiffEnd = newLines.length - suffixLen;

  const removedLines = oldLines.slice(oldDiffStart, oldDiffEnd);
  const addedLines = newLines.slice(newDiffStart, newDiffEnd);

  const hunks: DiffHunk[] = [];

  if (removedLines.length > 0 || addedLines.length > 0) {
    const op: DiffHunk['op'] =
      removedLines.length === 0 ? 'insert' :
      addedLines.length === 0 ? 'delete' : 'replace';

    hunks.push({
      op,
      old_start: oldDiffStart,
      old_end: oldDiffEnd,
      new_start: newDiffStart,
      new_end: newDiffEnd,
      old_preview: removedLines.slice(0, 5).join('\n').slice(0, 200),
      new_preview: addedLines.slice(0, 5).join('\n').slice(0, 200),
    });
  }

  const added = addedLines.join('\n').length;
  const removed = removedLines.join('\n').length;
  const maxLen = Math.max(oldText.length, 1);

  return {
    stats: {
      old_len: oldText.length,
      new_len: newText.length,
      added,
      removed,
      change_pct: Math.round(((added + removed) / (maxLen * 2)) * 10000) / 100,
      hunks: hunks.length,
    },
    hunks,
  };
}

/**
 * Map diff hunks to scene ordinals based on line offsets.
 */
export function mapHunksToScenes(
  hunks: DiffHunk[],
  scenes: Array<{ ordinal: number; start: number; end: number }>,
  lines: string[],
): number[] {
  const changedOrdinals = new Set<number>();

  // Build line→char offset map
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (const hunk of hunks) {
    const hunkCharStart = lineOffsets[hunk.old_start] ?? 0;
    const hunkCharEnd = lineOffsets[Math.min(hunk.old_end, lineOffsets.length - 1)] ?? offset;

    for (const scene of scenes) {
      if (hunkCharEnd > scene.start && hunkCharStart < scene.end) {
        changedOrdinals.add(scene.ordinal);
      }
    }
  }

  return [...changedOrdinals].sort((a, b) => a - b);
}
