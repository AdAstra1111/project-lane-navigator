import { describe, it, expect } from "vitest";

// We replicate the extractor logic here since edge function code can't be imported directly
// This tests the same algorithm that runs server-side

const KIND_MAP: Record<string, string> = {
  film: "film", movie: "film", feature: "film", "feature film": "film",
  series: "series", "tv series": "series", "tv show": "series", show: "series",
  "limited series": "series", miniseries: "series", "mini-series": "series",
  "k-drama": "series", kdrama: "series", "korean drama": "series",
  "j-drama": "series", drama: "series",
  "web series": "vertical", "short-form": "vertical", vertical: "vertical",
  "vertical drama": "vertical",
  documentary: "film", doc: "film", "doc series": "series",
  "documentary series": "series", anime: "series", "anime film": "film",
};

function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[""''`]/g, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/[—–-]\s*$/, "")
    .replace(/[.,;:!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferKind(tag: string): string {
  return KIND_MAP[tag.toLowerCase().trim()] || "unknown";
}

describe("Comp Title Extractor", () => {
  it("extracts markdown heading comps with kind tags", () => {
    const text = `
### Lost in Translation (Film)
Some description of why this is relevant.

### Crash Landing on You (K-Drama)
Another description.

### Normal People (Series)
`;
    const titles = extractFromText(text);
    expect(titles.length).toBeGreaterThanOrEqual(3);

    const lost = titles.find(t => t.normalized_title.includes("lost in translation"));
    expect(lost).toBeDefined();
    expect(lost!.kind).toBe("film");

    const crash = titles.find(t => t.normalized_title.includes("crash landing on you"));
    expect(crash).toBeDefined();
    expect(crash!.kind).toBe("series"); // K-Drama maps to series

    const normal = titles.find(t => t.normalized_title.includes("normal people"));
    expect(normal).toBeDefined();
    expect(normal!.kind).toBe("series");
  });

  it("extracts labeled comps", () => {
    const text = `Comparable: Fleabag (Series)\nReference: Parasite (Film)`;
    const titles = extractFromText(text);
    expect(titles.length).toBe(2);
    expect(titles[0].normalized_title).toBe("fleabag");
    expect(titles[1].normalized_title).toBe("parasite");
  });

  it("normalizes and deduplicates", () => {
    const text = `
### Lost in Translation (Film)
### "Lost in Translation" (Film)
`;
    const titles = extractFromText(text);
    expect(titles.length).toBe(1);
  });

  it("filters blocklisted terms", () => {
    const text = `### Episode\n### Scene\n### Draft`;
    const titles = extractFromText(text);
    expect(titles.length).toBe(0);
  });

  it("extracts inline 'like Title' patterns", () => {
    const text = `The tone is similar to Succession and reminiscent of The White Lotus.`;
    const titles = extractFromText(text);
    const succession = titles.find(t => t.normalized_title.includes("succession"));
    expect(succession).toBeDefined();
  });
});

// Simplified extractor mirroring the edge function logic
function extractFromText(text: string) {
  const HEADING_PATTERN = /^#{1,4}\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/;
  const BOLD_PATTERN = /^\*{1,2}(.+?)\*{1,2}(?:\s*\(([^)]+)\))?\s*$/;
  const LIST_PATTERN = /^(?:[-*•]|\d+[.)]\s)\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/;
  const LABELED_PATTERN = /^(?:Comparable|Comp|Reference|Similar to|See also|Ref)\s*[:—–-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/i;
  const INLINE_LIKE_PATTERN = /(?:like|such as|inspired by|similar to|reminiscent of|echoes of|in the vein of)\s+[""]?([A-Z][A-Za-z0-9\s':&!,.-]+?)[""]?\s*(?:\((\d{4})\)|\(([^)]+)\))?(?:[,;.]|\s+and\s|\s*$)/gi;

  const BLOCKLIST = new Set([
    "act", "scene", "episode", "chapter", "section", "part", "draft",
    "version", "revision", "note", "notes", "summary", "overview",
    "introduction", "conclusion", "appendix", "table of contents",
    "character", "characters", "setting", "plot", "theme", "themes",
    "genre", "tone", "audience", "budget", "schedule", "timeline",
    "the end", "fade in", "fade out", "cut to", "int", "ext",
    "comparable", "comparables", "reference", "references",
    "film", "series", "vertical", "drama", "treatment",
  ]);

  const seen = new Set<string>();
  const results: any[] = [];

  function add(raw: string, title: string, kindTag: string | undefined, confidence: number) {
    const normalized = normalizeTitle(title);
    if (normalized.length < 2 || BLOCKLIST.has(normalized) || /^\d+$/.test(normalized) || /^(the|a|an)\s*$/i.test(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({ raw_text: raw.trim(), title: title.trim(), normalized_title: normalized, kind: kindTag ? inferKind(kindTag) : "unknown", confidence });
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;
    let m = trimmed.match(HEADING_PATTERN);
    if (m) { add(trimmed, m[1].trim(), m[2], 0.9); continue; }
    m = trimmed.match(BOLD_PATTERN);
    if (m) { add(trimmed, m[1].trim(), m[2], 0.85); continue; }
    m = trimmed.match(LABELED_PATTERN);
    if (m) { add(trimmed, m[1].trim(), m[2], 0.9); continue; }
    m = trimmed.match(LIST_PATTERN);
    if (m && m[2]) { add(trimmed, m[1].trim(), m[2], 0.8); continue; }
  }

  INLINE_LIKE_PATTERN.lastIndex = 0;
  let im: RegExpExecArray | null;
  while ((im = INLINE_LIKE_PATTERN.exec(text)) !== null) {
    const title = im[1].trim();
    const yearOrKind = im[2] || im[3];
    const isYear = yearOrKind && /^\d{4}$/.test(yearOrKind);
    add(im[0].trim(), title, isYear ? undefined : yearOrKind, 0.7);
  }

  return results;
}
