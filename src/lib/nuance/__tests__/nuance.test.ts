import { describe, it, expect } from 'vitest';
import { computeNuanceMetrics, computeMelodramaScore, computeNuanceScore } from '@/lib/nuance/scoring';
import { computeFingerprint, computeSimilarityRisk, getDiversificationHints } from '@/lib/nuance/fingerprint';
import { runNuanceGate } from '@/lib/nuance/gate';
import { buildRepairInstruction } from '@/lib/nuance/repair';
import { getDefaultCaps, getDefaultConflictMode, getMelodramaThreshold, getSimilarityThreshold } from '@/lib/nuance/defaults';

// ─── Scoring Tests ──────────────────────────────────────────────────────────

describe('computeNuanceMetrics', () => {
  it('returns zeroed metrics for empty text', () => {
    const m = computeNuanceMetrics('');
    expect(m.absolute_words_rate).toBe(0);
    expect(m.twist_keyword_rate).toBe(0);
    expect(m.subtext_scene_count).toBe(0);
  });

  it('detects melodrama signals', () => {
    const text = 'A kidnapping. A murder. An explosion rocks the compound. ' +
      'He always knew this was everything. She never trusted anyone. ' +
      'Suddenly he reveals the betrayal. It turns out the secret organization was behind it all along. ' +
      'Meanwhile the rest of the story continues with various plot developments and character moments ' +
      'that fill out the narrative and provide enough length for the early-portion detection to work correctly.';
    const m = computeNuanceMetrics(text);
    expect(m.absolute_words_rate).toBeGreaterThan(0);
    expect(m.twist_keyword_rate).toBeGreaterThan(0);
    expect(m.conspiracy_markers).toBeGreaterThan(0);
    expect(m.shock_events_early).toBeGreaterThan(0);
  });

  it('detects nuance signals', () => {
    const text = 'The subtext beneath the surface reveals what he won\'t say. ' +
      'A quiet moment of stillness, a pause, contemplation. ' +
      'She reinterprets everything in a new light. ' +
      'From their perspective, it\'s a valid point. The cost of this sacrifice weighs heavy.';
    const m = computeNuanceMetrics(text);
    expect(m.subtext_scene_count).toBeGreaterThan(0);
    expect(m.quiet_beats_count).toBeGreaterThan(0);
    expect(m.meaning_shift_count).toBeGreaterThan(0);
    expect(m.antagonist_legitimacy).toBe(true);
    expect(m.cost_of_action_markers).toBeGreaterThan(0);
  });
});

describe('computeMelodramaScore', () => {
  it('returns 0 for clean metrics', () => {
    const m = computeNuanceMetrics('A simple story about a person walking to work.');
    expect(computeMelodramaScore(m)).toBeLessThan(0.1);
  });

  it('returns high score for melodramatic text', () => {
    const text = 'Always never everything nothing! Suddenly reveals betrayal! ' +
      'The secret organization\'s conspiracy unfolds. Kidnapping! Murder! Explosion! ' +
      'Everything is connected. The shadow cabal puppet master pulls the strings.';
    const m = computeNuanceMetrics(text);
    expect(computeMelodramaScore(m)).toBeGreaterThan(0.3);
  });
});

describe('computeNuanceScore', () => {
  it('returns high for nuanced text', () => {
    const text = 'Subtext layers what he won\'t say. She says instead something lighter. ' +
      'Another unspoken moment. A third subtext scene with underlying tension. ' +
      'Silence fills the room, a pause. Stillness. ' +
      'She reinterprets the events in a new light. ' +
      'His perspective has a valid point. The cost is clear.';
    const m = computeNuanceMetrics(text);
    expect(computeNuanceScore(m)).toBeGreaterThan(0.5);
  });
});

// ─── Defaults & Thresholds Tests ────────────────────────────────────────────

