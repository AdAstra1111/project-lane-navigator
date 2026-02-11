import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Download, FileText, BarChart3, DollarSign, Package, Handshake, Receipt, Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useProjects } from '@/hooks/useProjects';
import { supabase } from '@/integrations/supabase/client';
import { exportDealsCSV, exportDeliverablesCSV, exportCostsCSV, exportBudgetCSV } from '@/lib/csv-export';
import { exportProjectPDF } from '@/lib/pdf-export';
import { toast } from '@/hooks/use-toast';

export default function Reports() {
  const { projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const project = useMemo(() => projects.find(p => p.id === selectedProject), [projects, selectedProject]);

  const runExport = async (key: string, fn: () => Promise<void>) => {
    setLoadingAction(key);
    try {
      await fn();
      toast({ title: 'Export complete' });
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoadingAction(null);
    }
  };

  const exportActions = useMemo(() => {
    if (!project) return [];
    return [
      {
        key: 'pdf',
        label: 'Project One-Pager (PDF)',
        icon: FileText,
        description: 'Lane, readiness, verdict, buyer matches',
        run: async () => {
          exportProjectPDF({ project: project as any, readiness: null, financeReadiness: null, cast: [], partners: [], hods: [], financeScenarios: [], buyerMatches: [], deals: [], deliverables: [], costSummary: null });
        },
      },
      {
        key: 'deals',
        label: 'Deals (CSV)',
        icon: Handshake,
        description: 'All deal records with status, amounts, territories',
        run: async () => {
          const { data } = await supabase.from('project_deals').select('*').eq('project_id', project.id);
          exportDealsCSV(data || [], project.title);
        },
      },
      {
        key: 'deliverables',
        label: 'Deliverables (CSV)',
        icon: Package,
        description: 'Deliverable items, deadlines, status',
        run: async () => {
          const { data } = await supabase.from('project_deliverables').select('*').eq('project_id', project.id);
          exportDeliverablesCSV(data || [], project.title);
        },
      },
      {
        key: 'costs',
        label: 'Costs (CSV)',
        icon: Receipt,
        description: 'All cost entries with vendors and categories',
        run: async () => {
          const { data } = await supabase.from('project_cost_entries').select('*').eq('project_id', project.id);
          exportCostsCSV(data || [], project.title);
        },
      },
      {
        key: 'budgets',
        label: 'Budget Lines (CSV)',
        icon: DollarSign,
        description: 'Budget breakdown by category',
        run: async () => {
          const { data: budgets } = await supabase.from('project_budgets').select('id, version_label').eq('project_id', project.id).limit(1);
          if (!budgets?.length) { toast({ title: 'No budgets found' }); return; }
          const { data: lines } = await supabase.from('project_budget_lines').select('*').eq('budget_id', budgets[0].id);
          exportBudgetCSV(lines || [], budgets[0].version_label, project.title);
        },
      },
      {
        key: 'contracts',
        label: 'Contracts (CSV)',
        icon: FileText,
        description: 'Contract ledger with terms and values',
        run: async () => {
          const { data } = await supabase.from('project_contracts').select('*').eq('project_id', project.id);
          const headers = ['Title', 'Type', 'Status', 'Territory', 'Value', 'Currency', 'Rights', 'Term', 'Executed', 'Expires'];
          const rows = (data || []).map((c: any) => [
            c.title || '', c.contract_type || '', c.status || '', c.territory || '',
            c.total_value || '', c.currency || '', c.rights_granted || '', c.term_years || '',
            c.executed_at ? new Date(c.executed_at).toLocaleDateString() : '',
            c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '',
          ]);
          // Inline CSV download
          const csv = [headers.join(','), ...rows.map((r: string[]) => r.map(v => `"${v.replace(/"/g, '""')}"`).join(','))].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `${project.title.replace(/\W/g, '_')}_contracts.csv`; a.click();
          URL.revokeObjectURL(url);
        },
      },
    ];
  }, [project]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Reports & Exports
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Generate PDFs and CSVs for any project</p>
          </div>
        </div>

        <div className="mb-6">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" disabled>Select a project…</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!project ? (
          <div className="text-center py-16 text-muted-foreground">
            <Download className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select a project above to see available exports</p>
          </div>
        ) : (
          <div className="space-y-3">
            {exportActions.map((action, i) => {
              const Icon = action.icon;
              return (
                <motion.div
                  key={action.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{action.label}</p>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runExport(action.key, action.run)}
                    disabled={loadingAction === action.key}
                  >
                    {loadingAction === action.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><Download className="h-4 w-4 mr-1" /> Export</>
                    )}
                  </Button>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
