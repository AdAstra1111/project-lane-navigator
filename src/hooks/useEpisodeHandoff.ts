/**
 * useEpisodeHandoff — Manages the roundtrip workflow between Series Writer and Dev Engine.
 * Handles sending episodes to Dev Engine, returning them, and cancelling handoffs.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EpisodeHandoff {
  id: string;
  project_id: string;
  episode_id: string;
  episode_number: number;
  from_script_id: string | null;
  dev_engine_doc_id: string | null;
  dev_engine_version_id: string | null;
  return_script_id: string | null;
  status: 'sent' | 'in_progress' | 'returned' | 'cancelled';
  issue_title: string | null;
  issue_description: string | null;
  desired_outcome: string | null;
  context_doc_keys: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  returned_at: string | null;
  cancelled_at: string | null;
}

export function useEpisodeHandoff(projectId: string) {
  const qc = useQueryClient();
  const handoffKey = ['episode-handoffs', projectId];

  // ── Fetch active handoffs ──
  const { data: handoffs = [], isLoading } = useQuery({
    queryKey: handoffKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('episode_handoffs')
        .select('*')
        .eq('project_id', projectId)
        .in('status', ['sent', 'in_progress'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EpisodeHandoff[];
    },
    enabled: !!projectId,
  });

  // ── All handoffs (including returned/cancelled) for history ──
  const { data: allHandoffs = [] } = useQuery({
    queryKey: [...handoffKey, 'all'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('episode_handoffs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EpisodeHandoff[];
    },
    enabled: !!projectId,
  });

  // Get active handoff for a specific episode
  function getActiveHandoff(episodeId: string): EpisodeHandoff | undefined {
    return handoffs.find(h => h.episode_id === episodeId);
  }

  // ── Send episode to Dev Engine ──
  const sendToDevEngine = useMutation({
    mutationFn: async (params: {
      episodeId: string;
      episodeNumber: number;
      scriptId: string | null;
      issueTitle: string;
      issueDescription: string;
      desiredOutcome: string;
      contextDocKeys: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check no active handoff exists for this episode
      const existing = handoffs.find(h => h.episode_id === params.episodeId);
      if (existing) throw new Error('This episode already has an active handoff');

      // Fetch script content if available
      let scriptText = '';
      if (params.scriptId) {
        const { data: s } = await supabase
          .from('scripts')
          .select('text_content')
          .eq('id', params.scriptId)
          .single();
        scriptText = (s as any)?.text_content || '';
      }

      // Create a project_document for the dev engine work
      const docTitle = `EP ${String(params.episodeNumber).padStart(2, '0')} — Dev Engine Work`;
      const { data: doc, error: docErr } = await supabase
        .from('project_documents')
        .insert({
          project_id: projectId,
          user_id: user.id,
          doc_type: 'episode_script',
          title: docTitle,
          file_name: `ep${String(params.episodeNumber).padStart(2, '0')}_dev.md`,
          file_path: `${projectId}/dev-engine/ep${String(params.episodeNumber).padStart(2, '0')}_dev.md`,
        })
        .select('id')
        .single();
      if (docErr) throw docErr;

      // Create initial version with the episode script content
      const { data: ver, error: verErr } = await supabase
        .from('project_document_versions')
        .insert({
          document_id: doc.id,
          version_number: 1,
          plaintext: scriptText || '*(No script content yet)*',
          change_summary: `Imported from Series Writer EP ${params.episodeNumber}`,
          created_by: user.id,
          status: 'draft',
          inputs_used: {
            source: 'series_writer_handoff',
            episode_id: params.episodeId,
            episode_number: params.episodeNumber,
            original_script_id: params.scriptId,
          },
        })
        .select('id')
        .single();
      if (verErr) throw verErr;

      // Create the handoff record
      const { data: handoff, error: hErr } = await (supabase as any)
        .from('episode_handoffs')
        .insert({
          project_id: projectId,
          episode_id: params.episodeId,
          episode_number: params.episodeNumber,
          from_script_id: params.scriptId,
          dev_engine_doc_id: doc.id,
          dev_engine_version_id: ver.id,
          status: 'sent',
          issue_title: params.issueTitle,
          issue_description: params.issueDescription,
          desired_outcome: params.desiredOutcome,
          context_doc_keys: params.contextDocKeys,
          created_by: user.id,
        })
        .select()
        .single();
      if (hErr) throw hErr;

      // Mark episode as in_dev_engine
      await supabase
        .from('series_episodes')
        .update({ handoff_status: 'in_dev_engine' } as any)
        .eq('id', params.episodeId);

      return { handoff, docId: doc.id };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: handoffKey });
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      toast.success('Episode sent to Dev Engine');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Return episode to Series Writer ──
  const returnToSeriesWriter = useMutation({
    mutationFn: async (params: {
      handoffId: string;
      versionId: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch handoff
      const { data: handoff, error: hFetchErr } = await (supabase as any)
        .from('episode_handoffs')
        .select('*')
        .eq('id', params.handoffId)
        .single();
      if (hFetchErr || !handoff) throw new Error('Handoff not found');

      // Fetch the chosen version content
      const { data: ver, error: vErr } = await supabase
        .from('project_document_versions')
        .select('plaintext, change_summary')
        .eq('id', params.versionId)
        .single();
      if (vErr || !ver) throw new Error('Version not found');

      // Create a new script record for the Series Writer
      const { data: newScript, error: sErr } = await supabase
        .from('scripts')
        .insert({
          project_id: projectId,
          created_by: user.id,
          text_content: ver.plaintext || '',
          version_label: `EP ${String(handoff.episode_number).padStart(2, '0')} (from Dev Engine)`,
        })
        .select('id')
        .single();
      if (sErr) throw sErr;

      // Update the episode with the new script
      await supabase
        .from('series_episodes')
        .update({
          script_id: (newScript as any).id,
          handoff_status: 'returned',
          status: 'complete',
          validation_status: 'pending',
        } as any)
        .eq('id', handoff.episode_id);

      // Update handoff record
      await (supabase as any)
        .from('episode_handoffs')
        .update({
          status: 'returned',
          return_script_id: (newScript as any).id,
          dev_engine_version_id: params.versionId,
          returned_at: new Date().toISOString(),
        })
        .eq('id', params.handoffId);

      return { episodeId: handoff.episode_id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: handoffKey });
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      toast.success('Episode returned to Series Writer');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Cancel handoff ──
  const cancelHandoff = useMutation({
    mutationFn: async (handoffId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: handoff } = await (supabase as any)
        .from('episode_handoffs')
        .select('episode_id')
        .eq('id', handoffId)
        .single();
      if (!handoff) throw new Error('Handoff not found');

      await (supabase as any)
        .from('episode_handoffs')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', handoffId);

      // Unlock episode
      await supabase
        .from('series_episodes')
        .update({ handoff_status: null } as any)
        .eq('id', handoff.episode_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: handoffKey });
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      toast.success('Handoff cancelled — episode unlocked');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    handoffs,
    allHandoffs,
    isLoading,
    getActiveHandoff,
    sendToDevEngine,
    returnToSeriesWriter,
    cancelHandoff,
  };
}