describe('lane-aware defaults', () => {
  it('vertical_drama has correct caps', () => {
    const caps = getDefaultCaps('vertical_drama');
    expect(caps.dramaBudget).toBe(3);
    expect(caps.twistCap).toBe(2);
    expect(caps.subtextScenesMin).toBe(2);
    expect(caps.quietBeatsMin).toBe(1);
    expect(caps.factionCap).toBe(2);
    expect(caps.stakesLateThreshold).toBe(0.75);
  });

  it('feature_film has correct caps', () => {
    const caps = getDefaultCaps('feature_film');
    expect(caps.dramaBudget).toBe(2);
    expect(caps.twistCap).toBe(1);
    expect(caps.subtextScenesMin).toBe(4);
    expect(caps.quietBeatsMin).toBe(3);
    expect(caps.factionCap).toBe(1);
  });

  it('series has correct caps', () => {
    const caps = getDefaultCaps('series');
    expect(caps.twistCap).toBe(1);
    expect(caps.subtextScenesMin).toBe(3);
    expect(caps.quietBeatsMin).toBe(2);
  });

  it('documentary has twist_cap 0', () => {
    const caps = getDefaultCaps('documentary');
    expect(caps.twistCap).toBe(0);
    expect(caps.dramaBudget).toBe(1);
    expect(caps.quietBeatsMin).toBe(3);
  });

  it('melodrama thresholds are lane-aware', () => {
    expect(getMelodramaThreshold('vertical_drama')).toBe(0.62);
    expect(getMelodramaThreshold('feature_film')).toBe(0.50);
    expect(getMelodramaThreshold('documentary')).toBe(0.15);
  });

  it('similarity thresholds are lane-aware', () => {
    expect(getSimilarityThreshold('vertical_drama')).toBe(0.70);
    expect(getSimilarityThreshold('feature_film')).toBe(0.60);
  });

  it('default conflict modes are lane-aware', () => {
    expect(getDefaultConflictMode('vertical_drama')).toBe('status_reputation');
    expect(getDefaultConflictMode('feature_film')).toBe('moral_trap');
    expect(getDefaultConflictMode('documentary')).toBe('legal_procedural');
  });
});

// ─── Fingerprint Tests ──────────────────────────────────────────────────────

describe('computeFingerprint', () => {
  it('extracts stakes type from text', () => {
    const fp = computeFingerprint(
      'The government institution threatens systemic collapse.',
      'feature_film', 'pressure_cooker', 'accumulation'
    );
    expect(fp.stakes_type).toBe('systemic');
  });

  it('includes conflict_mode', () => {
    const fp = computeFingerprint('test', 'vertical_drama', 'pressure_cooker', 'accumulation', 'status_reputation');
    expect(fp.conflict_mode).toBe('status_reputation');
  });

  it('defaults conflict_mode by lane', () => {
    const fp = computeFingerprint('test', 'feature_film', 'pressure_cooker', 'accumulation');
    expect(fp.conflict_mode).toBe('moral_trap');
  });

  it('detects setting tags', () => {
    const fp = computeFingerprint(
      'In the hospital clinic, she reviews the case from her office.',
      'series', 'two_hander', 'erosion'
    );
    expect(fp.setting_texture_tags).toContain('medical');
    expect(fp.setting_texture_tags).toContain('workplace');
  });

  it('returns correct engine/grammar passthrough', () => {
    const fp = computeFingerprint('test', 'series', 'moral_trap', 'mirror');
    expect(fp.story_engine).toBe('moral_trap');
    expect(fp.causal_grammar).toBe('mirror');
    expect(fp.lane).toBe('series');
  });
});

describe('computeSimilarityRisk', () => {
  it('returns 0 for no recent fingerprints', () => {
    const fp = computeFingerprint('test', 'series', 'pressure_cooker', 'accumulation');
    expect(computeSimilarityRisk(fp, [])).toBe(0);
  });

  it('returns high risk when fingerprint matches recent', () => {
    const fp = computeFingerprint('test', 'series', 'pressure_cooker', 'accumulation');
    const recent = [fp, fp, fp];
    expect(computeSimilarityRisk(fp, recent)).toBeGreaterThan(0.5);
  });

  it('uses lane-aware weighting for vertical_drama', () => {
    const fp1 = computeFingerprint('test', 'vertical_drama', 'pressure_cooker', 'accumulation', 'status_reputation');
    const fp2 = computeFingerprint('test', 'vertical_drama', 'pressure_cooker', 'accumulation', 'family_obligation');
    // Different conflict_mode should reduce similarity more for vertical_drama
    const risk = computeSimilarityRisk(fp2, [fp1], 'vertical_drama');
    expect(risk).toBeLessThan(1);
  });
});

describe('getDiversificationHints', () => {
  it('returns avoidConflictModes for vertical_drama', () => {
    const fps = Array(5).fill(null).map(() =>
      computeFingerprint('test', 'vertical_drama', 'pressure_cooker', 'accumulation', 'status_reputation')
    );
    const hints = getDiversificationHints(fps, 'vertical_drama');
    expect(hints.avoidConflictModes).toContain('status_reputation');
  });
});

// ─── Gate Tests ─────────────────────────────────────────────────────────────

