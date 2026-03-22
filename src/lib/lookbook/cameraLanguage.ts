/**
 * cameraLanguage — Deterministic camera language system for lookbook coherence.
 *
 * Defines project-wide directorial camera style and per-slot camera behavior.
 * Ensures all generated images feel directed by the same cinematographer.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CameraStyle =
  | 'observational'
  | 'dynamic'
  | 'handheld'
  | 'formal';

export type CameraMovement =
  | 'static'
  | 'slow_push'
  | 'tracking';

export type LensBehavior =
  | 'stable'
  | 'distorted'
  | 'compressed';

export interface CameraLanguage {
  camera_style: CameraStyle;
  movement: CameraMovement;
  lens_behavior: LensBehavior;
}

// ── Default ──────────────────────────────────────────────────────────────────

export function getDefaultCameraLanguage(): CameraLanguage {
  return {
    camera_style: 'observational',
    movement: 'static',
    lens_behavior: 'stable',
  };
}

// ── Slot → Camera Language Map ───────────────────────────────────────────────

const SLOT_CAMERA_MAP: Record<string, CameraLanguage> = {
  cover: {
    camera_style: 'formal',
    movement: 'static',
    lens_behavior: 'compressed',
  },
  characters: {
    camera_style: 'observational',
    movement: 'static',
    lens_behavior: 'compressed',
  },
  world: {
    camera_style: 'observational',
    movement: 'slow_push',
    lens_behavior: 'stable',
  },
  key_moments: {
    camera_style: 'dynamic',
    movement: 'tracking',
    lens_behavior: 'stable',
  },
  story_engine: {
    camera_style: 'observational',
    movement: 'slow_push',
    lens_behavior: 'stable',
  },
  visual_language: {
    camera_style: 'formal',
    movement: 'static',
    lens_behavior: 'stable',
  },
  themes: {
    camera_style: 'observational',
    movement: 'slow_push',
    lens_behavior: 'stable',
  },
  creative_statement: {
    camera_style: 'formal',
    movement: 'static',
    lens_behavior: 'stable',
  },
  poster_directions: {
    camera_style: 'formal',
    movement: 'static',
    lens_behavior: 'compressed',
  },
  closing: {
    camera_style: 'observational',
    movement: 'slow_push',
    lens_behavior: 'stable',
  },
  comparables: {
    camera_style: 'formal',
    movement: 'static',
    lens_behavior: 'stable',
  },
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the camera language for a lookbook slot.
 */
export function resolveCameraLanguageForSlot(slotKey: string): CameraLanguage {
  return SLOT_CAMERA_MAP[slotKey] || getDefaultCameraLanguage();
}

/**
 * Serialize a camera language into a prompt directive block.
 */
export function serializeCameraLanguage(lang: CameraLanguage): string {
  const STYLE_MAP: Record<CameraStyle, string> = {
    observational: 'Observational camera — documentary intimacy, present but unobtrusive, the camera discovers rather than dictates',
    dynamic: 'Dynamic camera — kinetic energy, implied movement, urgency in framing',
    handheld: 'Handheld camera — organic imperfection, lived-in feel, breathing movement',
    formal: 'Formal camera — deliberate, composed, every element placed with intention',
  };
  const MOVEMENT_MAP: Record<CameraMovement, string> = {
    static: 'Static camera feel — locked-off tripod, deliberate stillness, photograph quality',
    slow_push: 'Slow push — subtle forward momentum, gradual reveal, building intimacy',
    tracking: 'Tracking feel — lateral movement, following action, spatial continuity',
  };
  const LENS_MAP: Record<LensBehavior, string> = {
    stable: 'Stable lens behavior — clean, undistorted perspective, natural rendering',
    distorted: 'Lens distortion — wide-angle warping, environmental tension, spatial unease',
    compressed: 'Compressed lens — telephoto compression, flattened depth, subject isolation',
  };

  return [
    '[CAMERA LANGUAGE — DIRECTORIAL STYLE]',
    STYLE_MAP[lang.camera_style],
    MOVEMENT_MAP[lang.movement],
    LENS_MAP[lang.lens_behavior],
  ].join('\n');
}

/**
 * Compute a deterministic hash for camera language provenance.
 */
export function hashCameraLanguage(lang: CameraLanguage): string {
  return `${lang.camera_style}|${lang.movement}|${lang.lens_behavior}`;
}
