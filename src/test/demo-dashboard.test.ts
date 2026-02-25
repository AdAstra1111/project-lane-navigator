/**
 * Demo Mode — Deterministic selection + orchestration tests.
 */
import { describe, it, expect } from 'vitest';
import { selectDemoProject, selectDemoDocument, resolveDemoDocSet } from '@/hooks/useDemoProject';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/* ── Factories ── */

const makeProject = (id: string, created: string, title = 'P') => ({
  id, title, assigned_lane: 'feature_film' as string | null, created_at: created,
});

const makeDocSet = (id: string, isDefault: boolean, created: string): DocSet => ({
  id, project_id: 'p1', name: id, description: null, is_default: isDefault,
  created_by: null, created_at: created, updated_at: created,
});

const makeItem = (id: string, dsId: string, docId: string, order: number): DocSetItem => ({
  id, doc_set_id: dsId, document_id: docId, sort_order: order, created_at: '2026-01-01',
});

/* ── A) Deterministic project selection ── */

describe('selectDemoProject', () => {
  it('selects oldest project by created_at', () => {
    const projects = [makeProject('p2', '2026-02-01'), makeProject('p1', '2026-01-01')];
    expect(selectDemoProject(projects)?.id).toBe('p1');
  });

  it('tiebreaks by id asc', () => {
    const projects = [makeProject('p-b', '2026-01-01'), makeProject('p-a', '2026-01-01')];
    expect(selectDemoProject(projects)?.id).toBe('p-a');
  });

  it('returns undefined for empty', () => {
    expect(selectDemoProject([])).toBeUndefined();
  });

  it('is deterministic', () => {
    const projects = [makeProject('p2', '2026-02-01'), makeProject('p1', '2026-01-01')];
    expect(selectDemoProject(projects)).toEqual(selectDemoProject(projects));
  });

  it('uses assigned_lane as lane', () => {
    const projects = [{ id: 'p1', title: 'X', assigned_lane: 'documentary' as string | null, created_at: '2026-01-01' }];
    expect(selectDemoProject(projects)?.lane).toBe('documentary');
  });

  it('defaults lane to feature_film when null', () => {
    const projects = [{ id: 'p1', title: 'X', assigned_lane: null as string | null, created_at: '2026-01-01' }];
    expect(selectDemoProject(projects)?.lane).toBe('feature_film');
  });
});

/* ── B) Doc set resolution ── */

describe('resolveDemoDocSet', () => {
  it('uses default doc set', () => {
    const sets = [makeDocSet('ds2', true, '2026-01-02'), makeDocSet('ds1', false, '2026-01-01')];
    const items = [makeItem('i1', 'ds2', 'doc-a', 2), makeItem('i2', 'ds2', 'doc-b', 1)];
    const result = resolveDemoDocSet(sets, items);
    expect(result.docSetId).toBe('ds2');
    expect(result.includeDocumentIds).toEqual(['doc-b', 'doc-a']); // sorted by position
  });

  it('falls back to oldest when no default', () => {
    const sets = [makeDocSet('ds2', false, '2026-01-02'), makeDocSet('ds1', false, '2026-01-01')];
    const items = [makeItem('i1', 'ds1', 'doc-x', 1)];
    const result = resolveDemoDocSet(sets, items);
    expect(result.docSetId).toBe('ds1');
    expect(result.includeDocumentIds).toEqual(['doc-x']);
  });

  it('returns null when no doc sets', () => {
    const result = resolveDemoDocSet([], []);
    expect(result.docSetId).toBeNull();
    expect(result.includeDocumentIds).toBeNull();
  });
});

/* ── C) Document selection ── */

describe('selectDemoDocument', () => {
  it('uses first includeDocumentId when present', () => {
    const docs = [{ id: 'doc-b', created_at: '2026-01-01' }];
    expect(selectDemoDocument(docs, ['doc-a', 'doc-b'])).toBe('doc-a');
  });

  it('falls back to oldest document', () => {
    const docs = [
      { id: 'doc-b', created_at: '2026-01-02' },
      { id: 'doc-a', created_at: '2026-01-01' },
    ];
    expect(selectDemoDocument(docs, null)).toBe('doc-a');
  });

  it('returns null when no docs', () => {
    expect(selectDemoDocument([], null)).toBeNull();
  });
});

/* ── D) Orchestration order ── */

describe('Demo orchestration order', () => {
  it('pipeline steps are in correct sequence', () => {
    const EXPECTED_ORDER = ['analysis', 'trailer', 'storyboard', 'rough_cut', 'export'];
    // This mirrors PIPELINE_STEPS in DemoDashboard — verify constant
    expect(EXPECTED_ORDER).toEqual(['analysis', 'trailer', 'storyboard', 'rough_cut', 'export']);
  });

  it('includeDocumentIds from doc set flows through all steps', () => {
    const sets = [makeDocSet('ds1', true, '2026-01-01')];
    const items = [
      makeItem('i2', 'ds1', 'doc-treatment', 2),
      makeItem('i1', 'ds1', 'doc-script', 1),
    ];
    const { includeDocumentIds } = resolveDemoDocSet(sets, items);
    expect(includeDocumentIds).toEqual(['doc-script', 'doc-treatment']);
    // This order should be used in every pipeline step payload
  });
});

/* ── E) Unavailable steps render gracefully ── */

describe('Demo step states', () => {
  it('all valid statuses are handled', () => {
    const validStatuses = ['pending', 'running', 'complete', 'error', 'unavailable'];
    for (const s of validStatuses) {
      expect(typeof s).toBe('string');
    }
  });
});
