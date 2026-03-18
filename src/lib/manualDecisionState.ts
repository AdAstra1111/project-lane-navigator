/**
 * manualDecisionState — Unified decision state for manual rewrite workflows.
 *
 * Reconciles score convergence with issue/note state to produce a single
 * truthful recommendation for human operators.
 */

export type ScoreState = 'below_target' | 'near_target' | 'converged';
export type IssueState = 'blockers_remain' | 'major_notes_remain' | 'minor_only' | 'clear';
export type OperatorRecommendation =
  | 'run_full_rewrite'
  | 'run_selective_pass'
  | 'run_late_stage_patch'
  | 'review_remaining_issues'
  | 'optional_polish'
  | 'approval_ready'
  | 'stop';

export interface ManualDecisionState {
  scoreState: ScoreState;
  issueState: IssueState;
  recommendation: OperatorRecommendation;
  /** One-line label for badges / headers */
  label: string;
  /** Short explanation for the operator */
  explanation: string;
  /** Suggested primary CTA text */
  ctaText: string;
  /** Visual severity: success / warning / destructive / muted */
  severity: 'success' | 'warning' | 'destructive' | 'muted';
  /** Whether approval is available (even if not primary) */
  approvalAvailable: boolean;
  /** Secondary CTA text when applicable */
  secondaryCtaText?: string;
  /** Secondary CTA action key */
  secondaryAction?: OperatorRecommendation;
  /** Active rewrite discipline mode, if resolved */
  disciplineMode?: 'full_rewrite' | 'selective_rewrite' | 'late_stage_patch';
  /** Discipline mode label for UI display */
  disciplineModeLabel?: string;
}

export interface ManualDecisionInput {
  ci: number | null;
  gp: number | null;
  /** Raw convergence status from computeConvergenceStatus */
  convergenceStatus: string;
  blockerCount: number;
  majorNoteCount: number;
  minorNoteCount: number;
  /** Current version number (for discipline mode resolution) */
  versionNumber?: number;
  /** Whether the document is structurally incomplete */
  isStructurallyIncomplete?: boolean;
  /** Whether the document is in hard-failure state */
  isHardFailure?: boolean;
}

/** Map recommendation → Loop Controls action key used by the page */
export type ManualActionKey = 'approve' | 'review' | 'rewrite_selective' | 'rewrite_full' | 'polish' | 'reassess';

export function recommendationToActionKey(rec: OperatorRecommendation): ManualActionKey {
  switch (rec) {
    case 'approval_ready': return 'approve';
    case 'optional_polish': return 'polish';
    case 'run_selective_pass': return 'rewrite_selective';
    case 'run_full_rewrite': return 'rewrite_full';
    case 'review_remaining_issues': return 'review';
    case 'stop': return 'approve';
    default: return 'reassess';
  }
}

function resolveScoreState(input: ManualDecisionInput): ScoreState {
  if (input.convergenceStatus === 'Converged') return 'converged';
  if (input.ci == null || input.gp == null) return 'below_target';
  if (input.ci >= 65 && input.gp >= 65) return 'near_target';
  return 'below_target';
}

function resolveIssueState(input: ManualDecisionInput): IssueState {
  if (input.blockerCount > 0) return 'blockers_remain';
  if (input.majorNoteCount > 0) return 'major_notes_remain';
  if (input.minorNoteCount > 0) return 'minor_only';
  return 'clear';
}

export function computeManualDecisionState(input: ManualDecisionInput): ManualDecisionState {
  const scoreState = resolveScoreState(input);
  const issueState = resolveIssueState(input);

  // Decision matrix
  if (scoreState === 'converged' && issueState === 'clear') {
    return {
      scoreState, issueState,
      recommendation: 'approval_ready',
      label: 'Approval Ready',
      explanation: 'Scores converged and no outstanding issues remain.',
      ctaText: 'Approve',
      severity: 'success',
      approvalAvailable: true,
    };
  }

  if (scoreState === 'converged' && issueState === 'minor_only') {
    return {
      scoreState, issueState,
      recommendation: 'optional_polish',
      label: 'Optional Polish',
      explanation: `Scores converged. ${input.minorNoteCount} minor note${input.minorNoteCount !== 1 ? 's' : ''} remain — polish pass optional.`,
      ctaText: 'Run Polish Pass',
      severity: 'success',
      approvalAvailable: true,
      secondaryCtaText: 'Approve Anyway',
      secondaryAction: 'approval_ready',
    };
  }

  if (scoreState === 'converged' && issueState === 'major_notes_remain') {
    return {
      scoreState, issueState,
      recommendation: 'run_selective_pass',
      label: 'Converged — Notes Remain',
      explanation: `Scores converged but ${input.majorNoteCount} major note${input.majorNoteCount !== 1 ? 's' : ''} still active. Selective pass recommended.`,
      ctaText: 'Run Selective Pass',
      severity: 'warning',
      approvalAvailable: false,
    };
  }

  if (scoreState === 'converged' && issueState === 'blockers_remain') {
    return {
      scoreState, issueState,
      recommendation: 'review_remaining_issues',
      label: 'Converged — Blockers Remain',
      explanation: `Scores converged but ${input.blockerCount} blocker${input.blockerCount !== 1 ? 's' : ''} still active. Resolve before approval.`,
      ctaText: 'Review Blockers',
      severity: 'destructive',
      approvalAvailable: false,
    };
  }

  if (scoreState === 'near_target' && issueState === 'blockers_remain') {
    return {
      scoreState, issueState,
      recommendation: 'run_full_rewrite',
      label: 'Near Target — Blockers',
      explanation: `Scores near threshold with ${input.blockerCount} blocker${input.blockerCount !== 1 ? 's' : ''}. Full rewrite recommended.`,
      ctaText: 'Run Full Rewrite',
      severity: 'destructive',
      approvalAvailable: false,
    };
  }

  if (scoreState === 'near_target') {
    return {
      scoreState, issueState,
      recommendation: 'run_selective_pass',
      label: 'Near Target',
      explanation: 'Scores approaching threshold. Selective pass should close the gap.',
      ctaText: 'Run Selective Pass',
      severity: 'warning',
      approvalAvailable: false,
    };
  }

  // below_target
  if (issueState === 'blockers_remain') {
    return {
      scoreState, issueState,
      recommendation: 'run_full_rewrite',
      label: 'Below Target — Blockers',
      explanation: `Scores below threshold with ${input.blockerCount} blocker${input.blockerCount !== 1 ? 's' : ''}. Full rewrite needed.`,
      ctaText: 'Run Full Rewrite',
      severity: 'destructive',
      approvalAvailable: false,
    };
  }

  return {
    scoreState, issueState,
    recommendation: 'run_full_rewrite',
    label: 'Below Target',
    explanation: 'Scores below threshold. Another rewrite pass recommended.',
    ctaText: 'Run Full Rewrite',
    severity: 'warning',
    approvalAvailable: false,
  };
}
