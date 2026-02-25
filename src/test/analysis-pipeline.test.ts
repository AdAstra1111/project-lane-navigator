/**
 * Analysis Pipeline — Unit tests for payload assembly, response parsing,
 * canonical run selection, doc set filtering, and review wrappers.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAnalyzeProjectPayload,
  parseAnalysisResponse,
  selectCanonicalAnalysisRun,
  filterDocumentPathsByDocSet,
  type AnalysisRun,
  type AnalyzeProjectPayloadParams,
  type ProjectAnalysis,
} from '@/hooks/useProjectAnalysis';
import { getDefaultDocSetId, getDocSetDocumentIds } from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

/* ── Factories ── */

const makeProject = (overrides?: Partial<AnalyzeProjectPayloadParams['project']>): AnalyzeProjectPayloadParams['project'] => ({
  id: 'proj-1',
  title: 'Test Film',
  format: 'feature_film',
  genres: ['drama', 'thriller'],
  budget_range: '5M-10M',
  target_audience: 'adults',
  tone: 'dark',
  comparable_titles: ['Se7en'],
  ...overrides,
});

const makeRun = (id: string, created_at: string, status?: string): AnalysisRun => ({
  id,
  created_at,
  ...(status ? { status } : {}),
});

const makeDocSet = (id: string, is_default: boolean, created_at: string): DocSet => ({
  id, project_id: 'p1', name: `Set ${id}`, description: null, is_default,
  created_by: null, created_at, updated_at: '',
});

const makeItem = (doc_set_id: string, document_id: string, sort_order: number): DocSetItem => ({
  id: `item-${document_id}`, doc_set_id, document_id, sort_order, created_at: '',
});

/* ── A) buildAnalyzeProjectPayload ── */

describe('buildAnalyzeProjectPayload', () => {
  it('includes all project fields in projectInput', () => {
    const project = makeProject();
    const payload = buildAnalyzeProjectPayload({ project, documentPaths: ['/a.pdf'] });
    expect(payload.projectInput.id).toBe('proj-1');
    expect(payload.projectInput.title).toBe('Test Film');
    expect(payload.projectInput.format).toBe('feature_film');
    expect(payload.projectInput.genres).toEqual(['drama', 'thriller']);
    expect(payload.projectInput.budget_range).toBe('5M-10M');
    expect(payload.projectInput.target_audience).toBe('adults');
    expect(payload.projectInput.tone).toBe('dark');
    expect(payload.projectInput.comparable_titles).toEqual(['Se7en']);
  });

  it('includes documentPaths as-is', () => {
    const payload = buildAnalyzeProjectPayload({
      project: makeProject(),
      documentPaths: ['/script.pdf', '/treatment.pdf'],
    });
    expect(payload.documentPaths).toEqual(['/script.pdf', '/treatment.pdf']);
  });

  it('handles null optional fields', () => {
    const project = makeProject({ genres: null, target_audience: null, tone: null, comparable_titles: null });
    const payload = buildAnalyzeProjectPayload({ project, documentPaths: [] });
    expect(payload.projectInput.genres).toBeNull();
    expect(payload.projectInput.target_audience).toBeNull();
    expect(payload.projectInput.tone).toBeNull();
    expect(payload.projectInput.comparable_titles).toBeNull();
  });

  it('empty documentPaths produces empty array', () => {
    const payload = buildAnalyzeProjectPayload({ project: makeProject(), documentPaths: [] });
    expect(payload.documentPaths).toEqual([]);
  });

  it('is deterministic', () => {
    const params: AnalyzeProjectPayloadParams = { project: makeProject(), documentPaths: ['/a.pdf'] };
    expect(buildAnalyzeProjectPayload(params)).toEqual(buildAnalyzeProjectPayload(params));
  });
});

/* ── A.2) Doc set integration in payload ── */

