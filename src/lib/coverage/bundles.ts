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
  const isDoc = isDocumentaryFormat(f);

  const bundles: BundleDef[] = [];

  // PACKAGE — universal
  bundles.push({
    key: 'PACKAGE',
    name: 'Whole Package',
    description: 'Creative + commercial evaluation of the full project package.',
    roles: [
      'concept', 'market', 'deck', 'blueprint', 'character_bible',
      isSeries ? 'episode_script' : 'feature_script',
      'episode_grid', 'season_arc', 'format_rules',
      isDoc ? 'documentary_outline' : null,
    ].filter(Boolean) as CoverageRole[],
    weights: {
      concept: 15,
      market: 10,
      deck: 10,
      blueprint: 15,
      character_bible: 10,
      [isSeries ? 'episode_script' : 'feature_script']: 25,
      episode_grid: 5,
      season_arc: 5,
      format_rules: 5,
    },
    minDocs: 2,
  });

  // NARRATIVE
  if (isSeries) {
    bundles.push({
      key: 'NARRATIVE',
      name: 'Narrative Coverage',
      description: 'Season arc coherence, episode structure, and character consistency.',
      roles: ['episode_script', 'episode_grid', 'season_arc', 'blueprint', 'character_bible'],
      weights: { episode_script: 35, episode_grid: 20, season_arc: 20, blueprint: 15, character_bible: 10 },
      minDocs: 1,
    });
  } else {
    bundles.push({
      key: 'NARRATIVE',
      name: 'Narrative Coverage',
      description: 'Script structure, character arcs, and story coherence.',
      roles: ['feature_script', 'blueprint', 'character_bible'],
      weights: { feature_script: 60, blueprint: 25, character_bible: 15 },
      minDocs: 1,
    });
  }

  // COMMERCIAL
  bundles.push({
    key: 'COMMERCIAL',
    name: 'Commercial Readiness',
    description: 'Market positioning, buyer alignment, and commercial viability.',
    roles: ['market', 'deck', 'concept'],
    weights: { market: 45, deck: 35, concept: 20 },
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
