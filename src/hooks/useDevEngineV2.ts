import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
    if (selectedDocId) {
      qc.invalidateQueries({ queryKey: ['dev-v2-versions', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-doc-runs', selectedDocId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-convergence', selectedDocId] });
    }
    if (selectedVersionId) {
      qc.invalidateQueries({ queryKey: ['dev-v2-runs', selectedVersionId] });
    }
  }

  // Select document → auto-select latest version
  const selectDocument = useCallback((docId: string) => {
    setSelectedDocId(docId);
    setSelectedVersionId(null);
  }, []);

  // ── Mutations ──

  const analyze = useMutation({
    mutationFn: (params: { productionType?: string; strategicPriority?: string; developmentStage?: string; analysisMode?: string; previousVersionId?: string }) =>
      callEngineV2('analyze', { projectId, documentId: selectedDocId, versionId: selectedVersionId, ...params }),
    onSuccess: () => { toast.success('Analysis complete'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateNotes = useMutation({
    mutationFn: (analysisJson?: any) =>
      callEngineV2('notes', { projectId, documentId: selectedDocId, versionId: selectedVersionId, analysisJson }),
    onSuccess: () => { toast.success('Notes generated'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rewrite = useMutation({
    mutationFn: (params: { approvedNotes: any[]; protectItems?: string[]; targetDocType?: string }) =>
      callEngineV2('rewrite', { projectId, documentId: selectedDocId, versionId: selectedVersionId, ...params }),
    onSuccess: (data) => {
      toast.success('Rewrite complete — new version created');
      if (data.newVersion) setSelectedVersionId(data.newVersion.id);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: (params: { targetOutput: string; protectItems?: string[] }) =>
      callEngineV2('convert', { projectId, documentId: selectedDocId, versionId: selectedVersionId, ...params }),
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

  const isConverged = latestAnalysis &&
    (latestAnalysis.ci_score ?? 0) >= 80 &&
    (latestAnalysis.gp_score ?? 0) >= 80 &&
    (latestAnalysis.gap ?? 100) <= (latestAnalysis.allowed_gap ?? 25);

  return {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste,
  };
}
