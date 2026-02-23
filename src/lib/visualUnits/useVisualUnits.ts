/**
 * Visual Unit Engine v1.0 — React Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { visualUnitsApi } from './visualUnitsApi';
import { toast } from 'sonner';

export function useVisualUnitSources(projectId: string | undefined) {
  return useQuery({
    queryKey: ['vue-sources', projectId],
    queryFn: () => visualUnitsApi.selectSources(projectId!),
    enabled: !!projectId,
  });
}

export function useVisualUnitRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: ['vue-runs', projectId],
    queryFn: () => visualUnitsApi.listRuns(projectId!),
    enabled: !!projectId,
  });
}

export function useVisualUnitCandidates(projectId: string | undefined, runId?: string, unitKey?: string, statuses?: string[]) {
  return useQuery({
    queryKey: ['vue-candidates', projectId, runId, unitKey, statuses],
    queryFn: () => visualUnitsApi.listCandidates(projectId!, runId, unitKey, statuses),
    enabled: !!projectId,
  });
}

export function useVisualUnitCandidate(projectId: string | undefined, candidateId: string | undefined) {
  return useQuery({
    queryKey: ['vue-candidate', projectId, candidateId],
    queryFn: () => visualUnitsApi.getCandidate(projectId!, candidateId!),
    enabled: !!projectId && !!candidateId,
  });
}

export function useVisualUnit(projectId: string | undefined, unitKey: string | undefined) {
  return useQuery({
    queryKey: ['vue-unit', projectId, unitKey],
    queryFn: () => visualUnitsApi.getUnit(projectId!, unitKey!),
    enabled: !!projectId && !!unitKey,
  });
}

export function useVisualUnitMutations(projectId: string | undefined) {
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['vue-runs', projectId] });
    qc.invalidateQueries({ queryKey: ['vue-candidates', projectId] });
    qc.invalidateQueries({ queryKey: ['vue-candidate', projectId] });
    qc.invalidateQueries({ queryKey: ['vue-unit', projectId] });
    qc.invalidateQueries({ queryKey: ['vue-sources', projectId] });
  };

  const createRun = useMutation({
    mutationFn: (params?: { sourceVersions?: Record<string, string>; scope?: string; unitKey?: string }) =>
      visualUnitsApi.createRun(projectId!, params?.sourceVersions, params?.scope, params?.unitKey),
    onSuccess: (data) => {
      toast.success(`Run created with ${data.candidatesCount} candidates`);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptCandidate = useMutation({
    mutationFn: (candidateId: string) => visualUnitsApi.acceptCandidate(projectId!, candidateId),
    onSuccess: () => { toast.success('Candidate accepted as canonical'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectCandidate = useMutation({
    mutationFn: ({ candidateId, reason }: { candidateId: string; reason?: string }) =>
      visualUnitsApi.rejectCandidate(projectId!, candidateId, reason),
    onSuccess: () => { toast.success('Candidate rejected'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const modifyCandidate = useMutation({
    mutationFn: ({ candidateId, patch, note }: { candidateId: string; patch: Record<string, any>; note?: string }) =>
      visualUnitsApi.modifyCandidate(projectId!, candidateId, patch, note),
    onSuccess: () => { toast.success('Modified candidate created'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const lockUnit = useMutation({
    mutationFn: (unitKey: string) => visualUnitsApi.lockUnit(projectId!, unitKey),
    onSuccess: () => { toast.success('Unit locked'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlockUnit = useMutation({
    mutationFn: (unitKey: string) => visualUnitsApi.unlockUnit(projectId!, unitKey),
    onSuccess: () => { toast.success('Unit unlocked'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const markStale = useMutation({
    mutationFn: ({ unitKey, stale, reason }: { unitKey: string; stale: boolean; reason?: string }) =>
      visualUnitsApi.markStale(projectId!, unitKey, stale, reason),
    onSuccess: () => { toast.success('Stale status updated'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const compare = useMutation({
    mutationFn: ({ from, to, write }: { from: Record<string, any>; to: Record<string, any>; write?: boolean }) =>
      visualUnitsApi.compare(projectId!, from, to, write),
    onError: (e: Error) => toast.error(e.message),
  });

  return { createRun, acceptCandidate, rejectCandidate, modifyCandidate, lockUnit, unlockUnit, markStale, compare };
}
