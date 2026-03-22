/**
 * shotIntent — Deterministic shot-intent resolution for lookbook slots.
 *
 * Maps slot/section types to explicit cinematic shot parameters.
 * Used by both generation (prompt injection) and selection (scoring).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ShotFraming = 'close_up' | 'medium' | 'wide';
export type ShotSubjectPriority = 'character' | 'environment';
export type ShotCameraAngle = 'eye_level' | 'low' | 'high';
export type ShotDepthOfField = 'shallow' | 'deep';
export type ShotMotionFeel = 'static' | 'dynamic';

export interface ShotIntent {
  framing: ShotFraming;
  subject_priority: ShotSubjectPriority;
  camera_angle: ShotCameraAngle;
  depth_of_field: ShotDepthOfField;
  motion_feel: ShotMotionFeel;
}

// ── Slot → Intent Map ────────────────────────────────────────────────────────

/**
 * Deterministic slot-to-intent mappings.
 * Each lookbook slot type maps to one canonical shot intent.
 */
const SLOT_INTENT_MAP: Record<string, ShotIntent> = {
  // Character slides: intimate, identity-focused
  characters: {
    framing: 'close_up',
    subject_priority: 'character',
    camera_angle: 'eye_level',
    depth_of_field: 'shallow',
    motion_feel: 'static',
  },

  // World/location slides: environment-dominant
  world: {
    framing: 'wide',
    subject_priority: 'environment',
    camera_angle: 'eye_level',
    depth_of_field: 'deep',
    motion_feel: 'static',
  },

  // Key moments: dramatic, action-oriented
  key_moments: {
    framing: 'medium',
    subject_priority: 'character',
    camera_angle: 'eye_level',
    depth_of_field: 'shallow',
    motion_feel: 'dynamic',
  },

  // Story engine: relational tension
  story_engine: {
    framing: 'medium',
    subject_priority: 'character',
    camera_angle: 'eye_level',
    depth_of_field: 'shallow',
    motion_feel: 'static',
  },

  // Visual language: texture/material studies
  visual_language: {
    framing: 'close_up',
    subject_priority: 'environment',
    camera_angle: 'eye_level',
    depth_of_field: 'shallow',
    motion_feel: 'static',
  },

  // Themes: atmospheric mood
  themes: {
    framing: 'wide',
    subject_priority: 'environment',
    camera_angle: 'eye_level',
    depth_of_field: 'deep',
    motion_feel: 'static',
  },

  // Cover/poster: cinematic hero
  cover: {
    framing: 'medium',
    subject_priority: 'character',
    camera_angle: 'low',
    depth_of_field: 'shallow',
    motion_feel: 'static',
  },

  // Closing: bookend atmosphere
  closing: {
    framing: 'wide',
    subject_priority: 'environment',
    camera_angle: 'eye_level',
    depth_of_field: 'deep',
    motion_feel: 'static',
  },

  // Creative statement: atmospheric backdrop
  creative_statement: {
    framing: 'wide',
    subject_priority: 'environment',
    camera_angle: 'eye_level',
    depth_of_field: 'deep',
    motion_feel: 'static',
  },

  // Poster directions: key art
  poster_directions: {
    framing: 'medium',
    subject_priority: 'character',
    camera_angle: 'low',
    depth_of_field: 'shallow',
    motion_feel: 'static',
  },
};

const DEFAULT_INTENT: ShotIntent = {
  framing: 'medium',
  subject_priority: 'environment',
  camera_angle: 'eye_level',
  depth_of_field: 'shallow',
  motion_feel: 'static',
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical shot intent for a lookbook slot/section type.
 * Always returns a deterministic result.
 */
export function resolveShotIntentForLookbookSlot(slotKey: string): ShotIntent {
  return SLOT_INTENT_MAP[slotKey] || DEFAULT_INTENT;
}

/**
 * Serialize a shot intent into a prompt-injectable directive.
 */
export function serializeShotIntent(intent: ShotIntent): string {
  const FRAMING_MAP: Record<ShotFraming, string> = {
    close_up: 'Close-up framing — subject fills the frame, intimate and detailed',
    medium: 'Medium shot — waist-up or mid-range, balanced subject and context',
    wide: 'Wide shot — environment dominant, subject contextualized in space',
  };
  const SUBJECT_MAP: Record<ShotSubjectPriority, string> = {
    character: 'Character is the primary subject — faces, expressions, identity readable',
    environment: 'Environment is the primary subject — architecture, space, atmosphere dominant',
  };
  const ANGLE_MAP: Record<ShotCameraAngle, string> = {
    eye_level: 'Eye-level camera angle — neutral, documentary',
    low: 'Low angle — heroic, powerful, imposing',
    high: 'High angle — vulnerable, observational, god-view',
  };
  const DOF_MAP: Record<ShotDepthOfField, string> = {
    shallow: 'Shallow depth of field — subject isolated, background bokeh',
    deep: 'Deep depth of field — full scene in focus, spatial clarity',
  };
  const MOTION_MAP: Record<ShotMotionFeel, string> = {
    static: 'Static camera feel — composed, deliberate, still-photo quality',
    dynamic: 'Dynamic camera feel — implied movement, energy, urgency',
  };

  return [
    '[SHOT INTENT — SLOT-SPECIFIC CAMERA DIRECTION]',
    FRAMING_MAP[intent.framing],
    SUBJECT_MAP[intent.subject_priority],
    ANGLE_MAP[intent.camera_angle],
    DOF_MAP[intent.depth_of_field],
    MOTION_MAP[intent.motion_feel],
  ].join('\n');
}
