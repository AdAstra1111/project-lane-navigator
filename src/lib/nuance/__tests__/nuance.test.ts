import { describe, it, expect } from 'vitest';
import { computeNuanceMetrics, computeMelodramaScore, computeNuanceScore } from '@/lib/nuance/scoring';
import { computeFingerprint, computeSimilarityRisk } from '@/lib/nuance/fingerprint';
import { runNuanceGate } from '@/lib/nuance/gate';
import { buildRepairInstruction } from '@/lib/nuance/repair';
import { getDefaultCaps } from '@/lib/nuance/defaults';

// ─── Scoring Tests ──────────────────────────────────────────────────────────

describe('computeNuanceMetrics', () => {
  it('returns zeroed metrics for empty text', () => {
    const m = computeNuanceMetrics('');
    expect(m.absolute_words_rate).toBe(0);
    expect(m.twist_keyword_rate).toBe(0);
    expect(m.subtext_scene_count).toBe(0);
  });

  it('detects melodrama signals', () => {
    // Put shock events early in a longer text so they fall in the first 20%
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

// ─── Fingerprint Tests ──────────────────────────────────────────────────────

describe('computeFingerprint', () => {
  it('extracts stakes type from text', () => {
    const fp = computeFingerprint(
      'The government institution threatens systemic collapse.',
      'feature_film', 'pressure_cooker', 'accumulation'
    );
    expect(fp.stakes_type).toBe('systemic');
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
});

// ─── Gate Tests ─────────────────────────────────────────────────────────────

describe('runNuanceGate', () => {
  const baseCaps = getDefaultCaps('feature_film');

  it('passes for clean nuanced text', () => {
    const text = 'Subtext layers what won\'t say. Says instead something. Unspoken beneath surface. ' +
      'Silence pause stillness. Quiet moment contemplation. Reinterprets new light. ' +
      'Valid point from their perspective. Cost sacrifice trade-off.';
    const metrics = computeNuanceMetrics(text);
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps: baseCaps, diversifyEnabled: false,
      similarityRisk: 0, restraint: 75,
    });
    expect(result.failures).not.toContain('SUBTEXT_MISSING');
    expect(result.failures).not.toContain('QUIET_BEATS_MISSING');
  });

  it('flags SUBTEXT_MISSING for plain text', () => {
    const metrics = computeNuanceMetrics('A simple story. He walked. She talked. The end.');
    const result = runNuanceGate(metrics, {
      lane: 'feature_film', caps: baseCaps, diversifyEnabled: false,
      similarityRisk: 0, restraint: 75,
    });
    expect(result.failures).toContain('SUBTEXT_MISSING');
    expect(result.pass).toBe(false);
  });

  it('flags TEMPLATE_SIMILARITY when risk is high and diversify on', () => {
    const metrics = computeNuanceMetrics('test');
    const result = runNuanceGate(metrics, {
      lane: 'series', caps: baseCaps, diversifyEnabled: true,
      similarityRisk: 0.85, restraint: 70,
    });
    expect(result.failures).toContain('TEMPLATE_SIMILARITY');
  });

  it('does not flag similarity when diversify off', () => {
    const metrics = computeNuanceMetrics('test');
    const result = runNuanceGate(metrics, {
      lane: 'series', caps: baseCaps, diversifyEnabled: false,
      similarityRisk: 0.85, restraint: 70,
    });
    expect(result.failures).not.toContain('TEMPLATE_SIMILARITY');
  });
});

// ─── Repair Tests ───────────────────────────────────────────────────────────

describe('buildRepairInstruction', () => {
  it('includes MELODRAMA directives for that failure', () => {
    const instruction = buildRepairInstruction(['MELODRAMA'], getDefaultCaps(), []);
    expect(instruction).toContain('REDUCE MELODRAMA');
    expect(instruction).toContain('screaming confessions');
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
