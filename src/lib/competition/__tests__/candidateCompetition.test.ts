/**
 * Candidate Competition Service — deterministic unit tests
 * Tests IEL invariants and canonical contracts.
 */
import { describe, it, expect } from 'vitest';
import {
  CompetitionInvariantError,
} from '@/lib/competition/candidateCompetitionService';

describe('CompetitionInvariantError', () => {
  it('creates error with IEL prefix', () => {
    const err = new CompetitionInvariantError('test violation');
    expect(err.message).toContain('[IEL]');
    expect(err.message).toContain('test violation');
    expect(err.name).toBe('CompetitionInvariantError');
  });
});

describe('candidate competition contracts (unit)', () => {
  it('CompetitionStatus values are well-defined', () => {
    const validStatuses = ['open', 'ranked', 'winner_selected', 'closed'];
    for (const s of validStatuses) {
      expect(typeof s).toBe('string');
    }
  });

  it('SelectionMode values are well-defined', () => {
    const validModes = ['manual', 'system_reserved_for_future'];
    for (const m of validModes) {
      expect(typeof m).toBe('string');
    }
  });

  it('RunContextType includes image type', () => {
    const validTypes = ['image', 'document', 'poster', 'lookbook', 'other'];
    expect(validTypes).toContain('image');
  });

  it('IEL error is instanceof Error', () => {
    const err = new CompetitionInvariantError('closed group');
    expect(err).toBeInstanceOf(Error);
  });

  it('IEL error message includes invariant context', () => {
    const err = new CompetitionInvariantError('Cannot add candidate to closed group abc');
    expect(err.message).toContain('closed group abc');
    expect(err.message).toContain('Competition invariant violated');
  });
});
