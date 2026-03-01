/**
 * Production Modality — backend canonical registry.
 *
 * Mirror of src/config/productionModality.ts for edge functions.
 * Kept in sync manually; changes must be reflected in both files.
 */

export type ProductionModality = 'live_action' | 'animation' | 'hybrid';

export const PRODUCTION_MODALITIES: readonly string[] = [
  'live_action',
  'animation',
  'hybrid',
];

export function getProjectModality(
  projectFeatures: Record<string, any> | null | undefined,
): ProductionModality {
  const raw = projectFeatures?.production_modality;
  if (raw && PRODUCTION_MODALITIES.includes(raw)) {
    return raw as ProductionModality;
  }
  return 'live_action';
}

export function isAnimationModality(modality: ProductionModality): boolean {
  return modality === 'animation' || modality === 'hybrid';
}

export function buildModalityPromptBlock(modality: ProductionModality): string {
  if (modality === 'live_action') return '';

  if (modality === 'animation') {
    return `\n\n=== PRODUCTION MODALITY: ANIMATION ===
This project uses ANIMATION as its production modality.
- All visual descriptions should reference animated visual language (character design, background art, animation style)
- Camera language translates to virtual camera: dolly → camera track, crane → altitude shift, handheld → slight wobble
- Emphasize visual consistency: character model sheets, color palettes, line weight
- Lighting descriptions should reference rendered/painted lighting rather than practical fixtures
- Do NOT reference live-action crew, physical sets, or practical effects
=== END MODALITY BLOCK ===\n`;
  }

  return `\n\n=== PRODUCTION MODALITY: HYBRID (LIVE ACTION + ANIMATION) ===
This project combines LIVE ACTION with ANIMATED elements.
- Scenes may mix real footage with animated overlays, characters, or environments
- Camera language applies to both real and virtual cameras
- Maintain visual consistency at the integration boundary (lighting match, perspective match)
- Note which elements are live-action vs animated when describing compositions
- VFX/compositing considerations are critical for every shot
=== END MODALITY BLOCK ===\n`;
}
