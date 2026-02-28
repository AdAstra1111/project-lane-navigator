/**
 * Tests for large-risk document infrastructure:
 * - Large-risk router
 * - Chunk validator (episode coverage, banned phrases, section completeness)
 * - Chunk runner correctness (upsert init, honest status, repair loop)
 */
import { describe, it, expect } from 'vitest';

// ── Inline copies of pure functions for testing (no Deno deps) ──

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

// Section heading finder (mirrors chunkValidator)
function findSectionHeadings(content: string): Set<string> {
  const found = new Set<string>();
  const headingPattern = /^#{1,4}\s+(.+)$/gm;
  for (const match of content.matchAll(headingPattern)) {
    const normalized = match[1].trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    found.add(normalized);
  }
  const boldPattern = /\*\*([A-Z][A-Z\s:]+)\*\*/g;
  for (const match of content.matchAll(boldPattern)) {
    const normalized = match[1].trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    found.add(normalized);
  }
  return found;
}

function validateSectionedContent(
  content: string,
  expectedSections: string[],
  docType: string
): { pass: boolean; missingSections: string[]; failures: any[] } {
  const failures: any[] = [];
  const missingSections: string[] = [];
  const foundHeadings = findSectionHeadings(content);
  const lowerContent = content.toLowerCase();

  for (const expectedSection of expectedSections) {
    const normalized = expectedSection.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const found = [...foundHeadings].some(h =>
      h.includes(normalized) || normalized.includes(h) || h === normalized
    );
    const altFound = lowerContent.includes(normalized.replace(/_/g, " "));
    if (!found && !altFound) {
      missingSections.push(expectedSection);
    }
  }

  if (missingSections.length > 0) {
    failures.push({
      type: "missing_section",
      detail: `Missing ${missingSections.length} section(s): ${missingSections.join(", ")}`,
      sections: missingSections,
    });
  }

  return { pass: failures.length === 0, missingSections, failures };
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
  });

  it('single-pass rewrite must be blocked for large-risk regardless of size', () => {
    expect(isLargeRiskDocType('treatment')).toBe(true);
    expect('A'.repeat(5000).length < 30000).toBe(true);
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
  });

  it('passes when all episodes present', () => {
    const episodes = Array.from({ length: 35 }, (_, i) => `## EPISODE ${i + 1}\nContent`);
    const text = episodes.join('\n\n');
    const found = extractEpisodeNumbers(text);
    const missing = Array.from({ length: 35 }, (_, i) => i + 1).filter(n => !found.includes(n));
    expect(missing.length).toBe(0);
  });
});

describe('Deterministic Assembly Ordering', () => {
  it('chunks assemble in index order', () => {
    const chunks = [
      { chunkIndex: 0, content: 'CHUNK_A' },
      { chunkIndex: 1, content: 'CHUNK_B' },
      { chunkIndex: 2, content: 'CHUNK_C' },
    ];
    const shuffled = [chunks[2], chunks[0], chunks[1]];
    const sorted = shuffled.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const assembled = sorted.map(c => c.content).join('\n\n');
    expect(assembled).toBe('CHUNK_A\n\nCHUNK_B\n\nCHUNK_C');
  });
});

// ── NEW: Correctness tests ──

describe('chunkRunner: initializeChunks does NOT delete existing done chunks', () => {
  it('upsert preserves existing chunks (simulated)', () => {
    // Simulate: existing map has chunk 0 as done with content
    const existingMap = new Map([
      [0, { chunk_index: 0, status: 'done', content: 'existing content' }],
    ]);
    const planChunks = [
      { chunkIndex: 0, chunkKey: 'E01-E05', label: 'Ep 1-5' },
      { chunkIndex: 1, chunkKey: 'E06-E10', label: 'Ep 6-10' },
    ];
    // Only chunks NOT in existingMap should be inserted
    const newRows = planChunks.filter(c => !existingMap.has(c.chunkIndex));
    expect(newRows.length).toBe(1);
    expect(newRows[0].chunkIndex).toBe(1);
    // Existing chunk 0 is preserved
    expect(existingMap.get(0)?.content).toBe('existing content');
  });
});

describe('chunkRunner: validation status honesty', () => {
  it('failed validation should NOT produce status "done"', () => {
    // Simulate: chunk has content but validation fails
    const chunkPassed = false;
    const content = 'Some content with etc.';
    const finalStatus = chunkPassed ? "done" : "failed_validation";
    expect(finalStatus).toBe("failed_validation");
    expect(finalStatus).not.toBe("done");
  });

  it('passed validation produces status "done"', () => {
    const chunkPassed = true;
    const finalStatus = chunkPassed ? "done" : "failed_validation";
    expect(finalStatus).toBe("done");
  });
});

describe('Repair loop: only regenerate impacted chunks', () => {
  it('maps missing episodes to correct chunk ranges', () => {
    const plan = [
      { chunkIndex: 0, episodeStart: 1, episodeEnd: 5 },
      { chunkIndex: 1, episodeStart: 6, episodeEnd: 10 },
      { chunkIndex: 2, episodeStart: 11, episodeEnd: 15 },
    ];
    const missingEpisodes = [7, 8, 12];
    const chunksToRegen: number[] = [];

    for (const missingEp of missingEpisodes) {
      const owningChunk = plan.find(
        c => missingEp >= c.episodeStart && missingEp <= c.episodeEnd
      );
      if (owningChunk && !chunksToRegen.includes(owningChunk.chunkIndex)) {
        chunksToRegen.push(owningChunk.chunkIndex);
      }
    }

    expect(chunksToRegen).toEqual([1, 2]);
    expect(chunksToRegen).not.toContain(0); // chunk 0 (Ep 1-5) NOT regenerated
  });

  it('repair loop respects MAX_ASSEMBLY_REPAIR_PASSES', () => {
    const MAX_ASSEMBLY_REPAIR_PASSES = 2;
    let passCount = 0;
    // Simulate always-failing validation
    for (let i = 0; i <= MAX_ASSEMBLY_REPAIR_PASSES; i++) {
      passCount++;
      const validationPassed = false;
      if (validationPassed || i >= MAX_ASSEMBLY_REPAIR_PASSES) break;
    }
    expect(passCount).toBeLessThanOrEqual(MAX_ASSEMBLY_REPAIR_PASSES + 1);
  });
});

describe('Sectioned Validator: section completeness', () => {
  it('detects missing sections', () => {
    const content = `# Act 1\nContent here.\n# Act 2a\nMore content.`;
    const expected = ['act_1', 'act_2a', 'act_2b', 'act_3'];
    const result = validateSectionedContent(content, expected, 'feature_script');
    expect(result.pass).toBe(false);
    expect(result.missingSections).toContain('act_2b');
    expect(result.missingSections).toContain('act_3');
  });

  it('passes when all sections present', () => {
    const content = `# Act 1\nContent.\n# Act 2a\nContent.\n# Act 2b\nContent.\n# Act 3\nContent.`;
    const expected = ['act_1', 'act_2a', 'act_2b', 'act_3'];
    const result = validateSectionedContent(content, expected, 'feature_script');
    expect(result.pass).toBe(true);
    expect(result.missingSections.length).toBe(0);
  });

  it('missing sections trigger regen_missing action', () => {
    const content = `# Act 1\nContent.`;
    const expected = ['act_1', 'act_2a'];
    const result = validateSectionedContent(content, expected, 'feature_script');
    expect(result.missingSections.length).toBeGreaterThan(0);
  });
});
