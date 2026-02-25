/**
 * sceneScope — Scope-aware shrink guard + scene parsing tests.
 */
import { describe, it, expect } from 'vitest';
import {
  parseScenes,
  resolveApplyScope,
  computeScopedShrink,
  detectOutOfScopeChanges,
} from '../../supabase/functions/_shared/sceneScope';

/* ── Helpers ── */

const SCRIPT_3_SCENES = `INT. COFFEE SHOP - DAY

Sarah sits at a table, nervously tapping her fingers. She checks her phone.
A barista approaches with a latte. Sarah smiles weakly and takes it.
She stares out the window, watching people pass by on the street.

EXT. CITY STREET - NIGHT

Rain pours down. Marcus walks alone, his coat pulled tight.
He passes a neon sign flickering in the darkness.
The city feels empty despite the noise. He keeps walking.

INT. APARTMENT - NIGHT

Sarah opens the door to find Marcus standing there, soaking wet.
They stare at each other for a long moment.
She steps aside to let him in without a word.`;

const SCRIPT_3_SCENES_SELECTIVE_REWRITE = `INT. COFFEE SHOP - DAY

Sarah sits at a table, nervously tapping her fingers. She checks her phone.
A barista approaches with a latte. Sarah smiles weakly and takes it.
She stares out the window, watching people pass by on the street.
There's a tension in her posture, a barely contained electricity.
She touches the rim of the cup and remembers his hands.

EXT. CITY STREET - NIGHT

Rain pours down. Marcus walks alone, his coat pulled tight.
He passes a neon sign flickering in the darkness.
The city feels empty despite the noise. He keeps walking.

INT. APARTMENT - NIGHT

Sarah opens the door to find Marcus standing there, soaking wet.
They stare at each other for a long moment.
She steps aside to let him in without a word.`;

const SCRIPT_3_SCENES_COMPRESSED = `INT. COFFEE SHOP - DAY

Sarah waits.

EXT. CITY STREET - NIGHT

Marcus walks.

INT. APARTMENT - NIGHT

She lets him in.`;

/* ── parseScenes ── */

describe('parseScenes', () => {
  it('parses 3 scenes from standard screenplay format', () => {
    const scenes = parseScenes(SCRIPT_3_SCENES);
    expect(scenes).toHaveLength(3);
    expect(scenes[0].heading).toBe('INT. COFFEE SHOP - DAY');
    expect(scenes[1].heading).toBe('EXT. CITY STREET - NIGHT');
    expect(scenes[2].heading).toBe('INT. APARTMENT - NIGHT');
  });

  it('returns empty for empty text', () => {
    expect(parseScenes('')).toEqual([]);
  });
});

/* ── resolveApplyScope ── */

describe('resolveApplyScope', () => {
  it('returns scene mode when changes have scene targets', () => {
    const result = resolveApplyScope({
      changes: [
        { target: { scene_numbers: [1, 3] } },
        { target: { scene_numbers: [3] } },
      ],
    });
    expect(result.mode).toBe('scene');
    expect(result.allowedScenes).toEqual([1, 3]);
  });

  it('returns full mode when no scene targets', () => {
    const result = resolveApplyScope({ changes: [{ target: {} }] });
    expect(result.mode).toBe('full');
  });

  it('returns full mode when client overrides to full', () => {
    const result = resolveApplyScope({
      changes: [{ target: { scene_numbers: [1] } }],
    }, 'full');
    expect(result.mode).toBe('full');
  });
});

/* ── computeScopedShrink ── */

describe('computeScopedShrink', () => {
  it('full rewrite: detects global shrink', () => {
    const result = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_COMPRESSED, []);
    expect(result.isSelective).toBe(false);
    expect(result.shrinkFraction).toBeGreaterThan(0.3);
    expect(result.shrinkPct).toBeGreaterThan(30);
  });

  it('selective rewrite (scene 1 grows): whole doc may shrink but targeted subset does not', () => {
    // Scene 1 got longer (added lines), scenes 2+3 unchanged
    const result = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_SELECTIVE_REWRITE, [1]);
    expect(result.isSelective).toBe(true);
    // Scene 1 grew, so shrink should be negative (growth)
    expect(result.shrinkFraction).toBeLessThanOrEqual(0);
  });

  it('selective rewrite where targeted scenes truly shrink', () => {
    // Rewrite compressed all scenes, but we target scene 1 only
    const result = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_COMPRESSED, [1]);
    expect(result.isSelective).toBe(true);
    expect(result.shrinkFraction).toBeGreaterThan(0.3);
  });

  it('full rewrite with no shrink passes', () => {
    const result = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_SELECTIVE_REWRITE, []);
    expect(result.isSelective).toBe(false);
    // Added text, so no shrink
    expect(result.shrinkFraction).toBeLessThanOrEqual(0);
  });

  it('selective with empty allowed scenes behaves as full', () => {
    const result = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_COMPRESSED, []);
    expect(result.isSelective).toBe(false);
  });
});

/* ── Integration scenario: selective rewrite false positive prevention ── */

describe('shrink guard integration scenario', () => {
  const SHRINK_THRESHOLD = 0.3;

  it('PASS: selective rewrite adds to scene 1, global shrink irrelevant', () => {
    const shrink = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_SELECTIVE_REWRITE, [1]);
    // Targeted scenes grew, so shrink guard should NOT block
    expect(shrink.shrinkFraction <= SHRINK_THRESHOLD).toBe(true);
  });

  it('FAIL: selective rewrite truly deletes content in scene 1 (>30%)', () => {
    const shrink = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_COMPRESSED, [1]);
    expect(shrink.shrinkFraction > SHRINK_THRESHOLD).toBe(true);
  });

  it('FAIL: full rewrite shrinks > 30%', () => {
    const shrink = computeScopedShrink(SCRIPT_3_SCENES, SCRIPT_3_SCENES_COMPRESSED, []);
    expect(shrink.shrinkFraction > SHRINK_THRESHOLD).toBe(true);
  });
});
