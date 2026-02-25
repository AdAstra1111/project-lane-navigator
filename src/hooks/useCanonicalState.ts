/**
 * useCanonicalState — Hook that resolves and exposes the canonical project state
 * with source attribution. Used by Canon tab & Decision Mode to show
 * "Canon currently sourced from: X".
 */
import { useQuery } from '@tanstack/react-query';
import { getCanonicalProjectState, type CanonicalProjectState, type CanonSource } from '@/lib/canon/getCanonicalProjectState';

const CANON_STATE_KEY = (pid: string) => ['canonical-project-state', pid];

const SOURCE_LABELS: Record<CanonSource, string> = {
  canon_editor: 'Canon Editor',
  locked_facts: 'Locked Decisions',
  doc_set: 'Canonical Doc Set',
  unknown: 'Unknown (not established)',
};

export function useCanonicalState(projectId: string | undefined) {
  const { data, isLoading, refetch } = useQuery<CanonicalProjectState>({
    queryKey: CANON_STATE_KEY(projectId!),
    queryFn: () => getCanonicalProjectState(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
  });

  return {
    canonState: data ?? null,
    source: data?.source ?? 'unknown' as CanonSource,
    sourceLabel: SOURCE_LABELS[data?.source ?? 'unknown'],
    evidence: data?.evidence ?? null,
    isLoading,
    refetch,
  };
}
