import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export interface ProjectParticipant {
  id: string;
  project_id: string;
  user_id: string;
  participant_name: string;
  participant_type: string;
  company: string;
  role_description: string;
  contact_email: string;
  notes: string;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectContract {
  id: string;
  project_id: string;
  user_id: string;
  participant_id: string | null;
  contract_type: string;
  title: string;
  status: string;
  currency: string;
  total_value: string;
  key_terms: Record<string, any>;
  territory: string;
  rights_granted: string;
  term_years: string;
  notes: string;
  source: string;
  version: number;
  executed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectOwnershipStake {
  id: string;
  project_id: string;
  user_id: string;
  participant_id: string | null;
  contract_id: string | null;
  stake_type: string;
  percentage: number;
  territory: string;
  rights_type: string;
  conditions: string;
  notes: string;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWaterfallRule {
  id: string;
  project_id: string;
  user_id: string;
  participant_id: string | null;
  contract_id: string | null;
  position: number;
  rule_name: string;
  rule_type: string;
  percentage: number;
  cap_amount: string;
  premium_pct: number;
  corridor_pct: number;
  conditions: string;
  notes: string;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// ---- Participants ----

export function useProjectParticipants(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-participants', projectId];

  const { data: participants = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_participants')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectParticipant[];
    },
    enabled: !!projectId,
  });

  const addParticipant = useMutation({
    mutationFn: async (input: Partial<ProjectParticipant>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_participants').insert({
        project_id: projectId!,
        user_id: user.id,
        participant_name: input.participant_name || '',
        participant_type: input.participant_type || 'producer',
        company: input.company || '',
        role_description: input.role_description || '',
        contact_email: input.contact_email || '',
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Participant added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateParticipant = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectParticipant> & { id: string }) => {
      const { error } = await supabase.from('project_participants').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteParticipant = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_participants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Participant removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { participants, isLoading, addParticipant, updateParticipant, deleteParticipant };
}

// ---- Contracts ----

export function useProjectContracts(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-contracts', projectId];

  const { data: contracts = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_contracts')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectContract[];
    },
    enabled: !!projectId,
  });

  const addContract = useMutation({
    mutationFn: async (input: Partial<ProjectContract>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_contracts').insert({
        project_id: projectId!,
        user_id: user.id,
        participant_id: input.participant_id || null,
        contract_type: input.contract_type || 'investment',
        title: input.title || '',
        status: input.status || 'draft',
        currency: input.currency || 'USD',
        total_value: input.total_value || '',
        key_terms: input.key_terms || {},
        territory: input.territory || '',
        rights_granted: input.rights_granted || '',
        term_years: input.term_years || '',
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Contract added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateContract = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectContract> & { id: string }) => {
      const { error } = await supabase.from('project_contracts').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteContract = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_contracts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Contract removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { contracts, isLoading, addContract, updateContract, deleteContract };
}

// ---- Ownership Stakes ----

export function useProjectOwnership(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-ownership', projectId];

  const { data: stakes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_ownership_stakes')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectOwnershipStake[];
    },
    enabled: !!projectId,
  });

  const addStake = useMutation({
    mutationFn: async (input: Partial<ProjectOwnershipStake>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_ownership_stakes').insert({
        project_id: projectId!,
        user_id: user.id,
        participant_id: input.participant_id || null,
        contract_id: input.contract_id || null,
        stake_type: input.stake_type || 'equity',
        percentage: input.percentage || 0,
        territory: input.territory || 'worldwide',
        rights_type: input.rights_type || 'all',
        conditions: input.conditions || '',
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Ownership stake added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStake = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectOwnershipStake> & { id: string }) => {
      const { error } = await supabase.from('project_ownership_stakes').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteStake = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_ownership_stakes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Stake removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { stakes, isLoading, addStake, updateStake, deleteStake };
}

// ---- Waterfall Rules ----

export function useProjectWaterfall(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-waterfall', projectId];

  const { data: rules = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_waterfall_rules')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectWaterfallRule[];
    },
    enabled: !!projectId,
  });

  const addRule = useMutation({
    mutationFn: async (input: Partial<ProjectWaterfallRule>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const nextPosition = rules.length > 0 ? Math.max(...rules.map(r => r.position)) + 1 : 0;
      const { error } = await supabase.from('project_waterfall_rules').insert({
        project_id: projectId!,
        user_id: user.id,
        participant_id: input.participant_id || null,
        contract_id: input.contract_id || null,
        position: input.position ?? nextPosition,
        rule_name: input.rule_name || '',
        rule_type: input.rule_type || 'recoupment',
        percentage: input.percentage || 0,
        cap_amount: input.cap_amount || '',
        premium_pct: input.premium_pct || 0,
        corridor_pct: input.corridor_pct || 0,
        conditions: input.conditions || '',
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Waterfall rule added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectWaterfallRule> & { id: string }) => {
      const { error } = await supabase.from('project_waterfall_rules').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_waterfall_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Rule removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { rules, isLoading, addRule, updateRule, deleteRule };
}
