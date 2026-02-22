/**
 * NextAction model — separates doc lifecycle (promotion) from workflow/mode navigation.
 *
 * - "promote"       → doc lifecycle transition (e.g. concept_brief → blueprint)
 * - "enter_mode"    → navigate to a workflow/tool (e.g. Series Writer)
 * - "set_template"  → set season style template
 * - "publish"       → publish as latest
 * - "regenerate"    → regenerate current doc
 * - "none"          → no suggested action
 */

export type NextActionKind = 'promote' | 'enter_mode' | 'publish' | 'set_template' | 'regenerate' | 'none';

export interface NextAction {
  kind: NextActionKind;
  /** Stable internal key, e.g. "coverage", "series_writer" */
  key: string;
  /** EXACT button/pill text to show — never build from templates */
  ctaLabel: string;
  /** Only set when kind="promote" */
  targetDocType?: string;
  description?: string;
  /** For enter_mode navigation */
  route?: string;
}

// ── Human-readable labels for doc lifecycle stages (promotion targets) ──
export const DOC_STAGE_LABELS: Record<string, string> = {
  idea: 'Idea',
  concept_brief: 'Concept Brief',
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  draft: 'Draft',
  coverage: 'Coverage',
  vertical_market_sheet: 'Market Sheet (VD)',
  format_rules: 'Format Rules',
  character_bible: 'Character Bible',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  vertical_episode_beats: 'Episode Beats',
  feature_script: 'Feature Script',
  episode_script: 'Episode Script',
  script: 'Script',
  production_draft: 'Production Draft',
};

// ── Mode/workflow labels (NOT doc types — these are tools/workflows) ──
export const MODE_LABELS: Record<string, string> = {
  series_writer: 'Series Writer',
  writers_room: "Writer's Room",
};

/**
 * Get a human-readable label for a doc stage or mode.
 * NEVER returns raw keys. Falls back to "Next Step" for unknown keys
 * and logs a warning in dev.
 */
export function getStageModeLabel(key: string | null | undefined): string {
  if (!key) return 'Next Step';
  const label = DOC_STAGE_LABELS[key] || MODE_LABELS[key];
  if (!label) {
    if (import.meta.env.DEV) {
      console.warn(`[NextAction] Unknown stage/mode key: "${key}". Displaying as "Next Step".`);
    }
    return 'Next Step';
  }
  return label;
}

/**
 * Build a NextAction for series-format projects at the draft stage.
 */
export function buildSeriesWriterAction(projectId?: string): NextAction {
  return {
    kind: 'enter_mode',
    key: 'series_writer',
    ctaLabel: 'Enter Series Writer',
    route: projectId ? `/projects/${projectId}/series-writer` : undefined,
    description: 'Navigate to the Series Writer to generate remaining episodes.',
  };
}

/**
 * Build a NextAction for a standard doc promotion.
 */
export function buildPromoteAction(targetDocType: string): NextAction {
  const label = DOC_STAGE_LABELS[targetDocType] || targetDocType;
  return {
    kind: 'promote',
    key: targetDocType,
    ctaLabel: label,
    targetDocType,
  };
}

/**
 * Build a "none" action (nothing to suggest).
 */
export function buildNoAction(): NextAction {
  return { kind: 'none', key: 'none', ctaLabel: '' };
}

/**
 * Render the pill/badge text for a NextAction.
 * Rules:
 * - promote      → "Promote → {ctaLabel}"
 * - enter_mode   → "{ctaLabel}" (NO "Promote →" prefix)
 * - set_template → "Set as Season Template"
 * - publish      → "Publish as Latest"
 * - regenerate   → "Regenerate"
 * - none         → "" (hide)
 */
export function renderActionPillText(action: NextAction): string {
  switch (action.kind) {
    case 'promote':
      return `Promote → ${action.ctaLabel}`;
    case 'enter_mode':
      return action.ctaLabel;
    case 'set_template':
      return 'Set as Season Template';
    case 'publish':
      return 'Publish as Latest';
    case 'regenerate':
      return 'Regenerate';
    case 'none':
    default:
      return '';
  }
}
