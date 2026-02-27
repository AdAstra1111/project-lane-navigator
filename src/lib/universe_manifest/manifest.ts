/**
 * Universe Manifest v1 — deterministic parser + index builder.
 * Stored as a normal project_document with doc_type = 'universe_manifest'.
 * No LLM. No schema changes. JSON only.
 */

export interface UniverseManifestV1 {
  schema_version: 1;
  universe_assets?: string[];
  seasons?: ManifestSeasonV1[];
}

export interface ManifestSeasonV1 {
  season: number;
  season_assets?: string[];
  episodes: ManifestEpisodeV1[];
}

export interface ManifestEpisodeV1 {
  episode: number;
  doc_ids: string[];
  title?: string;
}

export interface ManifestParseResult {
  ok: boolean;
  manifest?: UniverseManifestV1;
  errors: string[];
}

export interface ManifestIndices {
  universe: Set<string>;
  bySeason: Map<number, Set<string>>;
  byEpisode: Map<string, Set<string>>; // key = "S01E02"
  episodeIndexByDocId: Map<string, { season: number; episode: number; key: string }>;
}

function epKey(s: number, e: number): string {
  return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
}

function uniqStrings(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((x: any) => typeof x === 'string') as string[])];
}

export function parseUniverseManifest(plaintext: string): ManifestParseResult {
  const errors: string[] = [];

  let raw: any;
  try {
    raw = JSON.parse(plaintext);
  } catch (e: any) {
    return { ok: false, errors: [`Invalid JSON: ${e?.message || 'parse error'}`] };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['Manifest must be a JSON object'] };
  }

  if (raw.schema_version !== 1) {
    return {
      ok: false,
      errors: [`Expected schema_version 1, got ${JSON.stringify(raw.schema_version)}`],
    };
  }

  const manifest: UniverseManifestV1 = { schema_version: 1 };

  // universe_assets
  if (raw.universe_assets !== undefined) {
    if (!Array.isArray(raw.universe_assets)) {
      errors.push('universe_assets must be an array');
    } else {
      manifest.universe_assets = uniqStrings(raw.universe_assets);
    }
  }

  // seasons
  if (raw.seasons !== undefined) {
    if (!Array.isArray(raw.seasons)) {
      errors.push('seasons must be an array');
    } else {
      const seasons: ManifestSeasonV1[] = [];
      for (let si = 0; si < raw.seasons.length; si++) {
        const s = raw.seasons[si];
        if (typeof s !== 'object' || s === null || Array.isArray(s)) {
          errors.push(`seasons[${si}] must be an object`);
          continue;
        }
        if (typeof s.season !== 'number' || !Number.isFinite(s.season)) {
          errors.push(`seasons[${si}].season must be a number`);
          continue;
        }
        const season: ManifestSeasonV1 = {
          season: s.season,
          season_assets: [],
          episodes: [],
        };
        if (s.season_assets !== undefined) {
          if (!Array.isArray(s.season_assets)) {
            errors.push(`seasons[${si}].season_assets must be an array`);
          } else {
            season.season_assets = uniqStrings(s.season_assets);
          }
        }
        if (s.episodes !== undefined) {
          if (!Array.isArray(s.episodes)) {
            errors.push(`seasons[${si}].episodes must be an array`);
          } else {
            for (let ei = 0; ei < s.episodes.length; ei++) {
              const ep = s.episodes[ei];
              if (typeof ep !== 'object' || ep === null || Array.isArray(ep)) {
                errors.push(`seasons[${si}].episodes[${ei}] must be an object`);
                continue;
              }
              if (typeof ep.episode !== 'number' || !Number.isFinite(ep.episode)) {
                errors.push(`seasons[${si}].episodes[${ei}].episode must be a number`);
                continue;
              }
              const episode: ManifestEpisodeV1 = {
                episode: ep.episode,
                title: typeof ep.title === 'string' ? ep.title : undefined,
                doc_ids: Array.isArray(ep.doc_ids) ? uniqStrings(ep.doc_ids) : [],
              };
              if (ep.doc_ids !== undefined && !Array.isArray(ep.doc_ids)) {
                errors.push(`seasons[${si}].episodes[${ei}].doc_ids must be an array`);
              }
              season.episodes.push(episode);
            }
          }
        }
        seasons.push(season);
      }
      manifest.seasons = seasons;
    }
  }

  return { ok: errors.length === 0, manifest, errors };
}

export function manifestDocIds(m: UniverseManifestV1): ManifestIndices {
  const universe = new Set<string>();
  const bySeason = new Map<number, Set<string>>();
  const byEpisode = new Map<string, Set<string>>();
  const episodeIndexByDocId = new Map<string, { season: number; episode: number; key: string }>();

  for (const id of m.universe_assets || []) {
    universe.add(id);
  }

  for (const s of m.seasons || []) {
    const seasonSet = bySeason.get(s.season) || new Set<string>();
    bySeason.set(s.season, seasonSet);

    for (const id of s.season_assets || []) {
      universe.add(id);
      seasonSet.add(id);
    }

    for (const ep of s.episodes || []) {
      const key = epKey(s.season, ep.episode);
      const epSet = byEpisode.get(key) || new Set<string>();
      byEpisode.set(key, epSet);

      for (const id of ep.doc_ids || []) {
        universe.add(id);
        seasonSet.add(id);
        epSet.add(id);
        episodeIndexByDocId.set(id, { season: s.season, episode: ep.episode, key });
      }
    }
  }

  return { universe, bySeason, byEpisode, episodeIndexByDocId };
}

/** Seed template for new manifest */
export const MANIFEST_TEMPLATE = JSON.stringify(
  {
    schema_version: 1,
    universe_assets: [],
    seasons: [
      {
        season: 1,
        season_assets: [],
        episodes: [{ episode: 1, title: 'Episode 1', doc_ids: [] }],
      },
    ],
  },
  null,
  2
);
