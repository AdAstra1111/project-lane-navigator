/**
 * Preference Compiler — Pure deterministic function
 * 
 * Compiles an EffectiveProfile from canon (including seed_intel_pack),
 * project metadata, and lane defaults. No DB writes. No LLM.
 * 
 * Merge precedence: User Locked > Canon Explicit > SeedIntelPack > Lane Defaults
 */

import type { SeedIntelPack, ComparableCandidate, ToneStyleSignals } from '@/lib/trends/seed-intel-pack';

// ── Types ──

export interface VoiceProfile {
  tone_band?: string;
  pacing?: string;
  dialogue_density?: string;
  humor_darkness?: string;
  notes?: string[];
}

export interface StyleTargets {
  reference_axes: Record<string, number>; // axis → avg weight from comps
  primary_axis?: string;
}

export interface EffectiveConstraints {
  budget_band?: string;
  runtime_band?: string;
  rating?: string;
  episode_length?: string;
}

export interface EffectiveProfile {
  lane: string;
  comparables: ComparableCandidate[];
  voice_profile: VoiceProfile;
  style_targets: StyleTargets;
  constraints: EffectiveConstraints;
  intel_pack_applied: boolean;
}

// ── Lane Defaults ──

const LANE_DEFAULTS: Record<string, Partial<EffectiveProfile>> = {
  'independent-film': {
    voice_profile: { tone_band: 'dramatic', pacing: 'measured' },
    constraints: { budget_band: 'Mid', runtime_band: '90-120min' },
  },
  'studio-streamer': {
    voice_profile: { tone_band: 'elevated', pacing: 'accelerating' },
    constraints: { budget_band: 'High', runtime_band: '90-150min' },
  },
  'prestige-awards': {
    voice_profile: { tone_band: 'restrained', pacing: 'deliberate' },
    constraints: { budget_band: 'Mid', runtime_band: '100-140min' },
  },
  'genre-market': {
    voice_profile: { tone_band: 'heightened', pacing: 'accelerating' },
    constraints: { budget_band: 'Low', runtime_band: '85-105min' },
  },
  'fast-turnaround': {
    voice_profile: { tone_band: 'punchy', pacing: 'accelerating' },
    constraints: { budget_band: 'Micro', runtime_band: '2-5min' },
  },
};

// ── Style Target Derivation ──

function deriveStyleTargets(comps: ComparableCandidate[]): StyleTargets {
  const axisWeights: Record<string, number[]> = {};

  for (const comp of comps) {
    if (comp.reference_axis && comp.weight != null) {
      if (!axisWeights[comp.reference_axis]) axisWeights[comp.reference_axis] = [];
      axisWeights[comp.reference_axis].push(comp.weight);
    }
  }

  const axes: Record<string, number> = {};
  let primaryAxis: string | undefined;
  let maxAvg = 0;

  for (const [axis, weights] of Object.entries(axisWeights)) {
    const avg = Math.round((weights.reduce((s, w) => s + w, 0) / weights.length) * 100) / 100;
    axes[axis] = avg;
    if (avg > maxAvg) {
      maxAvg = avg;
      primaryAxis = axis;
    }
  }

  return { reference_axes: axes, primary_axis: primaryAxis };
}

// ── Main Compiler ──

export interface CompileInput {
  canon: Record<string, any>;
  project: {
    assigned_lane?: string | null;
    tone?: string | null;
    budget_range?: string | null;
    format?: string | null;
    genres?: string[];
    comparable_titles?: string | null;
  };
}

export function compileEffectiveProfile(input: CompileInput): EffectiveProfile {
  const { canon, project } = input;
  const lane = project.assigned_lane || 'independent-film';
  const defaults = LANE_DEFAULTS[lane] || {};

  const pack: SeedIntelPack | undefined = canon.seed_intel_pack;
  const intelApplied = !!pack;

  // ── Comparables: user locked > canon explicit > pack candidates ──
  let comparables: ComparableCandidate[] = [];

  // Check if canon has user-curated comparables
  const canonComps = canon.comparables as ComparableCandidate[] | undefined;
  if (canonComps && canonComps.length > 0) {
    comparables = canonComps;
  } else if (pack?.comparable_candidates && pack.comparable_candidates.length > 0) {
    // Populate from pack without DB write
    comparables = pack.comparable_candidates;
  } else if (project.comparable_titles) {
    // Fallback: parse comma-separated titles from project field
    comparables = project.comparable_titles
      .split(/[,;]+/)
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map(title => ({
        title,
        confidence: 'low' as const,
      }));
  }

  // ── Voice Profile: user explicit > pack tone_style > lane defaults ──
  const packTone: ToneStyleSignals = pack?.tone_style_signals || {};
  const voiceProfile: VoiceProfile = {
    tone_band: project.tone || packTone.tone_band || defaults.voice_profile?.tone_band,
    pacing: packTone.pacing || defaults.voice_profile?.pacing,
    dialogue_density: packTone.dialogue_density || defaults.voice_profile?.dialogue_density,
    humor_darkness: packTone.humor_darkness || defaults.voice_profile?.humor_darkness,
    notes: packTone.notes || defaults.voice_profile?.notes,
  };

  // ── Style Targets from comparables ──
  const styleTargets = deriveStyleTargets(comparables);

  // ── Constraints: project explicit > pack suggestions > lane defaults ──
  const packConstraints = pack?.constraints_suggestions || {};
  const constraints: EffectiveConstraints = {
    budget_band: project.budget_range || packConstraints.budget_band || defaults.constraints?.budget_band,
    runtime_band: packConstraints.runtime_band || defaults.constraints?.runtime_band,
    rating: packConstraints.rating,
    episode_length: packConstraints.episode_length,
  };

  return {
    lane,
    comparables,
    voice_profile: voiceProfile,
    style_targets: styleTargets,
    constraints,
    intel_pack_applied: intelApplied,
  };
}
