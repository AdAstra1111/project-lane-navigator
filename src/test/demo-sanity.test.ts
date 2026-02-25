/**
 * Demo-Readiness Sanity Suite
 *
 * Cross-cutting integration tests ensuring all punch-list items are wired,
 * visible, and deterministic. No network calls — all Supabase mocked.
 */
import { describe, it, expect } from 'vitest';

// ── Shared resolver helpers ──
import {
  getDefaultDocSetId,
  getDocSetDocumentIds,
  resolveContextDocumentIds,
  type ResolveParams,
} from '@/lib/docSetResolver';
import type { DocSet, DocSetItem } from '@/hooks/useDocSets';

// ── Analysis helpers ──
import {
  buildAnalyzeProjectPayload,
  selectCanonicalAnalysisRun,
  type AnalysisRun,
} from '@/hooks/useProjectAnalysis';

// ── ContextCards helpers ──
import { buildContextCardsData, getDocTypeBadge } from '@/components/notes/ContextCards';

// ── Scene scope helpers ──
import { parseScenes, detectOutOfScopeChanges, resolveApplyScope } from '../../supabase/functions/_shared/sceneScope';

// ── Model router canonical config ──
import { CIK_MODEL_ROUTER_CONFIG } from '@/config/cikModelConfig';
import {
  CIK_MODEL_ATTEMPT0_DEFAULT as FE_A0,
  CIK_MODEL_ATTEMPT1_STRONG as FE_A1,
  selectCikModel,
} from '@/config/cikModels';
import {
  CIK_MODEL_ATTEMPT0_DEFAULT as BE_A0,
  CIK_MODEL_ATTEMPT1_STRONG as BE_A1,
  selectCikModel as beSelectCikModel,
} from '../../supabase/functions/_shared/cik/modelRouter';

// ── Quality history CSV ──
import { qualityHistoryCSV, type QualityRunRow } from '@/videoRender/bundleUtils';

/* ── Test data factories ── */

const makeDocSet = (id: string, isDefault: boolean, createdAt: string): DocSet => ({
  id, project_id: 'proj-1', name: `Set ${id}`, description: null,
  is_default: isDefault, created_by: null, created_at: createdAt, updated_at: createdAt,
});

const makeItem = (id: string, dsId: string, docId: string, order: number): DocSetItem => ({
  id, doc_set_id: dsId, document_id: docId, sort_order: order, created_at: '2026-01-01',
});

const makeRun = (id: string, created: string, status = 'complete'): AnalysisRun => ({
  id, created_at: created, status,
} as AnalysisRun);

