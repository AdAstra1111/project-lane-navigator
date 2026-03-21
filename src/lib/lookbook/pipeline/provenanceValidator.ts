/**
 * provenanceValidator — Validates provenance requirements per slide.
 *
 * Scores and flags missing provenance for QA diagnostics.
 * Does NOT block builds — advisory layer only (for now).
 */
import type { SlideContent } from '../types';
import type { NarrativeEvidence, EvidenceClass } from './narrativeEvidence';
import type { IdentityBindings } from './identityBindingStage';
import { getSlotIntent } from './lookbookSlotIntent';
import { getProvenanceRule } from './provenanceRules';

// ── Types ────────────────────────────────────────────────────────────────────

export type ProvenanceSeverity = 'pass' | 'warn' | 'missing' | 'mismatch';

export interface SlideProvenanceResult {
  slideType: string;
  slideId: string;
  /** Overall provenance status */
  status: ProvenanceSeverity;
  /** Evidence classes present for this slide */
  presentEvidence: EvidenceClass[];
  /** Evidence classes missing */
  missingRequired: EvidenceClass[];
  /** Evidence classes preferred but absent */
  missingPreferred: EvidenceClass[];
  /** Whether identity binding was required but missing */
  identityBindingMiss: boolean;
  /** Whether environment dominance was required but images are character-led */
  environmentDominanceMiss: boolean;
  /** Human-readable diagnostics */
  diagnostics: string[];
}

export interface ProvenanceReport {
  slideResults: SlideProvenanceResult[];
  /** Summary counts */
  totalSlides: number;
  passCount: number;
  warnCount: number;
  missingCount: number;
  mismatchCount: number;
  /** Identity binding misses for principal slots */
  identityMissCount: number;
  /** Environment dominance misses */
  envDominanceMissCount: number;
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate provenance for all slides in a deck.
 */
export function validateProvenance(
  slides: SlideContent[],
  evidence: NarrativeEvidence,
  identityBindings: IdentityBindings,
): ProvenanceReport {
  const slideResults: SlideProvenanceResult[] = [];

  // Build available evidence class set from NarrativeEvidence
  const availableEvidence = new Set<EvidenceClass>();
  if (evidence.characters.length > 0) availableEvidence.add('character');
  if (evidence.worldRules || evidence.locations) availableEvidence.add('world');
  if (evidence.locations) availableEvidence.add('environment');
  if (evidence.toneStyle || evidence.tone) availableEvidence.add('atmosphere');
  if (evidence.logline || evidence.premise) availableEvidence.add('theme');
  if (evidence.sceneEvidence.length > 0) availableEvidence.add('scene');
  availableEvidence.add('poster'); // always available as a concept

  for (const slide of slides) {
    const intent = getSlotIntent(slide.type);
    const rule = getProvenanceRule(slide.type);
    const diagnostics: string[] = [];

    // Determine which evidence classes are present for this slide
    const presentEvidence: EvidenceClass[] = [];
    for (const ec of availableEvidence) {
      // Check if evidence is actually relevant to this slide
      if (rule.requiredProvenance.includes(ec) || rule.preferredProvenance.includes(ec)) {
        presentEvidence.push(ec);
      }
    }

    // Check required provenance
    const missingRequired: EvidenceClass[] = [];
    for (const req of rule.requiredProvenance) {
      if (!availableEvidence.has(req)) {
        missingRequired.push(req);
        diagnostics.push(`Missing required evidence: ${req}`);
      }
    }

    // Check preferred provenance
    const missingPreferred: EvidenceClass[] = [];
    for (const pref of rule.preferredProvenance) {
      if (!availableEvidence.has(pref) && !missingRequired.includes(pref)) {
        missingPreferred.push(pref);
      }
    }

    // Identity binding check
    let identityBindingMiss = false;
    if (intent.requiresPrincipalIdentity) {
      const hasBoundPrincipals = identityBindings.principals.some(
        p => p.strength === 'locked' || p.strength === 'anchored',
      );
      if (!hasBoundPrincipals) {
        identityBindingMiss = true;
        diagnostics.push('Principal identity binding required but no bound characters found');
      }
    }

    // Environment dominance check
    let environmentDominanceMiss = false;
    if (intent.requiresEnvironmentDominance) {
      if (!evidence.worldRules && !evidence.locations) {
        environmentDominanceMiss = true;
        diagnostics.push('Environment dominance required but no world/location evidence');
      }
    }

    // Determine overall status
    let status: ProvenanceSeverity = 'pass';
    if (missingRequired.length > 0) {
      status = rule.missingSeverity === 'block' ? 'missing' : 'warn';
    } else if (identityBindingMiss || environmentDominanceMiss) {
      status = 'mismatch';
    } else if (missingPreferred.length > 0) {
      status = 'pass'; // preferred misses don't downgrade
    }

    slideResults.push({
      slideType: slide.type,
      slideId: slide.slide_id,
      status,
      presentEvidence,
      missingRequired,
      missingPreferred,
      identityBindingMiss,
      environmentDominanceMiss,
      diagnostics,
    });
  }

  return {
    slideResults,
    totalSlides: slideResults.length,
    passCount: slideResults.filter(r => r.status === 'pass').length,
    warnCount: slideResults.filter(r => r.status === 'warn').length,
    missingCount: slideResults.filter(r => r.status === 'missing').length,
    mismatchCount: slideResults.filter(r => r.status === 'mismatch').length,
    identityMissCount: slideResults.filter(r => r.identityBindingMiss).length,
    envDominanceMissCount: slideResults.filter(r => r.environmentDominanceMiss).length,
  };
}
