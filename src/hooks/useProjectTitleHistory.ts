/**
 * useProjectTitleHistory — Governed title management with history, aliases, and downstream propagation.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Types ──

export type TitleType = 'canonical' | 'former_canonical' | 'working' | 'alias' | 'market_title';

export interface TitleHistoryEntry {
  id: string;
  project_id: string;
  title: string;
  normalized_title: string;
  title_type: TitleType;
  is_current: boolean;
  effective_from: string;
  effective_to: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RenameOptions {
  reason?: string;
  /** Which downstream surfaces to propagate the new title to */
  propagate?: {
    documents?: boolean;
    posterOverride?: boolean;
    deckFields?: boolean;
  };
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── Hook ──

export function useProjectTitleHistory(projectId: string | undefined) {
  const qc = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['project-title-history', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('project_title_history')
        .select('*')
        .eq('project_id', projectId)
        .order('effective_from', { ascending: false });
      if (error) throw error;
      return (data || []) as TitleHistoryEntry[];
    },
    enabled: !!projectId,
    staleTime: 15_000,
  });

  const currentCanonical = history.find(h => h.is_current && h.title_type === 'canonical') || null;
  const formerTitles = history.filter(h => h.title_type === 'former_canonical');
  const workingTitles = history.filter(h => h.title_type === 'working');
  const aliases = history.filter(h => h.title_type === 'alias');
  const marketTitles = history.filter(h => h.title_type === 'market_title');

  // ── Governed rename action ──
  const renameMutation = useMutation({
    mutationFn: async ({ newTitle, options = {} }: { newTitle: string; options?: RenameOptions }) => {
      if (!projectId) throw new Error('No project');
      const trimmed = newTitle.trim();
      if (!trimmed) throw new Error('Title cannot be empty');

      const { data: user } = await supabase.auth.getUser();
      const userId = user?.user?.id || null;
      const now = new Date().toISOString();
      const normalizedNew = normalize(trimmed);

      // IEL: Check for duplicate canonical within same project
      const existingDupe = history.find(
        h => h.normalized_title === normalizedNew && h.title_type === 'canonical' && h.is_current
      );
      if (existingDupe) {
        throw new Error('project_title_governance_violation: Title is already the current canonical title');
      }

      // 1. Mark current canonical as former_canonical
      if (currentCanonical) {
        const { error: updateErr } = await (supabase as any)
          .from('project_title_history')
          .update({
            is_current: false,
            title_type: 'former_canonical',
            effective_to: now,
          })
          .eq('id', currentCanonical.id);
        if (updateErr) throw updateErr;
      }

      // 2. Insert new canonical entry
      const { error: insertErr } = await (supabase as any)
        .from('project_title_history')
        .insert({
          project_id: projectId,
          title: trimmed,
          normalized_title: normalizedNew,
          title_type: 'canonical',
          is_current: true,
          effective_from: now,
          change_reason: options.reason || 'User rename',
          created_by: userId,
        });
      if (insertErr) throw insertErr;

      // 3. Update projects.title (canonical source)
      const { error: projErr } = await supabase
        .from('projects')
        .update({ title: trimmed })
        .eq('id', projectId);
      if (projErr) throw projErr;

      // 4. Downstream propagation (controlled)
      if (options.propagate?.posterOverride) {
        // Update poster_settings title override if exists
        await (supabase as any)
          .from('poster_settings')
          .update({ title_override: trimmed })
          .eq('project_id', projectId);
      }

      return { title: trimmed };
    },
    onSuccess: ({ title }) => {
      toast.success(`Project renamed to "${title}"`);
      qc.invalidateQueries({ queryKey: ['project-title-history', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project'] });
      qc.invalidateQueries({ queryKey: ['dev-engine-project'] });
      qc.invalidateQueries({ queryKey: ['company-projects'] });
    },
    onError: (err: Error) => {
      if (err.message.includes('project_title_governance_violation')) {
        toast.error('This is already the current title');
      } else {
        toast.error(`Rename failed: ${err.message}`);
      }
    },
  });

  // ── Add working title / alias ──
  const addTitleMutation = useMutation({
    mutationFn: async ({ title, titleType }: { title: string; titleType: TitleType }) => {
      if (!projectId) throw new Error('No project');
      const trimmed = title.trim();
      if (!trimmed) throw new Error('Title cannot be empty');

      const { data: user } = await supabase.auth.getUser();

      const { error } = await (supabase as any)
        .from('project_title_history')
        .insert({
          project_id: projectId,
          title: trimmed,
          normalized_title: normalize(trimmed),
          title_type: titleType,
          is_current: false,
          effective_from: new Date().toISOString(),
          change_reason: `Added ${titleType.replace('_', ' ')}`,
          created_by: user?.user?.id || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-title-history', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Bootstrap: seed current title into history if no entries exist ──
  const bootstrapMutation = useMutation({
    mutationFn: async (currentTitle: string) => {
      if (!projectId || !currentTitle) return;
      // Only bootstrap if history is empty
      if (history.length > 0) return;

      const { data: user } = await supabase.auth.getUser();
      await (supabase as any)
        .from('project_title_history')
        .insert({
          project_id: projectId,
          title: currentTitle,
          normalized_title: normalize(currentTitle),
          title_type: 'canonical',
          is_current: true,
          effective_from: new Date().toISOString(),
          change_reason: 'Initial title',
          created_by: user?.user?.id || null,
        });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-title-history', projectId] });
    },
  });

  return {
    history,
    isLoading,
    currentCanonical,
    formerTitles,
    workingTitles,
    aliases,
    marketTitles,
    rename: renameMutation,
    addTitle: addTitleMutation,
    bootstrap: bootstrapMutation,
    allTitles: history.map(h => h.title),
  };
}
