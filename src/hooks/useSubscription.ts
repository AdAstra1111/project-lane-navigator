import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

export type Plan = 'free' | 'pro' | 'enterprise';

export interface PlanLimits {
  maxProjects: number;
  aiAnalysesPerMonth: number;
  castResearchPerMonth: number;
  maxBuyerContacts: number;
  maxStorageBytes: number;
  maxSeats: number;
  hasScriptCoverage: boolean;
  hasCompAnalysis: boolean;
  hasSmartPackaging: boolean;
  hasExport: boolean;
  hasFinanceScenarios: number; // 0 = unlimited, else max per project
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxProjects: 2,
    aiAnalysesPerMonth: 5,
    castResearchPerMonth: 3,
    maxBuyerContacts: 10,
    maxStorageBytes: 100 * 1024 * 1024, // 100MB
    maxSeats: 1,
    hasScriptCoverage: false,
    hasCompAnalysis: false,
    hasSmartPackaging: false,
    hasExport: false,
    hasFinanceScenarios: 1,
  },
  pro: {
    maxProjects: 15,
    aiAnalysesPerMonth: 100,
    castResearchPerMonth: 50,
    maxBuyerContacts: 999999,
    maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5GB
    maxSeats: 3,
    hasScriptCoverage: true,
    hasCompAnalysis: true,
    hasSmartPackaging: true,
    hasExport: true,
    hasFinanceScenarios: 0,
  },
  enterprise: {
    maxProjects: 999999,
    aiAnalysesPerMonth: 999999,
    castResearchPerMonth: 999999,
    maxBuyerContacts: 999999,
    maxStorageBytes: 50 * 1024 * 1024 * 1024, // 50GB
    maxSeats: 10,
    hasScriptCoverage: true,
    hasCompAnalysis: true,
    hasSmartPackaging: true,
    hasExport: true,
    hasFinanceScenarios: 0,
  },
};

export function useSubscription() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ['usage', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('usage_tracking')
        .select('*')
        .eq('user_id', user.id)
        .gte('period_start', periodStart.toISOString())
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const plan: Plan = (subscription?.plan as Plan) || 'free';
  const limits = PLAN_LIMITS[plan];
  const loading = subLoading || usageLoading;

  const incrementUsage = useMutation({
    mutationFn: async (field: 'ai_analyses_used' | 'cast_research_used') => {
      if (!user) return;
      const periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);

      // Upsert current period
      const { data: existing } = await supabase
        .from('usage_tracking')
        .select('id, ' + field)
        .eq('user_id', user.id)
        .gte('period_start', periodStart.toISOString())
        .maybeSingle();

      if (existing && 'id' in existing) {
        await supabase
          .from('usage_tracking')
          .update({ [field]: (existing as any)[field] + 1 })
          .eq('id', (existing as any).id);
      } else {
        await supabase
          .from('usage_tracking')
          .insert({ user_id: user.id, period_start: periodStart.toISOString(), [field]: 1 });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });

  function canUseFeature(feature: keyof PlanLimits): boolean {
    return !!limits[feature];
  }

  function isOverLimit(type: 'ai' | 'research' | 'projects' | 'buyers'): boolean {
    if (!usage) return false;
    switch (type) {
      case 'ai':
        return limits.aiAnalysesPerMonth !== 999999 && (usage.ai_analyses_used ?? 0) >= limits.aiAnalysesPerMonth;
      case 'research':
        return limits.castResearchPerMonth !== 999999 && (usage.cast_research_used ?? 0) >= limits.castResearchPerMonth;
      case 'projects':
        return limits.maxProjects !== 999999 && (usage.projects_count ?? 0) >= limits.maxProjects;
      case 'buyers':
        return limits.maxBuyerContacts !== 999999 && (usage.buyer_contacts_count ?? 0) >= limits.maxBuyerContacts;
      default:
        return false;
    }
  }

  function requireUpgrade(featureName: string) {
    toast({
      title: 'Upgrade Required',
      description: `${featureName} requires a Pro or Enterprise plan.`,
      variant: 'destructive',
    });
  }

  function showLimitReached(limitType: string) {
    toast({
      title: 'Limit Reached',
      description: `You've reached your ${plan} plan limit for ${limitType}. Upgrade to continue.`,
      variant: 'destructive',
    });
  }

  return {
    subscription,
    usage,
    plan,
    limits,
    loading,
    canUseFeature,
    isOverLimit,
    requireUpgrade,
    showLimitReached,
    incrementUsage,
    PLAN_LIMITS,
  };
}
