/**
 * React Query hooks for the Actor Promotion system.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  evaluateActorPromotionEligibility,
  applyActorPromotionDecision,
  getPromotionDecisions,
  getActorPromotionState,
  type PromotionAction,
  type PromotionEligibility,
  type PromotionDecision,
  type ActorPromotionState,
} from './promotionPolicy';

export function usePromotionEligibility(actorId: string | undefined) {
  return useQuery<PromotionEligibility | null>({
    queryKey: ['promotion-eligibility', actorId],
    queryFn: () => actorId ? evaluateActorPromotionEligibility(actorId) : null,
    enabled: !!actorId,
    staleTime: 30_000,
  });
}

export function usePromotionDecisions(actorId: string | undefined) {
  return useQuery<PromotionDecision[]>({
    queryKey: ['promotion-decisions', actorId],
    queryFn: () => actorId ? getPromotionDecisions(actorId) : [],
    enabled: !!actorId,
  });
}

export function useActorPromotionState(actorId: string | undefined) {
  return useQuery<ActorPromotionState | null>({
    queryKey: ['actor-promotion-state', actorId],
    queryFn: () => actorId ? getActorPromotionState(actorId) : null,
    enabled: !!actorId,
  });
}

export function useApplyPromotionDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      actorId: string;
      actorVersionId?: string;
      action: PromotionAction;
      overrideReason?: string;
      decisionNote?: string;
    }) => applyActorPromotionDecision(input),
    onSuccess: (decision) => {
      const actionLabels: Record<string, string> = {
        approved: 'Actor approved for roster',
        rejected: 'Actor rejected',
        override_approved: 'Actor override-approved for roster',
        override_rejected: 'Actor override-rejected',
        revoked: 'Actor roster access revoked',
      };
      toast.success(actionLabels[decision.final_decision_status] || 'Decision recorded');
      qc.invalidateQueries({ queryKey: ['promotion-eligibility'] });
      qc.invalidateQueries({ queryKey: ['promotion-decisions'] });
      qc.invalidateQueries({ queryKey: ['actor-promotion-state'] });
      qc.invalidateQueries({ queryKey: ['ai-actors'] });
      qc.invalidateQueries({ queryKey: ['ai-actor'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
