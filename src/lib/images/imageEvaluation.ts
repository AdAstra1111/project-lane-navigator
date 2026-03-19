/**
 * Image Evaluation System — Deterministic rule-based evaluation of images
 * against Character Visual DNA, canon constraints, and period/lore plausibility.
 * 
 * Hybrid approach: rule-based for clear matches/contradictions,
 * AI-assisted for nuanced compatibility and lore/period checks.
 */

import type { CharacterVisualDNA, VisualDNATrait } from './visualDNA';
import type { ProjectImage, CanonConstraints } from './types';

// ── Types ──

export type MatchLevel = 'high' | 'medium' | 'low' | 'unknown';
export type DriftRisk = 'none' | 'low' | 'medium' | 'high' | 'unknown';

export type PeriodPlausibility =
  | 'historically_valid'
  | 'historically_unlikely'
  | 'historically_impossible'
  | 'lore_valid'
  | 'lore_tension'
  | 'lore_contradiction'
  | 'anachronism'
  | 'material_mismatch'
  | 'unknown';

export interface ImageEvaluation {
  imageId: string;
  canonMatch: MatchLevel;
  continuityMatch: MatchLevel;
  narrativeFit: MatchLevel;
  wardrobeFit: MatchLevel;
  driftRisk: DriftRisk;
  periodPlausibility: PeriodPlausibility;
  loreCompatibility: string | null;
  
  contradictionFlags: string[];
  traitsSatisfied: string[];
  traitsViolated: string[];
  evaluationSummary: string;
  evaluationMethod: 'rule_based' | 'ai_assisted' | 'hybrid';
}

export interface ApprovalDecision {
  decisionType: 'approve' | 'reject' | 'reuse_pool';
  reason: string;
  note: string;
  traitsSatisfied: string[];
  traitsViolated: string[];
  destination: 'identity_anchor' | 'reference' | 'flexible' | 'reuse_pool' | 'archive';
}

export const REJECT_REASONS = [
  'wrong_age',
  'wrong_build',
  'wrong_face',
  'wrong_tone',
  'contradicts_canon',
  'continuity_drift',
  'period_mismatch',
  'reuse_pool_candidate',
  'quality_insufficient',
  'other',
] as const;

export type RejectReason = typeof REJECT_REASONS[number];

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  wrong_age: 'Wrong Age',
  wrong_build: 'Wrong Build',
  wrong_face: 'Wrong Face',
  wrong_tone: 'Wrong Tone',
  contradicts_canon: 'Contradicts Canon',
  continuity_drift: 'Continuity Drift',
  period_mismatch: 'Period/Era Mismatch',
  reuse_pool_candidate: 'Reuse Pool Candidate',
  quality_insufficient: 'Quality Insufficient',
  other: 'Other',
};

// ── Rule-Based Evaluation ──

/**
 * Evaluate an image against a character's Visual DNA using deterministic rules.
 * Checks prompt provenance, identity anchors, and trait coverage.
 */
