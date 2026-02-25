/**
 * Writers' Room hardening — Tests for scene-scope enforcement + ContextCards.
 */
import { describe, it, expect } from 'vitest';

// Import scene scope helpers directly (same pure logic used in edge function)
// We re-implement the imports since edge function uses Deno imports
// but the logic is identical — test the canonical source.

/* ── Scene scope helpers (replicated for Vitest since edge fn uses Deno imports) ── */

interface ParsedScene {
  sceneNumber: number;
  heading: string;
  body: string;
  startOffset: number;
  endOffset: number;
}

const SCENE_HEADING_RE = /^(?:\d+[\.\)]\s*)?(?:INT\.|EXT\.|I\/E\.|INT\/EXT\.?)\s*.+$/im;

function parseScenes(scriptText: string): ParsedScene[] {
  if (!scriptText || scriptText.trim().length === 0) return [];
  const lines = scriptText.split('\n');
  const scenes: ParsedScene[] = [];
  let currentHeading = '';
  let bodyLines: string[] = [];
  let charOffset = 0;
  let sceneStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (SCENE_HEADING_RE.test(trimmed)) {
      if (currentHeading) {
        scenes.push({
          sceneNumber: scenes.length + 1,
          heading: currentHeading,
          body: bodyLines.join('\n'),
          startOffset: sceneStartOffset,
          endOffset: charOffset - 1,
        });
      }
      currentHeading = trimmed;
      sceneStartOffset = charOffset;
      bodyLines = [];
    } else if (currentHeading) {
      bodyLines.push(line);
    }
    charOffset += line.length + 1;
  }
  if (currentHeading) {
    scenes.push({
      sceneNumber: scenes.length + 1,
      heading: currentHeading,
      body: bodyLines.join('\n'),
      startOffset: sceneStartOffset,
      endOffset: charOffset - 1,
    });
  }
  return scenes;
}

function normalizeHeading(heading: string): string {
  return heading.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

interface ScopeCheckResult {
  ok: boolean;
  outOfScopeScenes: number[];
  message: string;
}

function detectOutOfScopeChanges(
  originalScenes: ParsedScene[],
  updatedScenes: ParsedScene[],
  allowedSceneNumbers: number[]
): ScopeCheckResult {
  const allowedSet = new Set(allowedSceneNumbers);
  const outOfScope: number[] = [];
  const originalMap = new Map<string, string>();
  for (const s of originalScenes) {
    originalMap.set(normalizeHeading(s.heading), normalizeBody(s.body));
  }
  for (const us of updatedScenes) {
    if (allowedSet.has(us.sceneNumber)) continue;
    const nh = normalizeHeading(us.heading);
    const ob = originalMap.get(nh);
    if (ob === undefined) { outOfScope.push(us.sceneNumber); continue; }
    if (ob !== normalizeBody(us.body)) outOfScope.push(us.sceneNumber);
  }
  const updatedHeadings = new Set(updatedScenes.map(s => normalizeHeading(s.heading)));
  for (const os of originalScenes) {
    if (allowedSet.has(os.sceneNumber)) continue;
    if (!updatedHeadings.has(normalizeHeading(os.heading))) outOfScope.push(os.sceneNumber);
  }
  const sorted = [...new Set(outOfScope)].sort((a, b) => a - b);
  return sorted.length === 0
    ? { ok: true, outOfScopeScenes: [], message: 'All changes within scope' }
    : { ok: false, outOfScopeScenes: sorted, message: `Out-of-scope changes detected in scene(s): ${sorted.join(', ')}. Only scenes ${[...allowedSet].sort((a, b) => a - b).join(', ')} were allowed.` };
}

function resolveApplyScope(
  changePlan: { changes?: Array<{ target?: { scene_numbers?: number[] } }> },
  clientApplyScope?: string
): { mode: 'scene' | 'full'; allowedScenes: number[] } {
  const allSceneNumbers = new Set<number>();
  for (const c of changePlan.changes || []) {
    for (const sn of c.target?.scene_numbers || []) allSceneNumbers.add(sn);
  }
  if (clientApplyScope === 'full') return { mode: 'full', allowedScenes: [] };
  if (allSceneNumbers.size > 0) return { mode: 'scene', allowedScenes: [...allSceneNumbers].sort((a, b) => a - b) };
  return { mode: 'full', allowedScenes: [] };
}

/* ── ContextCards helpers ── */

import { buildContextCardsData, getDocTypeBadge } from '@/components/notes/ContextCards';

/* ════════════════════════════════════════════════════════════════
   PART A: Scene-scope enforcement
   ════════════════════════════════════════════════════════════════ */

describe('parseScenes', () => {
  it('parses standard INT./EXT. headings', () => {
    const script = `FADE IN:

INT. LIVING ROOM - DAY
John sits alone.

EXT. STREET - NIGHT
Rain falls.`;
    const scenes = parseScenes(script);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].heading).toBe('INT. LIVING ROOM - DAY');
    expect(scenes[1].heading).toBe('EXT. STREET - NIGHT');
  });

  it('numbers scenes 1..N in document order', () => {
    const script = `INT. A - DAY\nText A\nEXT. B - NIGHT\nText B\nINT. C - DAY\nText C`;
    const scenes = parseScenes(script);
    expect(scenes.map(s => s.sceneNumber)).toEqual([1, 2, 3]);
  });

  it('returns empty for empty script', () => {
    expect(parseScenes('')).toEqual([]);
    expect(parseScenes('  ')).toEqual([]);
  });

  it('handles I/E. headings', () => {
    const script = `I/E. CAR - MOVING - DAY\nDriving scene.`;
    const scenes = parseScenes(script);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].heading).toContain('I/E.');
  });

  it('preserves body text', () => {
    const script = `INT. OFFICE - DAY\nMARY\nHello.\n\nJOHN\nGoodbye.`;
    const scenes = parseScenes(script);
    expect(scenes[0].body).toContain('MARY');
    expect(scenes[0].body).toContain('Hello.');
  });
});