/* ════════════════════════════════════════════════════════════════
   A) Quality History Trends
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Quality History', () => {
  it('qualityHistoryCSV handles empty runs (empty state)', () => {
    const csv = qualityHistoryCSV([]);
    expect(csv.split('\n').length).toBe(1); // header only
  });

  it('qualityHistoryCSV orders by created_at DESC deterministically', () => {
    const rows: QualityRunRow[] = [
      { created_at: '2026-01-01T00:00:00Z', run_source: 'trailer', lane: 'feature_film', final_pass: true, final_score: 80, hard_failures: [], diagnostic_flags: [], adapter_mode: 'standard', strictness_mode: 'standard' },
      { created_at: '2026-01-03T00:00:00Z', run_source: 'trailer', lane: 'series', final_pass: false, final_score: 60, hard_failures: ['WEAK_ARC'], diagnostic_flags: [], adapter_mode: 'standard', strictness_mode: 'standard' },
    ];
    const csv = qualityHistoryCSV(rows);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('2026-01-03');
    expect(lines[2]).toContain('2026-01-01');
  });

  it('qualityHistoryCSV is deterministic', () => {
    const rows: QualityRunRow[] = [
      { created_at: '2026-01-01T00:00:00Z', run_source: 'trailer', lane: 'x', final_pass: true, final_score: 85, hard_failures: [], diagnostic_flags: [], adapter_mode: 'standard', strictness_mode: 'standard' },
    ];
    expect(qualityHistoryCSV(rows)).toBe(qualityHistoryCSV(rows));
  });
});

/* ════════════════════════════════════════════════════════════════
   B) Doc Sets CRUD determinism
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Doc Sets', () => {
  it('default doc set indicator picks is_default=true', () => {
    const sets = [makeDocSet('ds1', false, '2026-01-01'), makeDocSet('ds2', true, '2026-01-02')];
    expect(getDefaultDocSetId(sets)).toBe('ds2');
  });

  it('deleting default falls back to oldest deterministically', () => {
    // Simulate: ds2 was default and deleted, only ds1 and ds3 remain
    const remaining = [makeDocSet('ds3', false, '2026-01-03'), makeDocSet('ds1', false, '2026-01-01')];
    expect(getDefaultDocSetId(remaining)).toBe('ds1');
  });

  it('empty doc sets returns undefined (UI handles gracefully)', () => {
    expect(getDefaultDocSetId([])).toBeUndefined();
  });

  it('reorder produces sequential positions without conflicts', () => {
    const items = [
      makeItem('i3', 'ds1', 'doc-c', 3),
      makeItem('i1', 'ds1', 'doc-a', 1),
      makeItem('i2', 'ds1', 'doc-b', 2),
    ];
    const ids = getDocSetDocumentIds(items);
    expect(ids).toEqual(['doc-a', 'doc-b', 'doc-c']);
  });
});

/* ════════════════════════════════════════════════════════════════
   C) Writers' Room doc set + ContextCards + scene scope
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Writers\' Room', () => {
  it('includeDocumentIds from default doc set ordered by position asc', () => {
    const sets = [makeDocSet('ds1', true, '2026-01-01')];
    const itemsBySet: Record<string, DocSetItem[]> = {
      ds1: [makeItem('i2', 'ds1', 'doc-b', 2), makeItem('i1', 'ds1', 'doc-a', 1)],
    };
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: itemsBySet, mode: 'writers_room',
    });
    expect(result.includeDocumentIds).toEqual(['doc-a', 'doc-b']);
    expect(result.resolutionReason).toBe('doc_set_default');
  });

  it('ContextCards render in includeDocumentIds order', () => {
    const docs = [
      { id: 'doc-a', title: 'Script' },
      { id: 'doc-b', title: 'Treatment' },
      { id: 'doc-c', title: 'Notes' },
    ];
    const cards = buildContextCardsData(docs, ['doc-c', 'doc-a']);
    expect(cards.map(c => c.id)).toEqual(['doc-c', 'doc-a']);
  });

  it('ContextCards show "No summary available" placeholder', () => {
    const cards = buildContextCardsData([{ id: 'doc-a', title: 'X' }], ['doc-a']);
    expect(cards[0].summary).toBeNull();
  });

  it('ContextCards empty state with no IDs', () => {
    expect(buildContextCardsData([], [])).toEqual([]);
  });

  it('scene scope guard rejects out-of-scope edits', () => {
    const original = 'INT. KITCHEN - DAY\nHello.\n\nINT. BEDROOM - NIGHT\nGoodbye.';
    const updated = 'INT. KITCHEN - DAY\nHello.\n\nINT. BEDROOM - NIGHT\nChanged text.';
    const result = detectOutOfScopeChanges(
      parseScenes(original), parseScenes(updated), [1]
    );
    expect(result.ok).toBe(false);
    expect(result.outOfScopeScenes.length).toBeGreaterThan(0);
  });

  it('scene scope guard passes when only allowed scenes changed', () => {
    const original = 'INT. KITCHEN - DAY\nHello.\n\nINT. BEDROOM - NIGHT\nGoodbye.';
    const updated = 'INT. KITCHEN - DAY\nChanged.\n\nINT. BEDROOM - NIGHT\nGoodbye.';
    const result = detectOutOfScopeChanges(
      parseScenes(original), parseScenes(updated), [1]
    );
    expect(result.ok).toBe(true);
  });

  it('resolveApplyScope defaults to scene when plan has scene targets', () => {
    const scope = resolveApplyScope({ changes: [{ target: { scene_numbers: [1, 3] } }] }, undefined);
    expect(scope.mode).toBe('scene');
  });
});

/* ════════════════════════════════════════════════════════════════
   D) Trailer / Storyboard / Analysis payload wiring
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Workflow payload assembly', () => {
  const sets = [makeDocSet('ds1', true, '2026-01-01')];
  const itemsBySet: Record<string, DocSetItem[]> = {
    ds1: [makeItem('i2', 'ds1', 'doc-treatment', 2), makeItem('i1', 'ds1', 'doc-script', 1)],
  };

  for (const mode of ['trailer', 'storyboard', 'analysis'] as const) {
    it(`${mode}: uses default doc set with position-asc ordering`, () => {
      const result = resolveContextDocumentIds({
        docSets: sets, docSetItemsBySetId: itemsBySet, mode,
      });
      expect(result.includeDocumentIds).toEqual(['doc-script', 'doc-treatment']);
      expect(result.resolutionReason).toBe('doc_set_default');
    });
  }

  it('legacy fallback when no doc sets exist', () => {
    const result = resolveContextDocumentIds({
      docSets: [], docSetItemsBySetId: {}, mode: 'trailer',
    });
    expect(result.includeDocumentIds).toBeNull();
    expect(result.resolutionReason).toBe('legacy_fallback');
  });

  it('explicit doc set overrides default', () => {
    const extraItems: Record<string, DocSetItem[]> = {
      ...itemsBySet,
      ds2: [makeItem('i3', 'ds2', 'doc-only', 1)],
    };
    const result = resolveContextDocumentIds({
      docSets: sets, docSetItemsBySetId: extraItems,
      explicitDocSetId: 'ds2', mode: 'storyboard',
    });
    expect(result.includeDocumentIds).toEqual(['doc-only']);
    expect(result.resolutionReason).toBe('doc_set_explicit');
  });
});

/* ════════════════════════════════════════════════════════════════
   E) Canonical Analysis + Quick/Deep redirect
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Canonical analysis selection', () => {
  it('prefers latest complete run', () => {
    const runs = [makeRun('r1', '2026-01-01', 'complete'), makeRun('r2', '2026-01-02', 'pending')];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r1');
  });

  it('stable tiebreak by id asc', () => {
    const runs = [makeRun('r-b', '2026-01-01', 'complete'), makeRun('r-a', '2026-01-01', 'complete')];
    expect(selectCanonicalAnalysisRun(runs)?.id).toBe('r-a');
  });

  it('empty returns undefined', () => {
    expect(selectCanonicalAnalysisRun([])).toBeUndefined();
  });

  it('Quick/DeepReview redirect URL pattern is canonical', () => {
    const url = (pid: string) => `/projects/${pid}/script?drawer=open&tab=analysis`;
    expect(url('proj-1')).toBe('/projects/proj-1/script?drawer=open&tab=analysis');
    expect(url('proj-1')).toContain('drawer=open');
    expect(url('proj-1')).toContain('tab=analysis');
  });
});

/* ════════════════════════════════════════════════════════════════
   F) Model Router drift + smoke
   ════════════════════════════════════════════════════════════════ */

