/**
 * plateauDiagnosis.ts — Deterministic Plateau Diagnosis + DevSeed Recommendation Engine
 *
 * Rule-based heuristics for diagnosing WHY an Auto-Run plateaued below target,
 * and what structural action is most likely to unblock progress.
 *
 * This is retrieval-first and architecture-strict:
 *  - No LLM calls
 *  - No freeform prose generation
 *  - Deterministic classification from structured inputs
 */

// ── Cause Classes ──
export const PLATEAU_CAUSES = [
  'weak_hook',
  'weak_conflict_engine',
  'weak_lane_fit',
  'weak_market_heat',
  'weak_feasibility',
  'canon_scaffold_weak',
  'escalation_architecture_weak',
  'blueprint_mismatch',
  'dna_mismatch',
  'rewrite_exhausted',
  'seed_limited',
  'unknown',
] as const;
export type PlateauCause = typeof PLATEAU_CAUSES[number];

// ── Recommendation Types ──
export const RECOMMENDATION_TYPES = [
  'continue_rewrite',
  'force_advance_stage',
  'regenerate_devseed',
  'switch_blueprint',
  'remove_dna_constraint',
  'apply_different_dna',
  'strengthen_hook',
  'strengthen_conflict_engine',
  'change_lane',
  'simplify_budget_scope',
  'strengthen_canon_scaffold',
] as const;
export type RecommendationType = typeof RECOMMENDATION_TYPES[number];

// ── Diagnosis Input ──
export interface PlateauDiagnosisInput {
  project_id: string;
  auto_run_job_id: string;
  user_id: string;
  // Quality metrics
  target_ci: number;
  target_gp: number;
  final_ci: number | null;
  final_gp: number | null;
  best_ci_seen: number | null;
  // Job metadata
  halted_doc_type: string | null;
  halted_reason: string | null;
  step_count: number;
  stage_loop_count: number;
  // Lineage (nullable)
  pitch_idea_id?: string | null;
  source_dna_profile_id?: string | null;
  source_blueprint_id?: string | null;
  source_blueprint_run_id?: string | null;
  generation_mode?: string | null;
  optimizer_mode?: string | null;
  // Contextual signals
  blocker_note_count?: number;
  high_note_count?: number;
  total_versions_for_doc?: number;
  // Step-level signals (from last few steps)
  recent_step_actions?: string[];
  // Project metadata
  project_format?: string | null;
  project_lane?: string | null;
  project_budget_range?: string | null;
}

// ── Recommendation ──
export interface PlateauRecommendation {
  recommendation_type: RecommendationType;
  short_label: string;
  rationale: string;
  recommended_mutations: string[];
  recommended_quality_target?: { ci: number; gp: number } | null;
  recommended_blueprint_mode?: string | null;
  recommended_generation_mode?: string | null;
  recommended_lane?: string | null;
  recommended_budget_band?: string | null;
  dna_action?: string | null;
  blueprint_action?: string | null;
}

// ── Full Diagnosis Output ──
export interface PlateauDiagnosis {
  project_id: string;
  auto_run_job_id: string;
  user_id: string;
  target_ci: number;
  target_gp: number;
  final_ci: number | null;
  final_gp: number | null;
  best_ci_seen: number | null;
  halted_doc_type: string | null;
  halted_reason: string | null;
  diagnosis_version: string;
  primary_cause: PlateauCause;
  secondary_causes: PlateauCause[];
  rewriteable: boolean;
  seed_limited: boolean;
  confidence: 'high' | 'medium' | 'low';
  evidence_summary: string[];
  recommendation_bundle: PlateauRecommendation;
  // Lineage passthrough
  pitch_idea_id?: string | null;
  source_dna_profile_id?: string | null;
  source_blueprint_id?: string | null;
  source_blueprint_run_id?: string | null;
  generation_mode?: string | null;
  optimizer_mode?: string | null;
}

const DIAGNOSIS_VERSION = 'v1';

// ── Heuristic thresholds ──
const CI_GAP_LARGE = 15;       // >15 points from target = structurally limited
const CI_GAP_MEDIUM = 8;       // 8-15 points = possibly improvable
const MIN_VERSIONS_FOR_EXHAUSTION = 4;
const MIN_STEPS_FOR_EXHAUSTION = 8;
const EARLY_STAGE_DOCS = ['idea', 'brief', 'concept'];

/**
 * computePlateauDiagnosis — Pure deterministic function.
 * No IO, no DB calls. All inputs must be pre-fetched.
 */
