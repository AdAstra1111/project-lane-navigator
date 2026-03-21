/**
 * mergeUserDecisions — Preserves user editorial overrides across rebuilds.
 *
 * Extracted from generateLookBookData to remove legacy dependency.
 *
 * INPUT: freshSlides, previousSlides
 * OUTPUT: merged slides with preserved user decisions
 * SIDE EFFECTS: none (pure function)
 */
import type { SlideContent, SlideUserDecisions } from '../types';

/**
 * Legacy ordinal-to-semantic migration map.
 * Maps old ordinal IDs (from prior builds) to their new semantic equivalents.
 */
const LEGACY_ORDINAL_TO_SEMANTIC: Record<string, string> = {
  'cover': 'cover:main',
  'overview': 'overview:main',
  'world': 'world:main',
  'characters': 'characters:main',
  'themes': 'themes:main',
  'visual_language': 'visual_language:main',
  'story_engine': 'story_engine:main',
  'key_moments': 'key_moments:main',
  'comparables': 'comparables:main',
  'creative_statement': 'creative_statement:main',
  'closing': 'closing:main',
};

/**
 * Merge forward valid user decisions from a previous build into freshly generated slides.
 * Matches by slide_id for stability. Drops decisions that reference invalid/unsupported layouts.
 */
export function mergeUserDecisions(
  freshSlides: SlideContent[],
  previousSlides: SlideContent[],
): { merged: SlideContent[]; preservedCount: number; droppedCount: number; dropReasons: string[]; migratedCount: number } {
  const prevBySlideId = new Map<string, SlideUserDecisions>();
  for (const s of previousSlides) {
    if (s.slide_id && s.user_decisions && Object.keys(s.user_decisions).length > 0) {
      prevBySlideId.set(s.slide_id, s.user_decisions);
    }
  }

  if (prevBySlideId.size === 0) {
    return { merged: freshSlides, preservedCount: 0, droppedCount: 0, dropReasons: [], migratedCount: 0 };
  }

  let preservedCount = 0;
  let droppedCount = 0;
  let migratedCount = 0;
  const dropReasons: string[] = [];

  const merged = freshSlides.map(slide => {
    let prevDecisions = prevBySlideId.get(slide.slide_id);
    let matchSource = 'exact';

    if (!prevDecisions) {
      for (const [legacyId, semanticId] of Object.entries(LEGACY_ORDINAL_TO_SEMANTIC)) {
        if (semanticId === slide.slide_id && prevBySlideId.has(legacyId)) {
          prevDecisions = prevBySlideId.get(legacyId);
          matchSource = 'legacy_migration';
          migratedCount++;
          console.log(`[LookBook merge] migrated legacy ID '${legacyId}' → '${slide.slide_id}'`);
          break;
        }
      }
    }

    if (!prevDecisions) return slide;

    if (slide._has_unresolved && prevDecisions.layout_family) {
      droppedCount++;
      dropReasons.push(`${slide.slide_id}: dropped layout_family (unresolved images, match=${matchSource})`);
      return slide;
    }

    const effectiveFamily = prevDecisions.layout_family || slide.layoutFamily || 'landscape_standard';
    preservedCount++;
    console.log(`[LookBook merge] preserved user_decisions for '${slide.slide_id}' (match=${matchSource})`);
    return {
      ...slide,
      user_decisions: { ...prevDecisions },
      layoutFamilyOverride: prevDecisions.layout_family || null,
      layoutFamilyOverrideSource: prevDecisions.layout_family ? 'user' as const : null,
      layoutFamilyEffective: effectiveFamily,
    };
  });

  console.log(`[LookBook merge] result: preserved=${preservedCount}, dropped=${droppedCount}, migrated=${migratedCount}`);
  return { merged, preservedCount, droppedCount, dropReasons, migratedCount };
}
