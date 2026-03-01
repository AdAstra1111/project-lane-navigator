/**
 * Production Modality — canonical registry.
 *
 * Models HOW a project is produced, orthogonal to FORMAT (what it is).
 * Stored in `projects.project_features.production_modality`.
 *
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for modality values.
 * Do NOT hard-code modality strings elsewhere — import from here.
 */

// ── Canonical values ──────────────────────────────────────────────────────

export type ProductionModality = 'live_action' | 'animation' | 'hybrid';

export const PRODUCTION_MODALITIES: readonly ProductionModality[] = [
  'live_action',
  'animation',
  'hybrid',
] as const;

export const MODALITY_LABELS: Record<ProductionModality, string> = {
  live_action: 'Live Action',
  animation: 'Animation',
  hybrid: 'Hybrid (Live Action + Animation)',
};

export const MODALITY_DESCRIPTIONS: Record<ProductionModality, string> = {
  live_action: 'Traditional live-action cinematography',
  animation: '2D, 3D, stop-motion, or mixed animation',
  hybrid: 'Combines live-action footage with animated elements',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read production_modality from a project's project_features JSON.
 * Returns 'live_action' if absent/null (backward-compatible default).
 */
export function getProjectModality(
  projectFeatures: Record<string, any> | null | undefined,
): ProductionModality {
  const raw = projectFeatures?.production_modality;
  if (raw && PRODUCTION_MODALITIES.includes(raw as ProductionModality)) {
    return raw as ProductionModality;
  }
  return 'live_action';
}

/**
 * Return a new project_features object with production_modality set.
 * Merges into existing features to avoid overwriting other keys.
 */
export function setProjectModality(
  existingFeatures: Record<string, any> | null | undefined,
  modality: ProductionModality,
): Record<string, any> {
  return { ...(existingFeatures || {}), production_modality: modality };
}

/**
 * Check if a modality value implies animation-related production.
 * Useful for prompt injection, finance adjustments, etc.
 */
export function isAnimationModality(modality: ProductionModality): boolean {
  return modality === 'animation' || modality === 'hybrid';
}

// ── Prompt Blocks (for LLM injection) ─────────────────────────────────────

/**
 * Build a deterministic MODALITY BLOCK for system prompts.
 * Returns empty string for live_action (no change to existing behavior).
 */
export function buildModalityPromptBlock(modality: ProductionModality): string {
  if (modality === 'live_action') return '';

  if (modality === 'animation') {
    return `
=== PRODUCTION MODALITY: ANIMATION ===
This project uses ANIMATION as its production modality.
- All visual descriptions should reference animated visual language (character design, background art, animation style)
- Camera language translates to virtual camera: dolly → camera track, crane → altitude shift, handheld → slight wobble
- Emphasize visual consistency: character model sheets, color palettes, line weight
- Lighting descriptions should reference rendered/painted lighting rather than practical fixtures
- Do NOT reference live-action crew, physical sets, or practical effects
=== END MODALITY BLOCK ===
`;
  }

  // hybrid
  return `
=== PRODUCTION MODALITY: HYBRID (LIVE ACTION + ANIMATION) ===
This project combines LIVE ACTION with ANIMATED elements.
- Scenes may mix real footage with animated overlays, characters, or environments
- Camera language applies to both real and virtual cameras
- Maintain visual consistency at the integration boundary (lighting match, perspective match)
- Note which elements are live-action vs animated when describing compositions
- VFX/compositing considerations are critical for every shot
=== END MODALITY BLOCK ===
`;
}

// ── Finance Multipliers (deterministic, auditable) ────────────────────────

/**
 * Modality-aware cost adjustment factors.
 * Applied as multipliers to base cost estimates.
 *
 * These are conservative industry-standard adjustments:
 * - Animation typically has lower location/travel costs but higher per-minute production costs
 * - Hybrid projects carry overhead of both pipelines
 */
export const MODALITY_COST_FACTORS: Record<ProductionModality, {
  schedule_multiplier: number;   // Applied to shoot/production schedule weeks
  crew_cost_multiplier: number;  // Applied to crew cost estimates
  location_multiplier: number;   // Applied to location costs
  post_multiplier: number;       // Applied to post-production costs
  vfx_multiplier: number;        // Applied to VFX budget line
}> = {
  live_action: {
    schedule_multiplier: 1.0,
    crew_cost_multiplier: 1.0,
    location_multiplier: 1.0,
    post_multiplier: 1.0,
    vfx_multiplier: 1.0,
  },
  animation: {
    schedule_multiplier: 1.5,    // Animation production schedules run longer
    crew_cost_multiplier: 0.7,   // Smaller on-set crew (no physical production)
    location_multiplier: 0.1,    // Virtual locations, minimal physical needs
    post_multiplier: 1.8,        // Heavy post/render pipeline
    vfx_multiplier: 0.3,         // VFX is the production itself, not an add-on
  },
  hybrid: {
    schedule_multiplier: 1.3,    // Dual pipeline overhead
    crew_cost_multiplier: 1.1,   // Both live + animation teams
    location_multiplier: 0.6,    // Some locations real, some virtual
    post_multiplier: 1.5,        // Compositing + integration heavy
    vfx_multiplier: 1.4,         // Integration VFX on top of base
  },
};