describe('detectOutOfScopeChanges', () => {
  const makeScript = (scenes: Array<{ heading: string; body: string }>) =>
    scenes.map(s => `${s.heading}\n${s.body}`).join('\n\n');

  it('passes when only allowed scenes changed', () => {
    const original = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'Original A' },
      { heading: 'EXT. B - NIGHT', body: 'Original B' },
      { heading: 'INT. C - DAY', body: 'Original C' },
    ]));
    const updated = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'Original A' },
      { heading: 'EXT. B - NIGHT', body: 'CHANGED B' },
      { heading: 'INT. C - DAY', body: 'Original C' },
    ]));
    const result = detectOutOfScopeChanges(original, updated, [2]);
    expect(result.ok).toBe(true);
    expect(result.outOfScopeScenes).toEqual([]);
  });

  it('rejects when out-of-scope scene changed', () => {
    const original = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'Original A' },
      { heading: 'EXT. B - NIGHT', body: 'Original B' },
      { heading: 'INT. C - DAY', body: 'Original C' },
    ]));
    const updated = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'CHANGED A' },
      { heading: 'EXT. B - NIGHT', body: 'CHANGED B' },
      { heading: 'INT. C - DAY', body: 'Original C' },
    ]));
    const result = detectOutOfScopeChanges(original, updated, [2]);
    expect(result.ok).toBe(false);
    expect(result.outOfScopeScenes).toContain(1);
  });

  it('detects deleted out-of-scope scene', () => {
    const original = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'A' },
      { heading: 'EXT. B - NIGHT', body: 'B' },
    ]));
    const updated = parseScenes(makeScript([
      { heading: 'EXT. B - NIGHT', body: 'B' },
    ]));
    const result = detectOutOfScopeChanges(original, updated, [2]);
    expect(result.ok).toBe(false);
    expect(result.outOfScopeScenes).toContain(1);
  });

  it('passes with no changes', () => {
    const script = makeScript([
      { heading: 'INT. A - DAY', body: 'Text' },
      { heading: 'EXT. B - NIGHT', body: 'Text' },
    ]);
    const scenes = parseScenes(script);
    const result = detectOutOfScopeChanges(scenes, scenes, [1]);
    expect(result.ok).toBe(true);
  });

  it('whitespace-only changes are ignored', () => {
    const original = parseScenes('INT. A - DAY\nHello   world');
    const updated = parseScenes('INT. A - DAY\nHello world');
    const result = detectOutOfScopeChanges(original, updated, []);
    expect(result.ok).toBe(true);
  });

  it('returns deterministic sorted scene numbers', () => {
    const original = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'A' },
      { heading: 'EXT. B - NIGHT', body: 'B' },
      { heading: 'INT. C - DAY', body: 'C' },
    ]));
    const updated = parseScenes(makeScript([
      { heading: 'INT. A - DAY', body: 'CHANGED' },
      { heading: 'EXT. B - NIGHT', body: 'B' },
      { heading: 'INT. C - DAY', body: 'CHANGED' },
    ]));
    const result = detectOutOfScopeChanges(original, updated, [2]);
    expect(result.outOfScopeScenes).toEqual([1, 3]); // sorted
  });
});

