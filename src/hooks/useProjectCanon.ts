/**
 * useProjectCanon — CRUD hook for the project_canon table.
 *
 * Provides:
 *  - canon: current canon_json
 *  - versions: version history with approval status
 *  - save(patch): autosave-friendly upsert (merges into canon_json)
 *  - approveVersion(versionId): mark a version as Active Approved
 *  - isLoading, isSaving
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Canon JSON shape ──

export interface CanonCharacter {
  name: string;
  role: string;
  goals?: string;
  traits?: string;
  secrets?: string;
  relationships?: string;
}

export interface CanonJson {
  logline?: string;
  premise?: string;
  characters?: CanonCharacter[];
  timeline?: string;
  world_rules?: string;
  locations?: string;
  ongoing_threads?: string;
  tone_style?: string;
  format_constraints?: string;
  forbidden_changes?: string;
  [key: string]: unknown;
}

export interface CanonVersion {
  id: string;
  project_id: string;
  canon_json: CanonJson;
  created_at: string;
  created_by: string | null;
  is_approved: boolean;
  approved_at: string | null;
}

// ── Keys ──

const CANON_KEY = (pid: string) => ['project-canon', pid];
const VERSIONS_KEY = (pid: string) => ['project-canon-versions', pid];

// ── Hook ──

export function useProjectCanon(projectId: string | undefined) {
  const qc = useQueryClient();

  // Fetch current canon
  const {
    data: canon,
    isLoading,
  } = useQuery<CanonJson>({
    queryKey: CANON_KEY(projectId!),
    queryFn: async () => {
      // Upsert to ensure row exists (for projects created before this feature)
      const { data: user } = await supabase.auth.getUser();
      await (supabase as any)
        .from('project_canon')
        .upsert(
          { project_id: projectId, canon_json: {}, updated_by: user?.user?.id },
          { onConflict: 'project_id', ignoreDuplicates: true }
        );

      const { data, error } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .single();
      if (error) throw error;
      return (data?.canon_json || {}) as CanonJson;
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });

  // Fetch versions (latest 50)
  const { data: versions = [] } = useQuery<CanonVersion[]>({
    queryKey: VERSIONS_KEY(projectId!),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_canon_versions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
    staleTime: 10_000,
  });

  // Active approved version
  const activeApproved = versions.find(v => v.is_approved) || null;

  // Save (merge patch into canon_json)
  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<CanonJson>) => {
      const { data: user } = await supabase.auth.getUser();
      const merged = { ...(canon || {}), ...patch };
      const { error } = await (supabase as any)
        .from('project_canon')
        .update({ canon_json: merged, updated_by: user?.user?.id })
        .eq('project_id', projectId);
      if (error) throw error;
      return merged;
    },
    onSuccess: (merged) => {
      qc.setQueryData(CANON_KEY(projectId!), merged);
      qc.invalidateQueries({ queryKey: VERSIONS_KEY(projectId!) });
    },
    onError: (err: any) => {
      toast.error('Failed to save canon: ' + (err.message || 'Unknown'));
    },
  });

  // Approve a version
  const approveMutation = useMutation({
    mutationFn: async (versionId: string) => {
      // Clear previous approvals
      await (supabase as any)
        .from('project_canon_versions')
        .update({ is_approved: false, approved_at: null })
        .eq('project_id', projectId)
        .eq('is_approved', true);
      // Set new approval
      const { error } = await (supabase as any)
        .from('project_canon_versions')
        .update({ is_approved: true, approved_at: new Date().toISOString() })
        .eq('id', versionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Canon version approved');
      qc.invalidateQueries({ queryKey: VERSIONS_KEY(projectId!) });
    },
    onError: (err: any) => {
      toast.error('Failed to approve: ' + (err.message || 'Unknown'));
    },
  });

  return {
    canon: canon ?? ({} as CanonJson),
    versions,
    activeApproved,
    isLoading,
    isSaving: saveMutation.isPending,
    save: saveMutation.mutate,
    saveAsync: saveMutation.mutateAsync,
    approveVersion: approveMutation.mutate,
    isApproving: approveMutation.isPending,
  };
}
