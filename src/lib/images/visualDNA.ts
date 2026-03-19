/**
 * Character Visual DNA — Deterministic resolver that builds a structured
 * visual truth model for each character from canon, narrative, inference, and user guidance.
 * 
 * DNA is versioned, auditable, and governs all downstream image generation.
 * 
 * Visual Truth Layers:
 *   1. Script Truth (locked) — explicit canon facts
 *   2. Binding Markers (approved → enforced) — persistent visible features
 *   3. Narrative Markers (protected) — story-critical visible traits
 *   4. Inferred Guidance (flexible) — contextual derivations
 *   5. Evidence Traits (draft) — AI-extracted, non-authoritative
 *   6. Producer Guidance (classified) — user notes
 */

import type { CharacterTrait, TraitSource, TraitConstraint, TraitCategory, BindingMarker } from './characterTraits';
import {
  extractTraitsFromCanon,
  deriveTraitsFromContext,
  extractNarrativeTraits,
  parseUserNotes,
  detectTraitContradictions,
  detectBindingMarkers,
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

export type ClarificationStatus = 'resolved' | 'partial' | 'missing';

export interface MissingClarification {
  category: TraitCategory;
  question: string;
  importance: 'high' | 'medium' | 'low';
  status: ClarificationStatus;
  resolvedBy?: string;
}

export interface EvidenceTrait extends VisualDNATrait {
  evidenceSource: string;
  evidenceExcerpt: string;
}

export interface CharacterVisualDNA {
  characterName: string;
  
  /** Layer 1: Explicit visual traits from canon/script — LOCKED */
  scriptTruth: VisualDNALayer;
  
  /** Layer 2: Binding visual markers — must persist across all images when visible */
  bindingMarkers: BindingMarker[];
  
  /** Layer 3: Narrative-critical visible markers — PROTECTED */
  narrativeMarkers: VisualDNALayer;
  
  /** Layer 4: Flexible traits derived from role/world */
  inferredGuidance: VisualDNALayer;
  
  /** Layer 5: User/producer guidance — classified */
  producerGuidance: ProducerGuidanceItem[];
  
  /** Layer 6: Traits that must NEVER drift */
  lockedInvariants: VisualDNATrait[];
  
  /** Layer 7: Traits allowed to vary */
  flexibleAxes: VisualDNATrait[];

  /** Layer 8: AI-extracted evidence traits — INFERRED, traceable */
  evidenceTraits: EvidenceTrait[];
  
  /** Conflicts between sources */
  contradictions: TraitContradiction[];
  
  /** Gaps in visual definition — now with resolution status */
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
  existingMarkers?: BindingMarker[],
  existingEvidenceTraits?: EvidenceTrait[],
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
  
  // Detect binding markers from all text sources
  const detectedMarkers: BindingMarker[] = [];
  if (canonCharacter) {
    for (const field of ['appearance', 'physical', 'description', 'traits']) {
      const val = canonCharacter[field];
      if (typeof val === 'string' && val.trim()) {
        detectedMarkers.push(...detectBindingMarkers(val, `canon.${field}`));
      }
    }
  }
  
  // Merge with existing markers (preserve approved/resolved state)
  const mergedMarkers = mergeMarkers(existingMarkers || [], detectedMarkers);
  
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
  
  // Build evidence coverage set for clarification resolution
  const evidenceTraits = existingEvidenceTraits || [];
  const evidenceCoveredCategories = new Set(evidenceTraits.map(t => t.category));
  
  // Identify missing clarifications with resolution status
  const coveredCategories = new Set(allTraits.map(t => t.category));
  const markerCategories = new Set(mergedMarkers.filter(m => m.status !== 'rejected').map(() => 'marker' as TraitCategory));
  
  const missingClarifications: MissingClarification[] = CORE_VISUAL_CATEGORIES.map(c => {
    const hasStrong = coveredCategories.has(c.category);
    const hasEvidence = evidenceCoveredCategories.has(c.category);
    const hasMarker = c.category === 'marker' && markerCategories.size > 0;
    
    if (hasStrong || hasMarker) {
      return { category: c.category, question: c.question, importance: c.importance, status: 'resolved' as ClarificationStatus, resolvedBy: 'canon/script' };
    }
    if (hasEvidence) {
      const evidenceSource = evidenceTraits.find(t => t.category === c.category)?.evidenceSource;
      return { category: c.category, question: c.question, importance: c.importance, status: 'partial' as ClarificationStatus, resolvedBy: evidenceSource || 'evidence' };
    }
    return { category: c.category, question: c.question, importance: c.importance, status: 'missing' as ClarificationStatus };
  }).filter(c => c.status !== 'resolved');
  
  // Derive identity signature from locked traits
  const identitySignature = deriveIdentitySignature(allTraits);
  const hasIdSig = hasIdentitySignature(identitySignature);
  const identityStrength: 'strong' | 'partial' | 'weak' = 
    identityLocked && hasIdSig ? 'strong' : hasIdSig ? 'partial' : 'weak';
  
  return {
    characterName,
    scriptTruth: { traits: scriptTraits.map(traitToVisualDNATrait) },
    bindingMarkers: mergedMarkers,
    narrativeMarkers: { traits: narrativeTraits.map(traitToVisualDNATrait) },
    inferredGuidance: { traits: inferredTraits.map(traitToVisualDNATrait) },
    producerGuidance,
    lockedInvariants: allInvariants,
    flexibleAxes,
    evidenceTraits,
    contradictions,
    missingClarifications,
    identitySignature: hasIdSig ? identitySignature : null,
    identityStrength,
    allTraits,
  };
}

/**
 * Merge existing markers (with approval state) with newly detected ones.
 * Existing approved/rejected markers are preserved. New detections are added only if novel.
 */
function mergeMarkers(existing: BindingMarker[], detected: BindingMarker[]): BindingMarker[] {
  const merged = [...existing];
  const existingKeys = new Set(existing.map(m => `${m.markerType}:${m.bodyRegion}`));
  
  for (const d of detected) {
    const key = `${d.markerType}:${d.bodyRegion}`;
    if (!existingKeys.has(key)) {
      merged.push(d);
      existingKeys.add(key);
    }
  }
  
  return merged;
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
    // Evidence traits and binding markers persisted in recipe_json
    recipe_json: JSON.parse(JSON.stringify({
      evidence_traits: dna.evidenceTraits,
      evidence_status: dna.evidenceTraits.length > 0 ? 'draft' : 'none',
      binding_markers: dna.bindingMarkers,
    })),
  };
}

