/**
 * castingBriefResolver — Phase 17.5 Identity Completion Layer Tests.
 *
 * Tests prove that:
 * - actor criteria never contain plot/story leakage
 * - visual classification is authoritarian, not heuristic
 * - signals are classified into explicit identity buckets
 * - composed descriptions are structured, not tag soup
 * - contradictions are resolved deterministically
 * - tags are clean and reusable
 * - Phase 17.5: identity completion fills sparse cues
 * - Phase 17.5: floating adjectives are anchored
 * - Phase 17.5: presence markers are expanded
 * - Phase 17.5: minimum quality gate works
 * - Phase 17.5: role weighting enriches leads
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
  completeActorIdentityBuckets,
  countIdentityDimensions,
  meetsMinimumIdentityQuality,
  expandPresenceMarker,
  anchorFloatingAdjective,
  FLOATING_ADJECTIVES,
  expandIdentityBuckets,
  composeActorCriteriaHighlights,
  formatActorRosterNumber,
  generateSyntheticActorName,
  composeActorRosterName,
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
    classifyIntoBucket('chiseled jawline', b);
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

    expect(result).toContain('woman');
    expect(result).toContain('playing age 20–25');
    expect(result).toContain('slender');
    expect(result).toContain('sharp features');
    expect(result).toContain('dark hair');
    expect(result).toContain('poised');
    expect(result).toContain('period-appropriate');
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

  it('handles presence terms without redundant "presence" suffix', () => {
    const b = createEmptyBuckets();
    b.presence.push('controlled intensity');
    b.presence.push('quiet authority');
    const result = composeActorDescriptionFromBuckets(b);
    // Should NOT have double "presence" — the terms already imply it
    expect(result).toContain('controlled intensity');
    expect(result).toContain('quiet authority');
  });

  it('adds "presence" suffix only when needed', () => {
    const b = createEmptyBuckets();
    b.presence.push('commanding');
    const result = composeActorDescriptionFromBuckets(b);
    expect(result).toContain('commanding presence');
  });

  it('no floating adjectives survive in final output', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.face.push('sharp features');
    b.hair.push('dark hair');
    const result = composeActorDescriptionFromBuckets(b);
    // "sharp" alone must not appear — only "sharp features"
    expect(result).not.toMatch(/\bsharp\b(?!\s+features)/);
    expect(result).toContain('sharp features');
  });

  it('base anchor includes gender and age', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.hair.push('dark hair');
    const result = composeActorDescriptionFromBuckets(b);
    expect(result).toMatch(/^woman/i);
    expect(result).toContain('playing age 20–25');
  });

  it('enforces max 220 char length', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.build.push('slender athletic build');
    b.face.push('sharp angular features with prominent cheekbones');
    b.hair.push('long flowing dark hair');
    b.eyes.push('deep set piercing dark eyes');
    b.skin.push('olive complexion');
    b.presence.push('commanding authority');
    b.presence.push('controlled intensity');
    b.styling.push('elaborate period-appropriate Victorian styling');
    const result = composeActorDescriptionFromBuckets(b);
    expect(result.length).toBeLessThanOrEqual(220);
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

// ── J. Phase 17.5: Identity Completion ───────────────────────────────────

describe('expandPresenceMarker', () => {
  it('expands "fierce" to casting-grade phrasing', () => {
    expect(expandPresenceMarker('fierce')).toBe('controlled intensity');
  });

  it('expands "quiet" to casting-grade phrasing', () => {
    expect(expandPresenceMarker('quiet')).toBe('quiet authority');
  });

  it('passes through already-good markers unchanged', () => {
    expect(expandPresenceMarker('poised')).toBe('poised');
    expect(expandPresenceMarker('elegant')).toBe('elegant');
  });
});

describe('anchorFloatingAdjective', () => {
  it('anchors "dark" to hair when hair bucket is empty', () => {
    const b = createEmptyBuckets();
    const result = anchorFloatingAdjective('dark', b);
    expect(result).toBe('dark hair');
  });

  it('anchors "dark" to eyes when hair is filled', () => {
    const b = createEmptyBuckets();
    b.hair.push('dark hair');
    const result = anchorFloatingAdjective('dark', b);
    expect(result).toBe('dark eyes');
  });

  it('anchors "dark" to complexion when hair+eyes filled', () => {
    const b = createEmptyBuckets();
    b.hair.push('dark hair');
    b.eyes.push('dark eyes');
    const result = anchorFloatingAdjective('dark', b);
    expect(result).toBe('dark complexion');
  });

  it('returns null for non-floating adjectives', () => {
    const b = createEmptyBuckets();
    expect(anchorFloatingAdjective('elegant', b)).toBeNull();
  });
});

describe('completeActorIdentityBuckets', () => {
  it('anchors floating "dark" from archetype into hair bucket', () => {
    const b = createEmptyBuckets();
    b.archetype.push('dark');
    const completed = completeActorIdentityBuckets(b, null, []);
    expect(completed.hair.some(h => h.includes('dark'))).toBe(true);
    expect(completed.archetype).not.toContain('dark');
  });

  it('expands terse presence markers', () => {
    const b = createEmptyBuckets();
    b.presence.push('fierce');
    b.presence.push('quiet');
    const completed = completeActorIdentityBuckets(b, null, []);
    expect(completed.presence).toContain('controlled intensity');
    expect(completed.presence).toContain('quiet authority');
    expect(completed.presence).not.toContain('fierce');
    expect(completed.presence).not.toContain('quiet');
  });

  it('adds world styling when styling bucket is empty', () => {
    const b = createEmptyBuckets();
    const completed = completeActorIdentityBuckets(b, null, ['Victorian']);
    expect(completed.styling.some(s => s.includes('victorian'))).toBe(true);
  });

  it('does not add styling when no world cues exist', () => {
    const b = createEmptyBuckets();
    const completed = completeActorIdentityBuckets(b, null, []);
    expect(completed.styling.length).toBe(0);
  });

  it('promotes performer-safe archetype to presence for leads', () => {
    const b = createEmptyBuckets();
    b.archetype.push('elegant');
    const completed = completeActorIdentityBuckets(b, 'protagonist', []);
    expect(completed.presence.length).toBeGreaterThan(0);
  });

  it('does not invent data — empty input stays mostly empty', () => {
    const b = createEmptyBuckets();
    const completed = completeActorIdentityBuckets(b, null, []);
    expect(completed.age.length).toBe(0);
    expect(completed.gender.length).toBe(0);
    expect(completed.ethnicity.length).toBe(0);
    expect(completed.hair.length).toBe(0);
  });
});

describe('countIdentityDimensions', () => {
  it('counts 0 for empty buckets', () => {
    expect(countIdentityDimensions(createEmptyBuckets())).toBe(0);
  });

  it('counts gender as base anchor', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    expect(countIdentityDimensions(b)).toBe(1);
  });

  it('counts multiple dimensions correctly', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.hair.push('dark hair');
    b.presence.push('poised');
    b.styling.push('period');
    expect(countIdentityDimensions(b)).toBe(5);
  });

  it('groups build and height as one dimension', () => {
    const b = createEmptyBuckets();
    b.build.push('slender');
    b.height.push('tall');
    expect(countIdentityDimensions(b)).toBe(1);
  });
});

describe('meetsMinimumIdentityQuality', () => {
  it('returns false for empty buckets', () => {
    expect(meetsMinimumIdentityQuality(createEmptyBuckets())).toBe(false);
  });

  it('returns false for 2 dimensions', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    expect(meetsMinimumIdentityQuality(b)).toBe(false);
  });

  it('returns true for 3+ dimensions', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.hair.push('dark hair');
    expect(meetsMinimumIdentityQuality(b)).toBe(true);
  });
});

// ── K. Phase 17.5: End-to-end sparse completion ─────────────────────────

describe('Phase 17.5 — sparse input produces casting-grade output', () => {
  it('transforms "tall, sharp, fierce, quiet" into anchored identity', () => {
    const b = createEmptyBuckets();
    classifyIntoBucket('tall', b);
    classifyIntoBucket('sharp', b);
    classifyIntoBucket('fierce', b);
    classifyIntoBucket('quiet', b);

    const completed = completeActorIdentityBuckets(b, null, []);
    const desc = composeActorDescriptionFromBuckets(completed);

    // Must not be raw tag soup
    expect(desc).not.toBe('tall, sharp, fierce, quiet');
    // "sharp" must be anchored to features
    expect(desc).toContain('sharp features');
    // "sharp" standalone must not survive
    expect(desc).not.toMatch(/,\s*sharp\s*,/);
    // fierce/quiet should be expanded
    expect(desc).not.toMatch(/\bfierce\b/);
    // Should contain anchored or expanded forms
    expect(desc.length).toBeGreaterThan(15);
  });

  it('Hana-like protagonist gets structured casting identity', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    classifyIntoBucket('tall', b);
    classifyIntoBucket('sharp', b);
    classifyIntoBucket('dark', b);

    const completed = completeActorIdentityBuckets(b, 'protagonist', ['period-drama']);
    const desc = composeActorDescriptionFromBuckets(completed);

    // Must start with base anchor
    expect(desc).toMatch(/^woman/i);
    expect(desc).toContain('playing age 20–25');
    // Physical traits must be anchored
    expect(desc).toContain('sharp features');
    expect(desc).toContain('dark hair');
    // No floating adjectives
    expect(desc).not.toMatch(/,\s*sharp\s*,/);
    expect(desc).not.toMatch(/,\s*dark\s*,/);
    // Must read like a casting identity sentence
    expect(desc.split(',').length).toBeGreaterThanOrEqual(3);
  });

  it('lead character gets richer output than non-lead', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.archetype.push('elegant');
    b.archetype.push('refined');

    const leadCompleted = completeActorIdentityBuckets(b, 'protagonist', []);
    const nonLeadCompleted = completeActorIdentityBuckets(b, 'minor guard', []);

    // Lead should have presence promoted from archetype
    expect(leadCompleted.presence.length).toBeGreaterThanOrEqual(nonLeadCompleted.presence.length);
  });

  it('no plot contamination regression', () => {
    const plotTerms = ['revenge', 'betrayal', 'secret', 'duty', 'guilt', 'conflict'];
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.hair.push('dark hair');
    b.presence.push('poised');

    const completed = completeActorIdentityBuckets(b, 'protagonist torn between duty and love', []);
    const desc = composeActorDescriptionFromBuckets(completed);

    for (const term of plotTerms) {
      expect(desc.toLowerCase()).not.toContain(term);
    }
  });

  it('no ethnicity hallucination from name alone', () => {
    // Empty ethnicity should stay empty — no invention
    const b = createEmptyBuckets();
    b.gender.push('woman');
    const completed = completeActorIdentityBuckets(b, null, []);
    expect(completed.ethnicity.length).toBe(0);
  });
});

// ── L. Phase 17.6: Phrase-level tags ─────────────────────────────────────

describe('Phase 17.6 — phrase-level tags', () => {
  it('preserves "dark hair" as dark_hair, not split into dark + hair', () => {
    const b = createEmptyBuckets();
    b.hair.push('dark hair');
    b.face.push('sharp features');
    const tags = composeActorTagsFromBuckets(b, null);
    expect(tags).toContain('dark_hair');
    expect(tags).toContain('sharp_features');
    expect(tags).not.toContain('dark');
    expect(tags).not.toContain('hair');
    expect(tags).not.toContain('sharp');
    expect(tags).not.toContain('features');
  });

  it('preserves "controlled intensity" as single tag', () => {
    const b = createEmptyBuckets();
    b.presence.push('controlled intensity');
    const tags = composeActorTagsFromBuckets(b, null);
    expect(tags).toContain('controlled_intensity');
    expect(tags).not.toContain('controlled');
    expect(tags).not.toContain('intensity');
  });

  it('preserves "period-appropriate styling" as single tag', () => {
    const b = createEmptyBuckets();
    b.styling.push('period-appropriate styling');
    const tags = composeActorTagsFromBuckets(b, null);
    expect(tags.some(t => t.includes('period'))).toBe(true);
    // Should be one tag, not three
    const periodTags = tags.filter(t => t.includes('period'));
    expect(periodTags.length).toBe(1);
  });

  it('includes gender hint as tag', () => {
    const b = createEmptyBuckets();
    b.age.push('early twenties');
    const tags = composeActorTagsFromBuckets(b, 'female');
    expect(tags).toContain('female');
    expect(tags).toContain('early_twenties');
  });
});

// ── M. Phase 17.6: Curated chip highlights ───────────────────────────────

describe('Phase 17.6 — composeActorCriteriaHighlights', () => {
  it('returns phrase-level highlights, not raw fragments', () => {
    const b = createEmptyBuckets();
    b.face.push('sharp features');
    b.hair.push('dark hair');
    b.height.push('tall');
    b.presence.push('controlled intensity');
    b.styling.push('period-appropriate styling');

    const highlights = composeActorCriteriaHighlights(b);
    expect(highlights).toContain('sharp features');
    expect(highlights).toContain('dark hair');
    expect(highlights).toContain('tall');
    expect(highlights).toContain('controlled intensity');
    expect(highlights.length).toBeLessThanOrEqual(6);
  });

  it('returns empty for empty buckets', () => {
    const b = createEmptyBuckets();
    expect(composeActorCriteriaHighlights(b).length).toBe(0);
  });

  it('dedupes highlights', () => {
    const b = createEmptyBuckets();
    b.face.push('sharp features');
    b.face.push('sharp features');
    const highlights = composeActorCriteriaHighlights(b);
    expect(highlights.filter(h => h === 'sharp features').length).toBe(1);
  });
});

// ── N. Phase 17.6: Identity expansion ────────────────────────────────────

describe('Phase 17.6 — expandIdentityBuckets', () => {
  it('adds build when height exists but build is empty', () => {
    const b = createEmptyBuckets();
    b.height.push('tall');
    const expanded = expandIdentityBuckets(b, null, []);
    expect(expanded.build.length).toBeGreaterThan(0);
    expect(expanded.build[0]).toContain('slender');
  });

  it('adds period styling when world cues available and styling empty', () => {
    const b = createEmptyBuckets();
    const expanded = expandIdentityBuckets(b, null, ['Victorian']);
    expect(expanded.styling.length).toBeGreaterThan(0);
  });

  it('promotes archetype to presence for leads when presence empty', () => {
    const b = createEmptyBuckets();
    b.archetype.push('elegant');
    const expanded = expandIdentityBuckets(b, 'protagonist', []);
    expect(expanded.presence.length).toBeGreaterThan(0);
  });

  it('does not invent data for empty input', () => {
    const b = createEmptyBuckets();
    const expanded = expandIdentityBuckets(b, null, []);
    expect(expanded.hair.length).toBe(0);
    expect(expanded.age.length).toBe(0);
    expect(expanded.ethnicity.length).toBe(0);
  });

  it('description/tags/chips serve different roles', () => {
    const b = createEmptyBuckets();
    b.gender.push('woman');
    b.age.push('early twenties');
    b.face.push('sharp features');
    b.hair.push('dark hair');
    b.presence.push('controlled intensity');
    b.styling.push('period-appropriate styling');

    const desc = composeActorDescriptionFromBuckets(b);
    const tags = composeActorTagsFromBuckets(b, 'female');
    const chips = composeActorCriteriaHighlights(b);

    // Description is a sentence
    expect(desc).toContain('woman');
    expect(desc.split(',').length).toBeGreaterThan(2);

    // Tags are underscore-separated tokens
    expect(tags.every(t => !t.includes(' '))).toBe(true);

    // Chips are phrase-level highlights
    expect(chips.some(c => c.includes(' '))).toBe(true);
  });
});
