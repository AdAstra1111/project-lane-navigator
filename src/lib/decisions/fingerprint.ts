/**
 * Note fingerprinting for persistent de-duplication.
 * Produces a stable hash from note content so the same issue
 * is recognised across analysis runs.
 */

function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple deterministic hash (djb2) — no crypto dependency needed client-side.
 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export interface FingerprintableNote {
  note_key?: string;
  id?: string;
  category?: string;
  severity?: string;
  description?: string;
  note?: string;
}

/**
 * Produce a stable fingerprint for a note.
 * Priority: note_key > id > category+description hash.
 */
export function noteFingerprint(note: FingerprintableNote): string {
  const key = note.note_key || note.id || '';
  const severity = note.severity || '';
  const desc = normalizeText(note.description || note.note || '');

  // If we have a stable key, use it directly with severity
  if (key) {
    return `${key}::${severity}::${djb2(desc)}`;
  }

  // Fallback: category + first 60 chars of description
  const cat = note.category || 'unknown';
  const short = desc.slice(0, 60);
  return `${cat}::${severity}::${djb2(short)}`;
}

/**
 * Server-side fingerprint using Deno crypto (for edge functions).
 * Falls back to djb2 if crypto unavailable.
 */
export async function noteFingerprintAsync(note: FingerprintableNote): Promise<string> {
  // Use the sync version — djb2 is sufficient for de-dupe
  return noteFingerprint(note);
}
