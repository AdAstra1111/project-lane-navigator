import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export interface ProjectCastMember {
  id: string;
  project_id: string;
  user_id: string;
  role_name: string;
  actor_name: string;
  status: string;
  territory_tags: string[];
  notes: string;
  agent_name: string;
  manager_name: string;
  agency: string;
  contact_phone: string;
  contact_email: string;
  imdb_id: string;
  tmdb_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectPartner {
  id: string;
  project_id: string;
  user_id: string;
  partner_name: string;
  partner_type: string; // co-producer | sales-agent | distributor | financier | broadcaster
  status: string; // identified | approached | in-discussion | confirmed
  territory: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectScript {
  id: string;
  project_id: string;
  user_id: string;
  version_label: string;
  status: string; // current | archived
  file_path: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFinanceScenario {
  id: string;
  project_id: string;
  user_id: string;
  scenario_name: string;
  total_budget: string;
  incentive_amount: string;
  presales_amount: string;
  equity_amount: string;
  gap_amount: string;
  other_sources: string;
  confidence: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectHOD {
  id: string;
  project_id: string;
  user_id: string;
  department: string;
  person_name: string;
  known_for: string;
  reputation_tier: string;
  status: string;
  notes: string;
  agent_name: string;
  manager_name: string;
  agency: string;
  contact_phone: string;
  contact_email: string;
  imdb_id: string;
  tmdb_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  user_id: string;
  update_type: string;
  title: string;
  description: string;
  impact_summary: string | null;
  created_at: string;
}

// ---- Cast ----

export function useProjectCast(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-cast', projectId];

  const { data: cast = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_cast')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectCastMember[];
    },
    enabled: !!projectId,
  });

  const addCast = useMutation({
    mutationFn: async (input: Partial<ProjectCastMember>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_cast').insert({
        project_id: projectId!,
        user_id: user.id,
        role_name: input.role_name || '',
        actor_name: input.actor_name || '',
        status: input.status || 'wishlist',
        territory_tags: input.territory_tags || [],
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Cast member added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCast = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectCastMember> & { id: string }) => {
      const { error } = await supabase.from('project_cast').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCast = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_cast').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Cast member removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { cast, isLoading, addCast, updateCast, deleteCast };
}

// ---- Partners ----

export function useProjectPartners(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-partners', projectId];

  const { data: partners = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_partners')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectPartner[];
    },
    enabled: !!projectId,
  });

  const addPartner = useMutation({
    mutationFn: async (input: Partial<ProjectPartner>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_partners').insert({
        project_id: projectId!,
        user_id: user.id,
        partner_name: input.partner_name || '',
        partner_type: input.partner_type || 'co-producer',
        status: input.status || 'identified',
        territory: input.territory || '',
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Partner added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePartner = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectPartner> & { id: string }) => {
      const { error } = await supabase.from('project_partners').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePartner = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_partners').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Partner removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { partners, isLoading, addPartner, updatePartner, deletePartner };
}

// ---- Scripts ----

export function useProjectScripts(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-scripts', projectId];

  const { data: scripts = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_scripts')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ProjectScript[];
    },
    enabled: !!projectId,
  });

  const addScript = useMutation({
    mutationFn: async (input: Partial<ProjectScript>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      // Archive existing current scripts
      if (input.status === 'current') {
        await supabase.from('project_scripts').update({ status: 'archived' })
          .eq('project_id', projectId!).eq('status', 'current');
      }
      const { error } = await supabase.from('project_scripts').insert({
        project_id: projectId!,
        user_id: user.id,
        version_label: input.version_label || 'Draft',
        status: input.status || 'current',
        file_path: input.file_path || null,
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Script version added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScript = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_scripts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Script removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { scripts, isLoading, addScript, deleteScript };
}

// ---- Finance Scenarios ----

export function useProjectFinance(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-finance', projectId];

  const { data: scenarios = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_finance_scenarios')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectFinanceScenario[];
    },
    enabled: !!projectId,
  });

  const addScenario = useMutation({
    mutationFn: async (input: Partial<ProjectFinanceScenario>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_finance_scenarios').insert({
        project_id: projectId!,
        user_id: user.id,
        scenario_name: input.scenario_name || `Scenario ${scenarios.length + 1}`,
        total_budget: input.total_budget || '',
        incentive_amount: input.incentive_amount || '',
        presales_amount: input.presales_amount || '',
        equity_amount: input.equity_amount || '',
        gap_amount: input.gap_amount || '',
        other_sources: input.other_sources || '',
        confidence: input.confidence || 'medium',
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Finance scenario added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScenario = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectFinanceScenario> & { id: string }) => {
      const { error } = await supabase.from('project_finance_scenarios').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScenario = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_finance_scenarios').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Scenario removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { scenarios, isLoading, addScenario, updateScenario, deleteScenario };
}

// ---- HODs (Heads of Department) ----

export function useProjectHODs(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-hods', projectId];

  const { data: hods = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_hods')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectHOD[];
    },
    enabled: !!projectId,
  });

  const addHOD = useMutation({
    mutationFn: async (input: Partial<ProjectHOD>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_hods').insert({
        project_id: projectId!,
        user_id: user.id,
        department: input.department || '',
        person_name: input.person_name || '',
        known_for: input.known_for || '',
        reputation_tier: input.reputation_tier || 'emerging',
        status: input.status || 'wishlist',
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('HOD added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateHOD = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectHOD> & { id: string }) => {
      const { error } = await supabase.from('project_hods').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteHOD = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_hods').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('HOD removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { hods, isLoading, addHOD, updateHOD, deleteHOD };
}

// ---- Updates Timeline ----

export function useProjectUpdates(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-updates', projectId];

  const { data: updates = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_updates')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as ProjectUpdate[];
    },
    enabled: !!projectId,
  });

  const addUpdate = useMutation({
    mutationFn: async (input: Partial<ProjectUpdate>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_updates').insert({
        project_id: projectId!,
        user_id: user.id,
        update_type: input.update_type || 'note',
        title: input.title || '',
        description: input.description || '',
        impact_summary: input.impact_summary || null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { updates, isLoading, addUpdate };
}
