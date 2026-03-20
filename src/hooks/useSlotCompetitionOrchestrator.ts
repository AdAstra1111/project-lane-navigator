/**
 * useSlotCompetitionOrchestrator — explicit competition orchestration hook.
 * Round-aware: creates initial rounds, supports rerun rounds.
 * 
 * Moves all competition lifecycle out of UI mount effects.
 * Provides explicit, idempotent actions for:
 *   - initializing competition groups + initial rounds for slots
 *   - syncing candidates into groups
 *   - persisting rankings (round-scoped)
 *   - selecting winners (round-scoped)
 *   - creating rerun rounds
 * 
 * All writes are intentional. No mount-time side effects.
 * All reads are query-backed from canonical DB state.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ensureGroupForSlot,
  addCandidateVersion,
  persistRankingSnapshot,
  selectWinner,
  loadActiveGroups,
  loadCompetitionGroup,
  createRerunRound,
  loadCurrentRound,
  type CandidateGroup,
  type CompetitionGroupWithDetails,
  type CompetitionRound,
} from '@/lib/competition/candidateCompetitionService';
import {
  createRepairRun,
  deriveRepairTargetsFromRound,
  createRepairRound as createRepairRoundService,
  registerRepairedCandidate,
  finalizeRepairRun,
  failRepairRun,
  canRepair,
  loadRepairHistory,
  type RepairRun,
} from '@/lib/competition/repairLoopService';

interface SlotInfo {
  key: string;
  assetGroup: string;
  subject: string | null;
  candidateIds: string[];
}

/**
 * Query key factory for competition state
 */
const competitionKeys = {
  groups: (projectId: string) => ['competition-groups', projectId] as const,
  groupDetail: (groupId: string) => ['competition-group-detail', groupId] as const,
  slotGroups: (projectId: string) => ['competition-slot-groups', projectId] as const,
};

export function useSlotCompetitionOrchestrator(projectId: string | undefined) {
  const qc = useQueryClient();

  // ── Canonical read: all active groups for project ──
  const groupsQuery = useQuery({
    queryKey: competitionKeys.groups(projectId || ''),
    queryFn: () => loadActiveGroups(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // ── Derived: slot key → group mapping from DB state ──
  const slotGroupMap = useMemo(() => {
    const map: Record<string, CandidateGroup> = {};
    for (const g of groupsQuery.data || []) {
      if (g.slot_key && !map[g.slot_key]) {
        map[g.slot_key] = g;
      }
    }
    return map;
  }, [groupsQuery.data]);

  // ── Load full group details (on-demand, not on mount) ──
  const loadGroupDetails = useCallback(async (groupId: string): Promise<CompetitionGroupWithDetails | null> => {
    return qc.fetchQuery({
      queryKey: competitionKeys.groupDetail(groupId),
      queryFn: () => loadCompetitionGroup(groupId),
      staleTime: 15_000,
    });
  }, [qc]);

  // ── Explicit action: initialize competition for a slot ──
  const initializeSlotCompetition = useMutation({
    mutationFn: async (slot: SlotInfo) => {
      if (!projectId) throw new Error('No project ID');
      if (slot.candidateIds.length < 2) return null;

      // Idempotent: ensureGroupForSlot checks for existing open group + creates initial round
      const group = await ensureGroupForSlot({
        projectId,
        slotKey: slot.key,
        runContextType: 'image',
        assetGroup: slot.assetGroup,
        characterName: slot.subject || undefined,
      });

      // Sync candidates — catch duplicate constraint errors for idempotency
      for (let i = 0; i < slot.candidateIds.length; i++) {
        try {
          await addCandidateVersion({
            groupId: group.id,
            versionRefId: slot.candidateIds[i],
            candidateIndex: i,
          });
        } catch (err: any) {
          if (!err?.message?.includes('duplicate') && !err?.message?.includes('unique')) {
            console.warn(`[Competition] Failed to add candidate ${slot.candidateIds[i]}:`, err);
          }
        }
      }

      return group;
    },
    onSuccess: () => {
      if (projectId) {
        qc.invalidateQueries({ queryKey: competitionKeys.groups(projectId) });
      }
    },
    onError: (e: Error) => {
      console.warn('[Competition] Initialization failed:', e);
    },
  });

  // ── Explicit action: initialize all slots at once ──
  const initializeAllSlots = useCallback(async (slots: SlotInfo[]) => {
    const eligible = slots.filter(s => s.candidateIds.length >= 2);
    for (const slot of eligible) {
      await initializeSlotCompetition.mutateAsync(slot);
    }
  }, [initializeSlotCompetition]);

  // ── Explicit action: persist ranking (round-aware) ──
  const persistRanking = useMutation({
    mutationFn: async (params: {
      groupId: string;
      roundId?: string;
      rankings: Array<{
        candidateVersionId: string;
        rankPosition: number;
        rankScore: number;
        scoreJson?: Record<string, unknown>;
        rankingInputsJson?: Record<string, unknown>;
      }>;
    }) => {
      return persistRankingSnapshot({
        groupId: params.groupId,
        roundId: params.roundId,
        rankings: params.rankings,
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: competitionKeys.groupDetail(vars.groupId) });
      if (projectId) {
        qc.invalidateQueries({ queryKey: competitionKeys.groups(projectId) });
      }
    },
    onError: (e: Error) => toast.error(`Ranking failed: ${e.message}`),
  });

  // ── Explicit action: select winner (round-aware) ──
  const selectCompetitionWinner = useMutation({
    mutationFn: async (params: {
      groupId: string;
      candidateVersionId: string;
      roundId?: string;
      rationale?: string;
    }) => {
      return selectWinner({
        groupId: params.groupId,
        candidateVersionId: params.candidateVersionId,
        roundId: params.roundId,
        selectionMode: 'manual',
        rationale: params.rationale || 'Selected via Approval Workspace',
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: competitionKeys.groupDetail(vars.groupId) });
      if (projectId) {
        qc.invalidateQueries({ queryKey: competitionKeys.groups(projectId) });
      }
      toast.success('Winner selected');
    },
    onError: (e: Error) => toast.error(`Winner selection failed: ${e.message}`),
  });

  // ── Explicit action: create rerun round ──
  const createRerun = useMutation({
    mutationFn: async (params: { groupId: string; roundType?: 'rerun' | 'manual_reassessment' }) => {
      return createRerunRound({
        groupId: params.groupId,
        roundType: params.roundType || 'rerun',
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: competitionKeys.groupDetail(vars.groupId) });
      if (projectId) {
        qc.invalidateQueries({ queryKey: competitionKeys.groups(projectId) });
      }
      toast.success('New competition round created');
    },
    onError: (e: Error) => toast.error(`Rerun creation failed: ${e.message}`),
  });

  return {
    /** DB-backed group list (query state) */
    groups: groupsQuery.data || [],
    isLoading: groupsQuery.isLoading,
    /** Derived slot→group map from canonical DB state */
    slotGroupMap,
    /** Load full details for a group (cached) */
    loadGroupDetails,
    /** Explicit: initialize competition for one slot */
    initializeSlotCompetition,
    /** Explicit: initialize all eligible slots */
    initializeAllSlots,
    /** Explicit: persist ranking snapshot (round-aware) */
    persistRanking,
    /** Explicit: select winner (round-aware) */
    selectCompetitionWinner,
    /** Explicit: create rerun round for existing group */
    createRerun,
  };
}
