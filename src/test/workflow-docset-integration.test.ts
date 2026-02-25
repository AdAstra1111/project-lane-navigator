/**
 * Workflow doc set integration tests — validates that Trailer, Storyboard,
 * and Analysis workflows use resolveContextDocumentIds deterministically.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveContextDocumentIds,
  getDefaultDocSetId,
  getDocSetDocumentIds,
  type ResolveParams,
} from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/* ── Factories ── */

const makeSet = (id: string, is_default: boolean, created_at: string): DocSet => ({
  id, project_id: 'p1', name: `Set ${id}`, description: null, is_default,
  created_by: null, created_at, updated_at: '',
});

const makeItem = (doc_set_id: string, document_id: string, sort_order: number): DocSetItem => ({
  id: `${doc_set_id}-${document_id}`, doc_set_id, document_id, sort_order, created_at: '',
});

/* ── Shared fixtures ── */

const sets = [
  makeSet('ds-default', true, '2026-01-01'),
  makeSet('ds-alt', false, '2026-01-02'),
];

const itemsBySet: Record<string, DocSetItem[]> = {
  'ds-default': [
    makeItem('ds-default', 'doc-treatment', 1),
    makeItem('ds-default', 'doc-script', 2),
    makeItem('ds-default', 'doc-bible', 3),
  ],
  'ds-alt': [
    makeItem('ds-alt', 'doc-pitch', 1),
    makeItem('ds-alt', 'doc-outline', 2),
  ],
};

/* ── Trailer workflow ── */

describe('trailer workflow doc set resolution', () => {
  it('uses explicit doc set when selected', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitDocSetId: 'ds-alt', mode: 'trailer',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    expect(result.includeDocumentIds).toEqual(['doc-pitch', 'doc-outline']);
  });

  it('falls back to default doc set when no explicit selection', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      mode: 'trailer',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual(['doc-treatment', 'doc-script', 'doc-bible']);
  });

  it('falls back to legacy when no doc sets exist', () => {
    const result = resolveContextDocumentIds({
      docSets: [], docSetItemsBySetId: {},
      mode: 'trailer',
    });
    expect(result.resolutionReason).toBe('legacy_fallback');
    expect(result.includeDocumentIds).toBeNull();
  });

  it('preserves deterministic order from sort_order', () => {
    const reversed: DocSetItem[] = [
      makeItem('ds-alt', 'doc-outline', 2),
      makeItem('ds-alt', 'doc-pitch', 1),
    ];
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: { ...itemsBySet, 'ds-alt': reversed },
      explicitDocSetId: 'ds-alt', mode: 'trailer',
    });
    expect(result.includeDocumentIds).toEqual(['doc-pitch', 'doc-outline']);
  });

  it('deterministic across multiple calls', () => {
    const params: ResolveParams = {
      docSets: sets, docSetItemsBySetId: itemsBySet, mode: 'trailer',
    };
    expect(resolveContextDocumentIds(params)).toEqual(resolveContextDocumentIds(params));
  });
});

/* ── Storyboard workflow ── */

describe('storyboard workflow doc set resolution', () => {
  it('uses explicit doc set when selected', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitDocSetId: 'ds-alt', mode: 'storyboard',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    expect(result.includeDocumentIds).toEqual(['doc-pitch', 'doc-outline']);
  });

  it('falls back to default doc set', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      mode: 'storyboard',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual(['doc-treatment', 'doc-script', 'doc-bible']);
  });

  it('explicit doc set overrides default even when default exists', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitDocSetId: 'ds-alt', mode: 'storyboard',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    // Must NOT use default set's docs
    expect(result.includeDocumentIds).not.toContain('doc-treatment');
  });

  it('empty doc set returns empty array', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: { ...itemsBySet, 'ds-alt': [] },
      explicitDocSetId: 'ds-alt', mode: 'storyboard',
    });
    expect(result.includeDocumentIds).toEqual([]);
  });
});

/* ── Analysis workflow ── */

describe('analysis workflow doc set resolution', () => {
  it('uses explicit doc set when provided', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitDocSetId: 'ds-alt', mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('doc_set_explicit');
    expect(result.includeDocumentIds).toEqual(['doc-pitch', 'doc-outline']);
  });

  it('falls back to default doc set for auto-run analysis', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).toEqual(['doc-treatment', 'doc-script', 'doc-bible']);
  });

  it('explicit include IDs used when no doc sets', () => {
    const result = resolveContextDocumentIds({
      docSets: [], docSetItemsBySetId: {},
      explicitIncludeDocumentIds: ['doc-x', 'doc-y'],
      mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('explicit_include_ids');
    expect(result.includeDocumentIds).toEqual(['doc-x', 'doc-y']);
  });

  it('doc sets take priority over explicit include IDs', () => {
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet,
      explicitIncludeDocumentIds: ['doc-override'],
      mode: 'analysis',
    });
    expect(result.resolutionReason).toBe('doc_set_default');
    expect(result.includeDocumentIds).not.toContain('doc-override');
  });
});

/* ── Cross-workflow consistency ── */

describe('cross-workflow consistency', () => {
  it('same inputs produce same output regardless of mode', () => {
    const base = { docSets: sets, docSetItemsBySetId: itemsBySet };
    const trailer = resolveContextDocumentIds({ ...base, mode: 'trailer' });
    const storyboard = resolveContextDocumentIds({ ...base, mode: 'storyboard' });
    const analysis = resolveContextDocumentIds({ ...base, mode: 'analysis' });
    // All should resolve to default doc set with same docs
    expect(trailer.includeDocumentIds).toEqual(storyboard.includeDocumentIds);
    expect(storyboard.includeDocumentIds).toEqual(analysis.includeDocumentIds);
    expect(trailer.resolutionReason).toBe('doc_set_default');
  });

  it('explicit doc set selection is consistent across modes', () => {
    const base = { docSets: sets, docSetItemsBySetId: itemsBySet, explicitDocSetId: 'ds-alt' };
    const trailer = resolveContextDocumentIds({ ...base, mode: 'trailer' });
    const storyboard = resolveContextDocumentIds({ ...base, mode: 'storyboard' });
    const analysis = resolveContextDocumentIds({ ...base, mode: 'analysis' });
    expect(trailer.includeDocumentIds).toEqual(storyboard.includeDocumentIds);
    expect(storyboard.includeDocumentIds).toEqual(analysis.includeDocumentIds);
  });

  it('default doc set selection is deterministic via getDefaultDocSetId', () => {
    const r1 = getDefaultDocSetId(sets);
    const r2 = getDefaultDocSetId(sets);
    expect(r1).toBe(r2);
    expect(r1).toBe('ds-default');
  });

  it('item ordering is strictly by sort_order asc', () => {
    const items = [
      makeItem('ds-default', 'doc-z', 3),
      makeItem('ds-default', 'doc-a', 1),
      makeItem('ds-default', 'doc-m', 2),
    ];
    expect(getDocSetDocumentIds(items)).toEqual(['doc-a', 'doc-m', 'doc-z']);
  });
});
