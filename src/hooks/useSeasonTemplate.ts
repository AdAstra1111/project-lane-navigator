import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SetSeasonTemplateParams {
  docType: string;
  versionId: string;
  versionText: string;
}

/**
 * Derives a season_style_profile from episode content.
 * This extracts tone, pacing, dialogue patterns, and structural cues.
 */
function deriveStyleProfile(text: string, docType: string): Record<string, any> {
  const wordCount = text.split(/\s+/).length;
  const dialogueLines = (text.match(/^[A-Z][A-Z\s]+$/gm) || []).length;
  const totalLines = text.split('\n').filter(l => l.trim()).length;
  const dialogueRatio = totalLines > 0 ? Math.round((dialogueLines / totalLines) * 100) / 100 : 0;

  // Detect tone tags from content
  const toneTags: string[] = [];
  const lowerText = text.toLowerCase();
  if (/dark|gritty|noir|bleak/.test(lowerText)) toneTags.push('dark');
  if (/comedy|humor|funny|laugh/.test(lowerText)) toneTags.push('comedic');
  if (/suspens|thriller|tense|tension/.test(lowerText)) toneTags.push('suspenseful');
  if (/drama|emotional|heart/.test(lowerText)) toneTags.push('dramatic');
  if (/romance|love|passion/.test(lowerText)) toneTags.push('romantic');
  if (/horror|scare|terrif/.test(lowerText)) toneTags.push('horror');

  // Detect cliffhanger pattern
  const hasCliffhanger = /fade out|cut to black|to be continued|end of episode/i.test(text);

  // Detect forbidden elements (explicit markers)
  const forbiddenElements: string[] = [];
  const forbiddenMatch = text.match(/FORBIDDEN[:\s]+(.*)/gi);
  if (forbiddenMatch) {
    forbiddenMatch.forEach(m => forbiddenElements.push(m.replace(/FORBIDDEN[:\s]+/i, '').trim()));
  }

  // Pacing estimate
  const sceneCount = (text.match(/INT\.|EXT\./gi) || []).length;
  const pacingCategory = sceneCount > 15 ? 'fast' : sceneCount > 8 ? 'medium' : 'slow';

  return {
    source_doc_type: docType,
    word_count: wordCount,
    dialogue_ratio: dialogueRatio,
    tone_tags: toneTags.length > 0 ? toneTags : ['neutral'],
    pacing: pacingCategory,
    scene_count: sceneCount,
    has_cliffhanger_pattern: hasCliffhanger,
    forbidden_elements: forbiddenElements,
    derived_at: new Date().toISOString(),
  };
}

export function useSeasonTemplate(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docType, versionId, versionText }: SetSeasonTemplateParams) => {
      if (!projectId) throw new Error('No project ID');

      const styleProfile = deriveStyleProfile(versionText, docType);

      const { error } = await (supabase as any)
        .from('projects')
        .update({
          season_style_template_doc_type: docType,
          season_style_template_version_id: versionId,
          season_style_profile: styleProfile,
        })
        .eq('id', projectId);

      if (error) throw new Error(error.message);
      return { styleProfile };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dev-engine-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success('Season template set. Future episodes will match tone/pacing/quality.');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set season template');
    },
  });
}
