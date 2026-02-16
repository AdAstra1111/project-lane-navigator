/**
 * Series Writer Readiness — computes eligibility for entering the series_writer stage
 * in vertical_drama projects. Checks 5 hard gates and produces component scores.
 */

export interface SeriesWriterBlocker {
  code: string;
  severity: 'high' | 'med' | 'low';
  message: string;
  how_to_fix: string;
}

export interface SeriesWriterReadinessResult {
  readiness_score: number;
  components: {
    episode_grid_integrity: number;
    blueprint_stability: number;
    character_bible_completeness: number;
    episode1_quality: number;
    canon_consistency: number;
  };
  blockers: SeriesWriterBlocker[];
  eligible: boolean;
  recommendation_message: string;
}

// Placeholder tokens that indicate incomplete content
const PLACEHOLDER_TOKENS = ['TBD', 'TK', '???', 'TODO', 'PLACEHOLDER', '[TBD]', '[TK]'];

function hasPlaceholders(text: string): boolean {
  const upper = text.toUpperCase();
  return PLACEHOLDER_TOKENS.some(t => upper.includes(t));
}

export interface SeriesWriterReadinessInput {
  // Documents available (doc_type strings)
  existingDocTypes: string[];
  // Season episode count from project
  seasonEpisodeCount: number | null;
  // Episode grid text (for completeness checks)
  episodeGridText: string | null;
  episodeGridApproved: boolean;
  // Blueprint text
  blueprintText: string | null;
  blueprintApproved: boolean;
  // Character bible text
  characterBibleText: string | null;
  characterBibleApproved: boolean;
  // Episode 1 script
  episode1ScriptText: string | null;
  episode1Approved: boolean;
  episode1SceneHeadingCount: number;
  episode1DialogueBlockCount: number;
  episode1CliffhangerStrength: number | null;
  episode1RetentionScore: number | null;
  // Drift / Canon
  openHighDriftFlags: number;
  canonConsistencyScore: number | null;
}

