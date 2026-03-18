/**
 * rewriteDiscipline.ts — Single canonical resolver for rewrite discipline mode.
 *
 * Determines whether a pass should be:
 *   - full_rewrite: broad rewrite of entire document
 *   - selective_rewrite: episode/scene-scoped rewrite of affected areas
 *   - late_stage_patch: surgical note-mapped patches only
 *
 * This is the SINGLE SOURCE OF TRUTH for rewrite discipline decisions.
 * No other module should independently compute this.
 */

// ── Discipline Modes ──

export type RewriteDisciplineMode = 'full_rewrite' | 'selective_rewrite' | 'late_stage_patch';

export interface DisciplineInput {
  versionNumber: number;
  ci: number | null;
  gp: number | null;
  blockerCount: number;
  majorNoteCount: number;
  minorNoteCount: number;
  /** True if the document is structurally incomplete (e.g. truncated, missing sections) */
  isStructurallyIncomplete: boolean;
  /** True if the document is in a hard-failure state (e.g. validation hard fail) */
  isHardFailure: boolean;
}

export interface DisciplineResult {
  mode: RewriteDisciplineMode;
  /** Human-readable reason for the mode decision */
  reason: string;
  /** Deterministic entry conditions that were evaluated */
  entryConditions: {
    versionMature: boolean;
    scoresStrong: boolean;
    lowBlockers: boolean;
    lowMajorNotes: boolean;
    structurallyComplete: boolean;
    noHardFailure: boolean;
  };
  /** Whether any broad rewrite is permitted */
  broadRewriteAllowed: boolean;
  /** Operator-facing label */
  label: string;
}

// ── Thresholds (deterministic, explainable) ──

const MATURITY_VERSION_THRESHOLD = 5;
const STRONG_SCORE_THRESHOLD = 85;
const MAX_BLOCKERS_FOR_PATCH = 1;
const MAX_MAJOR_NOTES_FOR_PATCH = 4;

/**
 * resolveRewriteDisciplineMode — deterministic gate for rewrite discipline.
 *
 * Late-stage patch mode activates when ALL of:
 *   1. version_number >= 5
 *   2. ci >= 85 OR gp >= 85
 *   3. blocker_count <= 1
 *   4. major_note_count <= 4
 *   5. document is NOT structurally incomplete
 *   6. document is NOT in hard-failure state
 */
export function resolveRewriteDisciplineMode(input: DisciplineInput): DisciplineResult {
  const versionMature = input.versionNumber >= MATURITY_VERSION_THRESHOLD;
  const scoresStrong = (input.ci != null && input.ci >= STRONG_SCORE_THRESHOLD)
    || (input.gp != null && input.gp >= STRONG_SCORE_THRESHOLD);
  const lowBlockers = input.blockerCount <= MAX_BLOCKERS_FOR_PATCH;
  const lowMajorNotes = input.majorNoteCount <= MAX_MAJOR_NOTES_FOR_PATCH;
  const structurallyComplete = !input.isStructurallyIncomplete;
  const noHardFailure = !input.isHardFailure;

  const entryConditions = {
    versionMature,
    scoresStrong,
    lowBlockers,
    lowMajorNotes,
    structurallyComplete,
    noHardFailure,
  };

  // Late-stage patch mode: ALL conditions must be true
  if (versionMature && scoresStrong && lowBlockers && lowMajorNotes && structurallyComplete && noHardFailure) {
    const totalNotes = input.blockerCount + input.majorNoteCount + input.minorNoteCount;
    return {
      mode: 'late_stage_patch',
      reason: `Version ${input.versionNumber} with strong scores (CI=${input.ci}, GP=${input.gp}), ${input.blockerCount} blocker(s) and ${input.majorNoteCount} major note(s). Surgical patch mode activated.`,
      entryConditions,
      broadRewriteAllowed: false,
      label: totalNotes === 0 ? 'Approval Ready' : 'Late-Stage Patch Mode',
    };
  }

  // Selective rewrite: scores are decent OR version is mature but doesn't meet full patch criteria
  if (versionMature || scoresStrong) {
    const failedConditions: string[] = [];
    if (!versionMature) failedConditions.push('version < 5');
    if (!scoresStrong) failedConditions.push('scores below 85');
    if (!lowBlockers) failedConditions.push(`${input.blockerCount} blockers (max ${MAX_BLOCKERS_FOR_PATCH})`);
    if (!lowMajorNotes) failedConditions.push(`${input.majorNoteCount} major notes (max ${MAX_MAJOR_NOTES_FOR_PATCH})`);
    if (!structurallyComplete) failedConditions.push('structurally incomplete');
    if (!noHardFailure) failedConditions.push('hard failure state');

    return {
      mode: 'selective_rewrite',
      reason: `Selective rewrite: ${failedConditions.join(', ')} prevent late-stage patch mode.`,
      entryConditions,
      broadRewriteAllowed: false,
      label: 'Selective Rewrite',
    };
  }

  // Full rewrite: early versions, low scores
  return {
    mode: 'full_rewrite',
    reason: `Early-stage document (v${input.versionNumber}, CI=${input.ci}, GP=${input.gp}). Full rewrite appropriate.`,
    entryConditions,
    broadRewriteAllowed: true,
    label: 'Full Rewrite',
  };
}

// ── Note Resolution Ledger ──

