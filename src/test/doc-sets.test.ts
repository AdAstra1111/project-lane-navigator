/**
 * Doc Sets — Unit tests for pure helpers and integration logic.
 */
import { describe, it, expect } from 'vitest';
import {
  docSetItemOrder,
  buildIncludeDocumentIds,
  enforceOneDefault,
  selectDefaultDocSet,
  normalizePositions,
  type DocSet,
  type DocSetItem,
} from '@/hooks/useDocSets';

/* ── docSetItemOrder / buildIncludeDocumentIds ── */

describe('docSetItemOrder', () => {
  it('orders by sort_order ascending', () => {
    const items: DocSetItem[] = [
      { id: '3', doc_set_id: 'ds1', document_id: 'doc-c', sort_order: 2, created_at: '' },
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-a', sort_order: 0, created_at: '' },
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-b', sort_order: 1, created_at: '' },
    ];
    expect(docSetItemOrder(items)).toEqual(['doc-a', 'doc-b', 'doc-c']);
  });

  it('returns empty for empty items', () => {
    expect(docSetItemOrder([])).toEqual([]);
  });

  it('does not mutate input', () => {
    const items: DocSetItem[] = [
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-b', sort_order: 1, created_at: '' },
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-a', sort_order: 0, created_at: '' },
    ];
    const orig0 = items[0].document_id;
    docSetItemOrder(items);
    expect(items[0].document_id).toBe(orig0);
  });

  it('is deterministic across calls', () => {
    const items: DocSetItem[] = [
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-b', sort_order: 1, created_at: '' },
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-a', sort_order: 0, created_at: '' },
    ];
    expect(docSetItemOrder(items)).toEqual(docSetItemOrder(items));
  });

  it('handles duplicate sort_order (stable by input order)', () => {
    const items: DocSetItem[] = [
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-a', sort_order: 0, created_at: '' },
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-b', sort_order: 0, created_at: '' },
    ];
    const result = docSetItemOrder(items);
    expect(result).toHaveLength(2);
    expect(result).toContain('doc-a');
    expect(result).toContain('doc-b');
  });

  it('single item returns single-element array', () => {
    const items: DocSetItem[] = [
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-a', sort_order: 0, created_at: '' },
    ];
    expect(docSetItemOrder(items)).toEqual(['doc-a']);
  });

  it('items with positions 2,1,3 return ids in 1,2,3 order', () => {
    const items: DocSetItem[] = [
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-x', sort_order: 2, created_at: '' },
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-y', sort_order: 1, created_at: '' },
      { id: '3', doc_set_id: 'ds1', document_id: 'doc-z', sort_order: 3, created_at: '' },
    ];
    expect(buildIncludeDocumentIds(items)).toEqual(['doc-y', 'doc-x', 'doc-z']);
  });
});

/* ── enforceOneDefault ── */

describe('enforceOneDefault', () => {
  const makeSets = (overrides: Partial<DocSet>[] = []): DocSet[] => [
    { id: 'ds1', project_id: 'p1', name: 'Set A', description: null, is_default: true, created_by: null, created_at: '', updated_at: '' },
    { id: 'ds2', project_id: 'p1', name: 'Set B', description: null, is_default: false, created_by: null, created_at: '', updated_at: '' },
    { id: 'ds3', project_id: 'p1', name: 'Set C', description: null, is_default: false, created_by: null, created_at: '', updated_at: '' },
    ...overrides.map((o, i) => ({
      id: `ds${4 + i}`, project_id: 'p1', name: `Extra ${i}`, description: null, is_default: false,
      created_by: null, created_at: '', updated_at: '', ...o,
    })),
  ];

  it('sets only target as default', () => {
    const result = enforceOneDefault(makeSets(), 'ds2');
    expect(result.filter(s => s.is_default)).toHaveLength(1);
    expect(result.find(s => s.id === 'ds2')?.is_default).toBe(true);
    expect(result.find(s => s.id === 'ds1')?.is_default).toBe(false);
  });

  it('keeps current default if same target', () => {
    const result = enforceOneDefault(makeSets(), 'ds1');
    expect(result.filter(s => s.is_default)).toHaveLength(1);
    expect(result.find(s => s.id === 'ds1')?.is_default).toBe(true);
  });

  it('handles empty array', () => {
    expect(enforceOneDefault([], 'ds1')).toEqual([]);
  });

  it('handles nonexistent target (no default set)', () => {
    const result = enforceOneDefault(makeSets(), 'nonexistent');
    expect(result.filter(s => s.is_default)).toHaveLength(0);
  });

  it('does not mutate input', () => {
    const sets = makeSets();
    const orig = sets[0].is_default;
    enforceOneDefault(sets, 'ds2');
    expect(sets[0].is_default).toBe(orig);
  });
});

/* ── selectDefaultDocSet ── */