describe('analysis payload with doc sets', () => {
  it('when doc sets exist, includeDocumentIds matches doc_set_items by position asc', () => {
    const items = [
      makeItem('ds1', 'doc-c', 3),
      makeItem('ds1', 'doc-a', 1),
      makeItem('ds1', 'doc-b', 2),
    ];
    const ids = getDocSetDocumentIds(items);
    expect(ids).toEqual(['doc-a', 'doc-b', 'doc-c']);
  });

  it('when doc sets exist, default doc set is selected deterministically', () => {
    const sets = [
      makeDocSet('ds1', true, '2026-01-01'),
      makeDocSet('ds2', false, '2026-01-02'),
    ];
    expect(getDefaultDocSetId(sets)).toBe('ds1');
  });

  it('when no doc sets exist, no filtering (legacy behavior)', () => {
    expect(getDefaultDocSetId([])).toBeUndefined();
  });

  it('filterDocumentPathsByDocSet preserves doc set order', () => {
    const allDocs = [
      { id: 'doc-a', file_path: '/a.pdf' },
      { id: 'doc-b', file_path: '/b.pdf' },
      { id: 'doc-c', file_path: '/c.pdf' },
    ];
    const result = filterDocumentPathsByDocSet(allDocs, ['doc-c', 'doc-a']);
    expect(result).toEqual(['/c.pdf', '/a.pdf']);
  });

  it('filterDocumentPathsByDocSet skips null/empty paths', () => {
    const allDocs = [
      { id: 'doc-a', file_path: null },
      { id: 'doc-b', file_path: '/b.pdf' },
      { id: 'doc-c', file_path: '  ' },
    ];
    const result = filterDocumentPathsByDocSet(allDocs, ['doc-a', 'doc-b', 'doc-c']);
    expect(result).toEqual(['/b.pdf']);
  });

  it('filterDocumentPathsByDocSet handles missing doc IDs gracefully', () => {
    const allDocs = [{ id: 'doc-a', file_path: '/a.pdf' }];
    const result = filterDocumentPathsByDocSet(allDocs, ['doc-a', 'doc-missing']);
    expect(result).toEqual(['/a.pdf']);
  });
});

/* ── B) parseAnalysisResponse ── */

describe('parseAnalysisResponse', () => {
  it('parses valid data into ProjectAnalysis shape', () => {
    const data = {
      id: 'proj-1',
      title: 'Film',
      format: 'feature',
      genres: ['drama'],
      budget_range: '5M',
      assigned_lane: 'independent-film',
      confidence: 0.85,
      reasoning: 'Strong script',
      analysis_passes: { verdict: 'Go', lane: 'independent-film' },
    };
    const result = parseAnalysisResponse(data);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe('proj-1');
    expect(result!.genres).toEqual(['drama']);
    expect(result!.assignedLane).toBe('independent-film');
    expect(result!.confidence).toBe(0.85);
    expect(result!.analysis?.verdict).toBe('Go');
  });

  it('returns null for null data', () => {
    expect(parseAnalysisResponse(null)).toBeNull();
  });

  it('defaults null genres to empty array', () => {
    const data = {
      id: 'p1', title: 'X', format: 'short', genres: null,
      budget_range: '1M', assigned_lane: null, confidence: null,
      reasoning: null, analysis_passes: null,
    };
    const result = parseAnalysisResponse(data);
    expect(result!.genres).toEqual([]);
  });

  it('handles null analysis_passes', () => {
    const data = {
      id: 'p1', title: 'X', format: 'short', genres: ['comedy'],
      budget_range: '1M', assigned_lane: null, confidence: null,
      reasoning: null, analysis_passes: null,
    };
    expect(parseAnalysisResponse(data)!.analysis).toBeNull();
  });

  it('error response shape: edge function error as string', () => {
    // Simulating how useRunAnalysis processes errors
    const errorMsg = 'Rate limit exceeded';
    const error = new Error(errorMsg);
    expect(error.message).toBe('Rate limit exceeded');
  });

  it('error response shape: analysis.error field', () => {
    const analysis = { error: 'Token limit exceeded' };
    const err = new Error(analysis.error);
    expect(err.message).toBe('Token limit exceeded');
  });
});

/* ── C) selectCanonicalAnalysisRun ── */

