import { describe, it, expect } from 'vitest';
import {
  buildCastingSpecificityProfile,
  buildCastingSearchPlan,
  getSpecificityDimensionEntries,
  getSearchBehaviorLabel,
} from '../castingSpecificity';
import type { CastingBrief } from '../castingBriefResolver';

function makeBrief(overrides: Partial<CastingBrief> = {}): CastingBrief {
  return {
    age_hint: null,
    gender_presentation: null,
    ethnicity_or_cultural_appearance: null,
    appearance_markers: [],
    visual_archetype: null,
    styling_cues: [],
    performance_vibe: [],
    negative_exclusions: [],
    suggested_actor_name: '',
    actor_description: '',
    actor_tags: [],
    actor_criteria_highlights: [],
    extraction_sufficiency: {
      has_gender: false,
      has_ethnicity: false,
      has_age: false,
      has_physical_description_signals: false,
      has_styling_signals: false,
      has_presence_signals: false,
    },
    prefill_quality: 'source_thin',
    ...overrides,
  };
}

describe('castingSpecificity', () => {
  describe('buildCastingSpecificityProfile', () => {
    it('returns all missing for empty brief', () => {
      const profile = buildCastingSpecificityProfile(makeBrief());
      expect(profile.gender.status).toBe('missing');
      expect(profile.ethnicity.status).toBe('missing');
      expect(profile.age.status).toBe('missing');
      expect(profile.physical.status).toBe('missing');
      expect(profile.styling.status).toBe('missing');
      expect(profile.presence.status).toBe('missing');
      expect(profile.specificityScore).toBe(0);
      expect(profile.specificityBand).toBe('low');
      expect(profile.recommendedMode).toBe('exploration');
    });

    it('returns known for dimensions with extraction sufficiency', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        ethnicity_or_cultural_appearance: 'Japanese',
        extraction_sufficiency: {
          has_gender: true,
          has_ethnicity: true,
          has_age: false,
          has_physical_description_signals: false,
          has_styling_signals: false,
          has_presence_signals: false,
        },
      });
      const profile = buildCastingSpecificityProfile(brief);
      expect(profile.gender.status).toBe('known');
      expect(profile.ethnicity.status).toBe('known');
      expect(profile.age.status).toBe('missing');
      expect(profile.specificityScore).toBe(30); // 15 + 15
      expect(profile.specificityBand).toBe('medium');
    });

    it('returns inferred when value exists but extraction did not flag it', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        extraction_sufficiency: {
          has_gender: false,
          has_ethnicity: false,
          has_age: false,
          has_physical_description_signals: false,
          has_styling_signals: false,
          has_presence_signals: false,
        },
      });
      const profile = buildCastingSpecificityProfile(brief);
      expect(profile.gender.status).toBe('inferred');
    });

    it('classifies Hana-like thin case as low specificity', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        ethnicity_or_cultural_appearance: 'Japanese',
        performance_vibe: ['quiet authority'],
        extraction_sufficiency: {
          has_gender: false,
          has_ethnicity: false,
          has_age: false,
          has_physical_description_signals: false,
          has_styling_signals: false,
          has_presence_signals: false,
        },
      });
      const profile = buildCastingSpecificityProfile(brief);
      expect(profile.gender.status).toBe('inferred');
      expect(profile.ethnicity.status).toBe('inferred');
      expect(profile.presence.status).toBe('inferred');
      expect(profile.age.status).toBe('missing');
      expect(profile.physical.status).toBe('missing');
      expect(profile.specificityBand).toBe('low');
      expect(profile.recommendedMode).toBe('exploration');
    });

    it('classifies rich brief as high specificity', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        ethnicity_or_cultural_appearance: 'Japanese',
        age_hint: 'early twenties',
        appearance_markers: ['sharp features', 'dark hair'],
        styling_cues: ['period-appropriate styling'],
        performance_vibe: ['quiet authority'],
        extraction_sufficiency: {
          has_gender: true,
          has_ethnicity: true,
          has_age: true,
          has_physical_description_signals: true,
          has_styling_signals: true,
          has_presence_signals: true,
        },
        prefill_quality: 'source_rich',
      });
      const profile = buildCastingSpecificityProfile(brief);
      expect(profile.specificityBand).toBe('high');
      expect(profile.recommendedMode).toBe('precision');
    });
  });

  describe('buildCastingSearchPlan', () => {
    it('produces wide diversity for low specificity', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        ethnicity_or_cultural_appearance: 'Japanese',
        performance_vibe: ['quiet authority'],
        extraction_sufficiency: {
          has_gender: false, has_ethnicity: false, has_age: false,
          has_physical_description_signals: false, has_styling_signals: false, has_presence_signals: false,
        },
      });
      const profile = buildCastingSpecificityProfile(brief);
      const plan = buildCastingSearchPlan(brief, profile);
      expect(plan.mode).toBe('exploration');
      expect(plan.diversityStrategy).toBe('wide');
      expect(plan.groundedFilters.length).toBe(0);
      expect(plan.softSignals.length).toBeGreaterThan(0);
      expect(plan.rationale).toContain('broad');
    });

    it('produces grounded filters for known dimensions', () => {
      const brief = makeBrief({
        gender_presentation: 'woman',
        ethnicity_or_cultural_appearance: 'Japanese',
        age_hint: 'early twenties',
        extraction_sufficiency: {
          has_gender: true, has_ethnicity: true, has_age: true,
          has_physical_description_signals: false, has_styling_signals: false, has_presence_signals: false,
        },
      });
      const profile = buildCastingSpecificityProfile(brief);
      const plan = buildCastingSearchPlan(brief, profile);
      expect(plan.groundedFilters.length).toBe(3);
      expect(plan.groundedFilters.map(f => f.dimension)).toContain('gender');
    });

    it('preserves directed constraints separately', () => {
      const brief = makeBrief();
      const profile = buildCastingSpecificityProfile(brief);
      const directed = [{ dimension: 'age', value: '20-25', source: 'directed' as const }];
      const plan = buildCastingSearchPlan(brief, profile, directed);
      expect(plan.directedConstraints).toEqual(directed);
      expect(plan.groundedFilters).not.toContainEqual(directed[0]);
    });
  });

  describe('display helpers', () => {
    it('getSpecificityDimensionEntries returns all 6', () => {
      const profile = buildCastingSpecificityProfile(makeBrief());
      const entries = getSpecificityDimensionEntries(profile);
      expect(entries).toHaveLength(6);
      expect(entries.map(e => e.key)).toEqual(['gender', 'ethnicity', 'age', 'physical', 'styling', 'presence']);
    });

    it('getSearchBehaviorLabel maps correctly', () => {
      expect(getSearchBehaviorLabel('low')).toBe('Broad');
      expect(getSearchBehaviorLabel('medium')).toBe('Balanced');
      expect(getSearchBehaviorLabel('high')).toBe('Narrow');
    });
  });
});
