import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { DeliverableType, DevelopmentBehavior, ConvergenceStatus } from '@/lib/dev-os-config';
import { computeConvergenceStatus } from '@/lib/dev-os-config';

// ── Types ──

export interface DevDocument {
  id: string;
  project_id: string;
  title: string;
  doc_type: string;
  source: string;
  file_name: string;
  file_path: string;
  plaintext: string | null;
  extracted_text: string | null;
  created_at: string;
}

export interface DevVersion {
  id: string;
  document_id: string;
  version_number: number;
  label: string | null;
  plaintext: string;
  created_by: string;
  created_at: string;
  parent_version_id: string | null;
  change_summary: string | null;
}

export interface DevRun {
  id: string;
  project_id: string;
  document_id: string;
  version_id: string;
  run_type: string;
  production_type: string;
  strategic_priority: string;
  development_stage: string;
  analysis_mode: string;
  output_json: any;
  created_at: string;
}

export interface ConvergencePoint {
  id: string;
  creative_score: number;
  greenlight_score: number;
  gap: number;
  allowed_gap: number;
  convergence_status: string;
  trajectory: string | null;
  created_at: string;
}

export interface DriftEvent {
  id: string;
  project_id: string;
  document_version_id: string;
  drift_level: 'none' | 'moderate' | 'major';
  drift_items: Array<{ field: string; similarity: number; inherited: string; current: string }>;
  acknowledged: boolean;
  resolved: boolean;
  resolution_type: string | null;
  created_at: string;
}

// ── API helper ──

