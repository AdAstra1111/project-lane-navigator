/**
 * Quality History — buildScoreTrendSeries tests
 * Covers: ordering, empty state, clamping/normalization, 50-cap, null exclusion.
 */
import { describe, it, expect } from 'vitest';
import {
  buildScoreTrendSeries,
  clampScore,
  type TrendPoint,
} from '@/components/cinematic/QualityRunHistory';

/* ── Helpers ── */

function makeRun(score: number | null, pass: boolean, created_at: string) {
  return { final_score: score as any, final_pass: pass, created_at };
}

/* ── A) Ordering ── */

describe('buildScoreTrendSeries ordering', () => {
  it('chart dataset is chronological (oldest→newest)', () => {
    const runs = [
      makeRun(0.5, true, '2026-01-03T00:00:00Z'),
      makeRun(0.7, true, '2026-01-01T00:00:00Z'),
      makeRun(0.6, false, '2026-01-02T00:00:00Z'),
    ];
    const series = buildScoreTrendSeries(runs);
    expect(series[0].time).toBe('2026-01-01T00:00:00Z');
    expect(series[1].time).toBe('2026-01-02T00:00:00Z');
    expect(series[2].time).toBe('2026-01-03T00:00:00Z');
  });

  it('list view order is newest-first (input sorted desc produces reversed chrono chart)', () => {
    const runs = [
      makeRun(0.9, true, '2026-02-25T03:00:00Z'),
      makeRun(0.7, false, '2026-02-25T01:00:00Z'),
      makeRun(0.8, true, '2026-02-25T02:00:00Z'),
    ];
    const series = buildScoreTrendSeries(runs);
    // Chart is chronological
    expect(series.map(s => s.score)).toEqual([0.7, 0.8, 0.9]);
  });

  it('is deterministic across calls', () => {
    const runs = [
      makeRun(0.3, false, '2026-01-02T00:00:00Z'),
      makeRun(0.9, true, '2026-01-01T00:00:00Z'),
    ];
    const a = buildScoreTrendSeries(runs);
    const b = buildScoreTrendSeries(runs);
    expect(a).toEqual(b);
  });

  it('does not mutate input', () => {
    const runs = [
      makeRun(0.9, true, '2026-01-02T00:00:00Z'),
      makeRun(0.5, false, '2026-01-01T00:00:00Z'),
    ];
    const orig0 = runs[0].created_at;
    buildScoreTrendSeries(runs);
    expect(runs[0].created_at).toBe(orig0);
  });
});

/* ── B) Empty state ── */

describe('buildScoreTrendSeries empty state', () => {
  it('returns empty for empty input', () => {
    expect(buildScoreTrendSeries([])).toEqual([]);
  });

  it('returns empty when all scores are null', () => {
    const runs = [
      makeRun(null, false, '2026-01-01T00:00:00Z'),
      makeRun(null, true, '2026-01-02T00:00:00Z'),
    ];
    expect(buildScoreTrendSeries(runs)).toEqual([]);
  });
});

/* ── C) Normalization / Clamping ── */

describe('buildScoreTrendSeries clamping', () => {
  it('clamps scores below 0 to 0', () => {
    const series = buildScoreTrendSeries([makeRun(-0.2, false, '2026-01-01T00:00:00Z')]);
    expect(series[0].score).toBe(0);
  });

  it('clamps scores above 1 to 1', () => {
    const series = buildScoreTrendSeries([makeRun(1.2, true, '2026-01-01T00:00:00Z')]);
    expect(series[0].score).toBe(1);
  });

  it('clamps [-0.2, 0.5, 1.2] to [0, 0.5, 1]', () => {
    const runs = [
      makeRun(-0.2, false, '2026-01-01T00:00:00Z'),
      makeRun(0.5, true, '2026-01-02T00:00:00Z'),
      makeRun(1.2, true, '2026-01-03T00:00:00Z'),
    ];
    const series = buildScoreTrendSeries(runs);
    expect(series.map(s => s.score)).toEqual([0, 0.5, 1]);
  });

  it('excludes null scores from dataset', () => {
    const runs = [
      makeRun(0.5, true, '2026-01-01T00:00:00Z'),
      makeRun(null, false, '2026-01-02T00:00:00Z'),
      makeRun(0.8, true, '2026-01-03T00:00:00Z'),
    ];
    const series = buildScoreTrendSeries(runs);
    expect(series).toHaveLength(2);
    expect(series.map(s => s.score)).toEqual([0.5, 0.8]);
  });

  it('preserves valid scores in [0,1] as-is', () => {
    const runs = [makeRun(0.42, true, '2026-01-01T00:00:00Z')];
    expect(buildScoreTrendSeries(runs)[0].score).toBeCloseTo(0.42);
  });
});

/* ── D) 50-cap ── */

describe('buildScoreTrendSeries 50-cap', () => {
  it('caps at 50 points given 60 runs', () => {
    const runs = Array.from({ length: 60 }, (_, i) =>
      makeRun(i / 60, i % 2 === 0, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    );
    const series = buildScoreTrendSeries(runs);
    expect(series).toHaveLength(50);
  });

  it('keeps the 50 most recent runs', () => {
    const runs = Array.from({ length: 60 }, (_, i) =>
      makeRun(i / 60, true, new Date(Date.UTC(2026, 0, i + 1)).toISOString())
    );
    const series = buildScoreTrendSeries(runs);
    // The oldest 10 should be excluded; first plotted point should be day 11
    expect(series[0].time).toBe(new Date(Date.UTC(2026, 0, 11)).toISOString());
  });

  it('passes through fewer than 50 unchanged', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun(0.5, true, `2026-01-0${i + 1}T00:00:00Z`)
    );
    expect(buildScoreTrendSeries(runs)).toHaveLength(5);
  });
});

/* ── E) clampScore unit tests ── */

describe('clampScore', () => {
  it('clamps negative to 0', () => expect(clampScore(-5)).toBe(0));
  it('clamps >1 to 1', () => expect(clampScore(3.7)).toBe(1));
  it('preserves 0', () => expect(clampScore(0)).toBe(0));
  it('preserves 1', () => expect(clampScore(1)).toBe(1));
  it('preserves 0.5', () => expect(clampScore(0.5)).toBe(0.5));
});

/* ── F) Label format ── */

describe('buildScoreTrendSeries labels', () => {
  it('produces deterministic UTC-based labels', () => {
    const series = buildScoreTrendSeries([makeRun(0.5, true, '2026-03-15T14:30:00Z')]);
    expect(series[0].label).toBe('03-15 14:30');
  });
});
