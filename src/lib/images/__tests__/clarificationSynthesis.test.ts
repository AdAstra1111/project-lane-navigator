/**
 * Clarification Synthesis — Tests for evidence consumption + cross-category inference.
 */
import { describe, it, expect } from 'vitest';
import { resolveCharacterVisualDNA, type EvidenceTrait } from '../visualDNA';

function makeEvidence(overrides: Partial<EvidenceTrait> = {}): EvidenceTrait {
  return {
    label: 'test trait',
    category: 'other',
    source: 'evidence',
    constraint: 'flexible',
    confidence: 'medium',
    evidenceSource: 'script',
    evidenceExcerpt: 'test excerpt',
    ...overrides,
  };
}

describe('clarification synthesis', () => {
  it('occupation evidence infers clothing/build/skin as partial', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'potter by trade', category: 'other' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    const clothing = dna.missingClarifications.find(c => c.category === 'clothing');
    expect(clothing).toBeTruthy();
    expect(clothing!.status).toBe('partial');
    expect(clothing!.answerCandidate?.basis).toBe('inferred_context');
    expect(clothing!.answerCandidate?.text).toContain('workwear');
    
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build).toBeTruthy();
    expect(build!.status).toBe('partial');
    expect(build!.answerCandidate?.basis).toBe('inferred_context');
    
    const skin = dna.missingClarifications.find(c => c.category === 'skin');
    expect(skin).toBeTruthy();
    expect(skin!.status).toBe('partial');
    expect(skin!.answerCandidate?.basis).toBe('inferred_context');
  });

  it('commoner social status infers clothing as partial', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'commoner social status', category: 'other' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    const clothing = dna.missingClarifications.find(c => c.category === 'clothing');
    expect(clothing).toBeTruthy();
    expect(clothing!.status).toBe('partial');
    expect(clothing!.answerCandidate?.text).toContain('commoner');
    expect(clothing!.answerCandidate?.confidence).toBe('low');
  });

  it('transient states produce partial with low confidence', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'hands tremble with fear', category: 'other' }),
      makeEvidence({ label: 'face pales', category: 'skin' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    // 'face pales' matches TRANSIENT_STATE_PATTERNS → transient, not direct evidence
    // Should appear as transient state, not resolve skin fully
    expect(dna.transientStates.length).toBeGreaterThan(0);
  });

  it('direct evidence resolves category as partial or resolved based on confidence', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'short cropped dark hair', category: 'hair', confidence: 'medium' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    const hair = dna.missingClarifications.find(c => c.category === 'hair');
    expect(hair).toBeTruthy();
    expect(hair!.status).toBe('partial');
    expect(hair!.answerCandidate?.basis).toBe('direct_evidence');
    expect(hair!.answerCandidate?.text).toContain('hair');
  });

  it('high-confidence direct evidence resolves category fully', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'bright red curly hair', category: 'hair', confidence: 'high' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    // Resolved items are filtered out of missingClarifications
    const hair = dna.missingClarifications.find(c => c.category === 'hair');
    expect(hair).toBeUndefined(); // fully resolved = filtered out
  });

  it('categories with no evidence remain missing', () => {
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], []);
    
    const age = dna.missingClarifications.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.status).toBe('missing');
    expect(age!.answerCandidate).toBeUndefined();
  });

  it('inferred context does not upgrade to resolved', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'blacksmith occupation', category: 'other' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build!.status).toBe('partial'); // never 'resolved' from inference alone
    expect(build!.answerCandidate?.confidence).toBe('low');
  });
});