async function callEngineV2(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

// ── Hook ──

export function useDevEngineV2(projectId: string | undefined) {
  const qc = useQueryClient();

  // Documents for project
  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['dev-v2-docs', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_documents')
        .select('id, project_id, title, doc_type, source, file_name, file_path, plaintext, extracted_text, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DevDocument[];
    },
    enabled: !!projectId,
  });

  // Versions for selected document
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['dev-v2-versions', selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return [];
      const { data, error } = await (supabase as any)
        .from('project_document_versions')
        .select('*')
        .eq('document_id', selectedDocId)
        .order('version_number', { ascending: true });
      if (error) throw error;
      return (data || []) as DevVersion[];
    },
    enabled: !!selectedDocId,
  });

  // Runs for selected version
  const { data: runs = [] } = useQuery({
    queryKey: ['dev-v2-runs', selectedVersionId],
    queryFn: async () => {
      if (!selectedVersionId) return [];
      const { data, error } = await (supabase as any)
        .from('development_runs')
        .select('*')
        .eq('version_id', selectedVersionId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as DevRun[];
    },
    enabled: !!selectedVersionId,
  });

  // All runs for document (for history across versions)
  const { data: allDocRuns = [] } = useQuery({
    queryKey: ['dev-v2-doc-runs', selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return [];
      const { data, error } = await (supabase as any)
        .from('development_runs')
        .select('*')
        .eq('document_id', selectedDocId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as DevRun[];
    },
    enabled: !!selectedDocId,
  });

  // Convergence history for document
  const { data: convergenceHistory = [] } = useQuery({
    queryKey: ['dev-v2-convergence', selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return [];
      const { data, error } = await (supabase as any)
        .from('dev_engine_convergence_history')
        .select('*')
        .eq('document_id', selectedDocId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ConvergencePoint[];
    },
    enabled: !!selectedDocId,
  });

  // Drift events for selected version
  const { data: driftEvents = [], refetch: refetchDrift } = useQuery({
    queryKey: ['dev-v2-drift', selectedVersionId],
    queryFn: async () => {
      if (!selectedVersionId) return [];
      const { data, error } = await (supabase as any)
        .from('document_drift_events')
        .select('*')
        .eq('document_version_id', selectedVersionId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DriftEvent[];
    },
    enabled: !!selectedVersionId,
  });

  const latestDrift = driftEvents.length > 0 ? driftEvents[0] : null;

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
    if (selectedDocId) {
      qc.invalidateQueries({ queryKey: ['dev-v2-versions', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-doc-runs', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-convergence', selectedDocId] });
    }
    if (selectedVersionId) {
      qc.invalidateQueries({ queryKey: ['dev-v2-runs', selectedVersionId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-drift', selectedVersionId] });
    }
  }

  // Select document → auto-select latest version
  const selectDocument = useCallback((docId: string) => {
    setSelectedDocId(docId);
    setSelectedVersionId(null);
  }, []);

  // ── Mutations ──

  // Resolve versionId at call time: prefer explicit selection, fall back to latest version from DB
  // If no version exists at all, auto-create one from the document's extracted_text/plaintext
  async function resolveVersionId() {
    if (selectedVersionId) return selectedVersionId;
    if (versions.length > 0) return versions[versions.length - 1].id;
    // If versions haven't loaded yet, fetch directly
    if (selectedDocId) {
      const { data } = await (supabase as any)
        .from('project_document_versions')
        .select('id')
        .eq('document_id', selectedDocId)
        .order('version_number', { ascending: false })
        .limit(1);
      if (data && data.length > 0) return data[0].id as string;

      // No versions exist — auto-create v1 from document text
      const doc = documents.find(d => d.id === selectedDocId);
      const text = doc?.extracted_text || doc?.plaintext || '';
      if (!text) return null;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: newVersion, error } = await (supabase as any)
        .from('project_document_versions')
        .insert({
          document_id: selectedDocId,
          version_number: 1,
          label: 'v1 (auto)',
          plaintext: text,
          created_by: user.id,
        })
        .select('id')
        .single();
      if (error || !newVersion) return null;
      setSelectedVersionId(newVersion.id);
      invalidateAll();
      return newVersion.id as string;
    }
    return null;
  }

  const analyze = useMutation({
    mutationFn: async (params: { productionType?: string; strategicPriority?: string; developmentStage?: string; analysisMode?: string; previousVersionId?: string; deliverableType?: DeliverableType; developmentBehavior?: DevelopmentBehavior; format?: string; episodeTargetDurationSeconds?: number }) => {
      const vid = await resolveVersionId();
      if (!vid) throw new Error('No version found — please select a document first');
      return callEngineV2('analyze', { projectId, documentId: selectedDocId, versionId: vid, ...params });
    },
    onSuccess: () => { toast.success('Analysis complete'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateNotes = useMutation({
    mutationFn: async (analysisJson?: any) => {
      const vid = await resolveVersionId();
      return callEngineV2('notes', { projectId, documentId: selectedDocId, versionId: vid, analysisJson });
    },
    onSuccess: () => { toast.success('Notes generated'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rewrite = useMutation({
    mutationFn: async (params: { approvedNotes: any[]; protectItems?: string[]; targetDocType?: string; deliverableType?: string; developmentBehavior?: string; format?: string }) => {
      const vid = await resolveVersionId();
      return callEngineV2('rewrite', { projectId, documentId: selectedDocId, versionId: vid, ...params });
    },
    onSuccess: (data) => {
      toast.success('Rewrite complete — new version created');
      if (data.newVersion) setSelectedVersionId(data.newVersion.id);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: async (params: { targetOutput: string; protectItems?: string[] }) => {
      const vid = await resolveVersionId();
      return callEngineV2('convert', { projectId, documentId: selectedDocId, versionId: vid, ...params });
    },
    onSuccess: (data) => {
      toast.success(`Converted to ${data.newDoc?.doc_type || 'new format'}`);
      if (data.newDoc) {
        selectDocument(data.newDoc.id);
        if (data.newVersion) setSelectedVersionId(data.newVersion.id);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPaste = useMutation({
    mutationFn: (params: { title: string; docType: string; text: string }) =>
      callEngineV2('create-paste', { projectId, ...params }),
    onSuccess: (data) => {
      toast.success('Document created');
      if (data.document) {
        selectDocument(data.document.id);
        if (data.version) setSelectedVersionId(data.version.id);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDocument = useMutation({
    mutationFn: async (docId: string) => {
      await (supabase as any).from('development_runs').delete().eq('document_id', docId);
      await (supabase as any).from('dev_engine_convergence_history').delete().eq('document_id', docId);
      await (supabase as any).from('project_document_versions').delete().eq('document_id', docId);
      const { error } = await (supabase as any).from('project_documents').delete().eq('id', docId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Document deleted');
      if (selectedDocId) {
        setSelectedDocId(null);
        setSelectedVersionId(null);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Drift resolution mutations
  const acknowledgeDrift = useMutation({
    mutationFn: async (driftEventId: string) =>
      callEngineV2('drift-acknowledge', { driftEventId }),
    onSuccess: () => { toast.success('Drift acknowledged'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveDrift = useMutation({
    mutationFn: async (params: { driftEventId: string; resolutionType: 'accept_drift' | 'intentional_pivot' | 'reseed'; versionId?: string }) =>
      callEngineV2('drift-resolve', params),
    onSuccess: () => { toast.success('Drift resolved'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Derived
  const selectedDoc = documents.find(d => d.id === selectedDocId) || null;
  const selectedVersion = versions.find(v => v.id === selectedVersionId) || (versions.length > 0 ? versions[versions.length - 1] : null);

  // Auto-select version when versions load
  if (selectedDocId && !selectedVersionId && versions.length > 0) {
    setSelectedVersionId(versions[versions.length - 1].id);
  }

  // Latest analysis for selected version
  const latestAnalysis = runs.filter(r => r.run_type === 'ANALYZE').pop()?.output_json || null;
  const latestNotes = runs.filter(r => r.run_type === 'NOTES').pop()?.output_json || null;

  const isLoading = analyze.isPending || generateNotes.isPending || rewrite.isPending || convert.isPending || createPaste.isPending;

  // Behavior-aware convergence
  const rewriteCount = allDocRuns.filter(r => r.run_type === 'REWRITE').length;
  const currentBehavior: DevelopmentBehavior = (latestAnalysis?.development_behavior as DevelopmentBehavior) || 'market';

  const convergenceStatus: ConvergenceStatus = computeConvergenceStatus(
    latestAnalysis?.ci_score ?? null,
    latestAnalysis?.gp_score ?? null,
    latestAnalysis?.gap ?? null,
    latestAnalysis?.allowed_gap ?? 25,
    currentBehavior,
    rewriteCount,
  );

  const isConverged = convergenceStatus === 'Converged';

  return {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, convergenceStatus, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument,
    // Drift
    driftEvents, latestDrift, acknowledgeDrift, resolveDrift,
  };
}
