/**
 * Martial/aristocratic role inference — Tests for build/posture from role cues.
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

describe('martial/aristocratic role inference', () => {
  it('"samurai lord" produces partial build inference', () => {
    const evidence = [makeEvidence({ label: 'samurai lord' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build).toBeTruthy();
    expect(build!.status).toBe('partial');
    expect(build!.answerCandidate?.basis).toBe('inferred_context');
    expect(build!.answerCandidate?.confidence).toBe('low');
  });

  it('"impeccable posture" contributes to build', () => {
    const evidence = [makeEvidence({ label: 'impeccable posture' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build).toBeTruthy();
    expect(build!.status).toBe('partial');
    expect(build!.answerCandidate?.text).toContain('combat training');
  });

  it('"hand resting on katana hilt" infers martial build', () => {
    const evidence = [makeEvidence({ label: 'hand resting on katana hilt' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build).toBeTruthy();
    expect(build!.status).toBe('partial');
    expect(build!.answerCandidate?.basis).toBe('inferred_context');
  });

  it('martial cues do NOT fill age', () => {
    const evidence = [makeEvidence({ label: 'samurai ronin swordsman' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const age = dna.missingClarifications.find(c => c.category === 'age');
    expect(age).toBeTruthy();
    expect(age!.status).toBe('missing');
  });

  it('martial cues do NOT fill hair', () => {
    const evidence = [makeEvidence({ label: 'samurai ronin swordsman' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const hair = dna.missingClarifications.find(c => c.category === 'hair');
    expect(hair).toBeTruthy();
    expect(hair!.status).toBe('missing');
  });

  it('martial cues do NOT fill skin', () => {
    const evidence = [makeEvidence({ label: 'samurai ronin swordsman' })];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    const skin = dna.missingClarifications.find(c => c.category === 'skin');
    expect(skin).toBeTruthy();
    expect(skin!.status).toBe('missing');
  });

  it('direct evidence outranks martial inferred context', () => {
    const evidence = [
      makeEvidence({ label: 'lean wiry build', category: 'build', confidence: 'high' }),
      makeEvidence({ label: 'samurai warrior' }),
    ];
    const dna = resolveCharacterVisualDNA('Test', null, null, '', false, [], evidence);
    // Direct high-confidence evidence resolves build → filtered out
    const build = dna.missingClarifications.find(c => c.category === 'build');
    expect(build).toBeUndefined();
  });
});
