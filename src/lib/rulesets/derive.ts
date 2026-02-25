/**
 * Ruleset Engine — Derive engine profile from influencer comps
 */
import type { EngineProfile, CompsInfluencer, InfluenceDimension, Lane } from './types';
import { getDefaultEngineProfile } from './defaults';

interface InfluencerInput {
  title: string;
  year?: number;
  format: string;
  weight: number;
  dimensions: InfluenceDimension[];
  emulate_tags?: string[];
  avoid_tags?: string[];
}

/**
 * Derive an EngineProfile from lane defaults + influencer selections.
 * Heuristic: influencers shift defaults within safe bounds.
 */
export function deriveEngineProfile(
  lane: Lane,
  influencers: InfluencerInput[],
): EngineProfile {
  const profile = getDefaultEngineProfile(lane);

  if (influencers.length === 0) return profile;

  // Build comps section
  profile.comps.influencers = influencers.map(i => ({
    title: i.title,
    year: i.year,
    format: i.format,
    weight: i.weight,
    dimensions: i.dimensions,
  }));

  const allTags = new Set<string>();
  const allAvoid = new Set<string>();
  for (const inf of influencers) {
    (inf.emulate_tags || []).forEach(t => allTags.add(t));
    (inf.avoid_tags || []).forEach(t => allAvoid.add(t));
  }
  profile.comps.tags = [...allTags];

  // Add avoid_tags to forbidden_moves
  for (const tag of allAvoid) {
    if (!profile.forbidden_moves.includes(tag)) {
      profile.forbidden_moves.push(tag);
    }
  }

  // Weighted dimension influence
  const dimWeights: Record<InfluenceDimension, number> = {
    pacing: 0, stakes_ladder: 0, dialogue_style: 0,
    twist_budget: 0, texture_realism: 0, antagonism_model: 0,
  };
  let totalWeight = 0;
  for (const inf of influencers) {
    for (const dim of inf.dimensions) {
      dimWeights[dim] += inf.weight;
    }
    totalWeight += inf.weight;
  }

  if (totalWeight === 0) return profile;

  // Pacing influence: more influencers → slightly faster pacing
  if (dimWeights.pacing > 0) {
    const pacingStrength = Math.min(1, dimWeights.pacing / totalWeight);
    profile.pacing_profile.beats_per_minute.target = Math.round(
      profile.pacing_profile.beats_per_minute.target + pacingStrength * 1
    );
    // Clamp
    profile.pacing_profile.beats_per_minute.target = Math.min(
      profile.pacing_profile.beats_per_minute.max,
      profile.pacing_profile.beats_per_minute.target
    );
  }

  // Stakes ladder influence: allow broader early stakes
  if (dimWeights.stakes_ladder > 0) {
    const stakesStrength = Math.min(1, dimWeights.stakes_ladder / totalWeight);
    if (stakesStrength > 0.5 && !profile.stakes_ladder.early_allowed.includes('social')) {
      profile.stakes_ladder.early_allowed.push('social');
    }
    // Slightly relax no_global threshold
    profile.stakes_ladder.no_global_before_pct = Math.max(
      0.15,
      profile.stakes_ladder.no_global_before_pct - stakesStrength * 0.05
    );
  }

  // Twist budget influence
  if (dimWeights.twist_budget > 0) {
    const twistStrength = Math.min(1, dimWeights.twist_budget / totalWeight);
    if (twistStrength > 0.6) {
      // Allow one extra twist, capped
      profile.budgets.twist_cap = Math.min(3, profile.budgets.twist_cap + 1);
    }
  }

  // Dialogue influence
  if (dimWeights.dialogue_style > 0) {
    const dialogueStrength = Math.min(1, dimWeights.dialogue_style / totalWeight);
    profile.dialogue_rules.subtext_ratio_target = Math.min(
      0.8,
      profile.dialogue_rules.subtext_ratio_target + dialogueStrength * 0.1
    );
  }

  // Antagonism influence
  if (dimWeights.antagonism_model > 0) {
    // Keep legitimacy required always; just note comp influence
    profile.antagonism_model.legitimacy_required = true;
  }

  return profile;
}

/**
 * Generate a human-readable summary of rules.
 */
export function generateRulesSummary(profile: EngineProfile): string {
  const lines: string[] = [];
  lines.push(`Lane: ${profile.lane}`);
  lines.push(`Engine: ${profile.engine.story_engine} / ${profile.engine.causal_grammar} / ${profile.engine.conflict_mode}`);
  lines.push(`Drama budget: ${profile.budgets.drama_budget}, Twists: ${profile.budgets.twist_cap}, Reveals: ${profile.budgets.big_reveal_cap}`);
  lines.push(`Characters: max ${profile.budgets.core_character_cap}, Threads: max ${profile.budgets.plot_thread_cap}, Factions: max ${profile.budgets.faction_cap}`);
  lines.push(`Quiet beats: min ${profile.pacing_profile.quiet_beats_min}, Subtext scenes: min ${profile.pacing_profile.subtext_scenes_min}`);
  lines.push(`Stakes: ${profile.stakes_ladder.early_allowed.join('/')} early; no global before ${Math.round(profile.stakes_ladder.no_global_before_pct * 100)}%`);
  lines.push(`Melodrama threshold: ${profile.gate_thresholds.melodrama_max}`);
  if (profile.comps.influencers.length > 0) {
    lines.push(`Comps: ${profile.comps.influencers.map(i => i.title).join(', ')}`);
  }
  if (profile.forbidden_moves.length > 0) {
    lines.push(`Forbidden: ${profile.forbidden_moves.join(', ')}`);
  }
  return lines.join('\n');
}
