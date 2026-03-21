/**
 * requirementBuilder — Builds the full LookBook requirement set from slot intent + narrative.
 *
 * This is the canonical source of "what the LookBook needs" in fresh_from_scratch mode.
 * Requirements are NOT derived from gaps. They are derived from the product spec.
 */
import { SLOT_INTENT_REGISTRY, type SlotIntentSpec } from './lookbookSlotIntent';
import type { NarrativeContext } from './types';
import type { NarrativeEvidence } from './narrativeEvidence';

// ── Requirement Types ────────────────────────────────────────────────────────

export type RequirementPass = 'character' | 'world' | 'key_moments' | 'atmosphere' | 'poster';

export type SatisfactionStatus = 'satisfied' | 'partial' | 'blocked';

export interface LookBookRequirement {
  /** Unique ID: slideType:slotIndex */
  id: string;
  /** Human-readable label */
  label: string;
  /** Which slide type this serves */
  slideType: string;
  /** Which generation pass handles this */
  pass: RequirementPass;
  /** Subject type for generation */
  subjectType: string;
  /** Shot type directive */
  shotType: string;
  /** Orientation preference */
  orientation: 'landscape' | 'portrait' | 'any';
  /** Minimum images required to satisfy */
  minRequired: number;
  /** Preferred image count */
  preferred: number;
  /** Asset group for edge function */
  assetGroup: string;
  /** Edge function section */
  section: string;
  /** Generation prompt context overrides */
  promptContext: Record<string, string>;
  /** Hard negative directives */
  hardNegatives: string[];
  /** Whether this is a critical requirement (blocks deck) */
  critical: boolean;
}

export interface RequirementSet {
  requirements: LookBookRequirement[];
  byPass: Record<RequirementPass, LookBookRequirement[]>;
  totalMinImages: number;
  totalPreferred: number;
}

export interface RequirementResult {
  requirement: LookBookRequirement;
  status: SatisfactionStatus;
  generatedCount: number;
  selectedCount: number;
  blockingReason?: string;
}

// ── Pass / Subject Mapping ───────────────────────────────────────────────────

const SLIDE_TO_PASS: Record<string, RequirementPass> = {
  cover: 'poster',
  creative_statement: 'atmosphere',
  world: 'world',
  key_moments: 'key_moments',
  characters: 'character',
  visual_language: 'atmosphere',
  themes: 'atmosphere',
  story_engine: 'key_moments',
  comparables: 'atmosphere',
  poster_directions: 'poster',
  closing: 'poster',
};

const SLIDE_TO_SUBJECT: Record<string, string> = {
  cover: 'poster',
  creative_statement: 'atmosphere',
  world: 'world',
  key_moments: 'moment',
  characters: 'character',
  visual_language: 'texture',
  themes: 'atmosphere',
  story_engine: 'moment',
  comparables: 'atmosphere',
  poster_directions: 'poster',
  closing: 'poster',
};

const SUBJECT_TO_ASSET_GROUP: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'poster',
};

const SUBJECT_TO_SECTION: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'key_moment',
};

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build the complete requirement set for a LookBook deck.
 * This does NOT look at existing images. It defines what the deck NEEDS.
 */
