/**
 * Image Evaluation System — Two-layer governance evaluation.
 * 
 * Layer A: Prompt/Provenance Audit — deterministic check of prompt against DNA traits.
 * Layer B: Image-vs-Anchor Audit — comparison of image metadata against locked identity anchors.
 * 
 * Both layers produce independent results; final governance verdict merges them.
 * Every evaluation MUST store dna_version_id for provenance.
 */

import type { CharacterVisualDNA, VisualDNATrait } from './visualDNA';
import type { ProjectImage, CanonConstraints } from './types';

// ── Types ──

export type MatchLevel = 'high' | 'medium' | 'low' | 'unknown';
export type DriftRisk = 'none' | 'low' | 'medium' | 'high' | 'unknown';
export type GovernanceVerdict = 'approved' | 'review_required' | 'flagged' | 'rejected' | 'pending';

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

/** Layer A: Prompt/provenance audit result */
export interface PromptAuditResult {
  traitsCoveredCount: number;
  traitsTotalCount: number;
  traitsSatisfied: string[];
  traitsMissing: string[];
  invariantsSatisfied: string[];
  invariantsViolated: string[];
  promptCanonMatch: MatchLevel;
  promptDriftRisk: DriftRisk;
  periodPlausibility: PeriodPlausibility;
}

/** Layer B: Image-vs-anchor audit result */
export interface ImageAuditResult {
  hasIdentityAnchors: boolean;
  anchorTypes: string[];
  generationPurposeMatch: boolean;
  identityLockEnforced: boolean;
  modelConsistency: MatchLevel;
  providerConsistency: boolean;
  imageAnchorMatch: MatchLevel;
}

/** Combined evaluation with explicit two-layer provenance */
export interface ImageEvaluation {
  imageId: string;
  dnaVersionId: string | null;
  
  // Layer A
  promptAudit: PromptAuditResult;
  
  // Layer B
  imageAudit: ImageAuditResult;
  
  // Merged governance
  canonMatch: MatchLevel;
  continuityMatch: MatchLevel;
  narrativeFit: MatchLevel;
  wardrobeFit: MatchLevel;
  driftRisk: DriftRisk;
  periodPlausibility: PeriodPlausibility;
  loreCompatibility: string | null;
  governanceVerdict: GovernanceVerdict;
  
  contradictionFlags: string[];
  evaluationSummary: string;
  evaluationMethod: 'rule_based' | 'ai_assisted' | 'hybrid';
  
  /** Producer-facing explanation */
  explanation: ExplanationItem[];
}

