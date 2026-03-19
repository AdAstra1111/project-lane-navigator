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
  
  // Group evidence by category with best confidence per category
  const evidenceByCat = new Map<TraitCategory, { confidence: 'high' | 'medium' | 'low'; source: string }>();
  for (const et of evidenceTraits) {
    const existing = evidenceByCat.get(et.category);
    const rank = { high: 0, medium: 1, low: 2 };
    if (!existing || rank[et.confidence] < rank[existing.confidence]) {
      evidenceByCat.set(et.category, { confidence: et.confidence, source: et.evidenceSource });
    }
  }
  
  // Identify missing clarifications with resolution status
  const coveredCategories = new Set(allTraits.map(t => t.category));
  const markerCategories = new Set(mergedMarkers.filter(m => m.status !== 'rejected').map(() => 'marker' as TraitCategory));
  
  const missingClarifications: MissingClarification[] = CORE_VISUAL_CATEGORIES.map(c => {
    const hasStrong = coveredCategories.has(c.category);
    const hasMarker = c.category === 'marker' && markerCategories.size > 0;
    const evidenceEntry = evidenceByCat.get(c.category);
    
    if (hasStrong || hasMarker) {
      return { category: c.category, question: c.question, importance: c.importance, status: 'resolved' as ClarificationStatus, resolvedBy: 'canon/script' };
    }
    if (evidenceEntry) {
      // High-confidence evidence from explicit sources fully resolves the category
      const isFullyResolved = evidenceEntry.confidence === 'high';
      return {
        category: c.category,
        question: c.question,
        importance: c.importance,
        status: (isFullyResolved ? 'resolved' : 'partial') as ClarificationStatus,
        resolvedBy: `evidence/${evidenceEntry.source} (${evidenceEntry.confidence})`,
      };
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
 * Build a composite merge key for binding markers.
 * Includes laterality to prevent collapsing distinct left/right markers.
 * Includes a normalized label fragment for markers in the same region with different descriptions.
 */
function markerMergeKey(m: BindingMarker): string {
  const lat = m.laterality !== 'unknown' ? m.laterality : '_';
  const labelNorm = m.label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  return `${m.markerType}:${m.bodyRegion}:${lat}:${labelNorm}`;
}

/**
 * Merge existing markers (with approval state) with newly detected ones.
 * Existing approved/rejected markers are preserved. New detections are added only if novel.
 * 
 * APPROVAL PERSISTENCE NOTE:
 * Marker approval state lives in-memory until `serializeDNAForStorage` is called
 * and the result is written to the database via `useVisualDNA.resolveDNA`.
 * Approving a marker in the UI panel updates local state only.
 * The approval becomes canonical ONLY after Save DNA persists it.
 */
function mergeMarkers(existing: BindingMarker[], detected: BindingMarker[]): BindingMarker[] {
  const merged = [...existing];
  const existingKeys = new Set(existing.map(markerMergeKey));
  
  for (const d of detected) {
    const key = markerMergeKey(d);
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

/**
 * Serialize DNA for storage in character_visual_dna table.
 * 
 * SCHEMA NOTE: The DB has these JSONB columns:
 *   script_truth, narrative_markers, inferred_guidance, producer_guidance,
 *   locked_invariants, flexible_axes, contradiction_flags, missing_clarifications,
 *   identity_signature (nullable), identity_strength (text)
 * 
 * There is NO recipe_json column. Binding markers and evidence traits are
 * persisted inside the `identity_signature` JSONB field as a composite structure:
 *   { signature: {...}, binding_markers: [...], evidence_traits: [...], evidence_status: '...' }
 */
export function serializeDNAForStorage(dna: CharacterVisualDNA) {
  // Composite identity_signature carries signature + markers + evidence
  const compositeSignature = {
    signature: dna.identitySignature || null,
    binding_markers: dna.bindingMarkers || [],
    evidence_traits: dna.evidenceTraits || [],
    evidence_status: dna.evidenceTraits.length > 0 ? 'draft' : 'none',
    transient_states: dna.transientStates || [],
  };

  return {
    script_truth: JSON.parse(JSON.stringify(dna.scriptTruth.traits)),
    narrative_markers: JSON.parse(JSON.stringify(dna.narrativeMarkers.traits)),
    inferred_guidance: JSON.parse(JSON.stringify(dna.inferredGuidance.traits)),
    producer_guidance: JSON.parse(JSON.stringify(dna.producerGuidance)),
    locked_invariants: JSON.parse(JSON.stringify(dna.lockedInvariants)),
    flexible_axes: JSON.parse(JSON.stringify(dna.flexibleAxes)),
    contradiction_flags: JSON.parse(JSON.stringify(dna.contradictions)),
    missing_clarifications: JSON.parse(JSON.stringify(dna.missingClarifications)),
    identity_signature: JSON.parse(JSON.stringify(compositeSignature)),
    identity_strength: dna.identityStrength,
  };
}

/**
 * Deserialize binding markers from the composite identity_signature JSONB.
 */
export function deserializeBindingMarkers(identitySignature: Record<string, any> | null): BindingMarker[] {
  if (!identitySignature?.binding_markers) return [];
  return (identitySignature.binding_markers as BindingMarker[]) || [];
}

/**
 * Deserialize evidence traits from the composite identity_signature JSONB.
 */
export function deserializeEvidenceTraits(identitySignature: Record<string, any> | null): EvidenceTrait[] {
  if (!identitySignature?.evidence_traits) return [];
  return (identitySignature.evidence_traits as EvidenceTrait[]) || [];
}

/**
 * Deserialize transient visual states from the composite identity_signature JSONB.
 */
export function deserializeTransientStates(identitySignature: Record<string, any> | null): TransientVisualState[] {
  if (!identitySignature?.transient_states) return [];
  return (identitySignature.transient_states as TransientVisualState[]) || [];
}

/**
 * Deserialize the actual identity signature from the composite structure.
 */
export function deserializeIdentitySignature(identitySignature: Record<string, any> | null): IdentitySignature | null {
  if (!identitySignature) return null;
  // Handle both old format (direct signature) and new composite format
  if (identitySignature.signature !== undefined) {
    return identitySignature.signature as IdentitySignature | null;
  }
  // Legacy: identity_signature IS the signature directly
  if (identitySignature.face || identitySignature.body || identitySignature.silhouette) {
    return identitySignature as unknown as IdentitySignature;
  }
  return null;
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