export function computePlateauDiagnosis(input: PlateauDiagnosisInput): PlateauDiagnosis {
  const evidence: string[] = [];
  const secondaryCauses: PlateauCause[] = [];
  let primaryCause: PlateauCause = 'unknown';
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const bestCi = input.best_ci_seen ?? input.final_ci ?? 0;
  const targetCi = input.target_ci;
  const ciGap = targetCi - bestCi;
  const isEarlyStage = EARLY_STAGE_DOCS.includes(input.halted_doc_type ?? '');
  const hasLineage = !!(input.source_blueprint_id || input.source_dna_profile_id);
  const totalVersions = input.total_versions_for_doc ?? 0;
  const recentActions = input.recent_step_actions ?? [];

  // ── Evidence collection ──
  evidence.push(`Best CI: ${bestCi}, Target: ${targetCi}, Gap: ${ciGap}`);
  evidence.push(`Halted on: ${input.halted_doc_type ?? 'unknown'}, Reason: ${input.halted_reason ?? 'unknown'}`);
  evidence.push(`Steps: ${input.step_count}, Stage loops: ${input.stage_loop_count}`);
  if (totalVersions > 0) evidence.push(`Versions generated for doc: ${totalVersions}`);
  if (input.blocker_note_count) evidence.push(`Blocker notes: ${input.blocker_note_count}`);
  if (input.high_note_count) evidence.push(`High-severity notes: ${input.high_note_count}`);
  if (hasLineage) evidence.push(`Lineage: blueprint=${input.source_blueprint_id ?? 'none'}, dna=${input.source_dna_profile_id ?? 'none'}`);

  // ── Classification heuristics ──

  // 1. Rewrite exhaustion: many versions, many steps, CI not moving
  const rewriteExhausted = totalVersions >= MIN_VERSIONS_FOR_EXHAUSTION
    && input.step_count >= MIN_STEPS_FOR_EXHAUSTION
    && ciGap > CI_GAP_MEDIUM;

  if (rewriteExhausted) {
    secondaryCauses.push('rewrite_exhausted');
    evidence.push('Rewrite exhaustion: multiple versions + steps without CI convergence');
  }

  // 2. Large CI gap on early-stage doc → seed is structurally limited
  if (isEarlyStage && ciGap > CI_GAP_LARGE) {
    primaryCause = 'seed_limited';
    confidence = 'high';
    evidence.push(`Large CI gap (${ciGap}) on early-stage doc (${input.halted_doc_type}) — seed architecture likely limiting`);
  }
  // 3. Large CI gap on later doc with many rewrites → also seed-limited
  else if (!isEarlyStage && ciGap > CI_GAP_LARGE && rewriteExhausted) {
    primaryCause = 'seed_limited';
    confidence = 'high';
    evidence.push(`Large CI gap (${ciGap}) persists after exhaustive rewrites — seed architecture constraining quality ceiling`);
  }
  // 4. Medium CI gap with rewrite exhaustion → weak structural element
  else if (ciGap > CI_GAP_MEDIUM && rewriteExhausted) {
    // Try to narrow down which structural element
    const hasHookSignals = recentActions.some(a =>
      a.includes('hook') || a.includes('logline') || a.includes('premise'));
    const hasConflictSignals = recentActions.some(a =>
      a.includes('conflict') || a.includes('antagonist') || a.includes('stakes'));

    if (hasHookSignals) {
      primaryCause = 'weak_hook';
      confidence = 'medium';
      evidence.push('Recent steps focused on hook/logline/premise without CI improvement');
    } else if (hasConflictSignals) {
      primaryCause = 'weak_conflict_engine';
      confidence = 'medium';
      evidence.push('Recent steps focused on conflict/antagonist/stakes without CI improvement');
    } else {
      primaryCause = 'escalation_architecture_weak';
      confidence = 'medium';
      evidence.push(`CI gap ${ciGap} with ${totalVersions} versions — escalation architecture insufficient`);
    }
  }
  // 5. CI gap with no notes remaining → canon or structural issue
  else if (ciGap > 0 && (input.blocker_note_count ?? 0) === 0 && (input.high_note_count ?? 0) === 0) {
    if (isEarlyStage) {
      primaryCause = 'canon_scaffold_weak';
      confidence = 'medium';
      evidence.push('No actionable notes remain but CI below target on early doc — canon scaffold may be insufficient');
    } else {
      primaryCause = 'rewrite_exhausted';
      confidence = 'medium';
      evidence.push('No actionable notes, CI below target — rewrite capacity exhausted for this seed');
    }
  }
  // 6. Still has notes but plateaued → may still be rewriteable
  else if ((input.blocker_note_count ?? 0) > 0 && ciGap <= CI_GAP_MEDIUM) {
    primaryCause = 'rewrite_exhausted';
    confidence = 'low';
    evidence.push(`Small CI gap (${ciGap}) with blocker notes — may still improve with targeted rewrites`);
  }

  // ── Blueprint/DNA mismatch detection ──
  if (hasLineage && primaryCause === 'seed_limited') {
    if (input.source_blueprint_id) {
      secondaryCauses.push('blueprint_mismatch');
      evidence.push('Seed has blueprint lineage but plateaued — blueprint pattern may not suit target quality');
    }
    if (input.source_dna_profile_id) {
      secondaryCauses.push('dna_mismatch');
      evidence.push('Seed has DNA lineage but plateaued — DNA constraints may be limiting quality ceiling');
    }
  }

  // ── Determine rewriteability ──
  const seedLimited = primaryCause === 'seed_limited'
    || (primaryCause === 'weak_hook' && rewriteExhausted)
    || (primaryCause === 'weak_conflict_engine' && rewriteExhausted);

  const rewriteable = !seedLimited && ciGap <= CI_GAP_MEDIUM;

  // ── Build recommendation ──
  const recommendation = buildRecommendation(primaryCause, secondaryCauses, {
    ciGap, bestCi, targetCi, rewriteable, seedLimited,
    hasBlueprint: !!input.source_blueprint_id,
    hasDna: !!input.source_dna_profile_id,
    isEarlyStage,
  });

  return {
    project_id: input.project_id,
    auto_run_job_id: input.auto_run_job_id,
    user_id: input.user_id,
    target_ci: input.target_ci,
    target_gp: input.target_gp,
    final_ci: input.final_ci,
    final_gp: input.final_gp,
    best_ci_seen: input.best_ci_seen,
    halted_doc_type: input.halted_doc_type,
    halted_reason: input.halted_reason,
    diagnosis_version: DIAGNOSIS_VERSION,
    primary_cause: primaryCause,
    secondary_causes: secondaryCauses,
    rewriteable,
    seed_limited: seedLimited,
    confidence,
    evidence_summary: evidence,
    recommendation_bundle: recommendation,
    pitch_idea_id: input.pitch_idea_id,
    source_dna_profile_id: input.source_dna_profile_id,
    source_blueprint_id: input.source_blueprint_id,
    source_blueprint_run_id: input.source_blueprint_run_id,
    generation_mode: input.generation_mode,
    optimizer_mode: input.optimizer_mode,
  };
}

