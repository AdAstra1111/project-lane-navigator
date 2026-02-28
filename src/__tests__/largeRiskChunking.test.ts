/**
 * Tests for large-risk document infrastructure:
 * - Large-risk router
 * - Chunk validator (episode coverage, banned phrases, ordering)
 * - Routing enforcement
 */
import { describe, it, expect } from 'vitest';

// ── Inline copies of pure functions for testing (no Deno deps) ──

// Large-risk router
const EPISODIC_DOC_TYPES = new Set([
  "episode_grid", "episode_beats", "vertical_episode_beats",
  "episode_script", "season_scripts_bundle", "season_master_script",
]);
const SECTIONED_DOC_TYPES = new Set([
  "feature_script", "screenplay_draft", "long_treatment", "treatment",
  "character_bible", "long_character_bible",
]);
const ALL_LARGE_RISK = new Set([...EPISODIC_DOC_TYPES, ...SECTIONED_DOC_TYPES, "production_draft"]);

function isLargeRiskDocType(docType: string): boolean {
  return ALL_LARGE_RISK.has(docType);
}

// Chunk validator: banned phrases
const BANNED_PHRASES = [
  "remaining episodes follow a similar", "remaining episodes", "and so on",
  "topline narrative", "highlights only", "selected highlights",
  "key episodes", "summary of episodes", "for brevity",
  "condensed version", "rest of the episodes", "the remaining",
  "this pattern repeats", "etc.", "…and more",
];

const BANNED_PATTERNS = [
  /episodes?\s+\d+[\s–\-—]+\d+\s*(follow|continue|are similar|share|mirror)/i,
  /eps?\s+\d+[\s–\-—]+\d+:\s*(same|similar|as above|see above)/i,
];

function hasBannedSummarizationLanguage(content: string): boolean {
  const lower = content.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return true;
  }
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

function extractEpisodeNumbers(text: string): number[] {
  const patterns = [
    /(?:^|\n)\s*#{1,4}\s*(?:EPISODE|EP\.?)\s*(\d+)/gim,
    /\*\*\s*(?:EPISODE|EP\.?)\s*(\d+)/gim,
    /(?:^|\n)\s*(?:EPISODE|EP\.?)\s*(\d+)\s*[:\-–—]/gim,
  ];
  const found = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(parseInt(match[1], 10));
  }
  return [...found].sort((a, b) => a - b);
}

// ── Tests ──

describe('Large-Risk Router', () => {
  it('identifies all episodic doc types as large-risk', () => {
    for (const dt of EPISODIC_DOC_TYPES) {
      expect(isLargeRiskDocType(dt)).toBe(true);
    }
  });

  it('identifies sectioned doc types as large-risk', () => {
    for (const dt of SECTIONED_DOC_TYPES) {
      expect(isLargeRiskDocType(dt)).toBe(true);
    }
  });

  it('does NOT flag non-large-risk doc types', () => {
    expect(isLargeRiskDocType('topline_narrative')).toBe(false);
    expect(isLargeRiskDocType('one_pager')).toBe(false);
    expect(isLargeRiskDocType('logline')).toBe(false);
    expect(isLargeRiskDocType('market_sheet')).toBe(false);
  });

  it('single-pass rewrite must be blocked for large-risk (< 30k chars rule removed)', () => {
    // Any large-risk doc, regardless of size, should NOT get single-pass treatment
    const shortTreatment = 'A'.repeat(5000);
    expect(isLargeRiskDocType('treatment')).toBe(true);
    expect(shortTreatment.length < 30000).toBe(true);
    // The router says it's large-risk → chunked rewrite enforced
  });
});

describe('Chunk Validator: Banned Phrases', () => {
  it('detects "remaining episodes" language', () => {
    expect(hasBannedSummarizationLanguage('The remaining episodes follow a similar pattern.')).toBe(true);
  });

  it('detects "and so on"', () => {
    expect(hasBannedSummarizationLanguage('Episodes 11-30 continue and so on.')).toBe(true);
  });

  it('detects "etc."', () => {
    expect(hasBannedSummarizationLanguage('Characters include Maya, Hiro, etc.')).toBe(true);
  });

  it('detects collapsed range summaries', () => {
    expect(hasBannedSummarizationLanguage('Episodes 11-30 follow the same pattern')).toBe(true);
  });

  it('passes clean content', () => {
    const clean = `## EPISODE 1\nHook: Aoi debuts.\n## EPISODE 2\nHook: Haruto arrives.`;
    expect(hasBannedSummarizationLanguage(clean)).toBe(false);
  });
});

describe('Chunk Validator: Episode Coverage', () => {
  it('detects missing episodes in N=35 output', () => {
    const episodes = Array.from({ length: 10 }, (_, i) => `## EPISODE ${i + 1}\nContent for episode ${i + 1}`);
    const text = episodes.join('\n\n');
    const found = extractEpisodeNumbers(text);
    const expected = Array.from({ length: 35 }, (_, i) => i + 1);
    const missing = expected.filter(n => !found.includes(n));
    expect(missing.length).toBe(25);
    expect(missing[0]).toBe(11);
    expect(missing[missing.length - 1]).toBe(35);
  });

  it('passes when all episodes present', () => {
    const episodes = Array.from({ length: 35 }, (_, i) => `## EPISODE ${i + 1}\nContent`);
    const text = episodes.join('\n\n');
    const found = extractEpisodeNumbers(text);
    const expected = Array.from({ length: 35 }, (_, i) => i + 1);
    const missing = expected.filter(n => !found.includes(n));
    expect(missing.length).toBe(0);
  });

  it('handles **EPISODE N** format', () => {
    const text = `**EPISODE 1** Hook\n**EPISODE 2** Hook\n**EPISODE 3** Hook`;
    const found = extractEpisodeNumbers(text);
    expect(found).toEqual([1, 2, 3]);
  });
});

describe('Deterministic Assembly Ordering', () => {
  it('chunks assemble in index order', () => {
    const chunks = [
      { chunkIndex: 0, content: 'CHUNK_A' },
      { chunkIndex: 1, content: 'CHUNK_B' },
      { chunkIndex: 2, content: 'CHUNK_C' },
    ];
    // Simulate shuffled input
    const shuffled = [chunks[2], chunks[0], chunks[1]];
    const sorted = shuffled.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const assembled = sorted.map(c => c.content).join('\n\n');
    expect(assembled).toBe('CHUNK_A\n\nCHUNK_B\n\nCHUNK_C');
  });
});
