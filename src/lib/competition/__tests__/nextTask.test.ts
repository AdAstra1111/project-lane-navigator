/**
 * Next-Task Triggering — contract + invariant tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ──
const { mockTableData, insertCallLog, mockFrom } = vi.hoisted(() => {
  const mockTableData: Record<string, any> = {};
  const insertCallLog: Array<{ table: string; data: any }> = [];

  const mockFrom = vi.fn((table: string) => {
    const state: any = { filters: {}, table, op: 'select' };
    const chain: any = {};

    chain.select = vi.fn((..._args: any[]) => { if (state.op !== 'insert') state.op = 'select'; return chain; });
    chain.insert = vi.fn((data: any) => {
      state.op = 'insert';
      state.insertData = data;
      insertCallLog.push({ table, data });
      return chain;
    });
    chain.update = vi.fn(() => { state.op = 'update'; return chain; });
    chain.delete = vi.fn(() => { state.op = 'delete'; return chain; });
    chain.eq = vi.fn((col: string, val: any) => { if (state.op !== 'insert') state.filters[col] = val; return chain; });
    chain.in = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.single = vi.fn(() => {
      const key = `${table}:${JSON.stringify(state.filters)}`;
      if (state.op === 'insert') {
        const inserted = {
          id: `mock-${table}-${Math.random().toString(36).slice(2, 8)}`,
          ...state.insertData,
          created_at: new Date().toISOString(),
        };
        return Promise.resolve({ data: inserted, error: null });
      }
      const result = mockTableData[key];
      if (result) return Promise.resolve({ data: result, error: null });
      return Promise.resolve({ data: null, error: { message: 'not found' } });
    });
    chain.then = (resolve: any) => {
      const key = `${table}:${JSON.stringify(state.filters)}`;
      const result = mockTableData[key];
      if (Array.isArray(result)) return Promise.resolve({ data: result, error: null }).then(resolve);
      if (result) return Promise.resolve({ data: [result], error: null }).then(resolve);
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return chain;
  });

  return { mockTableData, insertCallLog, mockFrom };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user' } } }) },
  },
}));

// ── Import after mock ──
import {
  evaluateNextTaskEligibility,
  triggerNextTaskForRound,
  loadProgressionForRound,
  loadProgressionHistoryForGroup,
} from '../nextTaskService';

// ── Constants ──
const GROUP_ID = 'group-1';
const ROUND_ID = 'round-1';
const CANDIDATE_ID = 'candidate-v1';
const PROMOTION_ID = 'promo-1';

function setData(key: string, data: any) {
  mockTableData[key] = data;
}

function clearData() {
  Object.keys(mockTableData).forEach(k => delete mockTableData[k]);
  insertCallLog.length = 0;
}

beforeEach(() => {
  clearData();
  vi.clearAllMocks();
});

describe('evaluateNextTaskEligibility', () => {
  it('returns not eligible when round not found', async () => {
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: 'bad' });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('not found');
  });

  it('returns not eligible when no promotion exists', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('No promotion decision');
  });

  it('returns not eligible when promotion is not_promoted', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, round_id: ROUND_ID, promotion_status: 'not_promoted',
      promoted_candidate_version_id: null, rationale: 'threshold not met',
    });
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('not promoted');
  });

  it('returns eligible when promotion is promoted', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, round_id: ROUND_ID, promotion_status: 'promoted',
      promoted_candidate_version_id: CANDIDATE_ID, rationale: 'all gates passed',
    });
    setData(`candidate_groups:{"id":"${GROUP_ID}"}`, { id: GROUP_ID, status: 'open' });
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.eligible).toBe(true);
    expect(result.promotion!.promoted_candidate_version_id).toBe(CANDIDATE_ID);
  });

  it('returns already advanced if progression exists', async () => {
    setData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-1', round_id: ROUND_ID, group_id: GROUP_ID,
      progression_status: 'advanced', promoted_candidate_version_id: CANDIDATE_ID,
    });
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.alreadyAdvanced).toBeTruthy();
  });

  it('returns round-group mismatch as ineligible', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: 'other-group', status: 'active' });
    const result = await evaluateNextTaskEligibility({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('does not belong');
  });
});

describe('triggerNextTaskForRound', () => {
  it('persists blocked when no promotion exists', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.progression_status).toBe('blocked');
    expect(result.next_task_type).toBe('none');
    const pInserts = insertCallLog.filter(c => c.table === 'round_progressions');
    expect(pInserts.length).toBe(1);
    expect(pInserts[0].data.progression_status).toBe('blocked');
  });

  it('persists blocked when promotion is not_promoted', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, promotion_status: 'not_promoted',
      promoted_candidate_version_id: null, rationale: 'score too low',
    });
    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.progression_status).toBe('blocked');
  });

  it('advances when promotion is valid and creates downstream selection', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, round_id: ROUND_ID, promotion_status: 'promoted',
      promoted_candidate_version_id: CANDIDATE_ID, rationale: 'all gates passed',
      gating_snapshot_json: { policy: 'default_v1' },
    });
    setData(`candidate_groups:{"id":"${GROUP_ID}"}`, { id: GROUP_ID, status: 'ranked' });

    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.progression_status).toBe('advanced');
    expect(result.next_task_type).toBe('auto_promoted_selection');
    expect(result.next_task_ref_id).toBeTruthy();
    expect(result.promoted_candidate_version_id).toBe(CANDIDATE_ID);
    expect(result.source_promotion_id).toBe(PROMOTION_ID);

    const selInserts = insertCallLog.filter(c => c.table === 'candidate_selections');
    expect(selInserts.length).toBe(1);
    expect(selInserts[0].data.selected_candidate_version_id).toBe(CANDIDATE_ID);
    expect(selInserts[0].data.selection_mode).toBe('auto_promoted');
  });

  it('creates exactly one auto_promoted selection per advancement', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, round_id: ROUND_ID, promotion_status: 'promoted',
      promoted_candidate_version_id: CANDIDATE_ID, rationale: 'all gates passed',
      gating_snapshot_json: { policy: 'default_v1' },
    });
    setData(`candidate_groups:{"id":"${GROUP_ID}"}`, { id: GROUP_ID, status: 'ranked' });

    await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    const selInserts = insertCallLog.filter(c => c.table === 'candidate_selections');
    expect(selInserts.length).toBe(1);
    expect(selInserts[0].data.selection_mode).toBe('auto_promoted');
    expect(selInserts[0].data.round_id).toBe(ROUND_ID);
  });

  it('returns already_advanced on repeat trigger without duplicate inserts', async () => {
    setData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-existing', round_id: ROUND_ID, group_id: GROUP_ID,
      progression_status: 'advanced', promoted_candidate_version_id: CANDIDATE_ID,
      next_task_type: 'auto_promoted_selection', next_task_ref_id: 'sel-123',
    });
    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.progression_status).toBe('already_advanced');
    expect(insertCallLog.filter(c => c.table === 'round_progressions').length).toBe(0);
  });

  it('returns existing blocked if already blocked (normalized to blocked)', async () => {
    setData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-blocked', round_id: ROUND_ID, group_id: GROUP_ID,
      progression_status: 'blocked', promoted_candidate_version_id: null,
      next_task_type: 'none', rationale: 'no promotion',
    });
    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    // Contract: already-blocked normalizes to 'blocked', not 'already_blocked'
    expect(result.progression_status).toBe('blocked');
    expect(result.id).toBe('prog-blocked');
    expect(insertCallLog.length).toBe(0);
    // Verify no 'already_blocked' status leaks
    expect(result.progression_status).not.toBe('already_blocked');
  });

  it('does not create duplicate selections on repeat trigger', async () => {
    setData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-existing', round_id: ROUND_ID, group_id: GROUP_ID,
      progression_status: 'advanced', promoted_candidate_version_id: CANDIDATE_ID,
      next_task_type: 'auto_promoted_selection', next_task_ref_id: 'sel-123',
    });
    await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    const selInserts = insertCallLog.filter(c => c.table === 'candidate_selections');
    expect(selInserts.length).toBe(0);
  });

  it('blocked outcome preserves rationale in snapshot', async () => {
    setData(`competition_rounds:{"id":"${ROUND_ID}"}`, { id: ROUND_ID, group_id: GROUP_ID, status: 'active' });
    setData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID, promotion_status: 'not_promoted',
      promoted_candidate_version_id: null, rationale: 'rank_score 25 below threshold 40',
    });
    const result = await triggerNextTaskForRound({ groupId: GROUP_ID, roundId: ROUND_ID });
    expect(result.progression_status).toBe('blocked');
    const snapshot = result.progression_snapshot_json as any;
    expect(snapshot.promotion_status).toBe('not_promoted');
  });
});

describe('loadProgressionForRound', () => {
  it('returns null when no progression exists', async () => {
    const result = await loadProgressionForRound('nonexistent');
    expect(result).toBeNull();
  });
});

describe('loadProgressionHistoryForGroup', () => {
  it('returns empty array when no history', async () => {
    const result = await loadProgressionHistoryForGroup('nonexistent');
    expect(result).toEqual([]);
  });
});
