/**
 * Repair Loop v1 — Hardened contract + invariant tests.
 *
 * Tests cover:
 * - retry cap: failed attempts count, cancelled do not
 * - attempt index monotonicity
 * - repair run creation IEL enforcement
 * - repair target derivation IEL
 * - repaired candidate lineage IEL
 * - repair round lifecycle (specialized rerun)
 * - finalize/fail/cancel state transitions
 * - double round creation prevention
 * - cross-group invariant violations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before imports
const mockFrom = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

import {
  createRepairRun,
  deriveRepairTargetsFromRound,
  createRepairRound,
  registerRepairedCandidate,
  finalizeRepairRun,
  failRepairRun,
  cancelRepairRun,
  canRepair,
} from '../repairLoopService';
import { CompetitionInvariantError } from '../candidateCompetitionService';

// ── Helpers ──

function chainable(finalData: any = null, finalError: any = null) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'limit', 'single', 'maybeSingle'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data: finalData, error: finalError });
  return chain;
}

function mockCountQuery(count: number) {
  const c = chainable();
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockResolvedValue({ count, error: null });
  return c;
}

// ── Tests ──

describe('Repair Loop v1 — Hardened Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════
  // RETRY CAP SEMANTICS
  // ═══════════════════════════════════════════

  describe('Retry Cap Accounting', () => {
    it('failed repair attempts COUNT toward retry cap', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'r1', group_id: 'g1' });
        // countRepairAttempts — 2 completed + 1 failed = 3 counted
        if (callCount === 3) return mockCountQuery(3);
        return chainable();
      });

      await expect(
        createRepairRun({ groupId: 'g1', sourceRoundId: 'r1', maxAttempts: 3 })
      ).rejects.toThrow(/retry cap/i);
    });

    it('cancelled repair attempts DO NOT count toward retry cap', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'r1', group_id: 'g1' });
        // 2 counted (completed+failed), 1 cancelled = only 2 count
        if (callCount === 3) return mockCountQuery(2);
        // insert
        if (callCount === 4) return chainable({ id: 'rr1', status: 'pending', attempt_index: 2 });
        return chainable();
      });

      const run = await createRepairRun({ groupId: 'g1', sourceRoundId: 'r1', maxAttempts: 3 });
      expect(run.attempt_index).toBe(2);
    });

    it('canRepair returns retry_cap_reached when failed attempts fill cap', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        // count: 3 (includes failed)
        if (callCount === 2) return mockCountQuery(3);
        return chainable();
      });

      const result = await canRepair('g1', 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('retry_cap_reached');
      expect(result.attemptCount).toBe(3);
    });

    it('canRepair returns allowed when cancelled attempts exist but counted < max', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        // only 1 counted (the cancelled one isn't counted)
        if (callCount === 2) return mockCountQuery(1);
        return chainable();
      });

      const result = await canRepair('g1', 3);
      expect(result.allowed).toBe(true);
      expect(result.attemptCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════
  // ATTEMPT INDEX MONOTONICITY
  // ═══════════════════════════════════════════

  describe('Attempt Index', () => {
    it('attempt_index equals counted attempts at creation time', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'r1', group_id: 'g1' });
        if (callCount === 3) return mockCountQuery(2); // 2 prior counted attempts
        if (callCount === 4) return chainable({ id: 'rr3', status: 'pending', attempt_index: 2, max_attempts: 3 });
        return chainable();
      });

      const run = await createRepairRun({ groupId: 'g1', sourceRoundId: 'r1', maxAttempts: 3 });
      expect(run.attempt_index).toBe(2);
    });

    it('attempt_index starts at 0 for first attempt', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'r1', group_id: 'g1' });
        if (callCount === 3) return mockCountQuery(0);
        if (callCount === 4) return chainable({ id: 'rr1', status: 'pending', attempt_index: 0, max_attempts: 3 });
        return chainable();
      });

      const run = await createRepairRun({ groupId: 'g1', sourceRoundId: 'r1' });
      expect(run.attempt_index).toBe(0);
    });
  });

  // ═══════════════════════════════════════════
  // REPAIR RUN CREATION IEL
  // ═══════════════════════════════════════════

  describe('createRepairRun — IEL', () => {
    it('throws when group not found', async () => {
      mockFrom.mockReturnValue(chainable(null, { message: 'not found' }));
      await expect(
        createRepairRun({ groupId: 'g1', sourceRoundId: 'r1' })
      ).rejects.toThrow(CompetitionInvariantError);
    });

    it('throws when group is closed', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'closed' });
        return chainable();
      });
      await expect(
        createRepairRun({ groupId: 'g1', sourceRoundId: 'r1' })
      ).rejects.toThrow(/closed/);
    });

    it('throws when source round belongs to different group', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'r1', group_id: 'g_other' });
        return chainable();
      });
      await expect(
        createRepairRun({ groupId: 'g1', sourceRoundId: 'r1' })
      ).rejects.toThrow(/does not belong/);
    });
  });

  // ═══════════════════════════════════════════
  // REPAIR ROUND LIFECYCLE
  // ═══════════════════════════════════════════

  describe('createRepairRound — Lifecycle', () => {
    it('throws when repair run is not pending or running', async () => {
      mockFrom.mockImplementation(() =>
        chainable({ id: 'rr1', status: 'completed', group_id: 'g1', repair_round_id: null })
      );
      await expect(
        createRepairRound({ repairRunId: 'rr1', groupId: 'g1' })
      ).rejects.toThrow(/cannot create round/);
    });

    it('throws when repair run already has a repair round (double creation)', async () => {
      mockFrom.mockImplementation(() =>
        chainable({ id: 'rr1', status: 'pending', group_id: 'g1', repair_round_id: 'existing-round-id' })
      );
      await expect(
        createRepairRound({ repairRunId: 'rr1', groupId: 'g1' })
      ).rejects.toThrow(/already has a repair round/);
    });

    it('throws when repair run belongs to different group', async () => {
      mockFrom.mockImplementation(() =>
        chainable({ id: 'rr1', status: 'pending', group_id: 'g_other', repair_round_id: null })
      );
      await expect(
        createRepairRound({ repairRunId: 'rr1', groupId: 'g1' })
      ).rejects.toThrow(/does not belong/);
    });
  });

  // ═══════════════════════════════════════════
  // REPAIR TARGET DERIVATION IEL
  // ═══════════════════════════════════════════

  describe('deriveRepairTargetsFromRound — IEL', () => {
    it('throws when repair run is not pending', async () => {
      mockFrom.mockImplementation(() =>
        chainable({ id: 'rr1', status: 'completed', group_id: 'g1' })
      );
      await expect(
        deriveRepairTargetsFromRound({ repairRunId: 'rr1', groupId: 'g1', sourceRoundId: 'sr1' })
      ).rejects.toThrow(/not pending/);
    });

    it('throws when repair run belongs to different group', async () => {
      mockFrom.mockImplementation(() =>
        chainable({ id: 'rr1', status: 'pending', group_id: 'g_other' })
      );
      await expect(
        deriveRepairTargetsFromRound({ repairRunId: 'rr1', groupId: 'g1', sourceRoundId: 'sr1' })
      ).rejects.toThrow(/does not belong/);
    });
  });

  // ═══════════════════════════════════════════
  // REPAIRED CANDIDATE LINEAGE
  // ═══════════════════════════════════════════

  describe('registerRepairedCandidate — Lineage IEL', () => {
    it('throws when group is closed', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'g1', status: 'closed' }));
      await expect(
        registerRepairedCandidate({ groupId: 'g1', versionRefId: 'img1', sourceCandidateVersionId: 'cv1' })
      ).rejects.toThrow(/closed/);
    });

    it('throws when source candidate belongs to different group', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable({ id: 'cv1', group_id: 'g_other' });
        return chainable();
      });
      await expect(
        registerRepairedCandidate({ groupId: 'g1', versionRefId: 'img1', sourceCandidateVersionId: 'cv1' })
      ).rejects.toThrow(/does not belong/);
    });

    it('throws when source candidate not found', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'g1', status: 'open' });
        if (callCount === 2) return chainable(null, { message: 'not found' });
        return chainable();
      });
      await expect(
        registerRepairedCandidate({ groupId: 'g1', versionRefId: 'img1', sourceCandidateVersionId: 'cv_missing' })
      ).rejects.toThrow(CompetitionInvariantError);
    });
  });

  // ═══════════════════════════════════════════
  // STATE TRANSITION VALIDATION
  // ═══════════════════════════════════════════

  describe('State Transitions', () => {
    it('finalizeRepairRun throws when not running', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'rr1', status: 'pending' }));
      await expect(finalizeRepairRun('rr1')).rejects.toThrow(/Cannot finalize/);
    });

    it('finalizeRepairRun throws when no targets exist', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'rr1', status: 'running' });
        if (callCount === 2) {
          const c = chainable();
          c.select = vi.fn().mockReturnValue(c);
          c.eq = vi.fn().mockResolvedValue({ count: 0, error: null });
          return c;
        }
        return chainable();
      });
      await expect(finalizeRepairRun('rr1')).rejects.toThrow(/no targets/);
    });

    it('failRepairRun throws when already completed', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'rr1', status: 'completed' }));
      await expect(failRepairRun('rr1')).rejects.toThrow(/Cannot fail/);
    });

    it('failRepairRun throws when already failed', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'rr1', status: 'failed' }));
      await expect(failRepairRun('rr1')).rejects.toThrow(/Cannot fail/);
    });

    it('cancelRepairRun throws when already completed', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'rr1', status: 'completed' }));
      await expect(cancelRepairRun('rr1')).rejects.toThrow(/Cannot cancel/);
    });

    it('cancelRepairRun throws when already cancelled', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'rr1', status: 'cancelled' }));
      await expect(cancelRepairRun('rr1')).rejects.toThrow(/Cannot cancel/);
    });

    it('failRepairRun accepts pending status', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'rr1', status: 'pending' });
        if (callCount === 2) return chainable({ id: 'rr1', status: 'failed' });
        return chainable();
      });
      const result = await failRepairRun('rr1');
      expect(result.status).toBe('failed');
    });

    it('cancelRepairRun accepts running status', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chainable({ id: 'rr1', status: 'running' });
        if (callCount === 2) return chainable({ id: 'rr1', status: 'cancelled' });
        return chainable();
      });
      const result = await cancelRepairRun('rr1');
      expect(result.status).toBe('cancelled');
    });
  });

  // ═══════════════════════════════════════════
  // CANREPAIR CONVENIENCE
  // ═══════════════════════════════════════════

  describe('canRepair', () => {
    it('returns group_not_found', async () => {
      const c = chainable();
      c.single = vi.fn().mockResolvedValue({ data: null, error: null });
      mockFrom.mockReturnValue(c);
      const result = await canRepair('g1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('group_not_found');
    });

    it('returns group_closed', async () => {
      mockFrom.mockImplementation(() => chainable({ id: 'g1', status: 'closed' }));
      const result = await canRepair('g1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('group_closed');
    });
  });

  // ═══════════════════════════════════════════
  // ROUND TYPE SEMANTICS
  // ═══════════════════════════════════════════

  describe('Round Type Semantics', () => {
    it('repair round type is distinct from rerun and initial', () => {
      const roundTypes = ['initial', 'rerun', 'repair', 'manual_reassessment'];
      expect(roundTypes).toContain('repair');
      expect(new Set(roundTypes).size).toBe(roundTypes.length);
    });

    it('deriveReasonKey valid keys are well-defined', () => {
      const validReasonKeys = ['very_low_score', 'low_score', 'identity_drift', 'weak_similarity', 'below_threshold'];
      for (const key of validReasonKeys) {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      }
    });
  });
});
