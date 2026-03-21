/**
 * narrativeEvidence — Structured narrative evidence model for LookBook pipeline.
 *
 * Canonical output of NARRATIVE_EXTRACTION stage.
 * Provides typed evidence classes that downstream stages (slot planning,
 * identity binding, provenance validation, election) can consume.
 */

// ── Evidence Classes ─────────────────────────────────────────────────────────

export type EvidenceClass =
  | 'character'
  | 'relationship'
  | 'world'
  | 'environment'
  | 'scene'
  | 'atmosphere'
  | 'theme'
  | 'poster';

/** A single piece of narrative evidence with source provenance */
export interface NarrativeEvidenceItem {
  class: EvidenceClass;
  /** Human-readable label */
  label: string;
  /** Source field or document */
  source: string;
  /** Confidence 0–1 */
  confidence: number;
  /** Raw text excerpt */
  excerpt?: string;
}

/** Character evidence from canon */
export interface CharacterEvidence {
  name: string;
  id?: string;
  role?: string;
  archetype?: string;
  traits?: string;
  goals?: string;
  description?: string;
  /** Whether this character has visual identity anchors */
  hasIdentityAnchors: boolean;
  /** Story importance: principal | recurring | incidental */
  importance: 'principal' | 'recurring' | 'incidental';
}

/** Location evidence from canon */
export interface LocationEvidence {
  name: string;
  canonLocationId?: string;
  description?: string;
  interiorOrExterior?: string;
  storyImportance?: string;
  /** Whether visual refs exist */
  hasVisualRefs: boolean;
}

/** Scene/beat evidence if available */
export interface SceneEvidence {
  sceneId?: string;
  slugline?: string;
  characters?: string[];
  dramaticPurpose?: string;
  location?: string;
  /** Confidence 0–1 */
  confidence: number;
}

// ── Composite Narrative Evidence ─────────────────────────────────────────────

export interface NarrativeEvidence {
  // ── Core story fields ──
  projectTitle: string;
  logline: string;
  premise: string;
  synopsis: string;
  creativeStatement: string;

  // ── World ──
  worldRules: string;
  locations: string;
  timeline: string;

  // ── Tone / Style ──
  genre: string;
  format: string;
  formatLabel: string;
  tone: string;
  toneStyle: string;
  targetAudience: string;

  // ── Structure ──
  assignedLane: string;
  comparableTitles: string;
  comparables: string;
  formatConstraints: string;

  // ── Structured evidence ──
  characters: CharacterEvidence[];
  locationEvidence: LocationEvidence[];
  sceneEvidence: SceneEvidence[];
  evidenceItems: NarrativeEvidenceItem[];

  // ── Derived flags ──
  isVerticalDrama: boolean;
  effectiveLane: string | null;

  // ── Completeness metrics ──
  evidenceCoverage: {
    hasLogline: boolean;
    hasPremise: boolean;
    hasWorldRules: boolean;
    hasLocations: boolean;
    hasCharacters: boolean;
    hasComparables: boolean;
    hasSynopsis: boolean;
    hasCreativeStatement: boolean;
    hasSceneEvidence: boolean;
    /** 0–1 overall completeness */
    score: number;
  };
}

// ── Character Importance Heuristic ───────────────────────────────────────────

/**
 * PRINCIPAL_SIGNALS — role/archetype keywords indicating a principal character.
 * Matched case-insensitively against role and archetype fields.
 */
const PRINCIPAL_SIGNALS = [
  'protagonist', 'lead', 'main', 'hero', 'heroine',
  'antagonist', 'villain', 'anti-hero', 'antihero',
  'central', 'primary',
];

const RECURRING_SIGNALS = [
  'supporting', 'secondary', 'friend', 'ally', 'mentor',
  'recurring', 'rival', 'love interest', 'partner',
  'confidant', 'sidekick', 'lieutenant',
];

const INCIDENTAL_SIGNALS = [
  'guard', 'servant', 'extra', 'crowd', 'incidental',
  'background', 'bystander', 'minor', 'unnamed', 'passerby',
  'townsperson', 'villager',
];

/**
 * Derive character importance from canon role/archetype fields.
 * Falls back to array position only when no semantic signal exists.
 */
