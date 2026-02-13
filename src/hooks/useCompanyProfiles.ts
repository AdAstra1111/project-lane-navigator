import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { CompanyIntelligenceProfile } from "@/lib/paradox-house-mode";

export function useCompanyProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["company-intelligence-profiles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_intelligence_profiles")
        .select("*")
        .order("company_name");
      if (error) throw error;
      return (data || []) as CompanyIntelligenceProfile[];
    },
    enabled: !!user,
  });
}

export function useActiveCompanyProfile(profileId: string | null) {
  return useQuery({
    queryKey: ["company-intelligence-profile", profileId],
    queryFn: async () => {
      if (!profileId) return null;
      const { data, error } = await supabase
        .from("company_intelligence_profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle();
      if (error) throw error;
      return data as CompanyIntelligenceProfile | null;
    },
    enabled: !!profileId,
  });
}

export function useSetActiveProfile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string | null) => {
      const { error } = await supabase
        .from("projects")
        .update({ active_company_profile_id: profileId })
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}