describe('runNuanceGate', () => {
  it('passes for clean nuanced text (feature_film)', () => {
    const text = 'Subtext layers what won\'t say. Says instead something. Unspoken beneath surface. ' +
      'Another subtext scene. Fourth subtext moment with underlying tension. ' +
      'Silence pause stillness. Quiet moment contemplation. Another quiet beat with breath. ' +
      'Reinterprets new light. Valid point from their perspective. Cost sacrifice trade-off.';
    const metrics = computeNuanceMetrics(text);
    const caps = getDefaultCaps('feature_film');
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps, diversifyEnabled: false,
      similarityRisk: 0, restraint: 75,
    });
    expect(result.failures).not.toContain('SUBTEXT_MISSING');
    expect(result.failures).not.toContain('QUIET_BEATS_MISSING');
  });

  it('flags SUBTEXT_MISSING for plain text', () => {
    const metrics = computeNuanceMetrics('A simple story. He walked. She talked. The end.');
    const caps = getDefaultCaps('feature_film');
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps, diversifyEnabled: false,
      similarityRisk: 0, restraint: 75,
    });
    expect(result.failures).toContain('SUBTEXT_MISSING');
    expect(result.pass).toBe(false);
  });

  it('uses lane-aware similarity threshold (feature_film = 0.60)', () => {
    const metrics = computeNuanceMetrics('test');
    const caps = getDefaultCaps('feature_film');
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps, diversifyEnabled: true,
      similarityRisk: 0.65, restraint: 75,
    });
    expect(result.failures).toContain('TEMPLATE_SIMILARITY');
  });

  it('uses lane-aware similarity threshold (vertical = 0.70)', () => {
    const metrics = computeNuanceMetrics('test');
    const caps = getDefaultCaps('vertical_drama');
    const result = runNuanceGate(metrics, {
      lane: 'vertical_drama', caps, diversifyEnabled: true,
      similarityRisk: 0.65, restraint: 60,
    });
    expect(result.failures).not.toContain('TEMPLATE_SIMILARITY');
  });

  it('does not flag similarity when diversify off', () => {
    const metrics = computeNuanceMetrics('test');
    const caps = getDefaultCaps('series');
    const result = runNuanceGate(metrics, {
      lane: 'series', caps, diversifyEnabled: false,
      similarityRisk: 0.85, restraint: 70,
    });
    expect(result.failures).not.toContain('TEMPLATE_SIMILARITY');
  });

  it('uses lane-aware faction cap for OVERCOMPLEXITY', () => {
    const metrics = computeNuanceMetrics('test');
    const caps = getDefaultCaps('feature_film');
    // feature_film factionCap=1, so named_factions > 2 triggers
    metrics.named_factions = 3;
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps, diversifyEnabled: false,
      similarityRisk: 0, restraint: 75,
    });
    expect(result.failures).toContain('OVERCOMPLEXITY');
  });
});

// ─── Repair Tests ───────────────────────────────────────────────────────────

describe('buildRepairInstruction', () => {
  it('includes vertical_drama-specific repair priorities', () => {
    const instruction = buildRepairInstruction(['MELODRAMA'], getDefaultCaps('vertical_drama'), [], 'vertical_drama');
    expect(instruction).toContain('VERTICAL DRAMA REPAIR PRIORITIES');
    expect(instruction).toContain('leverage');
    expect(instruction).toContain('social friction');
  });

  it('includes feature_film-specific repair priorities', () => {
    const instruction = buildRepairInstruction(['MELODRAMA'], getDefaultCaps('feature_film'), [], 'feature_film');
    expect(instruction).toContain('FEATURE FILM REPAIR PRIORITIES');
    expect(instruction).toContain('quiet beats');
    expect(instruction).toContain('subtext density');
  });

  it('includes trope avoidance', () => {
    const instruction = buildRepairInstruction([], getDefaultCaps(), ['secret_organization', 'hidden_bloodline']);
    expect(instruction).toContain('secret organization');
    expect(instruction).toContain('hidden bloodline');
  });

  it('includes CRITICAL REPAIR RULES', () => {
    const instruction = buildRepairInstruction(['OVERCOMPLEXITY'], getDefaultCaps(), []);
    expect(instruction).toContain('Do NOT add new plot elements');
    expect(instruction).toContain('REDUCE COMPLEXITY');
  });

  it('uses lane-aware caps in directives', () => {
    const instruction = buildRepairInstruction(['SUBTEXT_MISSING'], getDefaultCaps('feature_film'), [], 'feature_film');
    expect(instruction).toContain('at least 4 subtext scenes');
  });

  it('handles multiple failures', () => {
    const instruction = buildRepairInstruction(
      ['MELODRAMA', 'TWIST_OVERUSE', 'SUBTEXT_MISSING'],
      getDefaultCaps(),
      [],
    );
    expect(instruction).toContain('REDUCE MELODRAMA');
    expect(instruction).toContain('REDUCE TWISTS');
    expect(instruction).toContain('ADD SUBTEXT');
  });
});
