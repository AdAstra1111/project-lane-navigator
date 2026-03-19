/**
 * Character Visual DNA — Deterministic resolver that builds a structured
 * visual truth model for each character from canon, narrative, inference, and user guidance.
 * 
 * DNA is versioned, auditable, and governs all downstream image generation.
 */

import type { CharacterTrait, TraitSource, TraitConstraint, TraitCategory } from './characterTraits';
import {
  extractTraitsFromCanon,
  deriveTraitsFromContext,
  extractNarrativeTraits,
  parseUserNotes,
  detectTraitContradictions,
  type TraitContradiction,
} from './characterTraits';
import {
  deriveIdentitySignature,
  hasIdentitySignature,
  type IdentitySignature,
} from './identitySignature';

// ── Types ──

export interface VisualDNATrait {
  label: string;
  category: TraitCategory;
  source: TraitSource;
  constraint: TraitConstraint;
  confidence: 'high' | 'medium' | 'low';
}

export interface VisualDNALayer {
  traits: VisualDNATrait[];
}

export interface ProducerGuidanceItem {
  text: string;
  classification: 'canon_compatible' | 'canon_conflicting' | 'ambiguous';
  warning?: string;
}

export interface MissingClarification {
  category: TraitCategory;
  question: string;
  importance: 'high' | 'medium' | 'low';
}

export interface EvidenceTrait extends VisualDNATrait {
  evidenceSource: string;
  evidenceExcerpt: string;
}

export interface CharacterVisualDNA {
  characterName: string;
  
  /** Layer 1: Explicit visual traits from canon/script — LOCKED */
  scriptTruth: VisualDNALayer;
  
  /** Layer 2: Narrative-critical visible markers — PROTECTED */
  narrativeMarkers: VisualDNALayer;
  
  /** Layer 3: Flexible traits derived from role/world */
  inferredGuidance: VisualDNALayer;
  
  /** Layer 4: User/producer guidance — classified */
  producerGuidance: ProducerGuidanceItem[];
  
  /** Layer 5: Traits that must NEVER drift */
  lockedInvariants: VisualDNATrait[];
  
  /** Layer 6: Traits allowed to vary */
  flexibleAxes: VisualDNATrait[];

  /** Layer 7: AI-extracted evidence traits — INFERRED, traceable */
  evidenceTraits: EvidenceTrait[];
  
  /** Conflicts between sources */
  contradictions: TraitContradiction[];
  
  /** Gaps in visual definition */
  missingClarifications: MissingClarification[];
  
  /** Identity signature derived from locked anchors */
  identitySignature: IdentitySignature | null;
  identityStrength: 'strong' | 'partial' | 'weak';
  
  /** All resolved traits for prompt injection */
  allTraits: CharacterTrait[];
}

// ── Core categories to check for completeness ──

const CORE_VISUAL_CATEGORIES: { category: TraitCategory; question: string; importance: 'high' | 'medium' | 'low' }[] = [
  { category: 'age', question: 'What is this character\'s approximate age or age range?', importance: 'high' },
  { category: 'gender', question: 'What is this character\'s gender presentation?', importance: 'high' },
  { category: 'build', question: 'What is this character\'s physical build and height?', importance: 'high' },
  { category: 'hair', question: 'What is this character\'s hair style and color?', importance: 'medium' },
  { category: 'skin', question: 'What is this character\'s skin tone or complexion?', importance: 'medium' },
  { category: 'clothing', question: 'What is this character\'s baseline wardrobe style?', importance: 'medium' },
];

// ── Resolver ──

/**
 * Resolve the full Character Visual DNA from all available sources.
 * Pure function — no side effects, no database calls.
 */
