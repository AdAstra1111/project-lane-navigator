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
import { VERTICAL_DRAMA_PIPELINE_ORDER, DELIVERABLE_PIPELINE_ORDER } from '@/lib/dev-os-config';
import { getDocFlowConfig } from '@/lib/docFlowMap';

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

  // ── IEL regression tripwire: complete_season_script must never be a ladder stage ──
  it('No FORMAT_LADDERS entry contains complete_season_script', () => {
    for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
      expect(ladder).not.toContain('complete_season_script');
    }
  });

  it('complete_season_script is aliased to season_script', () => {
    expect(DOC_TYPE_ALIASES['complete_season_script']).toBe('season_script');
  });

  it('Vertical-drama terminal stage is season_script', () => {
    const vdLadder = FORMAT_LADDERS['vertical-drama'];
    expect(vdLadder[vdLadder.length - 1]).toBe('season_script');
  });

  // ── IEL: VD UI pipeline MUST NOT contain series_writer or season_master_script ──
  it('VERTICAL_DRAMA_PIPELINE_ORDER does not contain season_master_script', () => {
    expect(VERTICAL_DRAMA_PIPELINE_ORDER).not.toContain('season_master_script');
  });

  it('VERTICAL_DRAMA_PIPELINE_ORDER does not contain series_writer', () => {
    expect(VERTICAL_DRAMA_PIPELINE_ORDER).not.toContain('series_writer');
  });

  it('VERTICAL_DRAMA_PIPELINE_ORDER does not contain episode_script', () => {
    expect(VERTICAL_DRAMA_PIPELINE_ORDER).not.toContain('episode_script');
  });

  it('VERTICAL_DRAMA_PIPELINE_ORDER ends with season_script', () => {
    expect(VERTICAL_DRAMA_PIPELINE_ORDER[VERTICAL_DRAMA_PIPELINE_ORDER.length - 1]).toBe('season_script');
  });

  it('VD docFlowMap topTabs do not include series_writer key', () => {
    const config = getDocFlowConfig('vertical_drama');
    const tabKeys = config.topTabs.map(t => t.key);
    expect(tabKeys).not.toContain('series_writer');
  });

  it('VD docFlowMap hiddenDocTypes includes season_master_script', () => {
    const config = getDocFlowConfig('vertical_drama');
    expect(config.hiddenDocTypes).toContain('season_master_script');
  });

  it('VD FORMAT_LADDERS does not contain season_master_script', () => {
    const vdLadder = FORMAT_LADDERS['vertical-drama'];
    expect(vdLadder).not.toContain('season_master_script');
  });
});
