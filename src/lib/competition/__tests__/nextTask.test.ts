/**
 * Next-Task Triggering — contract + invariant tests.
 *
 * Tests cover:
 * - promoted round advances successfully
 * - not_promoted round persists blocked progression
 * - round with no promotion decision persists blocked progression
 * - repeated trigger on already advanced round is idempotent
 * - downstream artifact/task reference is persisted for advanced rounds
 * - blocked outcome persists rationale
 * - invalid promotion/candidate/round/group mismatch handled
 * - eligibility dry-run returns correct state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ──
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockSingle = vi.fn();
const mockLimit = vi.fn();
const mockOrder = vi.fn();

function createChain() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  };
  return chain;
}

let mockTableData: Record<string, any> = {};
let insertCallLog: Array<{ table: string; data: any }> = [];

const mockFrom = vi.fn((table: string) => {
  const chain: any = {};
  const state: any = { filters: {}, table };

  chain.select = vi.fn((...args: any[]) => {
    state.op = 'select';
    return chain;
  });
  chain.insert = vi.fn((data: any) => {
    state.op = 'insert';
    state.insertData = data;
    insertCallLog.push({ table, data });
    return chain;
  });
  chain.update = vi.fn((data: any) => {
    state.op = 'update';
    return chain;
  });
  chain.delete = vi.fn(() => {
    state.op = 'delete';
    return chain;
  });
  chain.eq = vi.fn((col: string, val: any) => {
    state.filters[col] = val;
    return chain;
  });
  chain.in = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.single = vi.fn(() => {
    const key = `${table}:${JSON.stringify(state.filters)}`;
    if (state.op === 'insert') {
      const inserted = {
        id: `mock-${table}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...state.insertData,
        created_at: new Date().toISOString(),
      };
      return Promise.resolve({ data: inserted, error: null });
    }
    const result = mockTableData[key];
    if (result) return Promise.resolve({ data: result, error: null });
    return Promise.resolve({ data: null, error: { message: 'not found' } });
  });

  // For non-single queries (arrays)
  const resolveArray = () => {
    const key = `${table}:${JSON.stringify(state.filters)}`;
    const result = mockTableData[key];
    if (Array.isArray(result)) return Promise.resolve({ data: result, error: null });
    if (result) return Promise.resolve({ data: [result], error: null });
    return Promise.resolve({ data: [], error: null });
  };

  // Override: if no .single() called, resolve as array via then
  chain.then = (resolve: any) => resolveArray().then(resolve);

  return chain;
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
  type RoundProgression,
} from '../nextTaskService';

// ── Test Data ──
const GROUP_ID = 'group-1';
const ROUND_ID = 'round-1';
const CANDIDATE_ID = 'candidate-v1';
const PROMOTION_ID = 'promo-1';

function setMockData(key: string, data: any) {
  mockTableData[key] = data;
}

beforeEach(() => {
  mockTableData = {};
  insertCallLog = [];
  vi.clearAllMocks();
});

describe('evaluateNextTaskEligibility', () => {
  it('returns not eligible when round not found', async () => {
    // No mock data → round lookup fails
    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: 'nonexistent-round',
    });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('not found');
  });

  it('returns not eligible when no promotion exists', async () => {
    // Round exists but no promotion
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
      round_type: 'initial',
    });

    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('No promotion decision');
  });

  it('returns not eligible when promotion is not_promoted', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });
    setMockData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID,
      round_id: ROUND_ID,
      promotion_status: 'not_promoted',
      promoted_candidate_version_id: null,
      rationale: 'threshold not met',
    });

    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('not promoted');
  });

  it('returns eligible when promotion is promoted with valid candidate', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });
    setMockData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID,
      round_id: ROUND_ID,
      promotion_status: 'promoted',
      promoted_candidate_version_id: CANDIDATE_ID,
      rationale: 'passes all gates',
    });
    setMockData(`candidate_groups:{"id":"${GROUP_ID}"}`, {
      id: GROUP_ID,
      status: 'open',
    });

    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });
    expect(result.eligible).toBe(true);
    expect(result.promotion).toBeTruthy();
    expect(result.promotion!.promoted_candidate_version_id).toBe(CANDIDATE_ID);
  });

  it('returns already advanced if progression exists', async () => {
    setMockData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-1',
      round_id: ROUND_ID,
      group_id: GROUP_ID,
      progression_status: 'advanced',
      promoted_candidate_version_id: CANDIDATE_ID,
    });

    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });
    expect(result.alreadyAdvanced).toBeTruthy();
    expect(result.rationale).toContain('already recorded');
  });

  it('returns round-group mismatch as ineligible', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: 'different-group',
      status: 'active',
    });

    const result = await evaluateNextTaskEligibility({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });
    expect(result.eligible).toBe(false);
    expect(result.rationale).toContain('does not belong to group');
  });
});

describe('triggerNextTaskForRound', () => {
  it('persists blocked when no promotion exists', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('blocked');
    expect(result.next_task_type).toBe('none');
    expect(result.rationale).toBeTruthy();
    // Verify insert was called on round_progressions
    const progressionInserts = insertCallLog.filter(c => c.table === 'round_progressions');
    expect(progressionInserts.length).toBe(1);
    expect(progressionInserts[0].data.progression_status).toBe('blocked');
  });

  it('persists blocked when promotion is not_promoted', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });
    setMockData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID,
      round_id: ROUND_ID,
      promotion_status: 'not_promoted',
      promoted_candidate_version_id: null,
      rationale: 'score too low',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('blocked');
    expect(result.rationale).toContain('not promoted');
  });

  it('advances when promotion is valid, creates downstream selection', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });
    setMockData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID,
      round_id: ROUND_ID,
      promotion_status: 'promoted',
      promoted_candidate_version_id: CANDIDATE_ID,
      rationale: 'all gates passed',
      gating_snapshot_json: { policy: 'default_v1' },
    });
    setMockData(`candidate_groups:{"id":"${GROUP_ID}"}`, {
      id: GROUP_ID,
      status: 'ranked',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('advanced');
    expect(result.next_task_type).toBe('auto_promoted_selection');
    expect(result.next_task_ref_id).toBeTruthy();
    expect(result.promoted_candidate_version_id).toBe(CANDIDATE_ID);
    expect(result.source_promotion_id).toBe(PROMOTION_ID);

    // Verify downstream selection was created
    const selectionInserts = insertCallLog.filter(c => c.table === 'candidate_selections');
    expect(selectionInserts.length).toBe(1);
    expect(selectionInserts[0].data.selected_candidate_version_id).toBe(CANDIDATE_ID);

    // Verify group status updated
    const groupUpdates = insertCallLog.filter(c => c.table === 'round_progressions');
    expect(groupUpdates.length).toBe(1);
    expect(groupUpdates[0].data.progression_status).toBe('advanced');
  });

  it('returns already_advanced on repeat trigger without duplicate inserts', async () => {
    // Existing advanced progression
    setMockData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-existing',
      round_id: ROUND_ID,
      group_id: GROUP_ID,
      progression_status: 'advanced',
      promoted_candidate_version_id: CANDIDATE_ID,
      next_task_type: 'auto_promoted_selection',
      next_task_ref_id: 'sel-123',
      rationale: 'already done',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('already_advanced');
    // No new inserts should have been made
    const newInserts = insertCallLog.filter(c => c.table === 'round_progressions');
    expect(newInserts.length).toBe(0);
  });

  it('returns existing blocked if already blocked', async () => {
    setMockData(`round_progressions:{"round_id":"${ROUND_ID}"}`, {
      id: 'prog-blocked',
      round_id: ROUND_ID,
      group_id: GROUP_ID,
      progression_status: 'blocked',
      promoted_candidate_version_id: null,
      next_task_type: 'none',
      rationale: 'no promotion',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('blocked');
    expect(result.id).toBe('prog-blocked');
    // No new inserts
    expect(insertCallLog.length).toBe(0);
  });

  it('blocked outcome preserves rationale detail', async () => {
    setMockData(`competition_rounds:{"id":"${ROUND_ID}"}`, {
      id: ROUND_ID,
      group_id: GROUP_ID,
      status: 'active',
    });
    setMockData(`round_promotions:{"round_id":"${ROUND_ID}"}`, {
      id: PROMOTION_ID,
      promotion_status: 'not_promoted',
      promoted_candidate_version_id: null,
      rationale: 'Top candidate rank_score 25 below threshold 40',
    });

    const result = await triggerNextTaskForRound({
      groupId: GROUP_ID,
      roundId: ROUND_ID,
    });

    expect(result.progression_status).toBe('blocked');
    expect(result.rationale).toBeTruthy();
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
  it('returns empty array when no history exists', async () => {
    const result = await loadProgressionHistoryForGroup('nonexistent');
    expect(result).toEqual([]);
  });
});