export function computeSeriesWriterReadiness(
  input: SeriesWriterReadinessInput,
): SeriesWriterReadinessResult {
  const blockers: SeriesWriterBlocker[] = [];

  // ═══ GATE A: Episode Grid Complete ═══
  let gateA = false;
  let episodeGridIntegrity = 100;

  if (!input.seasonEpisodeCount || input.seasonEpisodeCount <= 0) {
    blockers.push({
      code: 'GRID_INCOMPLETE',
      severity: 'high',
      message: 'Season episode count not defined',
      how_to_fix: 'Set season_episode_count in project qualifications.',
    });
    episodeGridIntegrity -= 50;
  }

  if (!input.existingDocTypes.some(d => normalize(d) === 'episode_grid')) {
    blockers.push({
      code: 'GRID_INCOMPLETE',
      severity: 'high',
      message: 'Episode Grid document not found',
      how_to_fix: 'Create an Episode Grid through the pipeline.',
    });
    episodeGridIntegrity -= 40;
  } else if (!input.episodeGridApproved) {
    episodeGridIntegrity -= 20;
  }

  if (input.episodeGridText) {
    if (hasPlaceholders(input.episodeGridText)) {
      blockers.push({
        code: 'GRID_INCOMPLETE',
        severity: 'high',
        message: 'Episode Grid contains placeholder tokens (TBD, TK)',
        how_to_fix: 'Replace all placeholder text with actual content.',
      });
      episodeGridIntegrity -= 20;
    }
    // Check for essential fields mentioned in grid
    const gridLower = input.episodeGridText.toLowerCase();
    const essentialFields = ['hook', 'conflict', 'escalation', 'cliffhanger'];
    const missingFields = essentialFields.filter(f => !gridLower.includes(f));
    if (missingFields.length > 0) {
      episodeGridIntegrity -= missingFields.length * 5;
    }
  } else if (input.existingDocTypes.some(d => normalize(d) === 'episode_grid')) {
    episodeGridIntegrity -= 10; // Exists but no text
  }

  episodeGridIntegrity = Math.max(0, Math.min(100, episodeGridIntegrity));
  gateA = !blockers.some(b => b.code === 'GRID_INCOMPLETE' && b.severity === 'high');

  // ═══ GATE B: Blueprint Stable ═══
  let gateB = false;
  let blueprintStability = 100;

  if (!input.existingDocTypes.some(d => ['blueprint', 'season_arc'].includes(normalize(d)))) {
    blockers.push({
      code: 'BLUEPRINT_NOT_STABLE',
      severity: 'high',
      message: 'Blueprint / Season Arc not found',
      how_to_fix: 'Create a Season Blueprint through the pipeline.',
    });
    blueprintStability -= 50;
  } else if (!input.blueprintApproved) {
    blueprintStability -= 15;
  }

  if (input.blueprintText) {
    const bpLower = input.blueprintText.toLowerCase();
    const structuralBeats = ['midpoint', 'climax', 'finale'];
    const missingBeats = structuralBeats.filter(b => !bpLower.includes(b));
    if (missingBeats.length > 0) {
      blueprintStability -= missingBeats.length * 10;
    }
    if (!bpLower.includes('stakes') && !bpLower.includes('escalat')) {
      blueprintStability -= 10;
    }
    if (hasPlaceholders(input.blueprintText)) {
      blueprintStability -= 15;
    }
  } else if (input.existingDocTypes.some(d => ['blueprint', 'season_arc'].includes(normalize(d)))) {
    blueprintStability -= 10;
  }

  blueprintStability = Math.max(0, Math.min(100, blueprintStability));
  gateB = !blockers.some(b => b.code === 'BLUEPRINT_NOT_STABLE');

  // ═══ GATE C: Character Bible Stable ═══
  let gateC = false;
  let characterBibleCompleteness = 100;

  if (!input.existingDocTypes.some(d => normalize(d) === 'character_bible')) {
    blockers.push({
      code: 'BIBLE_INCOMPLETE',
      severity: 'high',
      message: 'Character Bible not found',
      how_to_fix: 'Create a Character Bible through the pipeline.',
    });
    characterBibleCompleteness -= 50;
  } else if (!input.characterBibleApproved) {
    characterBibleCompleteness -= 15;
  }

  if (input.characterBibleText) {
    const cbLower = input.characterBibleText.toLowerCase();
    const requiredFields = ['want', 'flaw', 'arc', 'relationship'];
    const missingFields = requiredFields.filter(f => !cbLower.includes(f));
    characterBibleCompleteness -= missingFields.length * 8;
    if (hasPlaceholders(input.characterBibleText)) {
      blockers.push({
        code: 'BIBLE_INCOMPLETE',
        severity: 'high',
        message: 'Character Bible has placeholder motivations',
        how_to_fix: 'Fill in all character wants, flaws, and arc directions.',
      });
      characterBibleCompleteness -= 15;
    }
  } else if (input.existingDocTypes.some(d => normalize(d) === 'character_bible')) {
    characterBibleCompleteness -= 10;
  }

  characterBibleCompleteness = Math.max(0, Math.min(100, characterBibleCompleteness));
  gateC = !blockers.some(b => b.code === 'BIBLE_INCOMPLETE' && b.severity === 'high');

  // ═══ GATE D: Episode 1 Script ═══
  let gateD = false;
  let episode1Quality = 0;

  if (!input.episode1ScriptText) {
    blockers.push({
      code: 'EP1_NOT_APPROVED',
      severity: 'high',
      message: 'Episode 1 script not found',
      how_to_fix: 'Generate Episode 1 script through the pipeline.',
    });
  } else {
    // Screenplay validation pass = +40
    const validFormat = input.episode1SceneHeadingCount >= 6 && input.episode1DialogueBlockCount >= 12;
    if (validFormat) {
      episode1Quality += 40;
    } else {
      blockers.push({
        code: 'EP1_NOT_APPROVED',
        severity: 'high',
        message: `Episode 1 script format weak (${input.episode1SceneHeadingCount} scenes, ${input.episode1DialogueBlockCount} dialogue blocks)`,
        how_to_fix: 'Rewrite Episode 1 to meet screenplay format requirements (≥6 scene headings, ≥12 dialogue blocks).',
      });
    }

    // Retention score weight
    const retention = input.episode1RetentionScore ?? 70;
    episode1Quality += Math.round(retention * 0.30);

    // Cliffhanger strength weight
    const cliffhanger = input.episode1CliffhangerStrength ?? 70;
    episode1Quality += Math.round(cliffhanger * 0.30);

    if (cliffhanger < 60) {
      blockers.push({
        code: 'EP1_NOT_APPROVED',
        severity: 'med',
        message: 'Episode 1 cliffhanger is weak',
        how_to_fix: 'Strengthen the cliffhanger ending of Episode 1.',
      });
    }
    if (retention < 60) {
      blockers.push({
        code: 'EP1_NOT_APPROVED',
        severity: 'med',
        message: 'Episode 1 retention score is low',
        how_to_fix: 'Improve hook strength and pacing in Episode 1.',
      });
    }
  }

  episode1Quality = Math.max(0, Math.min(100, episode1Quality));
  gateD = !blockers.some(b => b.code === 'EP1_NOT_APPROVED' && b.severity === 'high');

  // ═══ GATE E: Canon Consistency ═══
  let gateE = false;
  let canonConsistency = input.canonConsistencyScore ?? 80;

  if (input.openHighDriftFlags > 0) {
    blockers.push({
      code: 'CANON_CONFLICTS',
      severity: 'high',
      message: `${input.openHighDriftFlags} unresolved high-severity drift flag(s)`,
      how_to_fix: 'Resolve all major drift flags before entering Series Writer.',
    });
    canonConsistency = Math.min(canonConsistency, 50);
  }

  if (canonConsistency < 70) {
    if (!blockers.some(b => b.code === 'CANON_CONFLICTS')) {
      blockers.push({
        code: 'CANON_CONFLICTS',
        severity: 'med',
        message: `Canon consistency score is ${canonConsistency} (minimum 70 required)`,
        how_to_fix: 'Resolve conflicts between documents to improve canon consistency.',
      });
    }
  }

  canonConsistency = Math.max(0, Math.min(100, canonConsistency));
  gateE = !blockers.some(b => b.code === 'CANON_CONFLICTS' && b.severity === 'high');

  // ═══ OVERALL SCORE ═══
  const readiness_score = Math.round(
    episodeGridIntegrity * 0.25 +
    blueprintStability * 0.25 +
    characterBibleCompleteness * 0.20 +
    episode1Quality * 0.20 +
    canonConsistency * 0.10
  );

  const allGatesPass = gateA && gateB && gateC && gateD && gateE;
  const eligible = allGatesPass && readiness_score >= 75;

  let recommendation_message: string;
  if (eligible) {
    recommendation_message = 'Ready to enter Series Writer mode — generate Episodes 2–N.';
  } else if (readiness_score >= 60) {
    recommendation_message = 'Almost ready. Refine the blockers below before scaling.';
  } else {
    recommendation_message = 'Structure not stable for Series Writer. Address high-severity blockers first.';
  }

  return {
    readiness_score,
    components: {
      episode_grid_integrity: episodeGridIntegrity,
      blueprint_stability: blueprintStability,
      character_bible_completeness: characterBibleCompleteness,
      episode1_quality: episode1Quality,
      canon_consistency: canonConsistency,
    },
    blockers: blockers.slice(0, 6),
    eligible,
    recommendation_message,
  };
}

function normalize(docType: string): string {
  return (docType || '').toLowerCase().trim().replace(/[\s\-]+/g, '_');
}

/** Map blocker code to the pipeline stage / tab the user should navigate to */
export function blockerTargetStage(code: string): string {
  switch (code) {
    case 'GRID_INCOMPLETE': return 'episode_grid';
    case 'BLUEPRINT_NOT_STABLE': return 'season_arc';
    case 'BIBLE_INCOMPLETE': return 'character_bible';
    case 'EP1_NOT_APPROVED': return 'script';
    case 'CANON_CONFLICTS': return 'development';
    default: return 'development';
  }
}
