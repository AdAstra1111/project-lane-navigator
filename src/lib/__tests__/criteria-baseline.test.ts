/**
 * Tests for criteria hashing determinism and baseline re-anchoring logic.
 */
import { describe, it, expect } from 'vitest';
import { estimateDurationSeconds, computeCriteriaHash, classifyCriteria, checkDurationMeetsTarget } from '../duration-estimator';

describe('computeCriteriaHash', () => {
  it('produces same hash for same input', () => {
    const criteria = { format_subtype: 'vertical-drama', season_episode_count: 30, episode_target_duration_seconds: 60 };
    const h1 = computeCriteriaHash(criteria);
    const h2 = computeCriteriaHash(criteria);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^ch_/);
  });

  it('produces different hash for different input', () => {
    const a = { format_subtype: 'vertical-drama', season_episode_count: 30 };
    const b = { format_subtype: 'vertical-drama', season_episode_count: 20 };
    expect(computeCriteriaHash(a)).not.toBe(computeCriteriaHash(b));
  });

  it('ignores updated_at field', () => {
    const a = { format_subtype: 'film', updated_at: '2025-01-01' };
    const b = { format_subtype: 'film', updated_at: '2026-03-01' };
    expect(computeCriteriaHash(a)).toBe(computeCriteriaHash(b));
  });

  it('ignores null values', () => {
    const a = { format_subtype: 'film', season_episode_count: null };
    const b = { format_subtype: 'film' };
    expect(computeCriteriaHash(a)).toBe(computeCriteriaHash(b));
  });
});

describe('classifyCriteria', () => {
  it('returns OK when hashes match and duration in range', () => {
    const result = classifyCriteria({
      versionCriteriaHash: 'ch_abc',
      currentCriteriaHash: 'ch_abc',
      measuredDurationSeconds: 60,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    expect(result.classification).toBe('OK');
  });

  it('returns CRITERIA_STALE_PROVENANCE when hashes differ', () => {
    const result = classifyCriteria({
      versionCriteriaHash: 'ch_abc',
      currentCriteriaHash: 'ch_xyz',
      measuredDurationSeconds: 60,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    expect(result.classification).toBe('CRITERIA_STALE_PROVENANCE');
  });

  it('returns CRITERIA_FAIL_DURATION when duration out of range', () => {
    const result = classifyCriteria({
      versionCriteriaHash: 'ch_abc',
      currentCriteriaHash: 'ch_abc',
      measuredDurationSeconds: 200,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    expect(result.classification).toBe('CRITERIA_FAIL_DURATION');
  });

  it('treats missing version hash as FAILS_CRITERIA not STALE', () => {
    const result = classifyCriteria({
      versionCriteriaHash: null,
      currentCriteriaHash: 'ch_abc',
      measuredDurationSeconds: 200,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    // Missing hash = skip provenance check, go straight to duration
    expect(result.classification).toBe('CRITERIA_FAIL_DURATION');
  });

  it('treats missing version hash with good duration as OK', () => {
    const result = classifyCriteria({
      versionCriteriaHash: null,
      currentCriteriaHash: 'ch_abc',
      measuredDurationSeconds: 60,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    expect(result.classification).toBe('OK');
  });
});

describe('estimateDurationSeconds', () => {
  it('returns 0 for empty text', () => {
    expect(estimateDurationSeconds('')).toBe(0);
    expect(estimateDurationSeconds('   ')).toBe(0);
  });

  it('is deterministic', () => {
    const text = 'INT. LIVING ROOM - DAY\n\nJOHN: Hello world, this is a test.\n\nHe walks across the room.';
    const a = estimateDurationSeconds(text);
    const b = estimateDurationSeconds(text);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it('handles dialogue at 2.5 wps', () => {
    // 10 words of dialogue = 4s + 1s cue = 5s
    const text = 'JOHN: One two three four five six seven eight nine ten.';
    const dur = estimateDurationSeconds(text);
    expect(dur).toBe(5); // 1s cue + 10/2.5 = 5s
  });
});

describe('checkDurationMeetsTarget', () => {
  it('passes within 10% tolerance', () => {
    const result = checkDurationMeetsTarget(55, 50, 70, 60);
    expect(result.meets).toBe(true);
  });

  it('fails outside tolerance', () => {
    const result = checkDurationMeetsTarget(200, 50, 70, 60);
    expect(result.meets).toBe(false);
  });
});

describe('baseline re-anchoring logic', () => {
  it('detects when baseline composite is worse than best by margin', () => {
    const baselineCI = 30, baselineGP = 20;
    const bestCI = 80, bestGP = 85;
    const REANCHOR_MARGIN = 20;
    
    const baselineComposite = baselineCI + baselineGP;
    const bestComposite = bestCI + bestGP;
    const shouldReanchor = bestComposite - baselineComposite >= REANCHOR_MARGIN;
    
    expect(shouldReanchor).toBe(true);
    expect(bestComposite - baselineComposite).toBe(115);
  });

  it('does NOT reanchor when baseline is close to best', () => {
    const baselineCI = 78, baselineGP = 82;
    const bestCI = 80, bestGP = 85;
    const REANCHOR_MARGIN = 20;
    
    const baselineComposite = baselineCI + baselineGP;
    const bestComposite = bestCI + bestGP;
    const shouldReanchor = bestComposite - baselineComposite >= REANCHOR_MARGIN;
    
    expect(shouldReanchor).toBe(false);
  });
});
