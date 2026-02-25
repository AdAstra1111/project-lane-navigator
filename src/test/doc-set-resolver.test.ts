/**
 * docSetResolver — Unit tests for shared deterministic resolution logic.
 */
import { describe, it, expect } from 'vitest';
import {
  getDefaultDocSetId,
  getDocSetDocumentIds,
  resolveContextDocumentIds,
  type ResolveParams,
} from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/* ── Helpers ── */

const makeSet = (id: string, is_default: boolean, created_at: string): DocSet => ({
  id, project_id: 'p1', name: `Set ${id}`, description: null, is_default,
  created_by: null, created_at, updated_at: '',
});

const makeItem = (id: string, doc_set_id: string, document_id: string, sort_order: number): DocSetItem => ({
  id, doc_set_id, document_id, sort_order, created_at: '',
});

/* ── getDefaultDocSetId ── */

describe('getDefaultDocSetId', () => {
  it('returns is_default=true doc set', () => {
    const sets = [makeSet('ds1', false, '2026-01-02'), makeSet('ds2', true, '2026-01-03')];
    expect(getDefaultDocSetId(sets)).toBe('ds2');
  });

  it('falls back to oldest created_at', () => {
    const sets = [makeSet('ds2', false, '2026-01-03'), makeSet('ds1', false, '2026-01-01')];
    expect(getDefaultDocSetId(sets)).toBe('ds1');
  });

  it('tiebreaks by id asc', () => {
    const sets = [makeSet('ds-b', false, '2026-01-01'), makeSet('ds-a', false, '2026-01-01')];
    expect(getDefaultDocSetId(sets)).toBe('ds-a');
  });

  it('returns undefined for empty', () => {
    expect(getDefaultDocSetId([])).toBeUndefined();
  });

  it('is deterministic', () => {
    const sets = [makeSet('ds2', false, '2026-01-02'), makeSet('ds1', false, '2026-01-01')];
    expect(getDefaultDocSetId(sets)).toBe(getDefaultDocSetId(sets));
  });
});

/* ── getDocSetDocumentIds ── */

describe('getDocSetDocumentIds', () => {
  it('returns document_ids sorted by sort_order asc', () => {
    const items = [
      makeItem('i3', 'ds1', 'doc-c', 3),
      makeItem('i1', 'ds1', 'doc-a', 1),
      makeItem('i2', 'ds1', 'doc-b', 2),
    ];
    expect(getDocSetDocumentIds(items)).toEqual(['doc-a', 'doc-b', 'doc-c']);
  });

  it('returns empty for empty items', () => {
    expect(getDocSetDocumentIds([])).toEqual([]);
  });

  it('does not mutate input', () => {
    const items = [makeItem('i2', 'ds1', 'doc-b', 2), makeItem('i1', 'ds1', 'doc-a', 1)];
    const origFirst = items[0].document_id;
    getDocSetDocumentIds(items);
    expect(items[0].document_id).toBe(origFirst);
  });
});

/* ── resolveContextDocumentIds ── */

describe('resolveContextDocumentIds', () => {
  const ds1Items = [
    makeItem('i1', 'ds1', 'doc-alpha', 1),
    makeItem('i2', 'ds1', 'doc-beta', 2),
  ];
  const ds2Items = [
    makeItem('i3', 'ds2', 'doc-gamma', 1),
    makeItem('i4', 'ds2', 'doc-delta', 2),
    makeItem('i5', 'ds2', 'doc-epsilon', 3),
  ];
  const sets = [makeSet('ds1', true, '2026-01-01'), makeSet('ds2', false, '2026-01-02')];
  const itemsBySet: Record<string, DocSetItem[]> = { ds1: ds1Items, ds2: ds2Items };

  it('explicitDocSetId wins over default', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitDocSetId: 'ds2', mode: 'trailer',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    expect(result.includeDocumentIds).toEqual(['doc-gamma', 'doc-delta', 'doc-epsilon']);
  });

  it('default doc set used when no explicit selection', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual(['doc-alpha', 'doc-beta']);
  });

  it('explicit include IDs used when no doc sets', () => {
    const result = resolveContextDocumentIds({
      docSets: [], docSetItemsBySetId: {},
      explicitIncludeDocumentIds: ['doc-x', 'doc-y'],
      mode: 'writers_room',
    });
    expect(result.resolutionReason).toBe('explicit_include_ids');
    expect(result.includeDocumentIds).toEqual(['doc-x', 'doc-y']);
  });

  it('legacy fallback when nothing available', () => {
    const result = resolveContextDocumentIds({
      docSets: [], docSetItemsBySetId: {},
      mode: 'storyboard',
    });
    expect(result.resolutionReason).toBe('legacy_fallback');
    expect(result.includeDocumentIds).toBeNull();
  });

  it('ordering is strictly position asc', () => {
    const reverseItems = [
      makeItem('i5', 'ds2', 'doc-epsilon', 3),
      makeItem('i3', 'ds2', 'doc-gamma', 1),
      makeItem('i4', 'ds2', 'doc-delta', 2),
    ];
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: { ...itemsBySet, ds2: reverseItems },
      explicitDocSetId: 'ds2', mode: 'trailer',
    });
    expect(result.includeDocumentIds).toEqual(['doc-gamma', 'doc-delta', 'doc-epsilon']);
  });

  it('explicit doc set with empty items returns empty array', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: { ds1: ds1Items },
      explicitDocSetId: 'ds-nonexistent', mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    expect(result.includeDocumentIds).toEqual([]);
  });

  it('default doc set with no items returns empty array', () => {
    const emptySets = [makeSet('ds-empty', true, '2026-01-01')];
    const result = resolveContextDocumentIds({
      docSets: emptySets, docSetItemsBySetId: {},
      mode: 'storyboard',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual([]);
  });

  it('explicit include IDs not used when doc sets exist', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitIncludeDocumentIds: ['doc-override'],
      mode: 'analysis',
    });
    // Default doc set takes priority over explicit IDs
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual(['doc-alpha', 'doc-beta']);
  });

  it('works for all workflow modes', () => {
    for (const mode of ['writers_room', 'trailer', 'storyboard', 'analysis'] as const) {
      const result = resolveContextDocumentIds({
        docSets: sets, docSetItemsBySetId: itemsBySet, mode,
      });
      expect(result.resolutionReason).toBe('doc_set_default');
    }
  });

  it('deterministic across calls', () => {
    const params: ResolveParams = { docSets: sets, docSetItemsBySetId: itemsBySet, mode: 'trailer' };
    const r1 = resolveContextDocumentIds(params);
    const r2 = resolveContextDocumentIds(params);
    expect(r1).toEqual(r2);
  });
});
