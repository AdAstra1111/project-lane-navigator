/**
 * Doc Sets — Unit tests for pure helpers and integration logic.
 */
import { describe, it, expect } from 'vitest';
import { docSetItemOrder, enforceOneDefault, type DocSet, type DocSetItem } from '@/hooks/useDocSets';

/* ── docSetItemOrder: deterministic ordering ── */

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

/* ── Writers' Room integration: doc set → includeDocumentIds ── */

describe('doc set → Writers Room integration', () => {
  it('doc set items produce deterministic includeDocumentIds', () => {
    const items: DocSetItem[] = [
      { id: '1', doc_set_id: 'ds1', document_id: 'doc-script', sort_order: 0, created_at: '' },
      { id: '2', doc_set_id: 'ds1', document_id: 'doc-char-bible', sort_order: 1, created_at: '' },
      { id: '3', doc_set_id: 'ds1', document_id: 'doc-treatment', sort_order: 2, created_at: '' },
    ];
    const ids = docSetItemOrder(items);
    expect(ids).toEqual(['doc-script', 'doc-char-bible', 'doc-treatment']);
    // Second call identical
    expect(docSetItemOrder(items)).toEqual(ids);
  });

  it('when default doc set exists, its items drive context', () => {
    const sets: DocSet[] = [
      { id: 'ds1', project_id: 'p1', name: 'Default', description: null, is_default: true, created_by: null, created_at: '', updated_at: '' },
      { id: 'ds2', project_id: 'p1', name: 'Other', description: null, is_default: false, created_by: null, created_at: '', updated_at: '' },
    ];
    const defaultSet = sets.find(s => s.is_default);
    expect(defaultSet?.id).toBe('ds1');
  });

  it('when no default, returns undefined (fallback to presets)', () => {
    const sets: DocSet[] = [
      { id: 'ds1', project_id: 'p1', name: 'Set A', description: null, is_default: false, created_by: null, created_at: '', updated_at: '' },
    ];
    const defaultSet = sets.find(s => s.is_default);
    expect(defaultSet).toBeUndefined();
  });
});
