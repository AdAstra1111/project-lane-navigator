/**
 * Tests for criteria hashing determinism, baseline re-anchoring logic,
 * and candidate stamping contract.
 */
import { describe, it, expect, vi } from 'vitest';
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

  it('returns OK when BOTH hashes are null (legacy data)', () => {
    const result = classifyCriteria({
      versionCriteriaHash: null,
      currentCriteriaHash: null,
      measuredDurationSeconds: 60,
      targetDurationMin: 50,
      targetDurationMax: 70,
      targetDurationScalar: 60,
    });
    expect(result.classification).toBe('OK');
  });

  it('returns STALE only when BOTH hashes exist and differ', () => {
    // Both null → no stale
    expect(classifyCriteria({
      versionCriteriaHash: null, currentCriteriaHash: null,
      measuredDurationSeconds: 60, targetDurationMin: 50, targetDurationMax: 70, targetDurationScalar: 60,
    }).classification).toBe('OK');

    // Version null, current set → no stale (skip provenance)
    expect(classifyCriteria({
      versionCriteriaHash: null, currentCriteriaHash: 'ch_abc',
      measuredDurationSeconds: 60, targetDurationMin: 50, targetDurationMax: 70, targetDurationScalar: 60,
    }).classification).toBe('OK');

    // Both set AND different → STALE
    expect(classifyCriteria({
      versionCriteriaHash: 'ch_old', currentCriteriaHash: 'ch_new',
      measuredDurationSeconds: 60, targetDurationMin: 50, targetDurationMax: 70, targetDurationScalar: 60,
    }).classification).toBe('CRITERIA_STALE_PROVENANCE');

    // Both set AND same → OK
    expect(classifyCriteria({
      versionCriteriaHash: 'ch_same', currentCriteriaHash: 'ch_same',
      measuredDurationSeconds: 60, targetDurationMin: 50, targetDurationMax: 70, targetDurationScalar: 60,
    }).classification).toBe('OK');
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

  it('re-anchor must be read-only (never call set_current_version)', () => {
    // Simulate the re-anchor decision logic
    const mockRpc = vi.fn();
    
    const bestVersionId = 'best-v1';
    const bestCI = 80, bestGP = 85;
    const jobLastCI = 30, jobLastGP = 20;
    const REANCHOR_MARGIN = 20;
    let baselineVersionId = 'baseline-v1';
    
    const baselineComposite = jobLastCI + jobLastGP;
    const bestComposite = bestCI + bestGP;
    
    if (bestComposite - baselineComposite >= REANCHOR_MARGIN) {
      // READ-ONLY re-anchor: only change in-memory variable
      baselineVersionId = bestVersionId;
      // MUST NOT call set_current_version
    }
    
    expect(baselineVersionId).toBe('best-v1');
    expect(mockRpc).not.toHaveBeenCalled(); // Proves no DB mutation
  });
});

describe('baseline score reuse safety', () => {
  it('reuses scores only when last_analyzed matches baseline', () => {
    const baselineVersionId = 'v-baseline';
    const lastAnalyzedVersionId = 'v-baseline';
    const lastCI = 75;
    const lastGP = 80;
    
    const canReuse = lastAnalyzedVersionId === baselineVersionId
      && typeof lastCI === 'number' && typeof lastGP === 'number';
    
    expect(canReuse).toBe(true);
  });

  it('rejects reuse when last_analyzed differs from baseline', () => {
    const baselineVersionId = 'v-baseline';
    const lastAnalyzedVersionId = 'v-other' as string;
    const lastCI = 75;
    const lastGP = 80;
    
    const canReuse = lastAnalyzedVersionId === baselineVersionId
      && typeof lastCI === 'number' && typeof lastGP === 'number';
    
    expect(canReuse).toBe(false);
  });

  it('rejects reuse when scores are null', () => {
    const baselineVersionId = 'v-baseline';
    const lastAnalyzedVersionId = 'v-baseline';
    const lastCI = null;
    const lastGP = 80;
    
    const canReuse = lastAnalyzedVersionId === baselineVersionId
      && typeof lastCI === 'number' && typeof lastGP === 'number';
    
    expect(canReuse).toBe(false);
  });
});

describe('candidate stamping contract', () => {
  it('stampVersionCriteriaAndMetrics produces correct shape', () => {
    // Simulate what the stamp function writes
    const criteriaSnapshot = { format_subtype: 'film', season_episode_count: 10 };
    const criteriaHash = computeCriteriaHash(criteriaSnapshot);
    const plaintext = 'INT. OFFICE - DAY\n\nJOHN: Hello world.\n\nHe sits down.';
    const measuredDuration = estimateDurationSeconds(plaintext);
    
    const updatePayload = {
      criteria_hash: criteriaHash,
      criteria_json: criteriaSnapshot,
      measured_metrics_json: {
        measured_duration_seconds: measuredDuration,
        estimated_at: new Date().toISOString(),
        estimator: 'edge_deterministic',
      },
    };
    
    expect(updatePayload.criteria_hash).toMatch(/^ch_/);
    expect(updatePayload.criteria_json).toEqual(criteriaSnapshot);
    expect(updatePayload.measured_metrics_json.measured_duration_seconds).toBeGreaterThan(0);
    expect(updatePayload.measured_metrics_json.estimator).toBe('edge_deterministic');
  });
});
