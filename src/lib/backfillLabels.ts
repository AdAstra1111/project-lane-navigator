/**
 * backfillLabels — Human-readable labels for DevSeed backfill pipeline.
 * Pure functions, no DB calls. Used by DevSeedBackfillProgress.
 */

const DEVSEED_DOC_TYPES = ['idea', 'concept_brief', 'treatment', 'character_bible', 'market_sheet'] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  idea: 'Idea',
  concept_brief: 'Concept Brief',
  treatment: 'Treatment',
  character_bible: 'Character Bible',
  market_sheet: 'Market Sheet',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  vertical_episode_beats: 'Episode Beats',
  episode_beats: 'Episode Beats',
  episode_script: 'Episode Script',
  season_master_script: 'Master Season Script',
  story_outline: 'Story Outline',
  beat_sheet: 'Beat Sheet',
};

/** Human-readable label for a doc type + optional episode index */
export function labelForDocType(docType: string, episodeIndex?: number | null): string {
  const base = DOC_TYPE_LABELS[docType] || docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (episodeIndex != null && episodeIndex > 0) {
    return `${base} — Ep ${String(episodeIndex).padStart(2, '0')}`;
  }
  return base;
}

/** Human-readable label for an item_key (e.g. "episode_script:E03") */
export function labelForItemKey(itemKey: string, episodeIndex?: number | null): string {
  const [base] = itemKey.split(':');
  return labelForDocType(base, episodeIndex);
}

/** Active verb based on status */
export function verbForStatus(status: string): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'claimed': return 'Preparing';
    case 'running': return 'Converging';
    case 'complete': return 'Approved';
    case 'failed': return 'Needs Fix';
    default: return status;
  }
}

/** One-line human summary of gate failures */
export function summarizeFailures(gateFailures: string[] | null | undefined): string {
  if (!gateFailures || gateFailures.length === 0) return '';
  const first = gateFailures[0];
  // Clean up common machine-style strings
  const cleaned = first
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  if (gateFailures.length === 1) return cleaned;
  return `${cleaned} (+${gateFailures.length - 1} more)`;
}

/** Whether a doc_type belongs to the DevSeed 5 foundation set */
export function isFoundationDocType(docType: string): boolean {
  return (DEVSEED_DOC_TYPES as readonly string[]).includes(docType);
}

/** Derive phase from doc_type (fallback when phase column missing) */
export function derivePhase(item: { doc_type: string; phase?: string }): 'foundation' | 'devpack' {
  if ((item as any).phase === 'devpack') return 'devpack';
  if ((item as any).phase === 'foundation') return 'foundation';
  return isFoundationDocType(item.doc_type) ? 'foundation' : 'devpack';
}

/** Group devpack items into logical sections for display */
export type DevpackSection = {
  key: string;
  label: string;
  items: any[];
};

export function groupDevpackItems(items: any[]): DevpackSection[] {
  const sections: DevpackSection[] = [];
  const gridItems = items.filter(i => i.doc_type === 'episode_grid');
  const arcItems = items.filter(i => i.doc_type === 'season_arc');
  const beatsItems = items.filter(i => ['vertical_episode_beats', 'episode_beats'].includes(i.doc_type));
  const scriptItems = items.filter(i => i.doc_type === 'episode_script');
  const masterItems = items.filter(i => i.doc_type === 'season_master_script');
  const featureItems = items.filter(i => ['story_outline', 'beat_sheet'].includes(i.doc_type));
  const other = items.filter(i =>
    !['episode_grid', 'season_arc', 'vertical_episode_beats', 'episode_beats', 'episode_script', 'season_master_script', 'story_outline', 'beat_sheet'].includes(i.doc_type)
  );

  if (arcItems.length) sections.push({ key: 'arc', label: 'Season Arc', items: arcItems });
  if (gridItems.length) sections.push({ key: 'grid', label: 'Episode Grid', items: gridItems });
  if (beatsItems.length) sections.push({ key: 'beats', label: 'Episode Beats', items: beatsItems.sort((a, b) => (a.episode_index || 0) - (b.episode_index || 0)) });
  if (scriptItems.length) sections.push({ key: 'scripts', label: 'Episode Scripts', items: scriptItems.sort((a, b) => (a.episode_index || 0) - (b.episode_index || 0)) });
  if (masterItems.length) sections.push({ key: 'master', label: 'Master Season Script', items: masterItems });
  if (featureItems.length) sections.push({ key: 'feature', label: 'Feature Development', items: featureItems });
  if (other.length) sections.push({ key: 'other', label: 'Other', items: other });

  return sections;
}

/** Build a narrative "currently doing X" string */
export function narrativeCurrentStep(currentStep: string | null, items: any[]): string | null {
  if (currentStep) {
    const item = items.find((i: any) => i.item_key === currentStep);
    if (item) {
      return `${verbForStatus(item.status === 'running' || item.status === 'claimed' ? item.status : 'running')} ${labelForItemKey(currentStep, item.episode_index)}`;
    }
    return `Processing ${labelForItemKey(currentStep)}`;
  }
  // Fallback: find first running/claimed item
  const active = items.find((i: any) => i.status === 'running' || i.status === 'claimed');
  if (active) {
    return `${verbForStatus(active.status)} ${labelForDocType(active.doc_type, active.episode_index)}`;
  }
  return null;
}
