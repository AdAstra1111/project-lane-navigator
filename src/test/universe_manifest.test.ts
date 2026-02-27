import { describe, expect, test } from 'vitest';
import { parseUniverseManifest, manifestDocIds } from '@/lib/universe_manifest/manifest';

describe('universe manifest', () => {
  test('parses valid manifest v1', () => {
    const json = JSON.stringify({
      schema_version: 1,
      universe_assets: ['docA', 'docA', 123],
      seasons: [
        {
          season: 1,
          season_assets: ['docS1', null],
          episodes: [
            { episode: 1, title: 'Ep 1', doc_ids: ['docE1', 'docE1'] },
            { episode: 2, doc_ids: ['docE2'] },
          ],
        },
      ],
    });

    const res = parseUniverseManifest(json);
    expect(res.ok).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.manifest?.schema_version).toBe(1);
    expect(res.manifest?.universe_assets).toEqual(['docA']);
    expect(res.manifest?.seasons?.[0].season_assets).toEqual(['docS1']);
    expect(res.manifest?.seasons?.[0].episodes[0].doc_ids).toEqual(['docE1']);
  });

  test('rejects invalid json', () => {
    const res = parseUniverseManifest('{');
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/Invalid JSON/);
  });

  test('builds indices deterministically', () => {
    const res = parseUniverseManifest(JSON.stringify({
      schema_version: 1,
      universe_assets: ['U1'],
      seasons: [
        { season: 1, season_assets: ['S1A'], episodes: [{ episode: 1, doc_ids: ['E11', 'E11'] }] },
      ],
    }));
    expect(res.ok).toBe(true);

    const idx = manifestDocIds(res.manifest!);
    expect(idx.universe.has('U1')).toBe(true);
    expect(idx.universe.has('S1A')).toBe(true);
    expect(idx.universe.has('E11')).toBe(true);

    const seasonSet = idx.bySeason.get(1);
    expect(seasonSet?.has('S1A')).toBe(true);
    expect(seasonSet?.has('E11')).toBe(true);

    const epSet = idx.byEpisode.get('S01E01');
    expect(epSet?.has('E11')).toBe(true);

    const epInfo = idx.episodeIndexByDocId.get('E11');
    expect(epInfo).toEqual({ season: 1, episode: 1, key: 'S01E01' });
  });
});
