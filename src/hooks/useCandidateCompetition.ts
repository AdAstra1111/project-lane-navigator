/**
 * useCandidateCompetition — React hook for consuming candidate competition
 * state in UI components. Reads from canonical DB-backed state.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  loadCompetitionGroup,
  loadActiveGroups,
  ensureGroupForSlot,
  addCandidateVersion,
  persistRankingSnapshot,
  selectWinner,
  closeGroup,
  type CandidateGroup,
  type CompetitionGroupWithDetails,
  type CompetitionInvariantError,
} from '@/lib/competition/candidateCompetitionService';

export function useCandidateCompetition(projectId: string | undefined) {
  const qc = useQueryClient();

  // Load all active groups for this project
  const groupsQuery = useQuery({
    queryKey: ['candidate-groups', projectId],
    queryFn: () => loadActiveGroups(projectId!),
    enabled: !!projectId,
  });

  // Load a single group with full details
  const useGroupDetails = (groupId: string | null) => {
    return useQuery({
      queryKey: ['candidate-group-details', groupId],
      queryFn: () => loadCompetitionGroup(groupId!),
      enabled: !!groupId,
    });
  };

  // Ensure group for a slot
  const ensureGroupMutation = useMutation({
    mutationFn: (params: Parameters<typeof ensureGroupForSlot>[0]) =>
      ensureGroupForSlot(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-groups', projectId] });
    },
  });

  // Add candidate to group
  const addCandidateMutation = useMutation({
    mutationFn: (params: Parameters<typeof addCandidateVersion>[0]) =>
      addCandidateVersion(params),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['candidate-group-details', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['candidate-groups', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Persist ranking snapshot
  const rankMutation = useMutation({
    mutationFn: (params: Parameters<typeof persistRankingSnapshot>[0]) =>
      persistRankingSnapshot(params),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['candidate-group-details', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['candidate-groups', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Select winner
  const selectWinnerMutation = useMutation({
    mutationFn: (params: Parameters<typeof selectWinner>[0]) =>
      selectWinner(params),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['candidate-group-details', vars.groupId] });
      qc.invalidateQueries({ queryKey: ['candidate-groups', projectId] });
      toast.success('Winner selected');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Close group
  const closeGroupMutation = useMutation({
    mutationFn: (groupId: string) => closeGroup(groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-groups', projectId] });
    },
  });

  return {
    groups: groupsQuery.data || [],
    isLoading: groupsQuery.isLoading,
    useGroupDetails,
    ensureGroup: ensureGroupMutation,
    addCandidate: addCandidateMutation,
    rank: rankMutation,
    selectWinner: selectWinnerMutation,
    closeGroup: closeGroupMutation,
  };
}
