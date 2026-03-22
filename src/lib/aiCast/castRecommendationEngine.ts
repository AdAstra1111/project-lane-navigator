/**
 * castRecommendationEngine — Phase 16.7 + 17.2: Deterministic cast recommendations.
 *
 * Proposes strong actor candidates for a project's characters using:
 * - casting brief (visual performer requirements, NOT raw story text)
 * - existing actor intelligence (quality, reusability, usage)
 * - deterministic tag/text overlap scoring
 *
 * Phase 17.2 update: recommendations now consume CastingBrief to prevent
 * plot-language from influencing actor matching.
 *
 * READ-ONLY. Advisory only. No bindings are mutated.
 *
 * WEIGHTS (documented):
 *   tag_overlap:     35%  — casting brief tags vs actor tags
 *   text_overlap:    25%  — actor description token overlap
 *   quality:         20%  — validation quality score
 *   reusability:     12%  — tier-based boost
 *   usage_proof:      8%  — cross-project proof
 *   ---
 *   match_score = weighted sum (0–100 scale)
 *
 * Rationale:
 *   FIT > POPULARITY is the governing principle.
 *   Tag/text overlap together = 60% (fit-dominant).
 *   Quality matters but must not override bad fit.
 *   Usage proof is lightest — popularity must not win over match.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeCharacterKey } from './normalizeCharacterKey';
import { getRosterActorsForCasting, type ActorIntelligenceProfile } from './actorIntelligence';
import { buildCharacterCastingBrief, type CastingBrief } from './castingBriefResolver';
import {
  buildCastingSpecificityProfile,
  buildCastingSearchPlan,
  type CastingSpecificityProfile,
  type CastingSearchPlan,
} from './castingSpecificity';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectCharacterCandidate {
  character_key: string;
  display_name: string;
  traits_text: string;
  age_hint?: string | null;
  gender_hint?: string | null;
  tags: string[];
  brief?: CastingBrief;
}

export interface ActorRecommendation {
  actor_id: string;
  actor_name: string;
  approved_version_id: string;
  quality_score: number | null;
  quality_band: string | null;
  reusability_tier: 'signature' | 'reliable' | 'emerging' | 'unvalidated';
  project_count: number;
  usage_count: number;
  match_score: number;
  match_reasons: string[];
}

export interface CharacterRecommendationResult {
  character_key: string;
  recommendations: ActorRecommendation[];
  specificity?: {
    score: number;
    band: 'low' | 'medium' | 'high';
    mode: 'exploration' | 'precision';
    diversityStrategy: 'wide' | 'balanced' | 'narrow';
  };
}

export interface ProjectCastRecommendationResult {
  project_id: string;
  characters: CharacterRecommendationResult[];
}

// ── Weight constants ─────────────────────────────────────────────────────────
const W_TAG_OVERLAP    = 0.35;
const W_TEXT_OVERLAP   = 0.25;
const W_QUALITY        = 0.20;
const W_REUSABILITY    = 0.12;
const W_USAGE_PROOF    = 0.08;

const MAX_RECOMMENDATIONS = 5;

// ── Character Extraction ─────────────────────────────────────────────────────

/**
 * Resolve project characters from canonical sources, using CastingBrief
 * to derive visual-only traits/tags (Phase 17.2 separation).
 * Priority: canon_facts (character type) → project_images subjects.
 * Returns enriched character candidates with appearance-only traits.
 */