// ── Recommendation Builder ──

interface RecommendationContext {
  ciGap: number;
  bestCi: number;
  targetCi: number;
  rewriteable: boolean;
  seedLimited: boolean;
  hasBlueprint: boolean;
  hasDna: boolean;
  isEarlyStage: boolean;
}

function buildRecommendation(
  primary: PlateauCause,
  secondary: PlateauCause[],
  ctx: RecommendationContext,
): PlateauRecommendation {
  // Default fallback
  const fallback: PlateauRecommendation = {
    recommendation_type: 'force_advance_stage',
    short_label: 'Force advance with best version',
    rationale: `CI gap of ${ctx.ciGap} points may not close with current seed. Consider force-advancing with the strongest available version (CI ~${ctx.bestCi}) or regenerating the seed.`,
    recommended_mutations: ['Force-promote best available version to advance the pipeline', 'Or regenerate DevSeed with stronger structural foundations'],
  };

  switch (primary) {
    case 'seed_limited':
      return {
        recommendation_type: 'regenerate_devseed',
        short_label: 'Regenerate DevSeed',
        rationale: `Seed architecture is capping quality at CI ~${ctx.bestCi}. A new seed with stronger structural foundations is more likely to reach ${ctx.targetCi}+.`,
        recommended_mutations: [
          'Create new pitch idea with stronger hook/conflict architecture',
          ctx.hasBlueprint ? 'Consider a different blueprint pattern' : 'Consider using a CI Blueprint for structural guidance',
          ctx.hasDna ? 'Review DNA constraints — they may be too restrictive' : 'Consider applying a Narrative DNA profile for structural grounding',
        ],
        dna_action: ctx.hasDna ? 'review_constraints' : 'consider_applying',
        blueprint_action: ctx.hasBlueprint ? 'switch_pattern' : 'consider_using',
      };

    case 'weak_hook':
      return {
        recommendation_type: 'strengthen_hook',
        short_label: 'Strengthen hook architecture',
        rationale: `Hook/logline/premise quality is limiting CI. ${ctx.seedLimited ? 'This seed may need full regeneration.' : 'Targeted hook improvement may close the gap.'}`,
        recommended_mutations: [
          'Revise logline for stronger dramatic irony or high-concept clarity',
          'Ensure protagonist has clear, external, measurable goal',
          'Verify stakes are concrete and escalating',
        ],
      };

    case 'weak_conflict_engine':
      return {
        recommendation_type: 'strengthen_conflict_engine',
        short_label: 'Strengthen conflict engine',
        rationale: `Conflict/antagonist/stakes architecture is limiting quality ceiling. ${ctx.seedLimited ? 'Seed may need structural redesign.' : 'Targeted conflict improvement may help.'}`,
        recommended_mutations: [
          'Ensure antagonist has clear motivation and active opposition',
          'Verify escalation pattern across act structure',
          'Check for dramatic irony and information asymmetry',
        ],
      };

    case 'canon_scaffold_weak':
      return {
        recommendation_type: 'strengthen_canon_scaffold',
        short_label: 'Strengthen canon scaffold',
        rationale: `Early-stage document lacks sufficient structural grounding. Canon scaffold needs enrichment.`,
        recommended_mutations: [
          'Ensure world rules are explicit and constraining',
          'Verify character motivations are concrete',
          'Add specific tonal/genre anchors',
        ],
      };

    case 'blueprint_mismatch':
      return {
        recommendation_type: 'switch_blueprint',
        short_label: 'Try different blueprint',
        rationale: `Current blueprint pattern may not suit Exceptional-tier quality for this project's genre/tone combination.`,
        recommended_mutations: [
          'Review blueprint structural pattern against project requirements',
          'Consider blueprints from higher-CI source material',
        ],
        blueprint_action: 'switch_pattern',
      };

    case 'dna_mismatch':
      return {
        recommendation_type: 'apply_different_dna',
        short_label: 'Adjust DNA constraints',
        rationale: `Narrative DNA constraints may be restricting the quality ceiling. Consider loosening or switching DNA profile.`,
        recommended_mutations: [
          'Review DNA mutation constraints',
          'Consider a DNA profile from closer-genre source material',
        ],
        dna_action: 'switch_or_loosen',
      };

    case 'weak_lane_fit':
      return {
        recommendation_type: 'change_lane',
        short_label: 'Reassess lane fit',
        rationale: `Project may be positioned in a lane that limits its Exceptional potential.`,
        recommended_mutations: [
          'Review lane assignment against project strengths',
          'Consider if a different lane unlocks higher CI ceiling',
        ],
      };

    case 'rewrite_exhausted':
      if (ctx.ciGap <= 5) {
        return {
          recommendation_type: 'continue_rewrite',
          short_label: 'Continue with targeted rewrites',
          rationale: `Small CI gap (${ctx.ciGap}). Targeted rewrites on specific weak areas may close the gap.`,
          recommended_mutations: ['Focus rewrites on specific blocker areas'],
          recommended_quality_target: null,
        };
      }
      return fallback;

    case 'escalation_architecture_weak':
      return {
        recommendation_type: 'regenerate_devseed',
        short_label: 'Regenerate with stronger architecture',
        rationale: `The seed's escalation architecture (act structure, tension curves) is insufficient for ${ctx.targetCi}+ quality.`,
        recommended_mutations: [
          'Redesign dramatic escalation pattern',
          'Ensure clear act breaks with rising stakes',
          'Verify climactic sequence resolves central dramatic question',
        ],
      };

    default:
      return fallback;
  }
}

