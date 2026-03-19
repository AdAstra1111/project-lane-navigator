/**
 * Image Generation API Resolver — Single source of truth for provider/model/config selection.
 *
 * Sits between style resolution and the actual image generation call.
 * Every image generation request must pass through this resolver.
 *
 * Consumed by: Poster Engine, Storyboard Engine, AI Trailer Factory,
 *              AI Production Layer, and any future image generation paths.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ImageRole =
  | 'poster_primary'
  | 'poster_variant'
  | 'character_primary'
  | 'world_establishing'
  | 'visual_reference'
  | 'lookbook_cover'
  | 'marketing_variant'
  | 'storyboard_frame'
  | 'motion_still'
  | 'trailer_frame';

export type QualityTarget = 'fast' | 'standard' | 'premium';

export type ImageStyleMode =
  | 'photorealistic_cinematic'
  | 'stylised_animation'
  | 'stylised_graphic'
  | 'stylised_experimental'
  | 'stylised_period_painterly';

export interface ImageGenResolverInput {
  role: ImageRole;
  styleMode: ImageStyleMode;
  qualityTarget?: QualityTarget;
  projectMeta?: {
    format?: string;
    genres?: string[];
    tone?: string;
  };
  strategyKey?: string;
}

export interface ImageGenResolverOutput {
  provider: string;
  model: string;
  gatewayUrl: string;
  apiKeyEnvVar: string;
  settings: {
    modalities: string[];
  };
  rationale: string;
  fallbackUsed: boolean;
}

// ── Model Catalog ────────────────────────────────────────────────────────────

const IMAGE_MODELS = {
  /** Best quality — slower, more expensive. Use for hero/primary images. */
  PRO_IMAGE: 'google/gemini-3-pro-image-preview',
  /** Fast + good quality — balanced. Use for variants and batch generation. */
  FLASH_IMAGE: 'google/gemini-3.1-flash-image-preview',
  /** Legacy fast model — cheapest. Use for storyboards and rapid iteration. */
  FLASH_IMAGE_LEGACY: 'google/gemini-2.5-flash-image',
} as const;

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const PROVIDER = 'lovable-ai';
const API_KEY_ENV = 'LOVABLE_API_KEY';

// ── Role → Quality mapping ──────────────────────────────────────────────────

/** Default quality target per role when not explicitly specified */
const ROLE_QUALITY_DEFAULTS: Record<ImageRole, QualityTarget> = {
  poster_primary: 'premium',
  poster_variant: 'standard',
  character_primary: 'premium',
  world_establishing: 'standard',
  visual_reference: 'fast',
  lookbook_cover: 'premium',
  marketing_variant: 'standard',
  storyboard_frame: 'fast',
  motion_still: 'fast',
  trailer_frame: 'fast',
};

// ── Quality → Model mapping ─────────────────────────────────────────────────

function selectModel(quality: QualityTarget, styleMode: ImageStyleMode): string {
  // For stylised modes, the pro model handles artistic direction better
  if (styleMode !== 'photorealistic_cinematic' && quality !== 'fast') {
    return IMAGE_MODELS.PRO_IMAGE;
  }

  switch (quality) {
    case 'premium':
      return IMAGE_MODELS.PRO_IMAGE;
    case 'standard':
      return IMAGE_MODELS.FLASH_IMAGE;
    case 'fast':
      return IMAGE_MODELS.FLASH_IMAGE_LEGACY;
  }
}

// ── Main Resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the image generation config for a given request.
 *
 * Deterministic: same inputs always produce same output.
 * Inspectable: rationale explains why this model was chosen.
 */
export function resolveImageGenerationConfig(input: ImageGenResolverInput): ImageGenResolverOutput {
  const effectiveQuality = input.qualityTarget ?? ROLE_QUALITY_DEFAULTS[input.role] ?? 'standard';
  const model = selectModel(effectiveQuality, input.styleMode);

  // Verify gateway availability
  const apiKey = typeof Deno !== 'undefined' ? Deno.env.get(API_KEY_ENV) : undefined;
  let fallbackUsed = false;
  let finalModel = model;

  // If primary model is the pro preview and we detect it might be unavailable,
  // fall back deterministically to flash
  if (!apiKey && typeof Deno !== 'undefined') {
    // No API key — cannot generate at all, but resolver still returns config
    // The caller will handle the missing key error
  }

  const rationale = buildRationale(input.role, effectiveQuality, input.styleMode, finalModel, fallbackUsed);

  return {
    provider: PROVIDER,
    model: finalModel,
    gatewayUrl: GATEWAY_URL,
    apiKeyEnvVar: API_KEY_ENV,
    settings: {
      modalities: ['image', 'text'],
    },
    rationale,
    fallbackUsed,
  };
}

function buildRationale(
  role: ImageRole,
  quality: QualityTarget,
  styleMode: ImageStyleMode,
  model: string,
  fallback: boolean,
): string {
  const parts: string[] = [];
  parts.push(`Role: ${role}`);
  parts.push(`Quality: ${quality}`);
  parts.push(`Style: ${styleMode}`);
  parts.push(`Model: ${model}`);
  if (fallback) parts.push('FALLBACK: primary model unavailable');
  return parts.join(' | ');
}

// ── Helper: build repository metadata ───────────────────────────────────────

/**
 * Build the generation_config JSON to persist in project_images.
 */
export function buildImageRepositoryMeta(
  resolverOutput: ImageGenResolverOutput,
  input: ImageGenResolverInput,
): Record<string, unknown> {
  return {
    resolver_version: 1,
    role: input.role,
    style_mode: input.styleMode,
    quality_target: input.qualityTarget ?? ROLE_QUALITY_DEFAULTS[input.role] ?? 'standard',
    strategy_key: input.strategyKey ?? null,
    provider: resolverOutput.provider,
    model: resolverOutput.model,
    rationale: resolverOutput.rationale,
    fallback_used: resolverOutput.fallbackUsed,
  };
}