describe('selectDefaultDocSet', () => {
  const makeSet = (id: string, is_default: boolean, created_at: string): DocSet => ({
    id, project_id: 'p1', name: `Set ${id}`, description: null, is_default,
    created_by: null, created_at, updated_at: '',
  });

  it('returns the is_default=true doc set', () => {
    const sets = [
      makeSet('ds1', false, '2026-01-02T00:00:00Z'),
      makeSet('ds2', true, '2026-01-03T00:00:00Z'),
      makeSet('ds3', false, '2026-01-01T00:00:00Z'),
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe('ds2');
  });

  it('if none is_default, returns oldest by created_at', () => {
    const sets = [
      makeSet('ds1', false, '2026-01-03T00:00:00Z'),
      makeSet('ds2', false, '2026-01-01T00:00:00Z'),
      makeSet('ds3', false, '2026-01-02T00:00:00Z'),
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe('ds2');
  });

  it('tiebreaks by id asc when created_at identical', () => {
    const sets = [
      makeSet('ds-b', false, '2026-01-01T00:00:00Z'),
      makeSet('ds-a', false, '2026-01-01T00:00:00Z'),
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe('ds-a');
  });

  it('returns undefined for empty array', () => {
    expect(selectDefaultDocSet([])).toBeUndefined();
  });

  it('is deterministic across calls', () => {
    const sets = [
      makeSet('ds1', false, '2026-01-02T00:00:00Z'),
      makeSet('ds2', false, '2026-01-01T00:00:00Z'),
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe(selectDefaultDocSet(sets)?.id);
  });
});

/* ── normalizePositions ── */

describe('normalizePositions', () => {
  const makeItem = (id: string, sort_order: number, document_id: string): DocSetItem => ({
    id, doc_set_id: 'ds1', document_id, sort_order, created_at: '',
  });

  it('re-indexes to 1..N after removal', () => {
    // Positions 1, 3 (gap from removal of position 2)
    const items = [makeItem('a', 1, 'doc-a'), makeItem('c', 3, 'doc-c')];
    const result = normalizePositions(items);
    expect(result.map(r => r.sort_order)).toEqual([1, 2]);
    expect(result.map(r => r.document_id)).toEqual(['doc-a', 'doc-c']);
  });

  it('preserves order based on original sort_order', () => {
    const items = [makeItem('c', 5, 'doc-c'), makeItem('a', 2, 'doc-a'), makeItem('b', 3, 'doc-b')];
    const result = normalizePositions(items);
    expect(result.map(r => r.document_id)).toEqual(['doc-a', 'doc-b', 'doc-c']);
    expect(result.map(r => r.sort_order)).toEqual([1, 2, 3]);
  });

  it('handles empty', () => {
    expect(normalizePositions([])).toEqual([]);
  });

  it('single item gets position 1', () => {
    const result = normalizePositions([makeItem('a', 7, 'doc-a')]);
    expect(result[0].sort_order).toBe(1);
  });

  it('does not mutate input', () => {
    const items = [makeItem('a', 5, 'doc-a')];
    normalizePositions(items);
    expect(items[0].sort_order).toBe(5);
  });
});

/* ── Writers' Room integration ── */

describe('doc set → Writers Room integration', () => {
  it('doc set items produce deterministic includeDocumentIds', () => {
    const items: DocSetItem[] = [
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-script', sort_order: 0, created_at: '' },
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-char-bible', sort_order: 1, created_at: '' },
      { id: '3', doc_set_id: 'ds1', document_id: 'doc-treatment', sort_order: 2, created_at: '' },
    ];
    const ids = docSetItemOrder(items);
    expect(ids).toEqual(['doc-script', 'doc-char-bible', 'doc-treatment']);
    expect(docSetItemOrder(items)).toEqual(ids);
  });

  it('when default doc set exists, selectDefaultDocSet returns it', () => {
    const sets: DocSet[] = [
      { id: 'ds1', project_id: 'p1', name: 'Default', description: null, is_default: true, created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '' },
      { id: 'ds2', project_id: 'p1', name: 'Other', description: null, is_default: false, created_by: null, created_at: '2026-01-02T00:00:00Z', updated_at: '' },
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe('ds1');
  });

  it('when no default, selectDefaultDocSet falls back to oldest', () => {
    const sets: DocSet[] = [
      { id: 'ds2', project_id: 'p1', name: 'Newer', description: null, is_default: false, created_by: null, created_at: '2026-01-02T00:00:00Z', updated_at: '' },
      { id: 'ds1', project_id: 'p1', name: 'Older', description: null, is_default: false, created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '' },
    ];
    expect(selectDefaultDocSet(sets)?.id).toBe('ds1');
  });

  it('when empty, selectDefaultDocSet returns undefined (fallback to presets)', () => {
    expect(selectDefaultDocSet([])).toBeUndefined();
  });
});
