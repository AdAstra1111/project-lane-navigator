export type WritingLaneGroup = 'vertical' | 'series' | 'feature' | 'documentary';

export interface WritingVoiceDefaultPreset {
  id: string;
  label: string;
  lane_group: WritingLaneGroup;
}

export function normalizeWritingLane(lane: string): string {
  return (lane || '').toLowerCase().replace(/[-_\s]+/g, '');
}

export function getWritingLaneGroup(lane: string): WritingLaneGroup {
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

export function getDefaultWritingVoiceForLane(lane: string): WritingVoiceDefaultPreset {
  return DEFAULT_WRITING_VOICE_BY_GROUP[getWritingLaneGroup(lane)] || DEFAULT_WRITING_VOICE_BY_GROUP.feature;
}
