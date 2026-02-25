import { describe, it, expect } from 'vitest';
import { deriveEngineProfile, generateRulesSummary } from '@/lib/rulesets/derive';
import { detectConflicts } from '@/lib/rulesets/conflicts';
import { applyOverrides, mergeRuleset } from '@/lib/rulesets/merge';
import { computeRulesetFingerprint, computeRulesetSimilarityRisk } from '@/lib/rulesets/fingerprint';
import { computeRulesetMetrics, computeRulesetMelodramaScore, computeRulesetNuanceScore, detectForbiddenMoves } from '@/lib/rulesets/scoring';
import { runRulesetGate } from '@/lib/rulesets/gate';
import { buildRulesetRepairInstruction } from '@/lib/rulesets/repair';
import { getDefaultEngineProfile } from '@/lib/rulesets/defaults';

// ─── Derive ─────────────────────────────────────────────────────

describe('deriveEngineProfile', () => {
  it('returns lane defaults when no influencers', () => {
    const p = deriveEngineProfile('feature_film', []);
    expect(p.lane).toBe('feature_film');
    expect(p.budgets.twist_cap).toBe(1);
    expect(p.budgets.drama_budget).toBe(2);
  });

  it('adjusts twist_cap with high twist_budget influence', () => {
    const p = deriveEngineProfile('feature_film', [
      { title: 'Test', format: 'film', weight: 2.0, dimensions: ['twist_budget'] },
    ]);
    expect(p.budgets.twist_cap).toBe(2); // +1 from default 1
  });

  it('never exceeds safe caps', () => {
    const p = deriveEngineProfile('vertical_drama', [
      { title: 'A', format: 'series', weight: 3, dimensions: ['twist_budget'] },
      { title: 'B', format: 'series', weight: 3, dimensions: ['twist_budget'] },
    ]);
    expect(p.budgets.twist_cap).toBeLessThanOrEqual(3);
  });

  it('adds avoid_tags to forbidden_moves', () => {
    const p = deriveEngineProfile('feature_film', [
      { title: 'Test', format: 'film', weight: 1, dimensions: ['pacing'], avoid_tags: ['car_chase'] },
    ]);
    expect(p.forbidden_moves).toContain('car_chase');
  });

  it('vertical_drama defaults are correct', () => {
    const p = deriveEngineProfile('vertical_drama', []);
    expect(p.budgets.drama_budget).toBe(3);
    expect(p.budgets.twist_cap).toBe(2);
    expect(p.pacing_profile.quiet_beats_min).toBe(1);
    expect(p.pacing_profile.subtext_scenes_min).toBe(2);
    expect(p.stakes_ladder.no_global_before_pct).toBe(0.25);
  });
});

// ─── Conflicts ──────────────────────────────────────────────────

describe('detectConflicts', () => {
  it('detects twist exceeding lane default', () => {
    const p = getDefaultEngineProfile('feature_film');
    p.budgets.twist_cap = 5;
    const conflicts = detectConflicts(p);
    expect(conflicts.some(c => c.id === 'twist_vs_restraint')).toBe(true);
  });

  it('detects early global stakes', () => {
    const p = getDefaultEngineProfile('feature_film');
    p.stakes_ladder.no_global_before_pct = 0.10;
    const conflicts = detectConflicts(p);
    expect(conflicts.some(c => c.id === 'early_global_stakes')).toBe(true);
  });

  it('detects missing forbidden move', () => {
    const p = getDefaultEngineProfile('feature_film');
    p.forbidden_moves = [];
    const conflicts = detectConflicts(p);
    expect(conflicts.some(c => c.id.startsWith('missing_forbidden_'))).toBe(true);
    expect(conflicts.filter(c => c.severity === 'hard').length).toBeGreaterThan(0);
  });

  it('returns empty for default profile', () => {
    const p = getDefaultEngineProfile('feature_film');
    const conflicts = detectConflicts(p);
    expect(conflicts.length).toBe(0);
  });
});

// ─── Merge ──────────────────────────────────────────────────────

describe('applyOverrides', () => {
  it('replaces nested values', () => {
    const p = getDefaultEngineProfile('feature_film');
    const result = applyOverrides(p, [
      { op: 'replace', path: '/budgets/twist_cap', value: 0 },
    ]);
    expect(result.budgets.twist_cap).toBe(0);
    // Original unchanged
    expect(p.budgets.twist_cap).toBe(1);
  });

  it('adds new values', () => {
    const p = getDefaultEngineProfile('feature_film');
    const result = applyOverrides(p, [
      { op: 'add', path: '/custom_field', value: 'test' },
    ]);
    expect((result as any).custom_field).toBe('test');
  });
});

describe('mergeRuleset', () => {
  it('run overrides take precedence over project overrides', () => {
    const base = getDefaultEngineProfile('feature_film');
    const result = mergeRuleset(
      base,
      null,
      [{ op: 'replace', path: '/budgets/twist_cap', value: 3 }],
      [{ op: 'replace', path: '/budgets/twist_cap', value: 0 }],
    );
    expect(result.budgets.twist_cap).toBe(0);
  });

  it('engine profile overrides base', () => {
    const base = getDefaultEngineProfile('feature_film');
    const engine = getDefaultEngineProfile('vertical_drama');
    const result = mergeRuleset(base, engine, [], []);
    expect(result.budgets.drama_budget).toBe(3); // vertical's default
  });
});

