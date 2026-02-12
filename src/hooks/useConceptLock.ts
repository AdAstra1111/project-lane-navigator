import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ConceptExpansion {
  id: string;
  pitch_idea_id: string;
  user_id: string;
  version: number;
  production_type: string;
  treatment: string;
  character_bible: string;
  world_bible: string;
  tone_doc: string;
  arc_map: string;
  raw_response: any;
  created_at: string;
  updated_at: string;
}

export interface StressTestResult {
  id: string;
  expansion_id: string;
  user_id: string;
  score_creative_structure: number;
  score_market_alignment: number;
  score_engine_sustainability: number;
  score_total: number;
  passed: boolean;
  details: any;
  created_at: string;
}

export interface ConceptLockVersion {
  id: string;
  pitch_idea_id: string;
  user_id: string;
  version: number;
  locked_fields: any;
  stress_test_id: string | null;
  expansion_id: string | null;
  locked_at: string;
  unlocked_at: string | null;
  unlock_reason: string | null;
}

export function useConceptExpansion(pitchIdeaId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: expansions = [], isLoading } = useQuery({
    queryKey: ['concept-expansions', pitchIdeaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('concept_expansions')
        .select('*')
        .eq('pitch_idea_id', pitchIdeaId)
        .order('version', { ascending: false });
      if (error) throw error;
      return data as ConceptExpansion[];
    },
    enabled: !!user && !!pitchIdeaId,
  });

  const latestExpansion = expansions[0] || null;

  const expandMutation = useMutation({
    mutationFn: async (params: { pitchIdea: any; productionType: string }) => {
      const { data, error } = await supabase.functions.invoke('expand-concept', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const nextVersion = (latestExpansion?.version || 0) + 1;
      const { data: saved, error: saveErr } = await supabase
        .from('concept_expansions')
        .insert({
          pitch_idea_id: pitchIdeaId,
          user_id: user!.id,
          version: nextVersion,
          production_type: params.productionType,
          treatment: data.treatment || '',
          character_bible: data.character_bible || '',
          world_bible: data.world_bible || '',
          tone_doc: data.tone_doc || '',
          arc_map: data.arc_map || '',
          raw_response: data,
        } as any)
        .select()
        .single();
      if (saveErr) throw saveErr;
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concept-expansions', pitchIdeaId] });
      toast.success('Expansion generated');
    },
    onError: (e: any) => toast.error(e.message || 'Expansion failed'),
  });

  return { expansions, latestExpansion, isLoading, expand: expandMutation.mutateAsync, expanding: expandMutation.isPending };
}

export function useStressTest(expansionId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: stressTests = [], isLoading } = useQuery({
    queryKey: ['stress-tests', expansionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('concept_stress_tests')
        .select('*')
        .eq('expansion_id', expansionId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StressTestResult[];
    },
    enabled: !!user && !!expansionId,
  });

  const latestTest = stressTests[0] || null;

  const testMutation = useMutation({
    mutationFn: async (params: { pitchIdea: any; expansion: any; productionType: string }) => {
      const { data, error } = await supabase.functions.invoke('stress-test-concept', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: saved, error: saveErr } = await supabase
        .from('concept_stress_tests')
        .insert({
          expansion_id: expansionId!,
          user_id: user!.id,
          score_creative_structure: data.score_creative_structure,
          score_market_alignment: data.score_market_alignment,
          score_engine_sustainability: data.score_engine_sustainability,
          score_total: data.score_total,
          passed: data.passed,
          details: data.details,
        } as any)
        .select()
        .single();
      if (saveErr) throw saveErr;
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stress-tests', expansionId] });
      toast.success('Stress test complete');
    },
    onError: (e: any) => toast.error(e.message || 'Stress test failed'),
  });

  return { stressTests, latestTest, isLoading, runTest: testMutation.mutateAsync, testing: testMutation.isPending };
}

export function useConceptLockVersions(pitchIdeaId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: versions = [] } = useQuery({
    queryKey: ['concept-lock-versions', pitchIdeaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('concept_lock_versions')
        .select('*')
        .eq('pitch_idea_id', pitchIdeaId)
        .order('version', { ascending: false });
      if (error) throw error;
      return data as ConceptLockVersion[];
    },
    enabled: !!user && !!pitchIdeaId,
  });

  const lockMutation = useMutation({
    mutationFn: async (params: { lockedFields: any; stressTestId: string; expansionId: string }) => {
      const nextVersion = (versions[0]?.version || 0) + 1;
      const { error: lockErr } = await supabase
        .from('concept_lock_versions')
        .insert({
          pitch_idea_id: pitchIdeaId,
          user_id: user!.id,
          version: nextVersion,
          locked_fields: params.lockedFields,
          stress_test_id: params.stressTestId,
          expansion_id: params.expansionId,
        } as any);
      if (lockErr) throw lockErr;

      const { error: updateErr } = await supabase
        .from('pitch_ideas')
        .update({ concept_lock_status: 'locked', concept_lock_version: nextVersion } as any)
        .eq('id', pitchIdeaId);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concept-lock-versions', pitchIdeaId] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      toast.success('Concept locked');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (reason: string) => {
      const latest = versions[0];
      if (latest) {
        await supabase
          .from('concept_lock_versions')
          .update({ unlocked_at: new Date().toISOString(), unlock_reason: reason } as any)
          .eq('id', latest.id);
      }
      await supabase
        .from('pitch_ideas')
        .update({ concept_lock_status: 'unlocked' } as any)
        .eq('id', pitchIdeaId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concept-lock-versions', pitchIdeaId] });
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      toast.success('Concept unlocked — re-testing required');
    },
  });

  return { versions, lock: lockMutation.mutateAsync, unlock: unlockMutation.mutateAsync };
}
