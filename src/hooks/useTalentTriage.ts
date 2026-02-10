import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type TriageStatus = 'unsorted' | 'shortlist' | 'maybe' | 'no' | 'pass';

export interface TalentTriageItem {
  id: string;
  project_id: string;
  user_id: string;
  person_name: string;
  person_type: string;
  status: TriageStatus;
  priority_rank: number;
  suggestion_source: string;
  suggestion_context: string;
  role_suggestion: string;
  creative_fit: string;
  commercial_case: string;
  created_at: string;
  updated_at: string;
}

interface AddTriageInput {
  person_name: string;
  person_type: string;
  suggestion_source: string;
  suggestion_context?: string;
  role_suggestion?: string;
  creative_fit?: string;
  commercial_case?: string;
}

export function useTalentTriage(projectId: string) {
  const { user } = useAuth();
  const [items, setItems] = useState<TalentTriageItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_talent_triage' as any)
      .select('*')
      .eq('project_id', projectId)
      .order('priority_rank', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch triage items:', error);
    } else {
      setItems((data as any[]) || []);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItems = useCallback(async (inputs: AddTriageInput[]) => {
    if (!user || !projectId) return;
    const rows = inputs.map(input => ({
      project_id: projectId,
      user_id: user.id,
      person_name: input.person_name,
      person_type: input.person_type,
      suggestion_source: input.suggestion_source,
      suggestion_context: input.suggestion_context || '',
      role_suggestion: input.role_suggestion || '',
      creative_fit: input.creative_fit || '',
      commercial_case: input.commercial_case || '',
      status: 'unsorted',
      priority_rank: 0,
    }));
    const { error } = await supabase.from('project_talent_triage' as any).insert(rows as any);
    if (error) {
      toast.error('Failed to save suggestions');
      console.error(error);
    } else {
      await fetchItems();
    }
  }, [user, projectId, fetchItems]);

  const updateStatus = useCallback(async (id: string, status: TriageStatus) => {
    const { error } = await supabase
      .from('project_talent_triage' as any)
      .update({ status } as any)
      .eq('id', id);
    if (error) {
      toast.error('Failed to update status');
    } else {
      setItems(prev => prev.map(item => item.id === id ? { ...item, status } : item));
    }
  }, []);

  const updatePriorityRank = useCallback(async (id: string, priority_rank: number) => {
    const { error } = await supabase
      .from('project_talent_triage' as any)
      .update({ priority_rank } as any)
      .eq('id', id);
    if (error) {
      toast.error('Failed to update priority');
    } else {
      setItems(prev => prev.map(item => item.id === id ? { ...item, priority_rank } : item));
    }
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('project_talent_triage' as any)
      .delete()
      .eq('id', id);
    if (error) {
      toast.error('Failed to delete');
    } else {
      setItems(prev => prev.filter(item => item.id !== id));
    }
  }, []);

  const byStatus = (status: TriageStatus) => 
    items
      .filter(i => i.status === status)
      .sort((a, b) => status === 'shortlist' ? a.priority_rank - b.priority_rank : 0);

  return {
    items,
    loading,
    addItems,
    updateStatus,
    updatePriorityRank,
    deleteItem,
    refetch: fetchItems,
    unsorted: byStatus('unsorted'),
    shortlisted: byStatus('shortlist'),
    maybes: byStatus('maybe'),
    nos: byStatus('no'),
    passed: byStatus('pass'),
  };
}