export function evaluateImageAgainstDNA(
  image: ProjectImage,
  dna: CharacterVisualDNA | null,
  canonConstraints?: CanonConstraints,
): ImageEvaluation {
  const result: ImageEvaluation = {
    imageId: image.id,
    canonMatch: 'unknown',
    continuityMatch: 'unknown',
    narrativeFit: 'unknown',
    wardrobeFit: 'unknown',
    driftRisk: 'unknown',
    periodPlausibility: 'unknown',
    loreCompatibility: null,
    contradictionFlags: [],
    traitsSatisfied: [],
    traitsViolated: [],
    evaluationSummary: '',
    evaluationMethod: 'rule_based',
  };
  
  if (!dna) {
    result.evaluationSummary = 'No Visual DNA available — evaluation skipped.';
    return result;
  }
  
  const prompt = (image.prompt_used || '').toLowerCase();
  
  // Check script truth traits against prompt
  const scriptSatisfied: string[] = [];
  const scriptMissing: string[] = [];
  
  for (const trait of dna.scriptTruth.traits) {
    if (isTraitInPrompt(trait, prompt)) {
      scriptSatisfied.push(trait.label);
    } else {
      scriptMissing.push(trait.label);
    }
  }
  
  // Check locked invariants
  const invariantsSatisfied: string[] = [];
  const invariantsViolated: string[] = [];
  
  for (const inv of dna.lockedInvariants) {
    if (isTraitInPrompt(inv, prompt)) {
      invariantsSatisfied.push(inv.label);
    } else {
      invariantsViolated.push(inv.label);
    }
  }
  
  // Check narrative markers
  const narrativeSatisfied: string[] = [];
  for (const marker of dna.narrativeMarkers.traits) {
    if (isTraitInPrompt(marker, prompt)) {
      narrativeSatisfied.push(marker.label);
    }
  }
  
  // Check wardrobe traits
  const wardrobeTraits = [...dna.scriptTruth.traits, ...dna.inferredGuidance.traits]
    .filter(t => t.category === 'clothing');
  const wardrobeSatisfied = wardrobeTraits.filter(t => isTraitInPrompt(t, prompt));
  
  // Compute match levels
  result.traitsSatisfied = [...scriptSatisfied, ...invariantsSatisfied];
  result.traitsViolated = invariantsViolated;
  
  const totalScript = dna.scriptTruth.traits.length;
  const scriptRatio = totalScript > 0 ? scriptSatisfied.length / totalScript : 0;
  result.canonMatch = scriptRatio >= 0.7 ? 'high' : scriptRatio >= 0.4 ? 'medium' : totalScript === 0 ? 'unknown' : 'low';
  
  // Continuity: based on identity anchor usage
  const usesIdentityRef = prompt.includes('identity') || prompt.includes('reference') ||
    (image.generation_purpose === 'character_identity');
  result.continuityMatch = usesIdentityRef ? 'high' : invariantsViolated.length === 0 ? 'medium' : 'low';
  
  // Narrative fit
  const totalNarrative = dna.narrativeMarkers.traits.length;
  result.narrativeFit = totalNarrative === 0 ? 'unknown' :
    narrativeSatisfied.length >= totalNarrative ? 'high' :
    narrativeSatisfied.length > 0 ? 'medium' : 'low';
  
  // Wardrobe fit
  result.wardrobeFit = wardrobeTraits.length === 0 ? 'unknown' :
    wardrobeSatisfied.length >= wardrobeTraits.length * 0.6 ? 'high' :
    wardrobeSatisfied.length > 0 ? 'medium' : 'low';
  
  // Drift risk
  if (invariantsViolated.length > 0) {
    result.driftRisk = invariantsViolated.length >= 3 ? 'high' : 'medium';
    result.contradictionFlags = invariantsViolated.map(v => `Locked invariant missing from prompt: ${v}`);
  } else if (scriptMissing.length > totalScript * 0.5 && totalScript > 0) {
    result.driftRisk = 'low';
  } else {
    result.driftRisk = 'none';
  }
  
  // Period plausibility (rule-based check)
  if (canonConstraints?.era) {
    result.periodPlausibility = evaluatePeriodPlausibility(prompt, canonConstraints.era);
  }
  
  // Build summary
  const summaryParts: string[] = [];
  const finalCanon: string = result.canonMatch;
  const finalDrift: string = result.driftRisk;
  if (finalCanon !== 'unknown') summaryParts.push(`Canon: ${finalCanon}`);
  if (invariantsViolated.length > 0) summaryParts.push(`${invariantsViolated.length} invariant(s) at risk`);
  if (finalDrift !== 'none' && finalDrift !== 'unknown') summaryParts.push(`Drift risk: ${finalDrift}`);
  result.evaluationSummary = summaryParts.join('. ') || 'Evaluation complete.';
  
  return result;
}

/**
 * Check if a trait keyword appears in a prompt.
 */
function isTraitInPrompt(trait: VisualDNATrait, prompt: string): boolean {
  const words = trait.label.toLowerCase().split(/\s+/);
  // At least half the words in the trait label should appear in prompt
  const matchCount = words.filter(w => w.length > 3 && prompt.includes(w)).length;
  return matchCount >= Math.ceil(words.length * 0.5);
}

/**
 * Simple rule-based period plausibility check.
 */
function evaluatePeriodPlausibility(prompt: string, era: string): PeriodPlausibility {
  const eraLower = era.toLowerCase();
  const promptLower = prompt.toLowerCase();
  
  // Check for anachronistic tech references
  const modernTech = /\b(smartphone|computer|car|television|electric|neon|LED|headphones|laptop)\b/i;
  const ancientSettings = /\b(medieval|ancient|roman|greek|viking|prehistoric|bronze age|iron age)\b/i;
  
  if (ancientSettings.test(eraLower) && modernTech.test(promptLower)) {
    return 'anachronism';
  }
  
  // Check for material mismatches
  const syntheticMaterials = /\b(plastic|nylon|polyester|synthetic|lycra|spandex)\b/i;
  const preindustrialEras = /\b(medieval|renaissance|baroque|ancient|roman|greek|tudor|elizabethan|regency|victorian|colonial)\b/i;
  
  if (preindustrialEras.test(eraLower) && syntheticMaterials.test(promptLower)) {
    return 'material_mismatch';
  }
  
  return 'unknown';
}

// ── Serialization for database ──

export function serializeEvaluationForStorage(eval_: ImageEvaluation) {
  return {
    image_id: eval_.imageId,
    canon_match: eval_.canonMatch,
    continuity_match: eval_.continuityMatch,
    narrative_fit: eval_.narrativeFit,
    wardrobe_fit: eval_.wardrobeFit,
    drift_risk: eval_.driftRisk,
    period_plausibility: eval_.periodPlausibility,
    lore_compatibility: eval_.loreCompatibility,
    contradiction_flags: eval_.contradictionFlags,
    traits_satisfied: eval_.traitsSatisfied,
    traits_violated: eval_.traitsViolated,
    evaluation_summary: eval_.evaluationSummary,
    evaluation_method: eval_.evaluationMethod,
  };
}

export function serializeDecisionForStorage(decision: ApprovalDecision) {
  return {
    decision_type: decision.decisionType,
    decision_reason: decision.reason,
    decision_note: decision.note,
    destination: decision.destination,
    traits_satisfied: decision.traitsSatisfied,
    traits_violated: decision.traitsViolated,
  };
}
