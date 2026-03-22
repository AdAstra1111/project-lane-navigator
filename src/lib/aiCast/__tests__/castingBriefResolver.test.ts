/**
 * castingBriefResolver — Phase 17.2 Hardening Invariant Tests.
 *
 * These tests prove that actor criteria never contain plot/story leakage
 * and that visual classification is authoritarian, not heuristic.
 */
import { describe, it, expect } from 'vitest';
import { _testHelpers, sanitizePlotLanguage } from '../castingBriefResolver';

const {
  classifyPredicate,
  isPerformerSafePresence,
  VISUAL_PREDICATE_ALLOWLIST,
  STORY_PREDICATE_DENYLIST,
  PERFORMER_PRESENCE_ALLOWLIST,
  PERSONALITY_DENYLIST,
} = _testHelpers;

// ── A. Plot-heavy predicates must NEVER classify as 'visual' ─────────────

describe('classifyPredicate — story predicates denied', () => {
  const storyPredicates = [
    'role', 'goal', 'goals', 'motivation', 'relationship',
    'backstory', 'conflict', 'arc', 'secret', 'desire',
    'personality', 'trait', 'character_trait', 'description',
  ];

  it.each(storyPredicates)('predicate "%s" is classified as story', (pred) => {
    expect(classifyPredicate(pred)).toBe('story');
  });
});

describe('classifyPredicate — visual predicates allowed', () => {
  const visualPredicates = [
    'age', 'gender', 'appearance', 'hair', 'eyes', 'skin',
    'height', 'build', 'physique', 'clothing', 'wardrobe',
    'posture', 'face', 'body', 'silhouette', 'tattoo', 'scar',
  ];

  it.each(visualPredicates)('predicate "%s" is classified as visual', (pred) => {
    expect(classifyPredicate(pred)).toBe('visual');
  });
});

describe('classifyPredicate — unknown predicates are UNKNOWN', () => {
  const unknownPredicates = [
    'favorite_food', 'weapon_of_choice', 'magic_ability',
    'political_stance', 'dream', 'spirit_animal', 'custom_field',
  ];

  it.each(unknownPredicates)('predicate "%s" is classified as unknown', (pred) => {
    expect(classifyPredicate(pred)).toBe('unknown');
  });

  it('unknown predicates are NOT visual', () => {
    for (const pred of unknownPredicates) {
      expect(classifyPredicate(pred)).not.toBe('visual');
    }
  });
});

// ── B. Visual-only data passes through correctly ─────────────────────────

describe('VISUAL_PREDICATE_ALLOWLIST completeness', () => {
  it('contains core physical descriptors', () => {
    const required = ['hair', 'eyes', 'skin', 'height', 'build', 'face', 'body'];
    for (const r of required) {
      expect(VISUAL_PREDICATE_ALLOWLIST.has(r)).toBe(true);
    }
  });

  it('contains styling descriptors', () => {
    const required = ['clothing', 'wardrobe', 'costume'];
    for (const r of required) {
      expect(VISUAL_PREDICATE_ALLOWLIST.has(r)).toBe(true);
    }
  });

  it('contains distinguishing marks', () => {
    const required = ['tattoo', 'scar', 'piercing', 'birthmark'];
    for (const r of required) {
      expect(VISUAL_PREDICATE_ALLOWLIST.has(r)).toBe(true);
    }
  });
});

// ── C. Plot-language sanitizer catches story content ─────────────────────

describe('sanitizePlotLanguage', () => {
  it('removes sentences with plot language', () => {
    const input = 'Tall woman with dark hair. Driven by revenge against her father. Sharp angular features.';
    const result = sanitizePlotLanguage(input);
    expect(result).not.toContain('revenge');
    expect(result).toContain('Tall woman');
    expect(result).toContain('Sharp angular features');
  });

  it('removes betrayal language', () => {
    expect(sanitizePlotLanguage('She was betrayed by everyone')).toBe('');
  });

  it('removes guilt language', () => {
    expect(sanitizePlotLanguage('Consumed by guilt over past actions')).toBe('');
  });

  it('removes conflict language', () => {
    expect(sanitizePlotLanguage('Internal conflict between duty and love')).toBe('');
  });

  it('removes murder/death language', () => {
    expect(sanitizePlotLanguage('Witnessed a murder as a child')).toBe('');
  });

  it('preserves pure visual text', () => {
    const input = 'Tall, slender, dark-haired woman with high cheekbones';
    expect(sanitizePlotLanguage(input)).toBe(input);
  });

  it('handles empty input', () => {
    expect(sanitizePlotLanguage('')).toBe('');
  });
});

// ── D. Performer-safe presence markers ───────────────────────────────────

describe('isPerformerSafePresence', () => {
  it('allows casting-language terms', () => {
    const allowed = ['poised', 'elegant', 'intense', 'commanding', 'graceful', 'stoic', 'rugged'];
    for (const term of allowed) {
      expect(isPerformerSafePresence(term)).toBe(true);
    }
  });

  it('rejects personality/story traits', () => {
    const rejected = [
      'ambitious', 'manipulative', 'grieving', 'conflicted', 'loyal',
      'jealous', 'traumatized', 'secretive', 'revenge-driven',
      'cunning', 'ruthless', 'compassionate', 'idealistic', 'cynical',
    ];
    for (const term of rejected) {
      expect(isPerformerSafePresence(term)).toBe(false);
    }
  });

  it('rejects unknown terms (not on allowlist)', () => {
    expect(isPerformerSafePresence('mysterious')).toBe(false);
    expect(isPerformerSafePresence('contemplative')).toBe(false);
    expect(isPerformerSafePresence('power-hungry')).toBe(false);
  });
});

// ── E. Allowlist/Denylist mutual exclusion ────────────────────────────────

describe('allowlist/denylist integrity', () => {
  it('VISUAL and STORY predicate lists do not overlap', () => {
    for (const pred of VISUAL_PREDICATE_ALLOWLIST) {
      expect(STORY_PREDICATE_DENYLIST.has(pred)).toBe(false);
    }
  });

  it('PERFORMER_PRESENCE and PERSONALITY lists do not overlap', () => {
    for (const term of PERFORMER_PRESENCE_ALLOWLIST) {
      expect(PERSONALITY_DENYLIST.has(term)).toBe(false);
    }
  });
});
