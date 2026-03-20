/**
 * Descriptor Mining — Tests for second-pass literal text signal extraction.
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
    evidenceExcerpt: '',
    ...overrides,
  };
}

describe('descriptor mining', () => {
  it('"young woman with long dark hair" resolves age, gender, hair', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'young woman with long dark hair', evidenceExcerpt: 'a young woman with long dark hair' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const all = dna.missingClarifications;

    // gender: high confidence descriptor → resolved (filtered out)
    const gender = all.find(c => c.category === 'gender');
    expect(gender).toBeUndefined(); // resolved = filtered

    // hair: high confidence descriptor → resolved (filtered out)
    const hair = all.find(c => c.category === 'hair');
    expect(hair).toBeUndefined(); // resolved = filtered

    // age: medium confidence descriptor → partial (still in list)
    const age = all.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.status).toBe('partial');
    expect(age!.answerCandidate?.basis).toBe('descriptor_match');
    expect(age!.answerCandidate?.text).toMatch(/young/i);
  });

  it('"elderly man" resolves age and gender', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'elderly man', evidenceExcerpt: 'an elderly man' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const all = dna.missingClarifications;

    const gender = all.find(c => c.category === 'gender');
    expect(gender).toBeUndefined(); // resolved

    const age = all.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.status).toBe('partial');
    expect(age!.answerCandidate?.text).toMatch(/elderly/i);
  });

  it('"short cropped hair" resolves hair', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'short cropped hair style' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const hair = dna.missingClarifications.find(c => c.category === 'hair');
    expect(hair).toBeUndefined(); // resolved = filtered out
  });

  it('"potter by trade" does NOT infer age/gender/hair', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'potter by trade' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const all = dna.missingClarifications;

    const age = all.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.status).toBe('missing');

    const gender = all.find(c => c.category === 'gender');
    expect(gender).toBeTruthy();
    expect(gender!.status).toBe('missing');

    const hair = all.find(c => c.category === 'hair');
    expect(hair).toBeTruthy();
    expect(hair!.status).toBe('missing');
  });

  it('descriptor wins over inferred context for same category', () => {
    // "blacksmith" infers build via inference rules
    // "young" is a descriptor match for age
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'young blacksmith', evidenceExcerpt: 'a young blacksmith' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const all = dna.missingClarifications;

    // build should be partial from inferred_context (blacksmith)
    const build = all.find(c => c.category === 'build');
    expect(build).toBeTruthy();
    expect(build!.answerCandidate?.basis).toBe('inferred_context');

    // age should be partial from descriptor_match (young)
    const age = all.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.answerCandidate?.basis).toBe('descriptor_match');
  });

  it('direct evidence takes priority over descriptor', () => {
    const evidence: EvidenceTrait[] = [
      makeEvidence({ label: 'bright red curly hair', category: 'hair', confidence: 'high' }),
      makeEvidence({ label: 'dark hair mentioned in passing', evidenceExcerpt: 'dark hair' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    // Direct evidence (high confidence) resolves hair → filtered out
    const hair = dna.missingClarifications.find(c => c.category === 'hair');
    expect(hair).toBeUndefined();
  });
});
