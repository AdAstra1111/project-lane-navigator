/**
 * Cinematic Style Lock — extract deterministic style anchors from attempt-0 output.
 */

const STOP = new Set([
  "the", "and", "with", "from", "that", "this", "then", "they", "them", "their",
  "have", "will", "been", "each", "into", "also", "more", "over", "some", "when",
  "what", "which", "about", "after", "before", "through", "between", "under",
  "around", "where", "while", "does", "should", "would", "could", "very",
]);

const GENERIC = new Set([
  "film", "story", "world", "life", "time", "people", "thing", "moment", "place",
  "scene", "shot", "camera",
]);

function gatherTexts(raw: unknown): string[] {
  const texts: string[] = [];
  if (!raw || typeof raw !== "object") return texts;
  const obj = raw as any;
  const items: any[] =
    obj.beats || obj.segments || obj.panels || obj.items || (Array.isArray(obj) ? obj : []);
  for (const item of items) {
    for (const k of ["text", "title", "description", "prompt", "composition", "action", "line", "emotional_intent"]) {
      const v = item?.[k];
      if (typeof v === "string" && v.length > 0) texts.push(v);
    }
  }
  return texts;
}

export function extractStyleAnchors(rawOutput: unknown): string[] {
  const texts = gatherTexts(rawOutput);
  if (texts.length === 0) return [];

  const freq = new Map<string, number>();
  const capSet = new Set<string>();
  const rep = new Map<string, string>(); // lower -> representative casing

  for (const t of texts) {
    const tokens = t.split(/[^a-zA-Z]+/).filter((w) => w.length >= 4);
    for (const tok of tokens) {
      const lower = tok.toLowerCase();
      if (STOP.has(lower) || GENERIC.has(lower)) continue;
      freq.set(lower, (freq.get(lower) || 0) + 1);
      const isCap = tok[0] === tok[0].toUpperCase() && tok !== tok.toUpperCase();
      if (isCap) {
        capSet.add(lower);
        rep.set(lower, tok); // capitalized form wins
      } else if (!rep.has(lower)) {
        rep.set(lower, tok); // first seen fallback
      }
    }
  }

  // Filter: remove all-lowercase freq==1 tokens (weak anchors)
  const entries = Array.from(freq.entries()).filter(
    ([w, count]) => capSet.has(w) || count > 1
  );

  // Sort: capitalized first, then by frequency desc, then alphabetical
  entries.sort((a, b) => {
    const aCap = capSet.has(a[0]) ? 0 : 1;
    const bCap = capSet.has(b[0]) ? 0 : 1;
    if (aCap !== bCap) return aCap - bCap;
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  return entries.slice(0, 8).map(([w]) => rep.get(w) || w);
}
