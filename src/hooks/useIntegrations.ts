import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Types ----

export interface IntegrationProvider {
  id: string;
  key: string;
  name: string;
  category: string;
  supported_import_types: string[];
  supported_export_types: string[];
  region: string[];
  is_active: boolean;
  created_at: string;
}

export interface IntegrationConnection {
  id: string;
  project_id: string;
  provider_id: string;
  user_id: string;
  connection_type: string;
  last_sync_at: string | null;
  last_sync_status: string;
  metadata: Record<string, any>;
  created_at: string;
  provider?: IntegrationProvider;
}

export interface IntegrationImport {
  id: string;
  project_id: string;
  provider_id: string | null;
  user_id: string;
  import_type: string;
  file_name: string;
  file_path: string | null;
  file_size_bytes: number | null;
  parse_status: string;
  extracted_summary: Record<string, any>;
  error_message: string | null;
  created_at: string;
}

export interface FinanceSnapshot {
  id: string;
  project_id: string;
  snapshot_type: string;
  baseline_budget: Record<string, any>;
  latest_cost_report: Record<string, any>;
  payroll_summary: Record<string, any>;
  schedule_summary: Record<string, any>;
  delivery_summary: Record<string, any>;
  currency: string;
  snapshot_date: string;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  budgeting: 'Budgeting',
  scheduling: 'Scheduling',
  payroll: 'Payroll',
  accounting: 'Accounting',
  bonding: 'Bonding',
  delivery: 'Delivery',
  incentive_admin: 'Incentive Admin',
};

export const getCategoryLabel = (cat: string) => CATEGORY_LABELS[cat] || cat;

const IMPORT_TYPE_LABELS: Record<string, string> = {
  budget: 'Budget',
  schedule: 'Schedule',
  cost_report: 'Cost Report',
  payroll_summary: 'Payroll Summary',
  delivery_spec: 'Delivery Spec',
  incentive_report: 'Incentive Report',
};

export const getImportTypeLabel = (t: string) => IMPORT_TYPE_LABELS[t] || t;

// ---- Providers ----

export function useIntegrationProviders() {
  return useQuery({
    queryKey: ['integration-providers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_providers')
        .select('*')
        .eq('is_active', true)
        .order('category', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as IntegrationProvider[];
    },
  });
}

// ---- Connections ----

export function useIntegrationConnections(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['integration-connections', projectId];

  const { data: connections = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('integration_connections')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as IntegrationConnection[];
    },
    enabled: !!projectId,
  });

  const addConnection = useMutation({
    mutationFn: async (providerId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('integration_connections').insert({
        project_id: projectId!,
        provider_id: providerId,
        user_id: user.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Integration connected'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeConnection = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('integration_connections').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Integration disconnected'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { connections, isLoading, addConnection, removeConnection };
}

// ---- Imports ----

export function useIntegrationImports(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['integration-imports', projectId];

  const { data: imports = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('integration_imports')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as IntegrationImport[];
    },
    enabled: !!projectId,
  });

  const createImport = useMutation({
    mutationFn: async (input: {
      provider_id?: string;
      import_type: string;
      file_name: string;
      file_size_bytes?: number;
      extracted_summary?: Record<string, any>;
      parse_status?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('integration_imports').insert({
        project_id: projectId!,
        user_id: user.id,
        provider_id: input.provider_id || null,
        import_type: input.import_type,
        file_name: input.file_name,
        file_size_bytes: input.file_size_bytes || null,
        extracted_summary: input.extracted_summary || {},
        parse_status: input.parse_status || 'pending',
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateImport = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, any>) => {
      const { error } = await supabase.from('integration_imports').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { imports, isLoading, createImport, updateImport };
}

// ---- Finance Snapshots ----

export function useFinanceSnapshots(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['finance-snapshots', projectId];

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_finance_snapshots')
        .select('*')
        .eq('project_id', projectId)
        .order('snapshot_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as FinanceSnapshot[];
    },
    enabled: !!projectId,
  });

  const createSnapshot = useMutation({
    mutationFn: async (input: Partial<FinanceSnapshot> & { snapshot_type: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_finance_snapshots').insert({
        project_id: projectId!,
        user_id: user.id,
        ...input,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { snapshots, isLoading, createSnapshot };
}