export interface ExplanationItem {
  type: 'safe' | 'conflict' | 'drift' | 'regen_needed' | 'info';
  message: string;
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

// ── Layer A: Prompt/Provenance Audit ──

function runPromptAudit(
  image: ProjectImage,
  dna: CharacterVisualDNA,
  canonConstraints?: CanonConstraints,
): PromptAuditResult {
  const prompt = (image.prompt_used || '').toLowerCase();
  
  const scriptSatisfied: string[] = [];
  const scriptMissing: string[] = [];
  for (const trait of dna.scriptTruth.traits) {
    if (isTraitInPrompt(trait, prompt)) {
      scriptSatisfied.push(trait.label);
    } else {
      scriptMissing.push(trait.label);
    }
  }
  
  const invariantsSatisfied: string[] = [];
  const invariantsViolated: string[] = [];
  for (const inv of dna.lockedInvariants) {
    if (isTraitInPrompt(inv, prompt)) {
      invariantsSatisfied.push(inv.label);
    } else {
      invariantsViolated.push(inv.label);
    }
  }
  
  const totalScript = dna.scriptTruth.traits.length;
  const scriptRatio = totalScript > 0 ? scriptSatisfied.length / totalScript : 0;
  const promptCanonMatch: MatchLevel = scriptRatio >= 0.7 ? 'high' : scriptRatio >= 0.4 ? 'medium' : totalScript === 0 ? 'unknown' : 'low';
  
  const promptDriftRisk: DriftRisk = invariantsViolated.length >= 3 ? 'high' :
    invariantsViolated.length > 0 ? 'medium' :
    scriptMissing.length > totalScript * 0.5 && totalScript > 0 ? 'low' : 'none';
  
  let periodPlausibility: PeriodPlausibility = 'unknown';
  if (canonConstraints?.era) {
    periodPlausibility = evaluatePeriodPlausibility(prompt, canonConstraints.era);
  }
  
  return {
    traitsCoveredCount: scriptSatisfied.length,
    traitsTotalCount: totalScript,
    traitsSatisfied: scriptSatisfied,
    traitsMissing: scriptMissing,
    invariantsSatisfied,
    invariantsViolated,
    promptCanonMatch,
    promptDriftRisk,
    periodPlausibility,
  };
}

// ── Layer B: Image-vs-Anchor Audit ──

function runImageAudit(
  image: ProjectImage,
  dna: CharacterVisualDNA,
  allProjectImages?: ProjectImage[],
): ImageAuditResult {
  // Check if identity anchors exist
  const anchorImages = (allProjectImages || []).filter(img =>
    img.is_primary &&
    img.subject === image.subject &&
    (img.shot_type === 'identity_headshot' || img.shot_type === 'identity_full_body') &&
    img.curation_state === 'active'
  );
  
  const hasIdentityAnchors = anchorImages.length >= 2;
  const anchorTypes = anchorImages.map(a => a.shot_type || 'unknown');
  
  // Check generation purpose alignment
  const generationPurposeMatch = image.generation_purpose === 'character_identity' ||
    image.asset_group === 'character';
  
  // Check identity lock enforcement — was this generated with locked identity?
  const genConfig = image.generation_config || {};
  const identityLockEnforced = !!(genConfig as any).identity_locked || !!(genConfig as any).identity_anchor_paths;
  
  // Model consistency — same model family as anchors
  const anchorModels = new Set(anchorImages.map(a => a.model));
  const modelConsistency: MatchLevel = anchorModels.size === 0 ? 'unknown' :
    anchorModels.has(image.model) ? 'high' : 'medium';
  
  // Provider consistency
  const anchorProviders = new Set(anchorImages.map(a => a.provider));
  const providerConsistency = anchorProviders.size === 0 || anchorProviders.has(image.provider);
  
  // Image-anchor match: high if generated with locked anchors, otherwise based on existence
  const imageAnchorMatch: MatchLevel = identityLockEnforced && hasIdentityAnchors ? 'high' :
    hasIdentityAnchors ? 'medium' : 'low';
  
  return {
    hasIdentityAnchors,
    anchorTypes,
    generationPurposeMatch,
    identityLockEnforced,
    modelConsistency,
    providerConsistency,
    imageAnchorMatch,
  };
}

// ── Governance Verdict ──

function computeGovernanceVerdict(
  promptAudit: PromptAuditResult,
  imageAudit: ImageAuditResult,
): GovernanceVerdict {
  // Hard reject conditions
  if (promptAudit.invariantsViolated.length >= 3) return 'rejected';
  if (promptAudit.periodPlausibility === 'anachronism') return 'flagged';
  
  // Flagged conditions
  if (promptAudit.invariantsViolated.length > 0) return 'flagged';
  if (!imageAudit.identityLockEnforced && imageAudit.hasIdentityAnchors) return 'review_required';
  
  // Review conditions
  if (promptAudit.promptCanonMatch === 'low') return 'review_required';
  if (promptAudit.promptDriftRisk === 'medium') return 'review_required';
  
  // Approved
  if (promptAudit.promptCanonMatch === 'high' && imageAudit.imageAnchorMatch === 'high') return 'approved';
  
  return 'review_required';
}

// ── Explanation Builder ──

function buildExplanation(
  promptAudit: PromptAuditResult,
  imageAudit: ImageAuditResult,
  dna: CharacterVisualDNA,
): ExplanationItem[] {
  const items: ExplanationItem[] = [];
  
  // Safety
  if (promptAudit.promptCanonMatch === 'high') {
    items.push({ type: 'safe', message: `Prompt covers ${promptAudit.traitsCoveredCount}/${promptAudit.traitsTotalCount} canon traits.` });
  }
  if (imageAudit.identityLockEnforced) {
    items.push({ type: 'safe', message: 'Generated with locked identity anchors — face/body consistency enforced.' });
  }
  
  // Conflicts
  for (const v of promptAudit.invariantsViolated) {
    items.push({ type: 'conflict', message: `Locked invariant missing from prompt: "${v}".` });
  }
  if (promptAudit.periodPlausibility === 'anachronism') {
    items.push({ type: 'conflict', message: 'Period anachronism detected — elements incompatible with era.' });
  }
  if (promptAudit.periodPlausibility === 'material_mismatch') {
    items.push({ type: 'conflict', message: 'Material mismatch — synthetic/industrial materials in pre-industrial setting.' });
  }
  
  // Drift
  if (promptAudit.promptDriftRisk !== 'none' && promptAudit.promptDriftRisk !== 'unknown') {
    items.push({ type: 'drift', message: `Drift risk: ${promptAudit.promptDriftRisk}. ${promptAudit.traitsMissing.length} canon traits not in prompt.` });
  }
  if (!imageAudit.identityLockEnforced && imageAudit.hasIdentityAnchors) {
    items.push({ type: 'drift', message: 'Identity anchors exist but were NOT used for this generation — face may differ.' });
  }
  
  // What must not drift
  if (dna.lockedInvariants.length > 0 && promptAudit.invariantsViolated.length === 0) {
    items.push({ type: 'safe', message: `All ${dna.lockedInvariants.length} locked invariants present in prompt.` });
  }
  
  // Regen needed
  if (!imageAudit.hasIdentityAnchors) {
    items.push({ type: 'regen_needed', message: 'No identity anchors locked — generate and lock identity headshot + full body first.' });
  }
  
  return items;
}

// ── Main Evaluator ──

/**
 * Two-layer evaluation: prompt audit + image-vs-anchor audit.
 * Produces governance verdict with explainability.
 * REQUIRES dna for evaluation — returns pending if null.
 */
export function evaluateImageAgainstDNA(
  image: ProjectImage,
  dna: CharacterVisualDNA | null,
  canonConstraints?: CanonConstraints,
  dnaVersionId?: string | null,
  allProjectImages?: ProjectImage[],
): ImageEvaluation {
  // No DNA = no evaluation possible
  if (!dna) {
    return {
      imageId: image.id,
      dnaVersionId: null,
      promptAudit: {
        traitsCoveredCount: 0, traitsTotalCount: 0, traitsSatisfied: [], traitsMissing: [],
        invariantsSatisfied: [], invariantsViolated: [],
        promptCanonMatch: 'unknown', promptDriftRisk: 'unknown', periodPlausibility: 'unknown',
      },
      imageAudit: {
        hasIdentityAnchors: false, anchorTypes: [], generationPurposeMatch: false,
        identityLockEnforced: false, modelConsistency: 'unknown', providerConsistency: true,
        imageAnchorMatch: 'unknown',
      },
      canonMatch: 'unknown', continuityMatch: 'unknown', narrativeFit: 'unknown',
      wardrobeFit: 'unknown', driftRisk: 'unknown', periodPlausibility: 'unknown',
      loreCompatibility: null, governanceVerdict: 'pending',
      contradictionFlags: [], evaluationSummary: 'No Visual DNA available — evaluation deferred.',
      evaluationMethod: 'rule_based',
      explanation: [{ type: 'info', message: 'No Visual DNA resolved yet. Resolve DNA to enable evaluation.' }],
    };
  }
  
  // Layer A: Prompt audit
  const promptAudit = runPromptAudit(image, dna, canonConstraints);
  
  // Layer B: Image-vs-anchor audit
  const imageAudit = runImageAudit(image, dna, allProjectImages);
  
  // Merge into governance
  const governanceVerdict = computeGovernanceVerdict(promptAudit, imageAudit);
  const explanation = buildExplanation(promptAudit, imageAudit, dna);
  
  // Narrative fit
  const narrativeTraits = dna.narrativeMarkers.traits;
  const prompt = (image.prompt_used || '').toLowerCase();
  const narrativeSatisfied = narrativeTraits.filter(t => isTraitInPrompt(t, prompt));
  const narrativeFit: MatchLevel = narrativeTraits.length === 0 ? 'unknown' :
    narrativeSatisfied.length >= narrativeTraits.length ? 'high' :
    narrativeSatisfied.length > 0 ? 'medium' : 'low';
  
  // Wardrobe fit
  const wardrobeTraits = [...dna.scriptTruth.traits, ...dna.inferredGuidance.traits]
    .filter(t => t.category === 'clothing');
  const wardrobeSatisfied = wardrobeTraits.filter(t => isTraitInPrompt(t, prompt));
  const wardrobeFit: MatchLevel = wardrobeTraits.length === 0 ? 'unknown' :
    wardrobeSatisfied.length >= wardrobeTraits.length * 0.6 ? 'high' :
    wardrobeSatisfied.length > 0 ? 'medium' : 'low';
  
  // Continuity: merge both layers
  const continuityMatch: MatchLevel = imageAudit.identityLockEnforced ? 'high' :
    imageAudit.hasIdentityAnchors && promptAudit.invariantsViolated.length === 0 ? 'medium' : 'low';
  
  // Build summary
  const summaryParts: string[] = [];
  if (promptAudit.promptCanonMatch !== 'unknown') summaryParts.push(`Canon: ${promptAudit.promptCanonMatch}`);
  if (promptAudit.invariantsViolated.length > 0) summaryParts.push(`${promptAudit.invariantsViolated.length} invariant(s) at risk`);
  if (promptAudit.promptDriftRisk !== 'none' && promptAudit.promptDriftRisk !== 'unknown') summaryParts.push(`Drift: ${promptAudit.promptDriftRisk}`);
  if (!imageAudit.identityLockEnforced && imageAudit.hasIdentityAnchors) summaryParts.push('Identity lock not enforced');
  
  return {
    imageId: image.id,
    dnaVersionId: dnaVersionId || null,
    promptAudit,
    imageAudit,
    canonMatch: promptAudit.promptCanonMatch,
    continuityMatch,
    narrativeFit,
    wardrobeFit,
    driftRisk: promptAudit.promptDriftRisk,
    periodPlausibility: promptAudit.periodPlausibility,
    loreCompatibility: null,
    governanceVerdict,
    contradictionFlags: promptAudit.invariantsViolated.map(v => `Locked invariant missing: ${v}`),
    evaluationSummary: summaryParts.join('. ') || 'Evaluation complete.',
    evaluationMethod: 'rule_based',
    explanation,
  };
}

// ── Helpers ──

function isTraitInPrompt(trait: VisualDNATrait, prompt: string): boolean {
  const words = trait.label.toLowerCase().split(/\s+/);
  const matchCount = words.filter(w => w.length > 3 && prompt.includes(w)).length;
  return matchCount >= Math.ceil(words.length * 0.5);
}

function evaluatePeriodPlausibility(prompt: string, era: string): PeriodPlausibility {
  const eraLower = era.toLowerCase();
  const promptLower = prompt.toLowerCase();
  
  const modernTech = /\b(smartphone|computer|car|television|electric|neon|LED|headphones|laptop|game\s?boy|nintendo|playstation|xbox|microwave|refrigerator|air\s?condition|plastic\s?bottle|synthetic\s?fabric)\b/i;
  const ancientSettings = /\b(medieval|ancient|roman|greek|viking|prehistoric|bronze age|iron age)\b/i;
  
  if (ancientSettings.test(eraLower) && modernTech.test(promptLower)) {
    return 'anachronism';
  }
  
  const syntheticMaterials = /\b(plastic|nylon|polyester|synthetic|lycra|spandex|acrylic|polycarbonate|styrofoam|vinyl|PVC)\b/i;
  const preindustrialEras = /\b(medieval|renaissance|baroque|ancient|roman|greek|tudor|elizabethan|regency|victorian|colonial|1[0-7]\d{2}s?)\b/i;
  
  if (preindustrialEras.test(eraLower) && syntheticMaterials.test(promptLower)) {
    return 'material_mismatch';
  }
  
  return 'unknown';
}

// ── Serialization ──

export function serializeEvaluationForStorage(eval_: ImageEvaluation) {
  return {
    image_id: eval_.imageId,
    dna_version_id: eval_.dnaVersionId,
    canon_match: eval_.canonMatch,
    continuity_match: eval_.continuityMatch,
    narrative_fit: eval_.narrativeFit,
    wardrobe_fit: eval_.wardrobeFit,
    drift_risk: eval_.driftRisk,
    period_plausibility: eval_.periodPlausibility,
    lore_compatibility: eval_.loreCompatibility,
    contradiction_flags: eval_.contradictionFlags,
    traits_satisfied: eval_.promptAudit.traitsSatisfied,
    traits_violated: eval_.promptAudit.invariantsViolated,
    evaluation_summary: eval_.evaluationSummary,
    evaluation_method: eval_.evaluationMethod,
    prompt_audit_result: eval_.promptAudit,
    image_audit_result: eval_.imageAudit,
    governance_verdict: eval_.governanceVerdict,
    explanation: eval_.explanation,
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
