/**
 * State presets for character and location visual continuity.
 * These define common state variants that can be generated for entities.
 */

export interface StatePreset {
  key: string;
  label: string;
  promptModifier: string;
}

export const CHARACTER_STATE_PRESETS: StatePreset[] = [
  { key: 'baseline', label: 'Baseline / Default', promptModifier: 'Default appearance. Everyday wardrobe. Neutral emotional state. Standard lighting.' },
  { key: 'formal', label: 'Formal / Dressed Up', promptModifier: 'Formal attire. Event or ceremony wardrobe. Polished, composed demeanor. Elegant lighting.' },
  { key: 'distressed', label: 'Distressed / Injured', promptModifier: 'Visibly distressed or injured. Torn or disheveled clothing. Dirt, blood, or sweat. Harsh or dim lighting. Raw emotional state.' },
  { key: 'disguised', label: 'Disguised / Undercover', promptModifier: 'Altered appearance. Different hairstyle, glasses, hat, or costume. Attempting to blend in or hide identity.' },
  { key: 'later_act', label: 'Later Act / Evolved', promptModifier: 'Evolved appearance reflecting character growth. Subtle wardrobe shift. More confident or weathered. Changed circumstances visible in posture and expression.' },
  { key: 'action', label: 'Action / Combat', promptModifier: 'In motion or combat-ready. Tactical or practical clothing. Intense expression. Dynamic pose. High-energy lighting.' },
];

export const LOCATION_STATE_PRESETS: StatePreset[] = [
  { key: 'day', label: 'Day / Standard', promptModifier: 'Daylight conditions. Natural sunlight. Clear atmospheric quality. Standard production-ready look.' },
  { key: 'night', label: 'Night', promptModifier: 'Night conditions. Practical light sources — streetlamps, neon, moonlight. Deep shadows. Cool color temperature.' },
  { key: 'golden_hour', label: 'Golden Hour', promptModifier: 'Golden hour / magic hour. Warm amber-orange light. Long shadows. Romantic, nostalgic atmosphere.' },
  { key: 'damaged', label: 'Damaged / Post-Event', promptModifier: 'Aftermath of a dramatic event. Broken elements, debris, damage marks. Changed atmosphere — tension, devastation, or eerie calm.' },
  { key: 'dressed', label: 'Dressed / Production Design', promptModifier: 'Dressed for a specific scene. Set decoration visible — props, furniture arrangement, signage, seasonal dressing. Production-ready.' },
  { key: 'abandoned', label: 'Abandoned / Empty', promptModifier: 'Vacant, deserted atmosphere. Dust, overgrown elements. Absence of people. Haunting quality. Still air.' },
];

export function getCharacterStatePresets(): StatePreset[] {
  return CHARACTER_STATE_PRESETS;
}

export function getLocationStatePresets(): StatePreset[] {
  return LOCATION_STATE_PRESETS;
}
