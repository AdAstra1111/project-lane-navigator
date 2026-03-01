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
  market_profile: string; // same as lane (assigned_lane is already market-lane style)
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
    market_profile: lane, // assigned_lane is already market-lane style (studio-streamer, independent-film, etc.)
    comparables,
    voice_profile: voiceProfile,
    style_targets: styleTargets,
    constraints,
    intel_pack_applied: intelApplied,
  };
}

// ── Deterministic prompt context block builder ──

/**
 * Builds a prompt-injectable text block from an EffectiveProfile.
 * Used by engines (dev-engine-v2, etc.) to inject seed intelligence into prompts.
 * Deterministic, stable ordering, clamped length.
 */
export function buildEffectiveProfileContextBlock(profile: EffectiveProfile): string {
  if (!profile.intel_pack_applied && profile.comparables.length === 0) return '';

  const parts: string[] = [];

  // Lane + market profile
  parts.push(`Market Profile: ${profile.market_profile}`);

  // Top comparables (max 6)
  const topComps = profile.comparables
    .filter(c => c.title)
    .slice(0, 6);
  if (topComps.length > 0) {
    const compLines = topComps.map((c, i) => {
      const axis = c.reference_axis ? ` [${c.reference_axis}]` : '';
      const weight = c.weight != null ? ` w=${c.weight}` : '';
      const reason = c.reason ? ` — ${c.reason}` : '';
      return `  ${i + 1}. ${c.title}${axis}${weight}${reason}`;
    });
    parts.push(`Comparable References:\n${compLines.join('\n')}`);
  }

  // Voice
  const voice = profile.voice_profile;
  const voiceParts: string[] = [];
  if (voice.tone_band) voiceParts.push(`tone=${voice.tone_band}`);
  if (voice.pacing) voiceParts.push(`pacing=${voice.pacing}`);
  if (voice.dialogue_density) voiceParts.push(`dialogue_density=${voice.dialogue_density}`);
  if (voice.humor_darkness) voiceParts.push(`humor=${voice.humor_darkness}`);
  if (voiceParts.length > 0) {
    parts.push(`Voice Profile: ${voiceParts.join(', ')}`);
  }

  // Constraints
  const c = profile.constraints;
  const cParts: string[] = [];
  if (c.budget_band) cParts.push(`budget=${c.budget_band}`);
  if (c.runtime_band) cParts.push(`runtime=${c.runtime_band}`);
  if (c.rating) cParts.push(`rating=${c.rating}`);
  if (cParts.length > 0) {
    parts.push(`Constraints: ${cParts.join(', ')}`);
  }

  // Style targets
  if (profile.style_targets.primary_axis) {
    parts.push(`Primary Style Axis: ${profile.style_targets.primary_axis}`);
  }

  if (parts.length === 0) return '';

  return `\n=== EFFECTIVE PROFILE (from Seed Intel Pack) ===\n${parts.join('\n')}\n=== END EFFECTIVE PROFILE ===`;
}
