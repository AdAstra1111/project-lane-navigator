/**
 * useResolvedNotes — Fetches resolved note fingerprints for a project
 * to suppress already-resolved notes in the UI.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { noteFingerprint, type FingerprintableNote } from '@/lib/decisions/fingerprint';

export function useResolvedNotes(projectId: string | undefined) {
  const { data: resolvedFingerprints = [], isLoading } = useQuery({
    queryKey: ['resolved-notes', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase
        .from('resolved_notes' as any)
        .select('note_fingerprint, status')
        .eq('project_id', projectId)
        .eq('status', 'active');
      return (data || []).map((r: any) => r.note_fingerprint as string);
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  /**
   * Check if a note has been resolved before.
   */
  function isResolved(note: FingerprintableNote): boolean {
    const fp = noteFingerprint(note);
    return resolvedFingerprints.includes(fp);
  }

  /**
   * Filter out resolved notes from a list.
   */
  function filterResolved<T extends FingerprintableNote>(notes: T[]): { active: T[]; resolved: T[] } {
    const active: T[] = [];
    const resolved: T[] = [];
    for (const n of notes) {
      if (isResolved(n)) {
        resolved.push(n);
      } else {
        active.push(n);
      }
    }
    return { active, resolved };
  }

  return { resolvedFingerprints, isResolved, filterResolved, isLoading };
}
