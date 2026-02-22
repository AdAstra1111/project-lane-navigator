/**
 * Pipeline Brain — Single source of truth for stage sequencing, current-stage
 * computation, next-step recommendations, and Series Writer entry rules.
 *
 * All consumers (Dev Engine UI, auto-run, notes targeting, promotion
 * intelligence) MUST use this module instead of ad-hoc ladder logic.
 *
 * Data source: supabase/_shared/stage-ladders.json via registry.ts
 */

import {
  getLadderForFormat,
  normalizeFormatKey,
  mapDocTypeToLadderStage,
  type DeliverableStage,
} from '@/lib/stages/registry';
import { getDeliverableLabel } from '@/lib/dev-os-config';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StageStatus {
  exists: boolean;
  hasApproved: boolean;
  activeVersionId: string | null;
}

export interface PipelineNextStep {
  docType: DeliverableStage;
  label: string;
  reason: string;
  action: 'create' | 'approve' | 'converge' | 'enter_series_writer';
  priority: 'primary' | 'secondary';
}

export interface SeriesWriterGate {
  key: string;
  label: string;
  met: boolean;
  howToFix: string | null;
}

export interface SeriesWriterReadiness {
  eligible: boolean;
  gates: SeriesWriterGate[];
  message: string;
}

export interface PipelineState {
  deliverableType: string;
  formatKey: string;
  pipeline: DeliverableStage[];
  currentStage: DeliverableStage | null;
  currentStageIndex: number;
  completedStages: Record<string, StageStatus>;
  nextSteps: PipelineNextStep[];
  seriesWriterReadiness: SeriesWriterReadiness | null;
  totalStages: number;
  completedCount: number;
  /** Stages that should NEVER be referenced for this format */
  excludedStages: DeliverableStage[];
}

export interface ProjectCriteria {
  episodeCount?: number | null;
  episodeLengthMin?: number | null;
  episodeLengthMax?: number | null;
  seasonEpisodeCount?: number | null;
}

export interface ExistingDoc {
  docType: string;
  hasApproved: boolean;
  activeVersionId: string | null;
}

// ── Stages that require approval before the next stage is reachable ──

const APPROVAL_REQUIRED_STAGES: Set<string> = new Set([
  'episode_grid',
  'character_bible',
  'season_arc',
  'format_rules',
]);

// ── "All known stages" — used to compute excluded list ─────────────────────

const ALL_KNOWN_STAGES: DeliverableStage[] = [
  'idea', 'concept_brief', 'market_sheet', 'vertical_market_sheet',
  'blueprint', 'architecture', 'character_bible', 'beat_sheet',
  'feature_script', 'episode_script', 'season_master_script', 'production_draft', 'deck',
  'documentary_outline', 'format_rules', 'season_arc', 'episode_grid',
  'vertical_episode_beats',
];

// ── Series Writer entry stage mapping ──────────────────────────────────────

/** For formats that eventually hand off to Series Writer, which stage triggers it */
const SERIES_WRITER_HANDOFF_AFTER: Record<string, DeliverableStage> = {
  'vertical-drama': 'season_master_script',
  'tv-series': 'season_master_script',
  'limited-series': 'season_master_script',
  'digital-series': 'season_master_script',
  'anim-series': 'season_master_script',
};

// ── Core ───────────────────────────────────────────────────────────────────────

/**
 * Compute the full pipeline state for a project.
 *
 * @param format        Project format string (e.g. "vertical-drama", "film")
 * @param existingDocs  Array of documents that exist in the project
 * @param criteria      Optional project criteria (episode count, duration range)
 */
