// ============================================================
// Fractional Indexing / LexoRank-like order key utilities
// ============================================================

const BASE = 36;
const DEFAULT_LENGTH = 6;

/** Generate a midpoint string between a and b (lexicographic). */
export function keyBetween(a: string | null, b: string | null): string {
  if (!a && !b) return padKey('n'); // midpoint of alphabet
  if (!a) return midpointBefore(b!);
  if (!b) return midpointAfter(a);
  return midpointBetween(a, b);
}

function padKey(s: string): string {
  return s.padEnd(DEFAULT_LENGTH, '0');
}

function midpointBefore(b: string): string {
  // Generate a key before b
  const bParsed = parseInt(b.replace(/[^0-9a-z]/gi, '') || 'n00000', BASE);
  const half = Math.max(1, Math.floor(bParsed / 2));
  const result = half.toString(BASE).padStart(DEFAULT_LENGTH, '0');
  if (result >= b) {
    // Edge case: prepend
    return '0'.repeat(DEFAULT_LENGTH);
  }
  return result;
}

function midpointAfter(a: string): string {
  const aParsed = parseInt(a.replace(/[^0-9a-z]/gi, '') || 'n00000', BASE);
  const max = Math.pow(BASE, DEFAULT_LENGTH) - 1;
  const mid = aParsed + Math.max(1, Math.floor((max - aParsed) / 2));
  const result = Math.min(mid, max).toString(BASE).padStart(DEFAULT_LENGTH, '0');
  if (result <= a) {
    // Extend length
    return a + padKey('n');
  }
  return result;
}

function midpointBetween(a: string, b: string): string {
  // Ensure same length
  const maxLen = Math.max(a.length, b.length);
  const aPad = a.padEnd(maxLen, '0');
  const bPad = b.padEnd(maxLen, '0');

  const aVal = parseInt(aPad, BASE);
  const bVal = parseInt(bPad, BASE);

  if (bVal - aVal <= 1) {
    // Need more precision — append midpoint
    return a + padKey('n');
  }

  const mid = aVal + Math.floor((bVal - aVal) / 2);
  return mid.toString(BASE).padStart(maxLen, '0');
}

/** Generate evenly spaced keys for count items. */
export function generateEvenKeys(count: number): string[] {
  const max = Math.pow(BASE, DEFAULT_LENGTH) - 1;
  const step = Math.floor(max / (count + 1));
  return Array.from({ length: count }, (_, i) =>
    ((i + 1) * step).toString(BASE).padStart(DEFAULT_LENGTH, '0')
  );
}