export function resolveCharacterVisualDNA(
  characterName: string,
  canonCharacter: Record<string, unknown> | null,
  canonJson: Record<string, unknown> | null,
  userNotes: string,
  identityLocked: boolean,
): CharacterVisualDNA {
  // Extract traits from each source
  const scriptTraits = extractTraitsFromCanon(canonCharacter);
  const narrativeTraits = extractNarrativeTraits(canonCharacter);
  const inferredTraits = deriveTraitsFromContext(canonCharacter, canonJson);
  const userTraits = parseUserNotes(userNotes);
  
  const allTraits: CharacterTrait[] = [...scriptTraits, ...narrativeTraits, ...inferredTraits, ...userTraits];
  
  // Detect contradictions
  const contradictions = detectTraitContradictions(allTraits);
  const contradictingUserLabels = new Set(contradictions.map(c => c.userTrait.label.toLowerCase()));
  
  // Classify producer guidance
  const producerGuidance: ProducerGuidanceItem[] = userTraits.map(t => {
    const isConflicting = contradictingUserLabels.has(t.label.toLowerCase());
    const matchingContradiction = contradictions.find(
      c => c.userTrait.label.toLowerCase() === t.label.toLowerCase()
    );
    
    return {
      text: t.label,
      classification: isConflicting ? 'canon_conflicting' as const : 'canon_compatible' as const,
      warning: matchingContradiction?.message,
    };
  });
  
  // Locked invariants: script + narrative traits (the "what must not drift" list)
  const lockedInvariants: VisualDNATrait[] = scriptTraits
    .filter(t => t.constraint === 'locked')
    .map(traitToVisualDNATrait);
  
  // Add narrative markers as protected invariants
  const protectedInvariants: VisualDNATrait[] = narrativeTraits
    .filter(t => t.constraint === 'protected')
    .map(traitToVisualDNATrait);
  
  const allInvariants = [...lockedInvariants, ...protectedInvariants];
  
  // Flexible axes: inferred + user traits without contradictions
  const flexibleAxes: VisualDNATrait[] = inferredTraits
    .filter(t => t.constraint === 'flexible')
    .map(traitToVisualDNATrait);
  
  // Identify missing clarifications
  const coveredCategories = new Set(allTraits.map(t => t.category));
  const missingClarifications: MissingClarification[] = CORE_VISUAL_CATEGORIES
    .filter(c => !coveredCategories.has(c.category))
    .map(c => ({ category: c.category, question: c.question, importance: c.importance }));
  
  // Derive identity signature from locked traits
  const identitySignature = deriveIdentitySignature(allTraits);
  const hasIdSig = hasIdentitySignature(identitySignature);
  const identityStrength: 'strong' | 'partial' | 'weak' = 
    identityLocked && hasIdSig ? 'strong' : hasIdSig ? 'partial' : 'weak';
  
  return {
    characterName,
    scriptTruth: { traits: scriptTraits.map(traitToVisualDNATrait) },
    narrativeMarkers: { traits: narrativeTraits.map(traitToVisualDNATrait) },
    inferredGuidance: { traits: inferredTraits.map(traitToVisualDNATrait) },
    producerGuidance,
    lockedInvariants: allInvariants,
    flexibleAxes,
    evidenceTraits: [],
    contradictions,
    missingClarifications,
    identitySignature: hasIdSig ? identitySignature : null,
    identityStrength,
    allTraits,
  };
}

function traitToVisualDNATrait(t: CharacterTrait): VisualDNATrait {
  return {
    label: t.label,
    category: t.category,
    source: t.source,
    constraint: t.constraint,
    confidence: t.confidence,
  };
}

// ── Serialization for database ──

export function serializeDNAForStorage(dna: CharacterVisualDNA) {
  return {
    script_truth: JSON.parse(JSON.stringify(dna.scriptTruth.traits)),
    narrative_markers: JSON.parse(JSON.stringify(dna.narrativeMarkers.traits)),
    inferred_guidance: JSON.parse(JSON.stringify(dna.inferredGuidance.traits)),
    producer_guidance: JSON.parse(JSON.stringify(dna.producerGuidance)),
    locked_invariants: JSON.parse(JSON.stringify(dna.lockedInvariants)),
    flexible_axes: JSON.parse(JSON.stringify(dna.flexibleAxes)),
    contradiction_flags: JSON.parse(JSON.stringify(dna.contradictions)),
    missing_clarifications: JSON.parse(JSON.stringify(dna.missingClarifications)),
    identity_signature: dna.identitySignature ? JSON.parse(JSON.stringify(dna.identitySignature)) : null,
    identity_strength: dna.identityStrength,
  };
}

// ── Prompt Injection ──

/**
 * Format the "What Must Not Drift" block for prompt injection.
 * This is the concise invariant list that overrides all flexible inputs.
 */
export function formatInvariantsBlock(dna: CharacterVisualDNA): string {
  if (dna.lockedInvariants.length === 0) return '';
  
  const lines = [
    `[WHAT MUST NOT DRIFT — ${dna.characterName.toUpperCase()}]`,
    ...dna.lockedInvariants.map(t => `- ${t.label}`),
  ];
  
  return lines.join('\n');
}

/**
 * Format full DNA context for generation prompts.
 * Priority order: locked invariants > protected markers > flexible guidance > producer guidance
 */
export function formatDNAPromptContext(dna: CharacterVisualDNA): string {
  const blocks: string[] = [];
  
  // 1. Locked invariants (highest priority)
  const invariantsBlock = formatInvariantsBlock(dna);
  if (invariantsBlock) blocks.push(invariantsBlock);
  
  // 2. Script truth
  if (dna.scriptTruth.traits.length > 0) {
    blocks.push([
      '[CANON VISUAL TRAITS]',
      ...dna.scriptTruth.traits.map(t => `- ${t.label} (${t.category})`),
    ].join('\n'));
  }
  
  // 3. Narrative markers
  if (dna.narrativeMarkers.traits.length > 0) {
    blocks.push([
      '[NARRATIVE-CRITICAL MARKERS — PROTECTED]',
      ...dna.narrativeMarkers.traits.map(t => `- ${t.label}`),
    ].join('\n'));
  }
  
  // 4. Inferred guidance (flexible)
  if (dna.inferredGuidance.traits.length > 0) {
    blocks.push([
      '[INFERRED GUIDANCE — FLEXIBLE]',
      ...dna.inferredGuidance.traits.map(t => `- ${t.label}`),
    ].join('\n'));
  }
  
  // 5. Producer guidance (only canon-compatible)
  const compatibleGuidance = dna.producerGuidance.filter(g => g.classification === 'canon_compatible');
  if (compatibleGuidance.length > 0) {
    blocks.push([
      '[PRODUCER GUIDANCE]',
      ...compatibleGuidance.map(g => `- ${g.text}`),
    ].join('\n'));
  }
  
  return blocks.join('\n\n');
}
