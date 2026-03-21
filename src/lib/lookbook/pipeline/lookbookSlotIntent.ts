/**
 * lookbookSlotIntent — Defines explicit intent metadata for each LookBook slide.
 *
 * Each slide type has a declared purpose, required evidence classes,
 * and constraints that downstream stages (election, provenance, QA) enforce.
 */
import type { EvidenceClass } from './narrativeEvidence';

// ── Slot Intent ──────────────────────────────────────────────────────────────

export type SlotPurpose =
  | 'character'
  | 'relationship'
  | 'world'
  | 'environment'
  | 'scene'
  | 'atmosphere'
  | 'theme'
  | 'poster';

export interface SlotIntentSpec {
  /** Primary purpose of this slide */
  purpose: SlotPurpose;
  /** Evidence classes that MUST be present for a valid build */
  requiredEvidence: EvidenceClass[];
  /** Evidence classes that enhance but are not mandatory */
  preferredEvidence: EvidenceClass[];
  /** Whether principal character identity binding is required */
  requiresPrincipalIdentity: boolean;
  /** Whether background/incidental humans are allowed */
  allowsBackgroundPopulation: boolean;
  /** Whether environment/location must dominate the composition */
  requiresEnvironmentDominance: boolean;
  /** Whether scene-literal visual provenance is required */
  requiresSceneProvenance: boolean;
  /** Minimum expected image count */
  minImages: number;
  /** Maximum useful image count */
  maxImages: number;
  /** Human-readable intent description */
  description: string;
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const SLOT_INTENT_REGISTRY: Record<string, SlotIntentSpec> = {
  cover: {
    purpose: 'poster',
    requiredEvidence: [],
    preferredEvidence: ['character', 'world', 'atmosphere'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 1,
    description: 'Cinematic poster hero — the emotional anchor of the deck.',
  },
  creative_statement: {
    purpose: 'atmosphere',
    requiredEvidence: [],
    preferredEvidence: ['atmosphere', 'theme', 'world'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 0,
    maxImages: 1,
    description: 'Atmospheric background supporting the creative vision text.',
  },
  world: {
    purpose: 'world',
    requiredEvidence: ['world'],
    preferredEvidence: ['environment'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: true,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 4,
    description: 'Environment-first world-building — architecture, geography, status.',
  },
  key_moments: {
    purpose: 'scene',
    requiredEvidence: [],
    preferredEvidence: ['scene', 'character', 'atmosphere'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: true,
    minImages: 3,
    maxImages: 6,
    description: 'Defining visual beats — the frames that sell the story.',
  },
  characters: {
    purpose: 'character',
    requiredEvidence: ['character'],
    preferredEvidence: [],
    requiresPrincipalIdentity: true,
    allowsBackgroundPopulation: false,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 6,
    description: 'Identity-bound character portraits with canon fidelity.',
  },
  visual_language: {
    purpose: 'atmosphere',
    requiredEvidence: [],
    preferredEvidence: ['atmosphere', 'environment'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: false,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 2,
    maxImages: 4,
    description: 'Texture, lighting, and composition reference grid.',
  },
  themes: {
    purpose: 'theme',
    requiredEvidence: [],
    preferredEvidence: ['atmosphere', 'theme', 'world'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 4,
    description: 'Atmospheric mood board anchoring thematic tone.',
  },
  story_engine: {
    purpose: 'scene',
    requiredEvidence: [],
    preferredEvidence: ['scene', 'atmosphere'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 3,
    description: 'Narrative momentum — the dramatic engine of the format.',
  },
  comparables: {
    purpose: 'atmosphere',
    requiredEvidence: [],
    preferredEvidence: ['atmosphere', 'world'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 0,
    maxImages: 1,
    description: 'Background atmosphere for comparable titles context.',
  },
  poster_directions: {
    purpose: 'poster',
    requiredEvidence: [],
    preferredEvidence: ['character', 'world', 'atmosphere', 'poster'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 2,
    maxImages: 4,
    description: 'Key art explorations — marketing identity variations.',
  },
  closing: {
    purpose: 'poster',
    requiredEvidence: [],
    preferredEvidence: ['atmosphere', 'world', 'poster'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 1,
    maxImages: 1,
    description: 'Bookend closure — cinematic sign-off.',
  },
};

/**
 * Get slot intent for a slide type. Falls back to a generic atmosphere spec.
 */
export function getSlotIntent(slideType: string): SlotIntentSpec {
  return SLOT_INTENT_REGISTRY[slideType] || {
    purpose: 'atmosphere' as SlotPurpose,
    requiredEvidence: [],
    preferredEvidence: ['atmosphere'],
    requiresPrincipalIdentity: false,
    allowsBackgroundPopulation: true,
    requiresEnvironmentDominance: false,
    requiresSceneProvenance: false,
    minImages: 0,
    maxImages: 2,
    description: 'Generic slide.',
  };
}
