/**
 * Infer which document types are affected by a note resolution.
 * Used to mark docs as needing reconcile after a decision is applied.
 */

const CATEGORY_TARGET_MAP: Record<string, string[]> = {
  structural: ['blueprint', 'beat_sheet', 'feature_script', 'episode_script', 'season_arc'],
  character: ['character_bible', 'feature_script', 'episode_script', 'blueprint'],
  escalation: ['blueprint', 'beat_sheet', 'feature_script', 'episode_script', 'season_arc'],
  lane: ['market_sheet', 'deck', 'concept_brief'],
  packaging: ['market_sheet', 'deck', 'concept_brief'],
  risk: ['market_sheet', 'concept_brief'],
  pacing: ['blueprint', 'beat_sheet', 'feature_script', 'episode_script'],
  hook: ['concept_brief', 'deck', 'feature_script', 'episode_script'],
  cliffhanger: ['episode_script', 'season_arc', 'episode_grid'],
  format: ['format_rules', 'episode_script', 'feature_script', 'episode_grid', 'season_arc', 'blueprint'],
};

interface NoteInput {
  category?: string;
  note_key?: string;
  severity?: string;
}

export interface DecisionTargets {
  doc_type_keys?: string[];
  episode_numbers?: number[];
}

/**
 * Infer which doc_type_keys are affected by a note.
 */
export function inferTargetsFromNote(note: NoteInput): DecisionTargets {
  const cat = (note.category || '').toLowerCase();
  const targets = CATEGORY_TARGET_MAP[cat] || [];

  return {
    doc_type_keys: targets.length > 0 ? targets : undefined,
  };
}

/**
 * Infer targets from a canon continuity issue.
 */
export function inferTargetsFromCanonIssue(issueType: string): DecisionTargets {
  return {
    doc_type_keys: ['episode_script', 'character_bible', 'season_arc', 'blueprint'],
  };
}
