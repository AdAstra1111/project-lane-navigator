import type { WritingLaneGroup, WritingVoicePreset } from './types';
import { WRITING_VOICE_PRESETS } from './presets';

export function normalizeLane(lane: string): string {
  return (lane || '').toLowerCase().replace(/[-_\s]+/g, '');
}

export function getLaneGroup(lane: string): WritingLaneGroup {
  const n = normalizeLane(lane);
  if (
    n.includes('verticaldrama') ||
    n.includes('fastturnaround') ||
    n === 'vertical'
  ) return 'vertical';
  if (n.includes('documentary')) return 'documentary';
  if (
    n.includes('series') ||
    n === 'tvseries' ||
    n === 'limitedseries' ||
    n === 'digitalseries'
  ) return 'series';
  return 'feature';
}

export function getVoiceOptionsForLane(lane: string): WritingVoicePreset[] {
  const group = getLaneGroup(lane);
  return WRITING_VOICE_PRESETS.filter(p => p.lane_group === group);
}

export function getDefaultVoiceForLane(lane: string): WritingVoicePreset {
  const options = getVoiceOptionsForLane(lane);
  return options[0];
}
