/**
 * Canon Rebuild Executor Tests — verifies canonical execution path,
 * status honesty, result semantics, and stage tracking.
 */
import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  isRebuildSuccess,
  isRebuildPartial,
  getRebuildStatusSeverity,
  getRebuildStatusLabel,
  REBUILD_STAGES,
  type RebuildExecutionStatus,
  type RebuildStage,
} from '../canonRebuildExecutor';

describe('extractEntities', () => {
  it('extracts characters and locations from canon JSON', () => {
    const canon = {
      characters: [
        { name: 'Alice', description: 'Young woman' },
        { character_name: 'Bob' },
        'Charlie',
      ],
      locations: [
        { name: 'London' },
        'Paris',
      ],
    };
    const result = extractEntities(canon);
    expect(result.characters).toHaveLength(3);
    expect(result.characters[0].name).toBe('Alice');
    expect(result.characters[2].name).toBe('Charlie');
    expect(result.locations).toHaveLength(2);
    expect(result.locations[0].name).toBe('London');
    expect(result.locations[1].name).toBe('Paris');
  });

  it('handles null/empty canon', () => {
    expect(extractEntities(null)).toEqual({ characters: [], locations: [] });
    expect(extractEntities({})).toEqual({ characters: [], locations: [] });
  });

  it('filters out Unknown characters', () => {
    const canon = { characters: [{ name: 'Unknown' }, { name: 'Valid' }] };
    const result = extractEntities(canon);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe('Valid');
  });

  it('caps at 10 entities', () => {
    const canon = {
      characters: Array.from({ length: 15 }, (_, i) => ({ name: `Char${i}` })),
    };
    expect(extractEntities(canon).characters).toHaveLength(10);
  });
});

describe('execution status helpers', () => {
  it('isRebuildSuccess returns true for completed and no_op', () => {
    expect(isRebuildSuccess('completed')).toBe(true);
    expect(isRebuildSuccess('no_op')).toBe(true);
    expect(isRebuildSuccess('completed_with_unresolved')).toBe(false);
    expect(isRebuildSuccess('failed')).toBe(false);
  });

  it('isRebuildPartial returns true only for completed_with_unresolved', () => {
    expect(isRebuildPartial('completed_with_unresolved')).toBe(true);
    expect(isRebuildPartial('completed')).toBe(false);
  });

  it('getRebuildStatusSeverity maps correctly', () => {
    expect(getRebuildStatusSeverity('completed')).toBe('success');
    expect(getRebuildStatusSeverity('no_op')).toBe('neutral');
    expect(getRebuildStatusSeverity('completed_with_unresolved')).toBe('warning');
    expect(getRebuildStatusSeverity('failed')).toBe('error');
    expect(getRebuildStatusSeverity('pending')).toBe('neutral');
    expect(getRebuildStatusSeverity('running')).toBe('neutral');
  });

  it('getRebuildStatusLabel returns human-readable labels', () => {
    expect(getRebuildStatusLabel('completed')).toBe('Completed');
    expect(getRebuildStatusLabel('no_op')).toBe('No action needed');
    expect(getRebuildStatusLabel('completed_with_unresolved')).toBe('Completed (unresolved slots)');
    expect(getRebuildStatusLabel('failed')).toBe('Failed');
    expect(getRebuildStatusLabel('pending')).toBe('Pending');
    expect(getRebuildStatusLabel('running')).toBe('Running');
  });
});

describe('REBUILD_STAGES', () => {
  it('contains all canonical execution stages', () => {
    expect(REBUILD_STAGES).toContain('analysing_incumbents');
    expect(REBUILD_STAGES).toContain('resetting_canon');
    expect(REBUILD_STAGES).toContain('generating_images');
    expect(REBUILD_STAGES).toContain('scoring_candidates');
    expect(REBUILD_STAGES).toContain('evaluating_replacements');
    expect(REBUILD_STAGES).toContain('attaching_winners');
    expect(REBUILD_STAGES).toContain('building_lookbook');
    expect(REBUILD_STAGES).toContain('preparing_download');
  });

  it('has exactly 8 stages', () => {
    expect(REBUILD_STAGES).toHaveLength(8);
  });

  it('stages are ordered from start to end of pipeline', () => {
    const idx = (s: RebuildStage) => REBUILD_STAGES.indexOf(s);
    expect(idx('analysing_incumbents')).toBeLessThan(idx('generating_images'));
    expect(idx('generating_images')).toBeLessThan(idx('scoring_candidates'));
    expect(idx('scoring_candidates')).toBeLessThan(idx('attaching_winners'));
    expect(idx('attaching_winners')).toBeLessThan(idx('building_lookbook'));
    expect(idx('building_lookbook')).toBeLessThan(idx('preparing_download'));
  });
});
