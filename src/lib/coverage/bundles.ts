/**
 * Bundle definitions by production type.
 * Determines which document roles compose each coverage bundle.
 */

import type { BundleDef, BundleKey, CoverageRole } from './types';
import { normalizeFormat, isSeriesFormat } from '@/lib/format-helpers';
import { isDocumentaryFormat } from '@/lib/types';

export function getBundleDefinitions(format: string): BundleDef[] {
  const f = normalizeFormat(format);
  const isSeries = isSeriesFormat(f);
  const isVerticalDrama = f === 'vertical-drama';
  const isDoc = isDocumentaryFormat(f);

  const bundles: BundleDef[] = [];

  // PACKAGE — universal
  bundles.push({
    key: 'PACKAGE',
    name: 'Whole Package',
    description: 'Creative + commercial evaluation of the full project package.',
    roles: [
      'topline', 'concept', 'market', 'deck', 'blueprint', 'character_bible',
      isVerticalDrama ? 'season_script' : isSeries ? 'episode_script' : 'feature_script',
      'episode_grid', 'season_arc', 'format_rules',
      isDoc ? 'documentary_outline' : null,
    ].filter(Boolean) as CoverageRole[],
    weights: {
      topline: 5,
      concept: 13,
      market: 10,
      deck: 9,
      blueprint: 13,
      character_bible: 10,
      [isVerticalDrama ? 'season_script' : isSeries ? 'episode_script' : 'feature_script']: 25,
      episode_grid: 5,
      season_arc: 5,
      format_rules: 5,
    },
    minDocs: 2,
  });

  // NARRATIVE
  if (isVerticalDrama) {
    bundles.push({
      key: 'NARRATIVE',
      name: 'Narrative Coverage',
      description: 'Season arc coherence, episode structure, and character consistency.',
      roles: ['topline', 'season_script', 'episode_grid', 'season_arc', 'blueprint', 'character_bible'],
      weights: { topline: 5, season_script: 33, episode_grid: 18, season_arc: 18, blueprint: 14, character_bible: 12 },
      minDocs: 1,
    });
  } else if (isSeries) {
    bundles.push({
      key: 'NARRATIVE',
      name: 'Narrative Coverage',
      description: 'Season arc coherence, episode structure, and character consistency.',
      roles: ['topline', 'episode_script', 'episode_grid', 'season_arc', 'blueprint', 'character_bible'],
      weights: { topline: 5, episode_script: 33, episode_grid: 18, season_arc: 18, blueprint: 14, character_bible: 12 },
      minDocs: 1,
    });
  } else {
    bundles.push({
      key: 'NARRATIVE',
      name: 'Narrative Coverage',
      description: 'Script structure, character arcs, and story coherence.',
      roles: ['topline', 'feature_script', 'blueprint', 'character_bible'],
      weights: { topline: 5, feature_script: 57, blueprint: 23, character_bible: 15 },
      minDocs: 1,
    });
  }

  // COMMERCIAL
  bundles.push({
    key: 'COMMERCIAL',
    name: 'Commercial Readiness',
    description: 'Market positioning, buyer alignment, and commercial viability.',
    roles: ['topline', 'market', 'deck', 'concept'],
    weights: { topline: 5, market: 43, deck: 33, concept: 19 },
    minDocs: 1,
  });

  // DOCU_REALITY — documentary projects only
  if (isDoc) {
    bundles.push({
      key: 'DOCU_REALITY',
      name: 'Documentary Integrity',
      description: 'Fact-based evaluation; no invented characters or events.',
      roles: ['documentary_outline', 'deck', 'market', 'concept'],
      weights: { documentary_outline: 50, deck: 20, market: 15, concept: 15 },
      minDocs: 1,
    });
  }

  return bundles;
}

/**
 * Select document versions for a bundle from available docs.
 * Returns version IDs mapped by role.
 */
export function selectBundleDocs(
  bundle: BundleDef,
  availableDocs: { versionId: string; role: CoverageRole }[],
): { versionId: string; role: CoverageRole }[] {
  const selected: { versionId: string; role: CoverageRole }[] = [];
  const usedVersions = new Set<string>();

  for (const role of bundle.roles) {
    const match = availableDocs.find(d => d.role === role && !usedVersions.has(d.versionId));
    if (match) {
      selected.push(match);
      usedVersions.add(match.versionId);
    }
  }

  return selected;
}
