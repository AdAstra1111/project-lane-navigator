/**
 * Ladder Promotion Invariant Guard — Regression Tests
 *
 * Covers: forward progression, end-of-ladder, unknown stages,
 * duplicate rejection, self-loop rejection, feature-film order assertion.
 */
import { describe, it, expect, vi } from 'vitest';
import LADDERS_JSON from '../../supabase/_shared/stage-ladders.json';

// We mirror the guard logic here for FE testability (same contract as BE _shared/ladder-invariant.ts)
// In production BE, the functions are imported from _shared/ladder-invariant.ts

function assertValidLadder(ladder: string[], context: { format: string; source: string }) {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    throw new Error(`[ladder-invariant] missing_or_empty_ladder format=${context.format} source=${context.source}`);
  }
  const seen = new Set<string>();
  for (const stage of ladder) {
    if (!stage || typeof stage !== 'string') {
      throw new Error(`[ladder-invariant] invalid_stage_value format=${context.format} source=${context.source} stage=${String(stage)}`);
    }
    if (seen.has(stage)) {
      throw new Error(`[ladder-invariant] duplicate_stage format=${context.format} source=${context.source} stage=${stage}`);
    }
    seen.add(stage);
  }
}

function getCanonicalNextStage(params: {
  ladder: string[];
  currentStage: string;
  format: string;
  source: string;
}): string | null {
  const { ladder, currentStage, format, source } = params;
  assertValidLadder(ladder, { format, source });
  const idx = ladder.indexOf(currentStage);
  if (idx === -1) return null;
  if (idx >= ladder.length - 1) return null;
  const nextStage = ladder[idx + 1];
  if (!nextStage) throw new Error(`[ladder-invariant] missing_next_stage`);
  if (nextStage === currentStage) throw new Error(`[ladder-invariant] self_loop`);
  const nextIdx = ladder.indexOf(nextStage);
  if (nextIdx <= idx) throw new Error(`[ladder-invariant] non_forward_progression`);
  return nextStage;
}

function assertFeatureFilmOrder(ladder: string[]) {
  const stages = ['treatment', 'story_outline', 'character_bible', 'beat_sheet', 'feature_script', 'production_draft'] as const;
  const indices = stages.map(s => {
    const idx = ladder.indexOf(s);
    if (idx === -1) throw new Error(`[ladder-invariant] feature-film ladder missing stage: ${s}`);
    return idx;
  });
  for (let i = 0; i < indices.length - 1; i++) {
    if (!(indices[i] < indices[i + 1])) {
      throw new Error(`[ladder-invariant] feature-film order invalid: ${stages[i]} must precede ${stages[i + 1]}`);
    }
  }
}

const FILM_LADDER: string[] = LADDERS_JSON.FORMAT_LADDERS['film'] as string[];
const FEATURE_LADDER: string[] = LADDERS_JSON.FORMAT_LADDERS['feature'] as string[];

describe('Ladder invariant guard — core logic', () => {
  // ── 1. Valid forward progression ──
  it('treatment → story_outline', () => {
    expect(getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'treatment', format: 'film', source: 'test' }))
      .toBe('story_outline');
  });

  it('story_outline → character_bible', () => {
    expect(getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'story_outline', format: 'film', source: 'test' }))
      .toBe('character_bible');
  });

  it('concept_brief → treatment', () => {
    expect(getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'concept_brief', format: 'film', source: 'test' }))
      .toBe('treatment');
  });

  // ── 2. End-of-ladder handling ──
  it('production_draft → null (end of ladder)', () => {
    expect(getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'production_draft', format: 'film', source: 'test' }))
      .toBeNull();
  });

  // ── 3. Unknown stage handling ──
  it('not_a_real_stage → null (no fallback to idea)', () => {
    const result = getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'not_a_real_stage', format: 'film', source: 'test' });
    expect(result).toBeNull();
  });

  it('blueprint (raw alias, not in ladder) → null', () => {
    const result = getCanonicalNextStage({ ladder: FILM_LADDER, currentStage: 'blueprint', format: 'film', source: 'test' });
    expect(result).toBeNull();
  });

  // ── 4. Duplicate ladder rejection ──
  it('throws on duplicate entries in ladder', () => {
    const bad = ['idea', 'concept_brief', 'concept_brief', 'treatment'];
    expect(() => getCanonicalNextStage({ ladder: bad, currentStage: 'idea', format: 'film', source: 'test' }))
      .toThrow('duplicate_stage');
  });

  // ── 5. Self-loop rejection ──
  it('throws on synthetic self-loop ladder', () => {
    // Construct a ladder where idx+1 equals current — impossible with unique entries,
    // but assertValidLadder catches duplicates first. Test assertValidLadder directly.
    expect(() => assertValidLadder(['idea', 'idea'], { format: 'film', source: 'test' }))
      .toThrow('duplicate_stage');
  });

  // ── 6. Empty ladder rejection ──
  it('throws on empty ladder', () => {
    expect(() => getCanonicalNextStage({ ladder: [], currentStage: 'idea', format: 'film', source: 'test' }))
      .toThrow('missing_or_empty_ladder');
  });

  // ── 7. Invalid stage value rejection ──
  it('throws on null/empty stage value in ladder', () => {
    expect(() => assertValidLadder(['idea', '', 'treatment'], { format: 'film', source: 'test' }))
      .toThrow('invalid_stage_value');
  });
});

describe('Feature-film order assertion', () => {
  it('canonical film ladder passes order assertion', () => {
    expect(() => assertFeatureFilmOrder(FILM_LADDER)).not.toThrow();
  });

  it('canonical feature ladder passes order assertion', () => {
    expect(() => assertFeatureFilmOrder(FEATURE_LADDER)).not.toThrow();
  });

  it('inverted treatment/story_outline fails order assertion', () => {
    const inverted = ['idea', 'concept_brief', 'story_outline', 'treatment', 'character_bible', 'beat_sheet', 'feature_script', 'production_draft'];
    expect(() => assertFeatureFilmOrder(inverted))
      .toThrow('treatment must precede story_outline');
  });

  it('missing treatment fails order assertion', () => {
    const missing = ['idea', 'concept_brief', 'story_outline', 'character_bible', 'beat_sheet', 'feature_script', 'production_draft'];
    expect(() => assertFeatureFilmOrder(missing))
      .toThrow('missing stage: treatment');
  });

  it('inverted beat_sheet/feature_script fails order assertion', () => {
    const inverted = ['idea', 'concept_brief', 'treatment', 'story_outline', 'character_bible', 'feature_script', 'beat_sheet', 'production_draft'];
    expect(() => assertFeatureFilmOrder(inverted))
      .toThrow('beat_sheet');
  });
});

describe('All FORMAT_LADDERS pass invariant guard', () => {
  const FORMAT_LADDERS = LADDERS_JSON.FORMAT_LADDERS as Record<string, string[]>;

  for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
    it(`${fmt} ladder passes assertValidLadder`, () => {
      expect(() => assertValidLadder(ladder, { format: fmt, source: 'test' })).not.toThrow();
    });

    it(`${fmt} ladder: every stage has a deterministic next (except terminal)`, () => {
      for (let i = 0; i < ladder.length - 1; i++) {
        const next = getCanonicalNextStage({ ladder, currentStage: ladder[i], format: fmt, source: 'test' });
        expect(next).toBe(ladder[i + 1]);
      }
    });

    it(`${fmt} ladder: terminal stage returns null`, () => {
      const terminal = ladder[ladder.length - 1];
      expect(getCanonicalNextStage({ ladder, currentStage: terminal, format: fmt, source: 'test' })).toBeNull();
    });
  }
});
