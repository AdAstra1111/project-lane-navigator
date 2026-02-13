import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────

export interface ApprovedSource {
  id: string;
  user_id: string;
  title: string;
  source_url: string;
  format: string;
  rights_status: string;
  license_reference: string;
  added_by: string;
  created_at: string;
}

export interface CorpusScript {
  id: string;
  source_id: string;
  checksum: string;
  page_count_estimate: number;
  ingestion_status: string;
  ingestion_log: string;
  created_at: string;
  approved_sources?: { title: string };
}

export interface DerivedArtifact {
  id: string;
  script_id: string;
  artifact_type: string;
  json_data: any;
  created_at: string;
}

// ── Hooks ─────────────────────────────────────────────────────────────

export function useApprovedSources() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['approved-sources', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('approved_sources')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ApprovedSource[];
    },
    enabled: !!user,
  });
}

export function useAddSource() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; source_url: string; format: string; license_reference: string; rights_status: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('approved_sources').insert({
        ...input,
        user_id: user.id,
        added_by: user.email || '',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approved-sources'] });
      toast.success('Source added');
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; rights_status?: string; title?: string }) => {
      const { error } = await supabase.from('approved_sources').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approved-sources'] });
      toast.success('Source updated');
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('approved_sources').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approved-sources'] });
      toast.success('Source removed');
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useCorpusScripts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-scripts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_scripts')
        .select('*, approved_sources(title)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as CorpusScript[];
    },
    enabled: !!user,
  });
}

export function useCorpusArtifacts(scriptId: string | null) {
  return useQuery({
    queryKey: ['corpus-artifacts', scriptId],
    queryFn: async () => {
      if (!scriptId) return [];
      const { data, error } = await supabase
        .from('corpus_derived_artifacts')
        .select('*')
        .eq('script_id', scriptId);
      if (error) throw error;
      return data as DerivedArtifact[];
    },
    enabled: !!scriptId,
  });
}

export function useIngestSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string) => {
      const { data, error } = await supabase.functions.invoke('ingest-corpus', {
        body: { action: 'ingest', source_id: sourceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      qc.invalidateQueries({ queryKey: ['approved-sources'] });
      toast.success(`Ingested: ${data.pages} pages, ${data.scenes} scenes, ${data.chunks} chunks`);
    },
    onError: (e) => toast.error(`Ingestion failed: ${e.message}`),
  });
}

export function useCorpusSearch() {
  return useMutation({
    mutationFn: async (query: string) => {
      const { data, error } = await supabase.functions.invoke('ingest-corpus', {
        body: { action: 'search', query, limit: 10 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onError: (e) => toast.error(`Search failed: ${e.message}`),
  });
}

// ── Embedding Pipeline ────────────────────────────────────────────────

export function useEmbedScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scriptId: string) => {
      const { data, error } = await supabase.functions.invoke('embed-corpus', {
        body: { action: 'embed_script', script_id: scriptId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { embedded: number; errors: number; total: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      toast.success(`Embedded ${data.embedded}/${data.total} chunks`);
    },
    onError: (e) => toast.error(`Embedding failed: ${e.message}`),
  });
}

export function useEmbedAllPending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('embed-corpus', {
        body: { action: 'embed_pending' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { embedded: number; errors: number; scripts_processed: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      toast.success(`Embedded ${data.embedded} chunks across ${data.scripts_processed} scripts`);
    },
    onError: (e) => toast.error(`Batch embedding failed: ${e.message}`),
  });
}

export function useSemanticSearch() {
  return useMutation({
    mutationFn: async (params: { query: string; limit?: number; script_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('embed-corpus', {
        body: { action: 'semantic_search', ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { chunks: any[]; scripts: any[] };
    },
    onError: (e) => toast.error(`Semantic search failed: ${e.message}`),
  });
}
