/**
 * useImageEvaluation — Hook for evaluating images against Visual DNA
 * and persisting approval decisions.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  evaluateImageAgainstDNA,
  serializeEvaluationForStorage,
  serializeDecisionForStorage,
  type ImageEvaluation,
  type ApprovalDecision,
} from '@/lib/images/imageEvaluation';
import { resolveCharacterVisualDNA, type CharacterVisualDNA } from '@/lib/images/visualDNA';
import type { ProjectImage, CanonConstraints } from '@/lib/images/types';

export function useImageEvaluation(projectId: string | undefined) {
  const qc = useQueryClient();
  
  // Fetch evaluations for project
  const evaluationsQuery = useQuery({
    queryKey: ['image-evaluations', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await (supabase as any)
        .from('image_evaluations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!projectId,
  });
  
  // Evaluate a single image
  const evaluateMutation = useMutation({
    mutationFn: async (params: {
      image: ProjectImage;
      dna: CharacterVisualDNA | null;
      canonConstraints?: CanonConstraints;
    }) => {
      if (!projectId) throw new Error('No project');
      
      const evaluation = evaluateImageAgainstDNA(params.image, params.dna, params.canonConstraints);
      const serialized = serializeEvaluationForStorage(evaluation);
      
      const { data: session } = await supabase.auth.getSession();
      
      // Upsert evaluation
      const { error } = await (supabase as any)
        .from('image_evaluations')
        .upsert({
          project_id: projectId,
          ...serialized,
          created_by: session?.session?.user?.id,
          dna_version_id: null, // Link to DNA version if available
        }, {
          onConflict: 'image_id',
          ignoreDuplicates: false,
        });
      
      // If upsert fails due to no unique constraint, just insert
      if (error) {
        await (supabase as any)
          .from('image_evaluations')
          .insert({
            project_id: projectId,
            ...serialized,
            created_by: session?.session?.user?.id,
          });
      }
      
      return evaluation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['image-evaluations', projectId] });
    },
  });
  
  // Record approval/rejection decision
  const decideMutation = useMutation({
    mutationFn: async (params: {
      imageId: string;
      decision: ApprovalDecision;
    }) => {
      if (!projectId) throw new Error('No project');
      
      const { data: session } = await supabase.auth.getSession();
      const serialized = serializeDecisionForStorage(params.decision);
      
      // Find existing evaluation or create one
      const { data: existing } = await (supabase as any)
        .from('image_evaluations')
        .select('id')
        .eq('project_id', projectId)
        .eq('image_id', params.imageId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (existing?.[0]) {
        await (supabase as any)
          .from('image_evaluations')
          .update({
            ...serialized,
            decided_at: new Date().toISOString(),
            decided_by: session?.session?.user?.id,
          })
          .eq('id', existing[0].id);
      } else {
        await (supabase as any)
          .from('image_evaluations')
          .insert({
            project_id: projectId,
            image_id: params.imageId,
            ...serialized,
            decided_at: new Date().toISOString(),
            decided_by: session?.session?.user?.id,
            canon_match: 'unknown',
            continuity_match: 'unknown',
            narrative_fit: 'unknown',
            wardrobe_fit: 'unknown',
            drift_risk: 'unknown',
            evaluation_method: 'rule_based',
            created_by: session?.session?.user?.id,
          });
      }
      
      return params.decision;
    },
    onSuccess: (decision) => {
      qc.invalidateQueries({ queryKey: ['image-evaluations', projectId] });
      const label = decision.decisionType === 'approve' ? 'approved' :
        decision.decisionType === 'reuse_pool' ? 'sent to reuse pool' : 'rejected';
      toast.success(`Image ${label}`);
    },
    onError: (e: Error) => toast.error(`Decision failed: ${e.message}`),
  });
  
  // Get evaluation for a specific image
  const getEvaluation = (imageId: string) => {
    return (evaluationsQuery.data || []).find((e: any) => e.image_id === imageId);
  };
  
  return {
    evaluations: evaluationsQuery.data || [],
    isLoading: evaluationsQuery.isLoading,
    evaluate: evaluateMutation,
    decide: decideMutation,
    getEvaluation,
  };
}
