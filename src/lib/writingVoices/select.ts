import type { WritingLaneGroup, WritingVoicePreset } from './types';
import { WRITING_VOICE_PRESETS } from './presets';
import {
  getDefaultWritingVoiceForLane,
  getWritingLaneGroup,
  normalizeWritingLane,
} from '../../../supabase/functions/_shared/writingVoiceResolver';

export function normalizeLane(lane: string): string {
  return normalizeWritingLane(lane);
}

export function getLaneGroup(lane: string): WritingLaneGroup {
  return getWritingLaneGroup(lane) as WritingLaneGroup;
}

export function getVoiceOptionsForLane(lane: string): WritingVoicePreset[] {
  const group = getLaneGroup(lane);
  return WRITING_VOICE_PRESETS.filter(p => p.lane_group === group);
}

export function getDefaultVoiceForLane(lane: string): WritingVoicePreset {
  const options = getVoiceOptionsForLane(lane);
  const canonical = getDefaultWritingVoiceForLane(lane);
  return options.find(o => o.id === canonical.id) || options[0];
}
