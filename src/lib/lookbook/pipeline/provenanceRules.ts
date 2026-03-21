/**
 * provenanceRules — Defines provenance requirements by slot type.
 *
 * Used by provenanceValidator to score/flag missing provenance
 * and expose diagnostics into QA.
 */
import type { EvidenceClass } from './narrativeEvidence';

export interface ProvenanceRule {
  slideType: string;
  /** Evidence classes that should justify the image selection */
  requiredProvenance: EvidenceClass[];
  /** Evidence classes that enhance but don't block */
  preferredProvenance: EvidenceClass[];
  /** Whether this slide can combine evidence from multiple classes */
  allowsMixedProvenance: boolean;
  /** Severity if provenance is missing: 'block' | 'warn' | 'info' */
  missingSeverity: 'block' | 'warn' | 'info';
}

export const PROVENANCE_RULES: Record<string, ProvenanceRule> = {
  cover: {
    slideType: 'cover',
    requiredProvenance: [],
    preferredProvenance: ['character', 'world', 'atmosphere', 'poster'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  creative_statement: {
    slideType: 'creative_statement',
    requiredProvenance: [],
    preferredProvenance: ['atmosphere', 'theme'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  world: {
    slideType: 'world',
    requiredProvenance: ['world'],
    preferredProvenance: ['environment'],
    allowsMixedProvenance: false,
    missingSeverity: 'warn',
  },
  key_moments: {
    slideType: 'key_moments',
    requiredProvenance: [],
    preferredProvenance: ['scene'],
    allowsMixedProvenance: true,
    missingSeverity: 'warn',
  },
  characters: {
    slideType: 'characters',
    requiredProvenance: ['character'],
    preferredProvenance: [],
    allowsMixedProvenance: false,
    missingSeverity: 'warn',
  },
  visual_language: {
    slideType: 'visual_language',
    requiredProvenance: [],
    preferredProvenance: ['atmosphere'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  themes: {
    slideType: 'themes',
    requiredProvenance: [],
    preferredProvenance: ['atmosphere', 'theme'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  story_engine: {
    slideType: 'story_engine',
    requiredProvenance: [],
    preferredProvenance: ['scene', 'atmosphere'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  comparables: {
    slideType: 'comparables',
    requiredProvenance: [],
    preferredProvenance: ['atmosphere'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  poster_directions: {
    slideType: 'poster_directions',
    requiredProvenance: [],
    preferredProvenance: ['poster', 'character', 'world'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
  closing: {
    slideType: 'closing',
    requiredProvenance: [],
    preferredProvenance: ['atmosphere', 'poster'],
    allowsMixedProvenance: true,
    missingSeverity: 'info',
  },
};

export function getProvenanceRule(slideType: string): ProvenanceRule {
  return PROVENANCE_RULES[slideType] || {
    slideType,
    requiredProvenance: [],
    preferredProvenance: [],
    allowsMixedProvenance: true,
    missingSeverity: 'info' as const,
  };
}
