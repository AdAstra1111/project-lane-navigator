export type WritingLaneGroup = 'vertical' | 'series' | 'feature' | 'documentary';

export interface WritingVoicePreset {
  id: string;
  label: string;
  lane_group: WritingLaneGroup;
  summary: string;
  knobs: {
    prose_density: number;
    dialogue_register: number;
    subtext: number;
    hook_intensity: number;
    emotional_restraint: number;
    visuality: number;
  };
  constraints: {
    sentence_len_band: [number, number];
    dialogue_ratio_band: [number, number];
    hook_frequency: 'every_beat' | 'every_2_beats' | 'act_outs';
  };
  do: [string, string, string, string, string];
  dont: [string, string, string, string, string];
}