export function computePipelineState(
  format: string,
  existingDocs: ExistingDoc[],
  criteria?: ProjectCriteria,
): PipelineState {
  const formatKey = normalizeFormatKey(format);
  const pipeline = getLadderForFormat(format);
  const excludedStages = ALL_KNOWN_STAGES.filter(s => !pipeline.includes(s));

  // Build completed map
  const completedStages: Record<string, StageStatus> = {};
  for (const stage of pipeline) {
    const match = existingDocs.find(d => mapDocTypeToLadderStage(d.docType) === stage);
    completedStages[stage] = {
      exists: !!match,
      hasApproved: match?.hasApproved ?? false,
      activeVersionId: match?.activeVersionId ?? null,
    };
  }

  const completedCount = Object.values(completedStages).filter(s => s.exists).length;

  // Find current stage — the latest stage that exists
  let currentStage: DeliverableStage | null = null;
  let currentStageIndex = -1;
  for (let i = pipeline.length - 1; i >= 0; i--) {
    if (completedStages[pipeline[i]]?.exists) {
      currentStage = pipeline[i];
      currentStageIndex = i;
      break;
    }
  }

  // Compute next steps
  const nextSteps: PipelineNextStep[] = [];

  // Primary: the very next stage in the pipeline that doesn't exist yet
  for (let i = (currentStageIndex >= 0 ? currentStageIndex : -1) + 1; i < pipeline.length; i++) {
    const stage = pipeline[i];
    const status = completedStages[stage];

    if (!status.exists) {
      // Check if any prerequisites need approval first
      const prevStage = i > 0 ? pipeline[i - 1] : null;
      if (prevStage && APPROVAL_REQUIRED_STAGES.has(prevStage) && completedStages[prevStage]?.exists && !completedStages[prevStage]?.hasApproved) {
        nextSteps.push({
          docType: prevStage,
          label: getDeliverableLabel(prevStage, format),
          reason: `Approve ${getDeliverableLabel(prevStage, format)} before proceeding`,
          action: 'approve',
          priority: 'primary',
        });
      }

      nextSteps.push({
        docType: stage,
        label: getDeliverableLabel(stage, format),
        reason: `Next in ${formatKey} pipeline`,
        action: 'create',
        priority: nextSteps.length === 0 ? 'primary' : 'secondary',
      });

      if (nextSteps.length >= 3) break;
    }
  }

  // If current stage exists but needs approval
  if (currentStage && APPROVAL_REQUIRED_STAGES.has(currentStage) && completedStages[currentStage]?.exists && !completedStages[currentStage]?.hasApproved) {
    const alreadyListed = nextSteps.some(n => n.docType === currentStage && n.action === 'approve');
    if (!alreadyListed) {
      nextSteps.unshift({
        docType: currentStage,
        label: getDeliverableLabel(currentStage, format),
        reason: `${getDeliverableLabel(currentStage, format)} needs approval`,
        action: 'approve',
        priority: 'primary',
      });
    }
  }

  // If all stages exist, recommend convergence or completion
  if (nextSteps.length === 0 && currentStage) {
    nextSteps.push({
      docType: currentStage,
      label: getDeliverableLabel(currentStage, format),
      reason: 'All pipeline stages created — review and converge',
      action: 'converge',
      priority: 'primary',
    });
  }

  // Series Writer readiness
  const swHandoffStage = SERIES_WRITER_HANDOFF_AFTER[formatKey];
  let seriesWriterReadiness: SeriesWriterReadiness | null = null;

  if (swHandoffStage) {
    seriesWriterReadiness = computeSeriesWriterGates(
      formatKey, pipeline, completedStages, criteria,
    );

    // If eligible, add as primary CTA
    if (seriesWriterReadiness.eligible) {
      nextSteps.unshift({
        docType: 'episode_script' as DeliverableStage,
        label: 'Series Writer',
        reason: 'All prerequisites met — generate remaining episodes',
        action: 'enter_series_writer',
        priority: 'primary',
      });
    }
  }

  return {
    deliverableType: formatKey,
    formatKey,
    pipeline,
    currentStage,
    currentStageIndex,
    completedStages,
    nextSteps,
    seriesWriterReadiness,
    totalStages: pipeline.length,
    completedCount,
    excludedStages,
  };
}

// ── Series Writer Gate Logic ─────────────────────────────────────────────────

