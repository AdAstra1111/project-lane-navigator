import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { approveAndActivate } from '@/lib/active-folder/approveAndActivate';

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

      // 4. Approve & activate in Active Project Folder
      if (versionId) {
        try {
          await approveAndActivate({
            projectId,
            documentVersionId: versionId,
            sourceFlow: 'publish_as_script',
          });
        } catch (err) {
          console.error('Approve+activate after publish failed:', err);
          // Non-fatal
        }
      }

      // 5. Auto-analysis removed — user starts Auto-Run manually from the project page.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-scripts', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['package-status', projectId] });
      toast.success('Script set as latest draft.');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set as latest draft');
    },
  });
}