async function resolveProjectCharacters(projectId: string): Promise<ProjectCharacterCandidate[]> {
  // 1. Get character subjects from canon_facts
  const { data: charTypeFacts } = await supabase
    .from('canon_facts')
    .select('subject')
    .eq('project_id', projectId)
    .eq('fact_type', 'character')
    .eq('is_active', true);

  const charSubjects = [...new Set((charTypeFacts || []).map((d: any) => d.subject))];

  if (charSubjects.length > 0) {
    // Use casting brief resolver for each character to get visual-only data
    const results: ProjectCharacterCandidate[] = [];
    for (const subject of charSubjects) {
      try {
        const briefResult = await buildCharacterCastingBrief(projectId, subject);
        results.push({
          character_key: normalizeCharacterKey(subject),
          display_name: subject,
          traits_text: briefResult.brief.actor_description,
          age_hint: briefResult.brief.age_hint,
          gender_hint: briefResult.brief.gender_presentation,
          tags: briefResult.brief.actor_tags,
          brief: briefResult.brief,
        });
      } catch {
        // Fallback: minimal entry if brief resolution fails
        results.push({
          character_key: normalizeCharacterKey(subject),
          display_name: subject,
          traits_text: '',
          age_hint: null,
          gender_hint: null,
          tags: [],
        });
      }
    }
    return results;
  }

  // 2. Fallback: project_images subjects
  const { data: imageSubjects } = await (supabase as any)
    .from('project_images')
    .select('subject')
    .eq('project_id', projectId)
    .in('shot_type', ['identity_headshot', 'identity_full_body'])
    .not('subject', 'is', null);

  const uniqueSubjects = [...new Set((imageSubjects || []).map((d: any) => d.subject).filter(Boolean))] as string[];

  return uniqueSubjects.map(subject => ({
    character_key: normalizeCharacterKey(subject),
    display_name: subject,
    traits_text: '',
    age_hint: null,
    gender_hint: null,
    tags: [],
  }));
}

// ── Scoring Helpers ──────────────────────────────────────────────────────────

/** Tokenize a string into lowercase alpha-numeric tokens */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').split(/[\s_-]+/).filter(t => t.length > 2);
}

/** Compute tag overlap score (0–100) */
function scoreTagOverlap(charTags: string[], actorTags: string[]): { score: number; overlapping: string[] } {
  if (charTags.length === 0 || actorTags.length === 0) return { score: 0, overlapping: [] };

  const charSet = new Set(charTags.map(t => t.toLowerCase()));
  const actorSet = new Set(actorTags.map(t => t.toLowerCase()));

  const overlapping: string[] = [];
  for (const tag of charSet) {
    if (actorSet.has(tag)) overlapping.push(tag);
    // Also check partial containment
    else {
      for (const actorTag of actorSet) {
        if (actorTag.includes(tag) || tag.includes(actorTag)) {
          overlapping.push(`~${tag}`);
          break;
        }
      }
    }
  }

  const maxPossible = Math.min(charSet.size, actorSet.size);
  if (maxPossible === 0) return { score: 0, overlapping: [] };

  return {
    score: Math.min(100, Math.round((overlapping.length / maxPossible) * 100)),
    overlapping,
  };
}

/** Compute text token overlap score (0–100) */
function scoreTextOverlap(charText: string, actorText: string): number {
  const charTokens = tokenize(charText);
  const actorTokens = new Set(tokenize(actorText));

  if (charTokens.length === 0 || actorTokens.size === 0) return 0;

  let matches = 0;
  for (const token of charTokens) {
    if (actorTokens.has(token)) matches++;
  }

  return Math.min(100, Math.round((matches / charTokens.length) * 100));
}

/** Compute quality score component (0–100) */
function scoreQuality(qualityScore: number | null): number {
  if (qualityScore == null) return 30; // baseline for unvalidated
  return Math.min(100, Math.max(0, qualityScore));
}

/** Compute reusability tier score (0–100) */
function scoreReusability(tier: ActorIntelligenceProfile['reusability_tier']): number {
  switch (tier) {
    case 'signature':   return 100;
    case 'reliable':    return 75;
    case 'emerging':    return 50;
    case 'unvalidated': return 25;
    default:            return 25;
  }
}

/** Compute usage proof score (0–100) */
function scoreUsageProof(projectCount: number): number {
  if (projectCount >= 5) return 100;
  if (projectCount >= 3) return 80;
  if (projectCount >= 2) return 60;
  if (projectCount >= 1) return 40;
  return 20;
}