function computeSeriesWriterGates(
  formatKey: string,
  pipeline: DeliverableStage[],
  completedStages: Record<string, StageStatus>,
  criteria?: ProjectCriteria,
): SeriesWriterReadiness {
  const gates: SeriesWriterGate[] = [];

  // Gate 1: Episode Grid exists
  const hasGrid = pipeline.includes('episode_grid')
    ? completedStages['episode_grid']?.exists ?? false
    : true; // skip if not in pipeline
  if (pipeline.includes('episode_grid')) {
    gates.push({
      key: 'episode_grid',
      label: 'Episode Grid exists',
      met: hasGrid,
      howToFix: hasGrid ? null : 'Create an Episode Grid through the pipeline.',
    });
  }

  // Gate 2: Character Bible exists
  const hasBible = pipeline.includes('character_bible')
    ? completedStages['character_bible']?.exists ?? false
    : true;
  if (pipeline.includes('character_bible')) {
    gates.push({
      key: 'character_bible',
      label: 'Character Bible exists',
      met: hasBible,
      howToFix: hasBible ? null : 'Create a Character Bible through the pipeline.',
    });
  }

  // Gate 3: Season Arc or Blueprint exists
  const arcKey = pipeline.includes('season_arc') ? 'season_arc' : pipeline.includes('blueprint') ? 'blueprint' : null;
  if (arcKey) {
    const hasArc = completedStages[arcKey]?.exists ?? false;
    gates.push({
      key: 'season_arc_or_blueprint',
      label: `${getDeliverableLabel(arcKey, formatKey)} exists`,
      met: hasArc,
      howToFix: hasArc ? null : `Create a ${getDeliverableLabel(arcKey, formatKey)} first.`,
    });
  }

  // Gate 4: Script/Episode 1 exists
  const hasScript = completedStages['script']?.exists ?? false;
  gates.push({
    key: 'episode_1_script',
    label: 'Episode 1 script exists',
    met: hasScript,
    howToFix: hasScript ? null : 'Generate or create the Episode 1 script.',
  });

  // Gate 5: Episode count set
  const hasCount = !!(criteria?.seasonEpisodeCount || criteria?.episodeCount);
  gates.push({
    key: 'episode_count_set',
    label: 'Episode count configured',
    met: hasCount,
    howToFix: hasCount ? null : 'Set season_episode_count in project qualifications.',
  });

  // Gate 6 (VD-specific): Format Rules exists
  if (pipeline.includes('format_rules')) {
    const hasRules = completedStages['format_rules']?.exists ?? false;
    gates.push({
      key: 'format_rules',
      label: 'Format Rules defined',
      met: hasRules,
      howToFix: hasRules ? null : 'Create Format Rules through the pipeline.',
    });
  }

  const allMet = gates.every(g => g.met);
  const metCount = gates.filter(g => g.met).length;

  return {
    eligible: allMet,
    gates,
    message: allMet
      ? 'Ready for Series Writer — generate episodes 2–N under locked constraints.'
      : `${metCount}/${gates.length} prerequisites met. Complete the remaining items.`,
  };
}

// ── Query Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if a stage name is valid for a given format.
 * Use this to prevent notes/recommendations from referencing non-existent stages.
 */
export function isStageValidForFormat(stage: string, format: string): boolean {
  const pipeline = getLadderForFormat(format);
  return pipeline.includes(mapDocTypeToLadderStage(stage));
}

/**
 * Get a description of the episode duration range respecting criteria.
 * Never assumes a fixed value.
 */
export function getDurationRangeLabel(criteria?: ProjectCriteria): string {
  const min = criteria?.episodeLengthMin;
  const max = criteria?.episodeLengthMax;
  if (min && max && min !== max) return `${min}–${max}s`;
  if (min) return `${min}s`;
  if (max) return `${max}s`;
  return '120–180s'; // explicit default range, never just "180s"
}

/**
 * Get the midpoint duration for scalar calculations.
 */
export function getDurationMidpoint(criteria?: ProjectCriteria): number {
  const min = criteria?.episodeLengthMin ?? 120;
  const max = criteria?.episodeLengthMax ?? 180;
  return Math.round((min + max) / 2);
}
