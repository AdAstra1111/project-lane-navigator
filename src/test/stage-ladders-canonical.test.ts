/**
 * Stage Ladders — Canonical Key Guard Tests
 *
 * Ensures stage-ladders.json FORMAT_LADDERS use only canonical keys
 * (no legacy blueprint/architecture) and that every ladder entry is
 * recognized by the documentLadders canonical registry.
 */
import { describe, it, expect } from 'vitest';
import LADDERS_JSON from '../../supabase/_shared/stage-ladders.json';
import { BASE_DOC_TYPES, normalizeDocType, formatToLane } from '@/config/documentLadders';

const FORMAT_LADDERS: Record<string, string[]> = LADDERS_JSON.FORMAT_LADDERS as Record<string, string[]>;
const DOC_TYPE_ALIASES: Record<string, string> = LADDERS_JSON.DOC_TYPE_ALIASES as Record<string, string>;

const BANNED_LEGACY_KEYS = ['blueprint', 'architecture', 'draft', 'coverage'];

describe('Stage ladders canonical key guard', () => {
  it('No FORMAT_LADDERS entry contains banned legacy keys', () => {
    for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
      for (const banned of BANNED_LEGACY_KEYS) {
        expect(ladder).not.toContain(banned);
      }
    }
  });

  it('Every FORMAT_LADDERS entry normalizes to a known BASE_DOC_TYPES key', () => {
    const knownKeys = new Set(Object.keys(BASE_DOC_TYPES));
    // Some pipeline stages are valid but not in BASE_DOC_TYPES (e.g. idea is in BASE_DOC_TYPES)
    // We allow pass-through if the key exists as-is in BASE_DOC_TYPES
    const failures: string[] = [];

    for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
      const lane = formatToLane(fmt);
      for (const entry of ladder) {
        const normalized = normalizeDocType(entry, lane, fmt);
        if (!knownKeys.has(normalized)) {
          failures.push(`FORMAT_LADDERS["${fmt}"] entry "${entry}" normalizes to "${normalized}" which is NOT in BASE_DOC_TYPES`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error('Canonical key drift detected:\n' + failures.join('\n'));
    }
  });

  it('DOC_TYPE_ALIASES maps blueprint → treatment', () => {
    expect(DOC_TYPE_ALIASES['blueprint']).toBe('treatment');
  });

  it('DOC_TYPE_ALIASES maps architecture → story_outline', () => {
    expect(DOC_TYPE_ALIASES['architecture']).toBe('story_outline');
  });

  it('DOC_TYPE_ALIASES does NOT map episode_beats globally to vertical_episode_beats', () => {
    expect(DOC_TYPE_ALIASES['episode_beats']).toBeUndefined();
  });

  it('Every ladder starts with idea', () => {
    for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
      expect(ladder[0]).toBe('idea');
    }
  });

  it('No ladder has duplicate entries', () => {
    for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
      expect(new Set(ladder).size).toBe(ladder.length);
    }
  });
});