// ── Cause Labels for UI ──
export const CAUSE_LABELS: Record<PlateauCause, string> = {
  weak_hook: 'Weak Hook / Logline',
  weak_conflict_engine: 'Weak Conflict Engine',
  weak_lane_fit: 'Poor Lane Fit',
  weak_market_heat: 'Low Market Heat',
  weak_feasibility: 'Feasibility Drag',
  canon_scaffold_weak: 'Weak Canon Scaffold',
  escalation_architecture_weak: 'Weak Escalation Architecture',
  blueprint_mismatch: 'Blueprint Mismatch',
  dna_mismatch: 'DNA Mismatch',
  rewrite_exhausted: 'Rewrite Capacity Exhausted',
  seed_limited: 'Seed Structurally Limited',
  unknown: 'Undetermined',
};

export const RECOMMENDATION_LABELS: Record<RecommendationType, string> = {
  continue_rewrite: 'Continue Rewrites',
  force_advance_stage: 'Force Advance Stage',
  regenerate_devseed: 'Regenerate DevSeed',
  switch_blueprint: 'Switch Blueprint',
  remove_dna_constraint: 'Remove DNA Constraint',
  apply_different_dna: 'Apply Different DNA',
  strengthen_hook: 'Strengthen Hook',
  strengthen_conflict_engine: 'Strengthen Conflict Engine',
  change_lane: 'Change Lane',
  simplify_budget_scope: 'Simplify Budget Scope',
  strengthen_canon_scaffold: 'Strengthen Canon Scaffold',
};