/**
 * Deserialize binding markers from stored recipe_json.
 */
export function deserializeBindingMarkers(recipeJson: Record<string, any> | null): BindingMarker[] {
  if (!recipeJson?.binding_markers) return [];
  return (recipeJson.binding_markers as BindingMarker[]) || [];
}

/**
 * Deserialize evidence traits from stored recipe_json.
 */
export function deserializeEvidenceTraits(recipeJson: Record<string, any> | null): EvidenceTrait[] {
  if (!recipeJson?.evidence_traits) return [];
  return (recipeJson.evidence_traits as EvidenceTrait[]) || [];
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
 * Priority order: binding markers > locked invariants > script truth > protected markers > flexible guidance > producer guidance > evidence
 */
export function formatDNAPromptContext(dna: CharacterVisualDNA): string {
  const blocks: string[] = [];
  
  // 0. Binding markers (HIGHEST priority — mandatory enforcement)
  const approvedMarkers = dna.bindingMarkers.filter(m => m.status === 'approved');
  if (approvedMarkers.length > 0) {
    blocks.push([
      `[BINDING VISUAL MARKERS — ${dna.characterName.toUpperCase()} — MANDATORY]`,
      '(These features MUST appear in the image whenever the relevant body region is visible.)',
      ...approvedMarkers.map(m => {
        const lateralStr = m.laterality !== 'unknown' ? ` (${m.laterality})` : '';
        const regionStr = m.bodyRegion !== 'unspecified' ? ` on ${m.bodyRegion}` : '';
        return `- ${m.markerType.toUpperCase()}${regionStr}${lateralStr} — ENFORCE: visible when region shown`;
      }),
    ].join('\n'));
  }
  
  // 1. Locked invariants
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

  // 6. Evidence-extracted traits — DRAFT ONLY, clearly demarcated as weak/suggestive
  const highConfEvidence = dna.evidenceTraits.filter(t => t.confidence === 'high' || t.confidence === 'medium');
  if (highConfEvidence.length > 0) {
    blocks.push([
      '[EVIDENCE-SUGGESTED TRAITS — DRAFT, NON-AUTHORITATIVE]',
      '(These are AI-inferred from project documents. They may be overridden by any canon or producer guidance above.)',
      ...highConfEvidence.map(t => `- ${t.label} (${t.category}, ${t.confidence} confidence)`),
    ].join('\n'));
  }
  
  return blocks.join('\n\n');
}
