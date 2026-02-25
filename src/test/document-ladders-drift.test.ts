/**
 * Document Ladders — Drift Guard Tests
 *
 * Asserts that the frontend (src/config/documentLadders.ts) and backend
 * (supabase/functions/_shared/documentLadders.ts) mirrors are semantically
 * identical. If any value diverges, these tests fail.
 */
import { describe, it, expect } from 'vitest';

import {
  BASE_DOC_TYPES as FE_BASE,
  LANE_DOC_LADDERS as FE_LADDERS,
  DOC_LABEL_ALIASES as FE_ALIASES,
  DOC_LABEL_ALIASES_BY_LANE as FE_LANE_ALIASES,
  normalizeDocType as feNormalize,
  getLaneLadder as feGetLadder,
  isDocTypeAllowedInLane as feAllowed,
  formatToLane as feFormatToLane,
} from '@/config/documentLadders';

import {
  BASE_DOC_TYPES as BE_BASE,
  LANE_DOC_LADDERS as BE_LADDERS,
  DOC_LABEL_ALIASES as BE_ALIASES,
  DOC_LABEL_ALIASES_BY_LANE as BE_LANE_ALIASES,
  normalizeDocType as beNormalize,
  getLaneLadder as beGetLadder,
  isDocTypeAllowedInLane as beAllowed,
  formatToLane as beFormatToLane,
} from '../../supabase/functions/_shared/documentLadders';

/* ── A) Data parity ── */

describe('Document ladders drift guard', () => {
  it('BASE_DOC_TYPES keys match', () => {
    expect(Object.keys(FE_BASE).sort()).toEqual(Object.keys(BE_BASE).sort());
  });

  it('BASE_DOC_TYPES labels match', () => {
    for (const key of Object.keys(FE_BASE)) {
      expect(FE_BASE[key].label).toBe(BE_BASE[key].label);
    }
  });

  it('LANE_DOC_LADDERS keys match', () => {
    expect(Object.keys(FE_LADDERS).sort()).toEqual(Object.keys(BE_LADDERS).sort());
  });

  it('LANE_DOC_LADDERS values match', () => {
    for (const lane of Object.keys(FE_LADDERS)) {
      expect(FE_LADDERS[lane as keyof typeof FE_LADDERS]).toEqual(
        BE_LADDERS[lane as keyof typeof BE_LADDERS]
      );
    }
  });

  it('DOC_LABEL_ALIASES match', () => {
    expect(FE_ALIASES).toEqual(BE_ALIASES);
  });

  it('DOC_LABEL_ALIASES_BY_LANE match', () => {
    expect(FE_LANE_ALIASES).toEqual(BE_LANE_ALIASES);
  });

  it('blueprint and architecture are NOT in BASE_DOC_TYPES (they are aliases)', () => {
    expect(FE_BASE).not.toHaveProperty('blueprint');
    expect(FE_BASE).not.toHaveProperty('architecture');
    expect(BE_BASE).not.toHaveProperty('blueprint');
    expect(BE_BASE).not.toHaveProperty('architecture');
  });

  it('treatment and story_outline ARE in BASE_DOC_TYPES', () => {
    expect(FE_BASE).toHaveProperty('treatment');
    expect(FE_BASE).toHaveProperty('story_outline');
  });
});

/* ── B) Function parity (lane-aware) ── */

describe('Document ladders function parity', () => {
  const testInputs: [string, string | null][] = [
    ['Blueprint', null],
    ['architecture', null],
    ['SCRIPT', null],
    ['treatment', null],
    ['Series Bible', null],
    ['draft', null],
    ['concept_brief', null],
    ['unknown_thing', null],
    ['episode_beats', 'series'],
    ['episode_beats', 'vertical_drama'],
    ['Blueprint', 'feature_film'],
  ];

  for (const [input, lane] of testInputs) {
    it(`normalizeDocType("${input}", "${lane}") matches FE/BE`, () => {
      expect(feNormalize(input, lane)).toBe(beNormalize(input, lane));
    });
  }

  const lanes = ['feature_film', 'series', 'vertical_drama', 'documentary', 'animation', 'short', 'unspecified', null];

  for (const lane of lanes) {
    it(`getLaneLadder("${lane}") matches FE/BE`, () => {
      expect(feGetLadder(lane)).toEqual(beGetLadder(lane));
    });
  }

  const formats = ['film', 'tv-series', 'vertical-drama', 'documentary', 'animation', 'short', 'weird-format'];

  for (const fmt of formats) {
    it(`formatToLane("${fmt}") matches FE/BE`, () => {
      expect(feFormatToLane(fmt)).toBe(beFormatToLane(fmt));
    });
  }

  it('isDocTypeAllowedInLane matches FE/BE for sample cases', () => {
    const cases: [string | null, string][] = [
      ['feature_film', 'treatment'],
      ['feature_film', 'blueprint'],
      ['vertical_drama', 'format_rules'],
      ['documentary', 'feature_script'],
      ['series', 'treatment'],
    ];
    for (const [lane, dt] of cases) {
      expect(feAllowed(lane, dt)).toBe(beAllowed(lane, dt));
    }
  });
});