export function buildRequirementSet(
  narrative: NarrativeContext,
  narrativeEvidence?: NarrativeEvidence,
): RequirementSet {
  const requirements: LookBookRequirement[] = [];

  // Canonical slide order — these are ALL the slides a LookBook should have
  const slideTypes = [
    'cover',
    'creative_statement',
    'world',
    'key_moments',
    'characters',
    'visual_language',
    'themes',
    'story_engine',
    'comparables',
    'closing',
  ];

  for (const slideType of slideTypes) {
    const intent = SLOT_INTENT_REGISTRY[slideType] || null;
    if (!intent) continue;

    const pass = SLIDE_TO_PASS[slideType] || 'atmosphere';
    const subjectType = SLIDE_TO_SUBJECT[slideType] || 'atmosphere';
    const assetGroup = SUBJECT_TO_ASSET_GROUP[subjectType] || 'visual_language';
    const section = SUBJECT_TO_SECTION[subjectType] || 'visual_language';

    // Skip character requirements here — handled by character pass below
    if (slideType === 'characters') continue;

    // Skip comparables — text-only slide, images optional
    if (slideType === 'comparables' && !narrative.comparables) continue;

    const minRequired = Math.max(1, intent.minImages);
    const preferred = Math.max(minRequired, intent.maxImages);

    // Determine shot types and orientation based on slide purpose
    const shotType = resolveDefaultShotType(slideType, intent);
    const orientation = resolveOrientation(slideType);

    // Build prompt context from narrative
    const promptCtx = buildPromptContextForSlide(slideType, narrative, narrativeEvidence);

    // Hard negatives based on slot purpose
    const hardNegatives = resolveHardNegatives(slideType, intent);

    // Critical = deck looks bad without it
    const critical = ['cover', 'world', 'key_moments', 'closing'].includes(slideType);

    requirements.push({
      id: `${slideType}:main`,
      label: formatLabel(slideType, intent),
      slideType,
      pass,
      subjectType,
      shotType,
      orientation,
      minRequired,
      preferred,
      assetGroup,
      section,
      promptContext: promptCtx,
      hardNegatives,
      critical,
    });
  }

  // ── CHARACTER PASS: one requirement per principal character ──
  const characters = narrativeEvidence?.characters || [];
  const principals = characters.filter(c => c.importance === 'principal');
  const recurring = characters.filter(c => c.importance === 'recurring');

  // At least generate for principals; if none detected, generate 1 generic character
  const charTargets = principals.length > 0 ? principals : (recurring.length > 0 ? recurring.slice(0, 3) : []);

  if (charTargets.length > 0) {
    for (const char of charTargets) {
      requirements.push({
        id: `characters:${char.name.toLowerCase().replace(/\s+/g, '_')}`,
        label: `Character — ${char.name}`,
        slideType: 'characters',
        pass: 'character',
        subjectType: 'character',
        shotType: 'close_up',
        orientation: 'portrait',
        minRequired: 1,
        preferred: 2,
        assetGroup: 'character',
        section: 'character',
        promptContext: {
          characterName: char.name,
          characterRole: char.role || '',
          characterTraits: char.traits || '',
        },
        hardNegatives: ['multiple people in frame', 'group shot'],
        critical: true,
      });
    }
  } else if (Array.isArray(narrative.characters) && (narrative.characters as any[]).length > 0) {
    // Fallback: generate from raw narrative characters
    const rawChars = (narrative.characters as any[]).slice(0, 4);
    for (const raw of rawChars) {
      const name = raw?.name || 'Character';
      requirements.push({
        id: `characters:${name.toLowerCase().replace(/\s+/g, '_')}`,
        label: `Character — ${name}`,
        slideType: 'characters',
        pass: 'character',
        subjectType: 'character',
        shotType: 'close_up',
        orientation: 'portrait',
        minRequired: 1,
        preferred: 1,
        assetGroup: 'character',
        section: 'character',
        promptContext: {
          characterName: name,
          characterRole: raw?.role || raw?.archetype || '',
        },
        hardNegatives: ['multiple people in frame'],
        critical: false,
      });
    }
  }

  // Group by pass
  const byPass: Record<RequirementPass, LookBookRequirement[]> = {
    character: [],
    world: [],
    key_moments: [],
    atmosphere: [],
    poster: [],
  };
  for (const req of requirements) {
    byPass[req.pass].push(req);
  }

  const totalMinImages = requirements.reduce((sum, r) => sum + r.minRequired, 0);
  const totalPreferred = requirements.reduce((sum, r) => sum + r.preferred, 0);

  console.log(`[RequirementBuilder] ${requirements.length} requirements: min=${totalMinImages} preferred=${totalPreferred}`);
  for (const [pass, reqs] of Object.entries(byPass)) {
    if (reqs.length > 0) console.log(`  ${pass}: ${reqs.length} requirements`);
  }

  return { requirements, byPass, totalMinImages, totalPreferred };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveDefaultShotType(slideType: string, intent: SlotIntentSpec): string {
  switch (slideType) {
    case 'cover': return 'hero';
    case 'closing': return 'hero';
    case 'world': return 'wide';
    case 'key_moments': return 'tableau';
    case 'creative_statement': return 'atmospheric';
    case 'visual_language': return 'texture_ref';
    case 'themes': return 'atmospheric';
    case 'story_engine': return 'medium';
    case 'poster_directions': return 'hero';
    default: return 'wide';
  }
}

function resolveOrientation(slideType: string): 'landscape' | 'portrait' | 'any' {
  switch (slideType) {
    case 'cover': return 'landscape';
    case 'closing': return 'landscape';
    case 'world': return 'landscape';
    case 'key_moments': return 'any';
    case 'visual_language': return 'any';
    case 'themes': return 'landscape';
    case 'poster_directions': return 'portrait';
    default: return 'landscape';
  }
}

function resolveHardNegatives(slideType: string, intent: SlotIntentSpec): string[] {
  const negatives: string[] = [];
  if (intent.requiresEnvironmentDominance) {
    negatives.push('protagonist centered', 'character portrait', 'craft activity', 'trade performance');
  }
  if (!intent.allowsBackgroundPopulation) {
    negatives.push('crowd', 'group', 'background people');
  }
  return negatives;
}

function buildPromptContextForSlide(
  slideType: string,
  narrative: NarrativeContext,
  evidence?: NarrativeEvidence,
): Record<string, string> {
  const ctx: Record<string, string> = {
    projectTitle: narrative.projectTitle,
    genre: narrative.genre,
    tone: narrative.tone || narrative.toneStyle,
  };

  if (slideType === 'world' && narrative.locations) {
    ctx.locationName = narrative.locations.split('\n')[0]?.trim() || 'the world';
    ctx.worldRules = narrative.worldRules || '';
  }
  if (slideType === 'key_moments' || slideType === 'story_engine') {
    ctx.momentDescription = narrative.synopsis?.slice(0, 200) || narrative.logline || '';
  }
  if (slideType === 'themes') {
    ctx.theme = narrative.toneStyle || '';
  }

  return ctx;
}

function formatLabel(slideType: string, intent: SlotIntentSpec): string {
  const labels: Record<string, string> = {
    cover: 'Cover — Hero Poster',
    creative_statement: 'Creative Vision — Atmosphere',
    world: 'World — Environment',
    key_moments: 'Key Moments — Scenes',
    visual_language: 'Visual Language — Texture',
    themes: 'Themes & Tone — Atmosphere',
    story_engine: 'Story Engine — Moments',
    comparables: 'Comparables — Atmosphere',
    poster_directions: 'Poster Directions — Key Art',
    closing: 'Closing — Bookend',
  };
  return labels[slideType] || `${slideType} — ${intent.purpose}`;
}
