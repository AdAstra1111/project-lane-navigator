/**
 * castingBriefResolver — Phase 17.4 Actor Identity Composer Tests.
 *
 * Tests prove that:
 * - actor criteria never contain plot/story leakage
 * - visual classification is authoritarian, not heuristic
 * - signals are classified into explicit identity buckets
 * - composed descriptions are structured, not tag soup
 * - contradictions are resolved deterministically
 * - tags are clean and reusable
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
  classifyIntoBucket,
  createEmptyBuckets,
  composeActorDescriptionFromBuckets,
  composeActorTagsFromBuckets,
  dedupeAndResolveConflicts,
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

  it('preserves appearance sentences mixed with plot', () => {
    const input = 'Angular jawline with high cheekbones. She hides a terrible secret. Pale complexion.';
    const result = sanitizePlotLanguage(input);
    expect(result).toContain('Angular jawline');
    expect(result).toContain('Pale complexion');
    expect(result).not.toContain('secret');
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

// ── F. Phase 17.4: Bucket classification ─────────────────────────────────

describe('classifyIntoBucket', () => {
  it('classifies hair signals into hair bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('dark hair', b);
    classifyIntoBucket('straight black hair', b);
    expect(b.hair.length).toBe(2);
    expect(b.hair[0]).toBe('dark hair');
  });

  it('classifies eye signals into eyes bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('dark eyes', b);
    classifyIntoBucket('almond-shaped eyes', b);
    expect(b.eyes.length).toBe(2);
  });

  it('classifies build signals into build bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('slender build', b);
    classifyIntoBucket('athletic frame', b);
    expect(b.build.length).toBe(2);
  });

  it('classifies face signals into face bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('angular features', b);
    classifyIntoBucket('high cheekbones', b);
    expect(b.face.length).toBe(2);
  });

  it('classifies skin signals into skin bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('pale skin', b);
    classifyIntoBucket('olive complexion', b);
    expect(b.skin.length).toBe(2);
  });

  it('classifies age signals into age bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('early twenties', b);
    expect(b.age.length).toBe(1);
  });

  it('classifies scar/tattoo into scars_marks bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('scar across left cheek', b);
    classifyIntoBucket('tattoo', b);
    expect(b.scars_marks.length).toBe(2);
  });

  it('classifies styling/costume signals into styling bucket', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('wearing a silk kimono', b);
    classifyIntoBucket('Victorian costume', b);
    expect(b.styling.length).toBe(2);
  });
});

// ── G. Phase 17.4: Structured description composition ────────────────────

describe('composeActorDescriptionFromBuckets', () => {
  it('produces ordered, structured output — not tag soup', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.build.push('slender');
    b.face.push('sharp features');
    b.hair.push('dark hair');
    b.presence.push('poised');
    b.styling.push('period-appropriate');

    const result = composeActorDescriptionFromBuckets(b);

    // Must be structured, not raw tags
    expect(result).toContain('woman');
    expect(result).toContain('early twenties');
    expect(result).toContain('slender');
    expect(result).toContain('sharp features');
    expect(result).toContain('dark hair');
    expect(result).toContain('poised');
    expect(result).toContain('period-appropriate');

    // Must be comma-separated phrases, not raw words
    expect(result.split(',').length).toBeGreaterThan(3);
  });

  it('includes ethnicity when explicit', () => {
    const b = createEmptyBuckets();
    b.ethnicity.push('Japanese');
    b.gender.push('woman');
    b.age.push('early twenties');

    const result = composeActorDescriptionFromBuckets(b);
    expect(result).toContain('Japanese');
  });

  it('handles empty buckets gracefully', () => {
    const b = createEmptyBuckets();
    const result = composeActorDescriptionFromBuckets(b);
    expect(result).toBe('');
  });

  it('appends "presence" suffix to presence markers', () => {
    const b = createEmptyBuckets();
    b.presence.push('commanding');
    b.presence.push('elegant');
    const result = composeActorDescriptionFromBuckets(b);
    expect(result).toContain('presence');
  });
});

// ── H. Phase 17.4: Deduplication and conflict resolution ─────────────────

describe('dedupeAndResolveConflicts', () => {
  it('removes duplicate entries', () => {
    const result = dedupeAndResolveConflicts(['tall', 'slender', 'tall', 'Tall']);
    expect(result.filter(r => r.toLowerCase() === 'tall').length).toBe(1);
  });

  it('resolves tall vs petite contradiction (keeps first)', () => {
    const result = dedupeAndResolveConflicts(['tall', 'petite']);
    expect(result).toContain('tall');
    expect(result).not.toContain('petite');
  });

  it('resolves slender vs stocky contradiction', () => {
    const result = dedupeAndResolveConflicts(['slender', 'stocky']);
    expect(result).toContain('slender');
    expect(result).not.toContain('stocky');
  });

  it('resolves dark hair vs blonde hair contradiction', () => {
    const result = dedupeAndResolveConflicts(['dark hair', 'blonde hair']);
    expect(result).toContain('dark hair');
    expect(result).not.toContain('blonde hair');
  });

  it('preserves non-contradictory items', () => {
    const result = dedupeAndResolveConflicts(['tall', 'slender', 'dark hair', 'blue eyes']);
    expect(result).toEqual(['tall', 'slender', 'dark hair', 'blue eyes']);
  });
});

// ── I. Phase 17.4: Tag composition ───────────────────────────────────────

describe('composeActorTagsFromBuckets', () => {
  it('produces clean underscore-separated tags', () => {
    const b = createEmptyBuckets();
    b.age.push('early twenties');
    b.hair.push('dark hair');
    b.presence.push('poised');

    const tags = composeActorTagsFromBuckets(b, 'female');
    expect(tags).toContain('female');
    expect(tags.some(t => t.includes('early'))).toBe(true);
    expect(tags.some(t => t.includes('dark'))).toBe(true);
    expect(tags.some(t => t.includes('poised'))).toBe(true);
  });

  it('rejects personality terms from tags', () => {
    const b = createEmptyBuckets();
    b.archetype.push('ambitious');
    b.archetype.push('manipulative');

    const tags = composeActorTagsFromBuckets(b, null);
    expect(tags).not.toContain('ambitious');
    expect(tags).not.toContain('manipulative');
  });

  it('deduplicates tags', () => {
    const b = createEmptyBuckets();
    b.hair.push('dark hair');
    b.face.push('dark features');
    const tags = composeActorTagsFromBuckets(b, null);
    const darkCount = tags.filter(t => t === 'dark').length;
    expect(darkCount).toBeLessThanOrEqual(1);
  });

  it('limits tag count', () => {
    const b = createEmptyBuckets();
    for (let i = 0; i < 30; i++) {
      b.archetype.push(`trait_${i}_value`);
    }
    const tags = composeActorTagsFromBuckets(b, null);
    expect(tags.length).toBeLessThanOrEqual(15);
  });
});
