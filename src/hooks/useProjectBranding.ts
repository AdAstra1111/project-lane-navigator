/**
 * useProjectBranding — Shared branding resolver for a project.
 * Resolves company logo + name from project → company link.
 * Single source of truth for Poster Engine, PDF export, and any branded surface.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectBranding {
  companyName: string | null;
  companyLogoUrl: string | null;
  colorAccent: string | null;
  source: "company" | "none";
}

/**
 * Resolve branding for a project via its linked production company.
 * Priority: production_companies.logo_url (company page upload) → null fallback.
 */
export function useProjectBranding(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-branding", projectId],
    queryFn: async (): Promise<ProjectBranding> => {
      if (!projectId) return { companyName: null, companyLogoUrl: null, colorAccent: null, source: "none" };

      // Resolve project → company link → company record
      const { data: links } = await supabase
        .from("project_company_links")
        .select("company_id")
        .eq("project_id", projectId)
        .limit(1);

      if (!links?.length) {
        return { companyName: null, companyLogoUrl: null, colorAccent: null, source: "none" };
      }

      const companyId = (links[0] as any).company_id;
      const { data: company } = await supabase
        .from("production_companies")
        .select("name, logo_url, color_accent")
        .eq("id", companyId)
        .single();

      if (!company) {
        return { companyName: null, companyLogoUrl: null, colorAccent: null, source: "none" };
      }

      return {
        companyName: (company as any).name || null,
        companyLogoUrl: (company as any).logo_url || null,
        colorAccent: (company as any).color_accent || null,
        source: "company",
      };
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}