describe('resolveApplyScope', () => {
  it('defaults to scene scope when plan has scene targets', () => {
    const plan = { changes: [{ target: { scene_numbers: [2, 5] } }] };
    const result = resolveApplyScope(plan);
    expect(result.mode).toBe('scene');
    expect(result.allowedScenes).toEqual([2, 5]);
  });

  it('explicit full scope overrides scene targets', () => {
    const plan = { changes: [{ target: { scene_numbers: [1] } }] };
    const result = resolveApplyScope(plan, 'full');
    expect(result.mode).toBe('full');
  });

  it('no scene targets → full scope', () => {
    const plan = { changes: [{ target: {} }] };
    const result = resolveApplyScope(plan);
    expect(result.mode).toBe('full');
  });

  it('empty changes → full scope', () => {
    const result = resolveApplyScope({ changes: [] });
    expect(result.mode).toBe('full');
  });

  it('merges scene numbers from multiple changes deterministically', () => {
    const plan = { changes: [
      { target: { scene_numbers: [3, 1] } },
      { target: { scene_numbers: [2, 1] } },
    ] };
    const result = resolveApplyScope(plan);
    expect(result.allowedScenes).toEqual([1, 2, 3]);
  });
});

/* ════════════════════════════════════════════════════════════════
   PART B: ContextCards
   ════════════════════════════════════════════════════════════════ */

describe('buildContextCardsData', () => {
  const docs = [
    { id: 'doc-a', title: 'Script Draft', doc_type: 'screenplay_draft' },
    { id: 'doc-b', title: 'Treatment', doc_type: 'treatment' },
    { id: 'doc-c', title: 'Character Bible', doc_type: 'character_bible' },
  ];

  it('orders cards by includeDocumentIds order', () => {
    const cards = buildContextCardsData(docs, ['doc-c', 'doc-a', 'doc-b']);
    expect(cards.map(c => c.id)).toEqual(['doc-c', 'doc-a', 'doc-b']);
  });

  it('returns empty for empty includeDocumentIds', () => {
    expect(buildContextCardsData(docs, [])).toEqual([]);
  });

  it('skips missing document IDs gracefully', () => {
    const cards = buildContextCardsData(docs, ['doc-a', 'doc-missing', 'doc-b']);
    expect(cards.map(c => c.id)).toEqual(['doc-a', 'doc-b']);
  });

  it('populates type badge from doc_type', () => {
    const cards = buildContextCardsData(docs, ['doc-a']);
    expect(cards[0].typeBadge).toBe('Script');
  });

  it('summary is null (no stored summary field)', () => {
    const cards = buildContextCardsData(docs, ['doc-a']);
    expect(cards[0].summary).toBeNull();
  });

  it('uses file_name as fallback title', () => {
    const cards = buildContextCardsData(
      [{ id: 'doc-x', file_name: 'draft.pdf' }],
      ['doc-x']
    );
    expect(cards[0].title).toBe('draft.pdf');
  });

  it('defaults to "Untitled" when no title or file_name', () => {
    const cards = buildContextCardsData([{ id: 'doc-x' }], ['doc-x']);
    expect(cards[0].title).toBe('Untitled');
  });
});

describe('getDocTypeBadge', () => {
  it('maps known types', () => {
    expect(getDocTypeBadge('screenplay_draft')).toBe('Script');
    expect(getDocTypeBadge('treatment')).toBe('Treatment');
    expect(getDocTypeBadge('character_bible')).toBe('Character Bible');
  });

  it('formats unknown types with title case', () => {
    expect(getDocTypeBadge('custom_thing')).toBe('Custom Thing');
  });
});
