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
  normalizeDocType as feNormalize,
  getLaneLadder as feGetLadder,
  isDocTypeAllowedInLane as feAllowed,
  formatToLane as feFormatToLane,
} from '@/config/documentLadders';

import {
  BASE_DOC_TYPES as BE_BASE,
  LANE_DOC_LADDERS as BE_LADDERS,
  DOC_LABEL_ALIASES as BE_ALIASES,
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
});

/* ── B) Function parity ── */

describe('Document ladders function parity', () => {
  const testInputs = [
    'Blueprint', 'architecture', 'SCRIPT', 'treatment', 'Series Bible',
    'episode_beats', 'draft', 'concept_brief', 'unknown_thing',
  ];

  for (const input of testInputs) {
    it(`normalizeDocType("${input}") matches FE/BE`, () => {
      expect(feNormalize(input)).toBe(beNormalize(input));
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
      ['feature_film', 'blueprint'],
      ['vertical_drama', 'blueprint'],
      ['vertical_drama', 'format_rules'],
      ['documentary', 'feature_script'],
      ['series', 'treatment'],
    ];
    for (const [lane, dt] of cases) {
      expect(feAllowed(lane, dt)).toBe(beAllowed(lane, dt));
    }
  });
});
