import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SetAsDraftParams {
  title: string;
  text: string;
  /** Dev-engine document ID — used to update the package system */
  documentId?: string;
  /** Dev-engine version ID — set as latest_version_id in package */
  versionId?: string;
  /** Doc type (e.g. "treatment", "character_bible") */
  docType?: string;
}

export function useSetAsLatestDraft(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ title, text, documentId, versionId, docType }: SetAsDraftParams) => {
      if (!projectId) throw new Error('No project ID');
      if (!text || text.trim().length < 100) throw new Error('Document text is too short to register as a script draft');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Archive any existing "current" scripts
      await supabase
        .from('project_scripts')
        .update({ status: 'archived' })
        .eq('project_id', projectId)
        .eq('status', 'current');

      // 2. Create new project_scripts record (no file_path — text-only from dev engine)
      const { error: scriptErr } = await supabase.from('project_scripts').insert({
        project_id: projectId,
        user_id: user.id,
        version_label: title || 'Dev Engine Draft',
        status: 'current',
        file_path: '',
        notes: 'Promoted from Development Engine as latest draft',
      });
      if (scriptErr) throw new Error(scriptErr.message);

      // 3. Update the document package — set latest_version_id so Package tab reflects this
      if (documentId && versionId) {
        await (supabase as any)
          .from('project_documents')
          .update({ latest_version_id: versionId, updated_at: new Date().toISOString() })
          .eq('id', documentId)
          .eq('project_id', projectId);
      }

      // 4. Trigger project re-analysis with this text
      try {
        const { data: project } = await supabase
          .from('projects')
          .select('title, format, genres, budget_range, target_audience, tone, comparable_titles')
          .eq('id', projectId)
          .single();

        if (project) {
          const { data: allDocs } = await supabase
            .from('project_documents')
            .select('file_path')
            .eq('project_id', projectId);

          const allPaths = (allDocs || []).map(d => d.file_path).filter((p): p is string => !!p && p.trim() !== '');

          await supabase.functions.invoke('analyze-project', {
            body: {
              projectInput: {
                id: projectId,
                title: project.title,
                format: project.format,
                genres: project.genres,
                budget_range: project.budget_range,
                target_audience: project.target_audience,
                tone: project.tone,
                comparable_titles: project.comparable_titles,
              },
              documentPaths: allPaths,
            },
          });
        }
      } catch (err) {
        console.error('Re-analysis after draft promotion failed:', err);
        // Non-fatal
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-scripts', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['package-status', projectId] });
      toast.success('Script set as latest draft — re-analysing project…');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set as latest draft');
    },
  });
}