function deriveCharacterImportance(
  role?: string,
  archetype?: string,
  arrayIndex?: number,
): CharacterEvidence['importance'] {
  const combined = [role || '', archetype || ''].join(' ').toLowerCase();

  // Check semantic signals in priority order
  for (const signal of PRINCIPAL_SIGNALS) {
    if (combined.includes(signal)) return 'principal';
  }
  for (const signal of INCIDENTAL_SIGNALS) {
    if (combined.includes(signal)) return 'incidental';
  }
  for (const signal of RECURRING_SIGNALS) {
    if (combined.includes(signal)) return 'recurring';
  }

  // Positional fallback only when no semantic signal found
  if (arrayIndex !== undefined) {
    if (arrayIndex < 3) return 'principal';
    if (arrayIndex < 6) return 'recurring';
    return 'incidental';
  }

  return 'recurring'; // safe default
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build NarrativeEvidence from the raw narrative context.
 * This is a pure transform — no DB calls.
 */
export function buildNarrativeEvidence(
  raw: {
    projectTitle: string;
    logline: string;
    premise: string;
    worldRules: string;
    locations: string;
    timeline: string;
    genre: string;
    format: string;
    formatLabel: string;
    tone: string;
    toneStyle: string;
    targetAudience: string;
    assignedLane: string;
    comparableTitles: string;
    comparables: string;
    formatConstraints: string;
    synopsis: string;
    creativeStatement: string;
    characters: unknown;
  },
  derived: {
    isVerticalDrama: boolean;
    effectiveLane: string | null;
    characterIdentityMap?: Map<string, boolean>;
    locationEvidence?: LocationEvidence[];
    sceneEvidence?: SceneEvidence[];
  },
): NarrativeEvidence {
  // Parse characters with semantic importance derivation
  const rawChars = Array.isArray(raw.characters) ? raw.characters : [];
  const characters: CharacterEvidence[] = rawChars.slice(0, 12).map((c: any, i: number) => {
    const name = (c?.name || `Character ${i + 1}`).toString();
    const id = c?.id?.toString();
    const role = c?.role?.toString();
    const archetype = c?.archetype?.toString();

    // Check identity anchors from map (by ID first, then by name)
    const hasAnchors = (
      (id && derived.characterIdentityMap?.get(id)) ||
      derived.characterIdentityMap?.get(name.toLowerCase()) ||
      false
    );

    // Semantic importance derivation (not positional)
    const importance = deriveCharacterImportance(role, archetype, i);

    return {
      name,
      id,
      role,
      archetype,
      traits: c?.traits?.toString(),
      goals: c?.goals?.toString(),
      description: c?.description?.toString(),
      hasIdentityAnchors: hasAnchors,
      importance,
    };
  });

  // Log importance derivation for diagnostics
  const importanceSummary = characters.map(c => `${c.name}:${c.importance}`).join(', ');
  console.log(`[Pipeline:narrative] Character importance: ${importanceSummary}`);

  // Build evidence items for downstream consumption
  const evidenceItems: NarrativeEvidenceItem[] = [];
  if (raw.logline) evidenceItems.push({ class: 'theme', label: 'Logline', source: 'canon', confidence: 1 });
  if (raw.premise) evidenceItems.push({ class: 'theme', label: 'Premise', source: 'canon', confidence: 1 });
  if (raw.worldRules) evidenceItems.push({ class: 'world', label: 'World Rules', source: 'canon', confidence: 1 });
  if (raw.locations) evidenceItems.push({ class: 'environment', label: 'Locations', source: 'canon', confidence: 0.9 });
  if (raw.toneStyle) evidenceItems.push({ class: 'atmosphere', label: 'Tone/Style', source: 'canon', confidence: 1 });
  for (const ch of characters) {
    evidenceItems.push({ class: 'character', label: ch.name, source: 'canon', confidence: ch.hasIdentityAnchors ? 1 : 0.7 });
  }
  if (raw.comparables) evidenceItems.push({ class: 'poster', label: 'Comparables', source: 'canon', confidence: 0.8 });

  // Scene evidence items
  const sceneEvidence = derived.sceneEvidence || [];
  for (const scene of sceneEvidence) {
    evidenceItems.push({
      class: 'scene',
      label: scene.slugline || 'Scene',
      source: 'canon',
      confidence: scene.confidence,
    });
  }

  // Location evidence items
  const locationEvidence = derived.locationEvidence || [];
  for (const loc of locationEvidence) {
    evidenceItems.push({
      class: 'environment',
      label: loc.name,
      source: 'canon_locations',
      confidence: loc.hasVisualRefs ? 1 : 0.7,
    });
  }

  // Coverage
  const fields = [raw.logline, raw.premise, raw.worldRules, raw.locations, raw.toneStyle, raw.comparables, raw.synopsis, raw.creativeStatement];
  const filledCount = fields.filter(Boolean).length + (characters.length > 0 ? 1 : 0) + (sceneEvidence.length > 0 ? 1 : 0);
  const totalFields = fields.length + 2; // +characters +scenes

  return {
    projectTitle: raw.projectTitle,
    logline: raw.logline,
    premise: raw.premise,
    synopsis: raw.synopsis,
    creativeStatement: raw.creativeStatement,
    worldRules: raw.worldRules,
    locations: raw.locations,
    timeline: raw.timeline,
    genre: raw.genre,
    format: raw.format,
    formatLabel: raw.formatLabel,
    tone: raw.tone,
    toneStyle: raw.toneStyle,
    targetAudience: raw.targetAudience,
    assignedLane: raw.assignedLane,
    comparableTitles: raw.comparableTitles,
    comparables: raw.comparables,
    formatConstraints: raw.formatConstraints,
    characters,
    locationEvidence,
    sceneEvidence,
    evidenceItems,
    isVerticalDrama: derived.isVerticalDrama,
    effectiveLane: derived.effectiveLane,
    evidenceCoverage: {
      hasLogline: !!raw.logline,
      hasPremise: !!raw.premise,
      hasWorldRules: !!raw.worldRules,
      hasLocations: !!raw.locations,
      hasCharacters: characters.length > 0,
      hasComparables: !!raw.comparables,
      hasSynopsis: !!raw.synopsis,
      hasCreativeStatement: !!raw.creativeStatement,
      hasSceneEvidence: sceneEvidence.length > 0,
      score: filledCount / totalFields,
    },
  };
}