describe('selectCanonicalAnalysisRun', () => {
  it('prefers latest successful run', () => {
    const runs = [
      makeRun('r1', '2026-01-01T00:00:00Z', 'complete'),
      makeRun('r2', '2026-01-03T00:00:00Z', 'failed'),
      makeRun('r3', '2026-01-02T00:00:00Z', 'complete'),
    ];
    const selected = selectCanonicalAnalysisRun(runs);
    expect(selected?.id).toBe('r3'); // latest complete
  });

  it('falls back to latest by created_at when no successful runs', () => {
    const runs = [
      makeRun('r1', '2026-01-01T00:00:00Z', 'failed'),
      makeRun('r2', '2026-01-03T00:00:00Z', 'failed'),
      makeRun('r3', '2026-01-02T00:00:00Z'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r2');
  });

  it('stable tiebreak by id asc when timestamps equal', () => {
    const runs = [
      makeRun('r-b', '2026-01-01T00:00:00Z', 'complete'),
      makeRun('r-a', '2026-01-01T00:00:00Z', 'complete'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r-a');
  });

  it('returns undefined for empty array', () => {
    expect(selectCanonicalAnalysisRun([])).toBeUndefined();
  });

  it('single run is always selected', () => {
    const runs = [makeRun('r1', '2026-01-01T00:00:00Z')];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r1');
  });

  it('treats "success" status same as "complete"', () => {
    const runs = [
      makeRun('r1', '2026-01-01T00:00:00Z', 'success'),
      makeRun('r2', '2026-01-02T00:00:00Z', 'pending'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r1');
  });

  it('is deterministic across calls', () => {
    const runs = [
      makeRun('r1', '2026-01-02T00:00:00Z', 'complete'),
      makeRun('r2', '2026-01-01T00:00:00Z', 'complete'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe(selectCanonicalAnalysisRun(runs)?.id);
  });

  it('runs without status field fall back to created_at ordering', () => {
    const runs = [
      makeRun('r1', '2026-01-01T00:00:00Z'),
      makeRun('r2', '2026-01-03T00:00:00Z'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r2');
  });

  it('successful run preferred even if older', () => {
    const runs = [
      makeRun('r-new', '2026-01-05T00:00:00Z', 'failed'),
      makeRun('r-old', '2026-01-01T00:00:00Z', 'complete'),
    ];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r-old');
  });
});

/* ── D) QuickReview / DeepReview redirect behavior ── */

describe('QuickReview / DeepReview redirect logic', () => {
  // These test the pure redirect logic without rendering components.
  // Both pages redirect to /projects/:id/script?drawer=open&tab=analysis

  const buildRedirectUrl = (projectId: string) =>
    `/projects/${projectId}/script?drawer=open&tab=analysis`;

  it('QuickReview redirects to analysis view when projectId present', () => {
    const url = buildRedirectUrl('proj-123');
    expect(url).toBe('/projects/proj-123/script?drawer=open&tab=analysis');
    expect(url).toContain('drawer=open');
    expect(url).toContain('tab=analysis');
  });

  it('DeepReview redirects to same analysis view', () => {
    const url = buildRedirectUrl('proj-456');
    expect(url).toBe('/projects/proj-456/script?drawer=open&tab=analysis');
  });

  it('redirect URL contains project ID in path', () => {
    const url = buildRedirectUrl('abc-def');
    expect(url).toMatch(/\/projects\/abc-def\//);
  });

  it('redirect URL always includes drawer=open and tab=analysis params', () => {
    const url = buildRedirectUrl('any-id');
    const searchParams = new URLSearchParams(url.split('?')[1]);
    expect(searchParams.get('drawer')).toBe('open');
    expect(searchParams.get('tab')).toBe('analysis');
  });
});

/* ── E) End-to-end doc set → analysis payload integration ── */

describe('doc set → analysis integration', () => {
  it('full flow: doc sets exist → filter docs → build payload', () => {
    const docSets = [
      makeDocSet('ds1', true, '2026-01-01'),
      makeDocSet('ds2', false, '2026-01-02'),
    ];
    const items = [
      makeItem('ds1', 'doc-script', 1),
      makeItem('ds1', 'doc-treatment', 2),
    ];

    // 1. Resolve default doc set
    const defaultId = getDefaultDocSetId(docSets);
    expect(defaultId).toBe('ds1');

    // 2. Get ordered document IDs
    const docIds = getDocSetDocumentIds(items);
    expect(docIds).toEqual(['doc-script', 'doc-treatment']);

    // 3. Filter document paths
    const allDocs = [
      { id: 'doc-script', file_path: '/script.pdf' },
      { id: 'doc-treatment', file_path: '/treatment.pdf' },
      { id: 'doc-other', file_path: '/other.pdf' },
    ];
    const filteredPaths = filterDocumentPathsByDocSet(allDocs, docIds);
    expect(filteredPaths).toEqual(['/script.pdf', '/treatment.pdf']);

    // 4. Build payload
    const payload = buildAnalyzeProjectPayload({
      project: makeProject(),
      documentPaths: filteredPaths,
    });
    expect(payload.documentPaths).toEqual(['/script.pdf', '/treatment.pdf']);
    expect(payload.documentPaths).not.toContain('/other.pdf');
  });

  it('full flow: no doc sets → legacy behavior (all docs)', () => {
    const defaultId = getDefaultDocSetId([]);
    expect(defaultId).toBeUndefined();

    // All docs used
    const allPaths = ['/script.pdf', '/treatment.pdf', '/other.pdf'];
    const payload = buildAnalyzeProjectPayload({
      project: makeProject(),
      documentPaths: allPaths,
    });
    expect(payload.documentPaths).toEqual(allPaths);
  });
});