// ─── Fingerprint ────────────────────────────────────────────────

describe('computeRulesetFingerprint', () => {
  it('extracts engine from profile', () => {
    const p = getDefaultEngineProfile('vertical_drama');
    const fp = computeRulesetFingerprint('A small-town story.', p);
    expect(fp.story_engine).toBe('pressure_cooker');
    expect(fp.conflict_mode).toBe('status_reputation');
    expect(fp.lane).toBe('vertical_drama');
  });
});

describe('computeRulesetSimilarityRisk', () => {
  it('returns 0 for empty recent', () => {
    const p = getDefaultEngineProfile('feature_film');
    const fp = computeRulesetFingerprint('test', p);
    expect(computeRulesetSimilarityRisk(fp, [])).toBe(0);
  });

  it('high similarity for identical fingerprints', () => {
    const p = getDefaultEngineProfile('feature_film');
    const fp = computeRulesetFingerprint('test', p);
    expect(computeRulesetSimilarityRisk(fp, [fp, fp, fp])).toBeGreaterThan(0.5);
  });
});

// ─── Scoring ────────────────────────────────────────────────────

describe('scoring', () => {
  it('computeRulesetMetrics returns zeroes for empty', () => {
    const m = computeRulesetMetrics('');
    expect(m.absolute_words_rate).toBe(0);
  });

  it('detectForbiddenMoves finds moves in text', () => {
    const found = detectForbiddenMoves(
      'The secret organization planned a villain monologue.',
      ['secret_organization', 'villain_monologue', 'helicopter_extraction'],
    );
    expect(found).toContain('secret_organization');
    expect(found).toContain('villain_monologue');
    expect(found).not.toContain('helicopter_extraction');
  });
});

// ─── Gate ────────────────────────────────────────────────────────

describe('runRulesetGate', () => {
  it('flags FORBIDDEN_MOVE_PRESENT', () => {
    const p = getDefaultEngineProfile('feature_film');
    const text = 'The secret organization pulled the strings from the shadows.';
    const metrics = computeRulesetMetrics(text);
    const result = runRulesetGate(metrics, text, p, 0, false);
    expect(result.failures).toContain('FORBIDDEN_MOVE_PRESENT');
  });

  it('flags TWIST_OVERUSE for high twist text', () => {
    const p = getDefaultEngineProfile('feature_film');
    // Generate text with many twist keywords
    const text = Array(20).fill('It reveals a twist. Turns out secretly all along.').join(' ');
    const metrics = computeRulesetMetrics(text);
    const result = runRulesetGate(metrics, text, p, 0, false);
    expect(result.failures).toContain('TWIST_OVERUSE');
  });

  it('uses gate_thresholds from profile', () => {
    const p = getDefaultEngineProfile('vertical_drama');
    // Vertical has melodrama_max 0.62, feature has 0.50
    expect(p.gate_thresholds.melodrama_max).toBe(0.62);
    expect(p.gate_thresholds.similarity_max).toBe(0.70);
  });
});

// ─── Repair ─────────────────────────────────────────────────────

describe('buildRulesetRepairInstruction', () => {
  it('includes vertical drama priorities', () => {
    const p = getDefaultEngineProfile('vertical_drama');
    const inst = buildRulesetRepairInstruction(['MELODRAMA'], p);
    expect(inst).toContain('VERTICAL DRAMA PRIORITIES');
    expect(inst).toContain('leverage');
  });

  it('includes feature film priorities', () => {
    const p = getDefaultEngineProfile('feature_film');
    const inst = buildRulesetRepairInstruction(['MELODRAMA'], p);
    expect(inst).toContain('FEATURE FILM PRIORITIES');
    expect(inst).toContain('quiet beats');
  });

  it('includes forbidden move removal', () => {
    const p = getDefaultEngineProfile('feature_film');
    const inst = buildRulesetRepairInstruction(['FORBIDDEN_MOVE_PRESENT'], p, ['secret_organization']);
    expect(inst).toContain('secret organization');
  });

  it('includes caps from profile', () => {
    const p = getDefaultEngineProfile('vertical_drama');
    const inst = buildRulesetRepairInstruction(['OVERCOMPLEXITY', 'SUBTEXT_MISSING'], p);
    expect(inst).toContain(String(p.budgets.plot_thread_cap));
    expect(inst).toContain(String(p.pacing_profile.subtext_scenes_min));
  });
});

// ─── Summary ────────────────────────────────────────────────────

describe('generateRulesSummary', () => {
  it('includes lane and engine info', () => {
    const p = getDefaultEngineProfile('feature_film');
    const summary = generateRulesSummary(p);
    expect(summary).toContain('feature_film');
    expect(summary).toContain('pressure_cooker');
    expect(summary).toContain('moral_trap');
  });
});
