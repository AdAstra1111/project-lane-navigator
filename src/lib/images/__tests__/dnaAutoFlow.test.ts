/**
 * DNA Auto-Flow Engine Tests
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBodyReference,
  resolveDirectionalAmbiguity,
  evaluateDnaIntegrity,
  filterClarifications,
  type DnaAutoFlowMode,
} from '../dnaAutoFlow';
import type { BindingMarker } from '../characterTraits';
import type { CharacterVisualDNA, MissingClarification, ClarificationStatus } from '../visualDNA';

function makeMarker(overrides: Partial<BindingMarker> = {}): BindingMarker {
  return {
    id: 'test-marker',
    markerType: 'tattoo',
    label: 'tattoo on wrist',
    bodyRegion: 'wrist',
    laterality: 'unknown',
    size: 'medium',
    visibility: 'always_visible',
    attributes: {},
    status: 'detected',
    requiresUserDecision: true,
    unresolvedFields: ['laterality'],
    confidence: 'high',
    evidenceSource: 'canon.description',
    evidenceExcerpt: 'serpentine tattoo on wrist',
    approvedAt: null,
    approvedBy: null,
    ...overrides,
  };
}

function makeDna(overrides: Partial<CharacterVisualDNA> = {}): CharacterVisualDNA {
  return {
    characterName: 'Test',
    scriptTruth: { traits: [] },
    bindingMarkers: [],
    narrativeMarkers: { traits: [] },
    inferredGuidance: { traits: [] },
    producerGuidance: [],
    lockedInvariants: [],
    flexibleAxes: [],
    evidenceTraits: [],
    contradictions: [],
    missingClarifications: [],
    transientStates: [],
    identitySignature: null,
    identityStrength: 'weak',
    allTraits: [],
    ...overrides,
  };
}

function makeClarification(overrides: Partial<MissingClarification> = {}): MissingClarification {
  return {
    category: 'age',
    question: 'What age?',
    importance: 'high',
    status: 'missing' as ClarificationStatus,
    ...overrides,
  };
}

describe('normalizeBodyReference', () => {
  it('"tattoo on wrist" → region=wrist, side=unknown, usable', () => {
    const ref = normalizeBodyReference(makeMarker());
    expect(ref.region).toBe('wrist');
    expect(ref.side).toBe('unknown');
    expect(ref.sideConfidence).toBe('unresolved');
    expect(ref.markerStatus).toBe('resolved_side_unknown');
    expect(ref.usableForGeneration).toBe(true);
  });

  it('explicit left hand → resolved', () => {
    const ref = normalizeBodyReference(makeMarker({
      bodyRegion: 'hand',
      laterality: 'left',
    }));
    expect(ref.sideConfidence).toBe('explicit');
    expect(ref.markerStatus).toBe('resolved');
    expect(ref.usableForGeneration).toBe(true);
  });

  it('scar on forehead → no side needed, resolved', () => {
    const ref = normalizeBodyReference(makeMarker({
      markerType: 'scar',
      label: 'scar on forehead',
      bodyRegion: 'forehead',
      laterality: 'unknown',
      unresolvedFields: [],
    }));
    expect(ref.sideConfidence).toBe('explicit'); // side N/A for forehead
    expect(ref.markerStatus).toBe('resolved');
    expect(ref.usableForGeneration).toBe(true);
  });
});

describe('resolveDirectionalAmbiguity', () => {
  it('Mode B clears laterality from unresolvedFields when usable', () => {
    const markers = [makeMarker()];
    const { resolved } = resolveDirectionalAmbiguity(markers, 'aggressive');
    expect(resolved[0].unresolvedFields).not.toContain('laterality');
    expect(resolved[0].requiresUserDecision).toBe(false);
  });

  it('Mode A preserves laterality in unresolvedFields', () => {
    const markers = [makeMarker()];
    const { resolved } = resolveDirectionalAmbiguity(markers, 'conservative');
    expect(resolved[0].unresolvedFields).toContain('laterality');
  });
});

describe('evaluateDnaIntegrity', () => {
  it('Mode B meets minimum with 2 core categories', () => {
    const dna = makeDna({
      allTraits: [
        { label: 'male', category: 'gender', source: 'script', confidence: 'high', constraint: 'locked' },
        { label: 'young', category: 'age', source: 'script', confidence: 'high', constraint: 'locked' },
      ],
    });
    const result = evaluateDnaIntegrity(dna, 'aggressive');
    expect(result.meetsMinimumThreshold).toBe(true);
    expect(result.resolvedCoreCount).toBe(2);
  });

  it('Mode A needs 4 core categories', () => {
    const dna = makeDna({
      allTraits: [
        { label: 'male', category: 'gender', source: 'script', confidence: 'high', constraint: 'locked' },
        { label: 'young', category: 'age', source: 'script', confidence: 'high', constraint: 'locked' },
      ],
    });
    const result = evaluateDnaIntegrity(dna, 'conservative');
    expect(result.meetsMinimumThreshold).toBe(false);
  });

  it('contradictions block Mode A but not Mode B warnings', () => {
    const dna = makeDna({
      allTraits: [
        { label: 'male', category: 'gender', source: 'script', confidence: 'high', constraint: 'locked' },
        { label: 'young', category: 'age', source: 'script', confidence: 'high', constraint: 'locked' },
        { label: 'tall', category: 'build', source: 'script', confidence: 'high', constraint: 'locked' },
      ],
      contradictions: [{
        userTrait: { label: 'old', category: 'age', source: 'user', confidence: 'medium', constraint: 'user' },
        conflictsWith: { label: 'young', category: 'age', source: 'script', confidence: 'high', constraint: 'locked' },
        severity: 'warning',
        message: 'test',
      }],
    });
    const modeA = evaluateDnaIntegrity(dna, 'conservative');
    const modeB = evaluateDnaIntegrity(dna, 'aggressive');
    expect(modeA.meetsMinimumThreshold).toBe(false); // any contradiction blocks A
    expect(modeB.meetsMinimumThreshold).toBe(true); // warning doesn't block B
  });
});

describe('filterClarifications', () => {
  it('Mode B suppresses partial medium-confidence clarifications', () => {
    const clars = [
      makeClarification({ status: 'missing', importance: 'high' }),
      makeClarification({
        category: 'clothing',
        status: 'partial' as ClarificationStatus,
        importance: 'medium',
        answerCandidate: { text: 'practical workwear', confidence: 'medium', basis: 'inferred_context' },
      }),
    ];
    const filtered = filterClarifications(clars, 'aggressive');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].category).toBe('age');
  });

  it('Mode A shows all non-resolved clarifications', () => {
    const clars = [
      makeClarification({ status: 'missing', importance: 'high' }),
      makeClarification({
        category: 'clothing',
        status: 'partial' as ClarificationStatus,
        importance: 'medium',
        answerCandidate: { text: 'practical workwear', confidence: 'medium', basis: 'inferred_context' },
      }),
    ];
    const filtered = filterClarifications(clars, 'conservative');
    expect(filtered).toHaveLength(2);
  });
});

describe('marker states', () => {
  it('resolved_side_unknown is distinct from pending_resolution', () => {
    const ref1 = normalizeBodyReference(makeMarker({ bodyRegion: 'wrist', laterality: 'unknown' }));
    const ref2 = normalizeBodyReference(makeMarker({ bodyRegion: 'wrist', laterality: 'left' }));
    
    expect(ref1.markerStatus).toBe('resolved_side_unknown');
    expect(ref2.markerStatus).toBe('resolved');
    expect(ref1.usableForGeneration).toBe(true);
    expect(ref2.usableForGeneration).toBe(true);
  });
});
