export type WritingLaneGroup = 'vertical' | 'series' | 'feature' | 'documentary';

export interface WritingVoiceDefaultPreset {
  id: string;
  label: string;
  lane_group: WritingLaneGroup;
}

export function normalizeWritingLane(lane: string): string {
  return (lane || '').toLowerCase().replace(/[-_\s]+/g, '');
}

/**
 * FORMAT_TO_LANE_GROUP — deterministic override map.
 * When a project has a known format, this takes precedence over lane-based heuristics.
 * Prevents platform-deal / genre-based lanes from overriding format-specific voice.
 */
const FORMAT_TO_LANE_GROUP: Record<string, WritingLaneGroup> = {
  'vertical-drama': 'vertical',
  'tv-series': 'series',
  'limited-series': 'series',
  'digital-series': 'series',
  'anim-series': 'series',
  'reality': 'series',
  'documentary': 'documentary',
  'documentary-series': 'documentary',
  'hybrid-documentary': 'documentary',
  'film': 'feature',
  'feature': 'feature',
  'short': 'feature',
  'animation': 'feature',
};

/**
 * Resolve lane group with format-first precedence.
 * If format is provided and recognized, it overrides lane-based heuristics.
 */
export function getWritingLaneGroup(lane: string, format?: string): WritingLaneGroup {
  // PATCH 2: Format-first resolution — format must constrain lane_group
  if (format) {
    const formatGroup = FORMAT_TO_LANE_GROUP[format.toLowerCase()];
    if (formatGroup) return formatGroup;
  }
  const n = normalizeWritingLane(lane);
  if (n.includes('verticaldrama') || n.includes('fastturnaround') || n === 'vertical') return 'vertical';
  if (n.includes('documentary')) return 'documentary';
  if (n.includes('series') || n === 'tvseries' || n === 'limitedseries' || n === 'digitalseries' || n === 'animseries' || n === 'reality') return 'series';
  return 'feature';
}

export const DEFAULT_WRITING_VOICE_BY_GROUP: Record<WritingLaneGroup, WritingVoiceDefaultPreset> = {
  vertical: { id: 'high_heat_addictive_vertical', label: 'High-Heat Addictive', lane_group: 'vertical' },
  series: { id: 'prestige_intimate_series', label: 'Prestige Intimate', lane_group: 'series' },
  feature: { id: 'cinematic_clean_feature', label: 'Cinematic Clean', lane_group: 'feature' },
  documentary: { id: 'investigative_doc', label: 'Investigative', lane_group: 'documentary' },
};

export function getDefaultWritingVoiceForLane(lane: string, format?: string): WritingVoiceDefaultPreset {
  return DEFAULT_WRITING_VOICE_BY_GROUP[getWritingLaneGroup(lane, format)] || DEFAULT_WRITING_VOICE_BY_GROUP.feature;
}
