/**
 * defaultDeliverableForDocType — hardening & regression tests.
 *
 * Ensures every canonical ladder doc type has an explicit mapping,
 * and that the fallback cannot silently coerce one canonical type into another.
 */
import { describe, it, expect } from 'vitest';
import { defaultDeliverableForDocType } from '@/lib/dev-os-config';
import { BASE_DOC_TYPES, LANE_DOC_LADDERS } from '@/config/documentLadders';

/* ── Identity: canonical doc types must not silently fall through ── */

describe('defaultDeliverableForDocType identity', () => {
  it('idea resolves to idea (not concept_brief)', () => {
    expect(defaultDeliverableForDocType('idea')).toBe('idea');
  });

  it('concept_brief resolves to concept_brief', () => {
    expect(defaultDeliverableForDocType('concept_brief')).toBe('concept_brief');
  });

  it('treatment resolves to blueprint (intentional dev-engine mapping)', () => {
    expect(defaultDeliverableForDocType('treatment')).toBe('blueprint');
  });

  it('story_outline resolves to architecture (intentional dev-engine mapping)', () => {
    expect(defaultDeliverableForDocType('story_outline')).toBe('architecture');
  });

  it('character_bible resolves to character_bible', () => {
    expect(defaultDeliverableForDocType('character_bible')).toBe('character_bible');
  });

  it('beat_sheet resolves to beat_sheet', () => {
    expect(defaultDeliverableForDocType('beat_sheet')).toBe('beat_sheet');
  });

  it('episode_beats resolves to episode_beats', () => {
    expect(defaultDeliverableForDocType('episode_beats')).toBe('episode_beats');
  });

  it('feature_script resolves to feature_script', () => {
    expect(defaultDeliverableForDocType('feature_script')).toBe('feature_script');
  });

  it('episode_script resolves to episode_script', () => {
    expect(defaultDeliverableForDocType('episode_script')).toBe('episode_script');
  });

  it('season_script resolves to season_script', () => {
    expect(defaultDeliverableForDocType('season_script')).toBe('season_script');
  });

  it('production_draft resolves to production_draft', () => {
    expect(defaultDeliverableForDocType('production_draft')).toBe('production_draft');
  });

  it('documentary_outline resolves to documentary_outline', () => {
    expect(defaultDeliverableForDocType('documentary_outline')).toBe('documentary_outline');
  });

  it('format_rules resolves to format_rules', () => {
    expect(defaultDeliverableForDocType('format_rules')).toBe('format_rules');
  });

  it('season_arc resolves to season_arc', () => {
    expect(defaultDeliverableForDocType('season_arc')).toBe('season_arc');
  });

  it('episode_grid resolves to episode_grid', () => {
    expect(defaultDeliverableForDocType('episode_grid')).toBe('episode_grid');
  });

  it('vertical_episode_beats resolves to vertical_episode_beats', () => {
    expect(defaultDeliverableForDocType('vertical_episode_beats')).toBe('vertical_episode_beats');
  });

  it('season_master_script resolves to season_master_script', () => {
    expect(defaultDeliverableForDocType('season_master_script')).toBe('season_master_script');
  });
});

/* ── Ladder coverage: every stage in every lane ladder must be mapped ── */

describe('defaultDeliverableForDocType ladder coverage', () => {
  // Collect all unique doc types from all lane ladders
  const allLadderStages = new Set<string>();
  for (const [_lane, ladder] of Object.entries(LANE_DOC_LADDERS)) {
    for (const stage of ladder) {
      allLadderStages.add(stage);
    }
  }

  for (const stage of allLadderStages) {
    it(`ladder stage "${stage}" does not fall through to concept_brief`, () => {
      const result = defaultDeliverableForDocType(stage);
      // If it returns concept_brief, it should only be because the stage IS concept_brief
      if (stage !== 'concept_brief' && stage !== 'logline' && stage !== 'notes' && stage !== 'other') {
        expect(result).not.toBe('concept_brief');
      }
    });
  }
});

/* ── Fallback: unknown types still get concept_brief ── */

describe('defaultDeliverableForDocType fallback', () => {
  it('unknown type falls back to concept_brief', () => {
    expect(defaultDeliverableForDocType('totally_unknown_type')).toBe('concept_brief');
  });

  it('empty string falls back to concept_brief', () => {
    expect(defaultDeliverableForDocType('')).toBe('concept_brief');
  });
});