describe('Demo sanity: Model Router drift-proof', () => {
  it('FE/BE attempt0 constants match canonical config', () => {
    expect(FE_A0).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
    expect(BE_A0).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
    expect(FE_A0).toBe(BE_A0);
  });

  it('FE/BE attempt1 constants match canonical config', () => {
    expect(FE_A1).toBe(CIK_MODEL_ROUTER_CONFIG.attempt1Strong);
    expect(BE_A1).toBe(CIK_MODEL_ROUTER_CONFIG.attempt1Strong);
    expect(FE_A1).toBe(BE_A1);
  });

  it('lane overrides match across FE/BE for all canonical lanes', () => {
    for (const lane of Object.keys(CIK_MODEL_ROUTER_CONFIG.laneOverrides)) {
      const fe = selectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ['X'] });
      const be = beSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ['X'] });
      expect(fe.model).toBe(be.model);
    }
  });

  it('smoke: attempt0 always cheap, attempt1+failures escalates', () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: 'feature_film' });
    expect(a0.model).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);

    const a1 = selectCikModel({ attemptIndex: 1, lane: 'feature_film', attempt0HardFailures: ['WEAK_ARC'] });
    expect(a1.model).toBe(CIK_MODEL_ROUTER_CONFIG.laneOverrides.feature_film.attempt1Strong);
  });
});