/**
 * Score an actor for a character candidate. Returns match_score (0–100) and reasons.
 */
function scoreActorForCharacter(
  character: ProjectCharacterCandidate,
  actor: ActorIntelligenceProfile,
): { match_score: number; reasons: string[] } {
  const reasons: string[] = [];

  // A. Tag overlap (35%)
  const tagResult = scoreTagOverlap(character.tags, actor.tags);
  const tagScore = tagResult.score;
  if (tagResult.overlapping.length > 0) {
    reasons.push(`tag overlap: ${tagResult.overlapping.slice(0, 4).join(', ')}`);
  }

  // B. Text overlap (25%)
  const actorText = [actor.actor_name, ...actor.tags].join(' ');
  const charText = [character.display_name, character.traits_text].join(' ');
  const textScore = scoreTextOverlap(charText, actorText);
  if (textScore > 0) {
    reasons.push(`text match: ${textScore}%`);
  }

  // C. Quality (20%)
  const qualScore = scoreQuality(actor.quality_score);
  if (actor.quality_score != null) {
    reasons.push(`quality: ${actor.quality_score}`);
  }

  // D. Reusability (12%)
  const reuseScore = scoreReusability(actor.reusability_tier);
  if (actor.reusability_tier !== 'unvalidated') {
    reasons.push(`tier: ${actor.reusability_tier}`);
  }

  // E. Usage proof (8%)
  const usageScore = scoreUsageProof(actor.project_count);
  if (actor.project_count > 0) {
    reasons.push(`used in ${actor.project_count} project${actor.project_count !== 1 ? 's' : ''}`);
  }

  const match_score = Math.round(
    tagScore * W_TAG_OVERLAP +
    textScore * W_TEXT_OVERLAP +
    qualScore * W_QUALITY +
    reuseScore * W_REUSABILITY +
    usageScore * W_USAGE_PROOF
  );

  return { match_score, reasons };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Build deterministic cast recommendations for a project.
 * Returns top-N actor suggestions per character, ranked by match_score.
 * READ-ONLY — no bindings are created or mutated.
 */
export async function buildProjectCastRecommendations(
  projectId: string,
): Promise<ProjectCastRecommendationResult> {
  // 1. Resolve project characters
  const characters = await resolveProjectCharacters(projectId);
  if (characters.length === 0) {
    return { project_id: projectId, characters: [] };
  }

  // 2. Get eligible actor pool (roster-ready with approved versions)
  const rosterActors = await getRosterActorsForCasting();
  if (rosterActors.length === 0) {
    return {
      project_id: projectId,
      characters: characters.map(c => ({
        character_key: c.character_key,
        recommendations: [],
      })),
    };
  }

  // 3. Score actors per character
  const results: CharacterRecommendationResult[] = characters.map(character => {
    const scored = rosterActors.map(actor => {
      const { match_score, reasons } = scoreActorForCharacter(character, actor);
      return {
        actor_id: actor.actor_id,
        actor_name: actor.actor_name,
        approved_version_id: actor.approved_version_id!,
        quality_score: actor.quality_score,
        quality_band: actor.quality_band,
        reusability_tier: actor.reusability_tier,
        project_count: actor.project_count,
        usage_count: actor.character_count,
        match_score,
        match_reasons: reasons,
      };
    });

    // 4. Deterministic sorting: match_score DESC, quality DESC, name ASC, id ASC
    scored.sort((a, b) => {
      if (b.match_score !== a.match_score) return b.match_score - a.match_score;
      if ((b.quality_score ?? -1) !== (a.quality_score ?? -1)) return (b.quality_score ?? -1) - (a.quality_score ?? -1);
      if (a.actor_name !== b.actor_name) return a.actor_name.localeCompare(b.actor_name);
      return a.actor_id.localeCompare(b.actor_id);
    });

    return {
      character_key: character.character_key,
      recommendations: scored.slice(0, MAX_RECOMMENDATIONS),
    };
  });

  return { project_id: projectId, characters: results };
}