export type NoteResolutionStatus = 'resolved' | 'unresolved' | 'regressed' | 'superseded' | 'deferred';

export interface NoteResolutionEntry {
  noteId: string;
  noteDescription: string;
  /** Tier of the note */
  tier: 'blocker' | 'major' | 'minor';
  /** Status after this pass */
  status: NoteResolutionStatus;
  /** Optional detail about what happened */
  detail?: string;
  /** Target episodes/scenes if applicable */
  targetUnits?: string[];
}

export interface PassResolutionLedger {
  passNumber: number;
  disciplineMode: RewriteDisciplineMode;
  /** All notes that were targeted in this pass */
  targetedNotes: NoteResolutionEntry[];
  /** Summary counts */
  resolved: number;
  unresolved: number;
  regressed: number;
  superseded: number;
  deferred: number;
  /** Whether this pass is considered successful by note-resolution criteria */
  passSuccessful: boolean;
  /** Reason for pass success/failure */
  passVerdict: string;
  /** Score deltas (secondary evidence) */
  scoreDelta?: { ci: number; gp: number };
  timestamp: string;
}

/**
 * evaluatePassSuccess — determine if a late-stage pass was successful.
 *
 * A pass is successful if:
 *   - at least one targeted note was resolved
 *   - zero notes regressed
 *   - unaffected material was preserved (caller must verify separately)
 *
 * Score improvement alone does NOT make a pass successful if notes regressed.
 */
export function evaluatePassSuccess(ledger: Omit<PassResolutionLedger, 'passSuccessful' | 'passVerdict'>): Pick<PassResolutionLedger, 'passSuccessful' | 'passVerdict'> {
  if (ledger.regressed > 0) {
    return {
      passSuccessful: false,
      passVerdict: `Failed: ${ledger.regressed} note(s) regressed despite ${ledger.resolved} resolved.`,
    };
  }

  if (ledger.resolved === 0 && ledger.targetedNotes.length > 0) {
    return {
      passSuccessful: false,
      passVerdict: `Failed: ${ledger.targetedNotes.length} note(s) targeted but none resolved.`,
    };
  }

  if (ledger.resolved > 0) {
    const remaining = ledger.unresolved + ledger.deferred;
    return {
      passSuccessful: true,
      passVerdict: remaining > 0
        ? `Successful: ${ledger.resolved} resolved, ${remaining} remaining.`
        : `Successful: All ${ledger.resolved} targeted note(s) resolved.`,
    };
  }

  return {
    passSuccessful: true,
    passVerdict: 'No notes targeted — structural pass.',
  };
}

// ── Patch Scope Planner ──

export interface PatchTarget {
  noteId: string;
  noteDescription: string;
  tier: 'blocker' | 'major' | 'minor';
  /** Affected episode numbers (for episodic docs) */
  episodes: number[];
  /** Affected scene numbers within episodes (if scene nesting available) */
  scenes?: Array<{ episode: number; sceneNumbers: number[] }>;
}

export interface PatchScopePlan {
  disciplineMode: 'late_stage_patch';
  targets: PatchTarget[];
  /** All unique affected episode numbers */
  affectedEpisodes: number[];
  /** Total episode count in document */
  totalEpisodes: number;
  /** Episodes that are preserved (not in patch scope) */
  preservedEpisodes: number[];
  /** Human-readable scope summary */
  scopeSummary: string;
  /** Version label for the resulting version */
  versionLabel: string;
}

/**
 * buildPatchScopePlan — derive a patch scope from targeted notes.
 *
 * Each note must declare which episodes/scenes it affects.
 * Episodes not in the target set are preserved.
 */
export function buildPatchScopePlan(
  targets: PatchTarget[],
  totalEpisodes: number,
): PatchScopePlan {
  const allEpisodes = new Set<number>();
  for (const t of targets) {
    for (const ep of t.episodes) allEpisodes.add(ep);
  }
  const affectedEpisodes = [...allEpisodes].sort((a, b) => a - b);
  const preservedEpisodes: number[] = [];
  for (let i = 1; i <= totalEpisodes; i++) {
    if (!allEpisodes.has(i)) preservedEpisodes.push(i);
  }

  const blockerTargets = targets.filter(t => t.tier === 'blocker');
  const majorTargets = targets.filter(t => t.tier === 'major');
  const minorTargets = targets.filter(t => t.tier === 'minor');

  const parts: string[] = [];
  if (blockerTargets.length > 0) parts.push(`${blockerTargets.length} blocker(s)`);
  if (majorTargets.length > 0) parts.push(`${majorTargets.length} strategic note(s)`);
  if (minorTargets.length > 0) parts.push(`${minorTargets.length} polish note(s)`);

  const scopeSummary = `Late-stage patch: ${parts.join(', ')} across ${affectedEpisodes.length}/${totalEpisodes} episodes. ${preservedEpisodes.length} episodes preserved.`;

  // Build version label
  const labelParts: string[] = ['Late-stage patch'];
  if (affectedEpisodes.length <= 5) {
    labelParts.push(`Ep ${affectedEpisodes.join(', ')}`);
  } else {
    labelParts.push(`${affectedEpisodes.length} episodes`);
  }
  const versionLabel = labelParts.join(' — ');

  return {
    disciplineMode: 'late_stage_patch',
    targets,
    affectedEpisodes,
    totalEpisodes,
    preservedEpisodes,
    scopeSummary,
    versionLabel,
  };
}
