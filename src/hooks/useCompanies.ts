import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProductionCompany {
  id: string;
  user_id: string;
  name: string;
  logo_url: string;
  color_accent: string;
  jurisdiction: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCompanyLink {
  id: string;
  project_id: string;
  company_id: string;
  user_id: string;
  created_at: string;
}

export function useCompanies() {
  const queryClient = useQueryClient();

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['production-companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_companies')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as unknown as ProductionCompany[];
    },
  });

  const createCompany = useMutation({
    mutationFn: async (name: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('production_companies')
        .insert({ user_id: user.id, name })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ProductionCompany;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-companies'] });
      toast.success('Production company created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCompany = useMutation({
    mutationFn: async (updates: { id: string; name?: string; logo_url?: string; color_accent?: string; jurisdiction?: string }) => {
      const { id, ...fields } = updates;
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) payload[k] = v;
      }
      const { error } = await supabase
        .from('production_companies')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-companies'] });
      queryClient.invalidateQueries({ queryKey: ['production-company'] });
      toast.success('Company updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCompany = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('production_companies')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-companies'] });
      toast.success('Company deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { companies, isLoading, createCompany, updateCompany, deleteCompany };
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['production-company', id],
    queryFn: async () => {
      if (!id) throw new Error('No company ID');
      const { data, error } = await supabase
        .from('production_companies')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as ProductionCompany;
    },
    enabled: !!id,
  });
}

export function useCompanyProjects(companyId: string | undefined) {
  return useQuery({
    queryKey: ['company-projects', companyId],
    queryFn: async () => {
      if (!companyId) throw new Error('No company ID');
      // Get linked project IDs
      const { data: links, error: linkErr } = await supabase
        .from('project_company_links')
        .select('project_id')
        .eq('company_id', companyId);
      if (linkErr) throw linkErr;
      if (!links || links.length === 0) return [];
      const projectIds = links.map((l: any) => l.project_id);
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!companyId,
  });
}

export function useProjectCompanies(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: linkedCompanyIds = [] } = useQuery({
    queryKey: ['project-company-links', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_company_links')
        .select('company_id')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data || []).map((l: any) => l.company_id as string);
    },
    enabled: !!projectId,
  });

  const linkProject = useMutation({
    mutationFn: async ({ projectId, companyId }: { projectId: string; companyId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('project_company_links')
        .insert({ project_id: projectId, company_id: companyId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['project-company-links', vars.projectId] });
      queryClient.invalidateQueries({ queryKey: ['company-projects', vars.companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlinkProject = useMutation({
    mutationFn: async ({ projectId, companyId }: { projectId: string; companyId: string }) => {
      const { error } = await supabase
        .from('project_company_links')
        .delete()
        .eq('project_id', projectId)
        .eq('company_id', companyId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['project-company-links', vars.projectId] });
      queryClient.invalidateQueries({ queryKey: ['company-projects', vars.companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { linkedCompanyIds, linkProject, unlinkProject };
}
