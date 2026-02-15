/**
 * IntegrationHub — Project-level industry integration management.
 * Provider connections, file imports, and normalized finance snapshots.
 */

import { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cable, Plus, Upload, FileSpreadsheet, CheckCircle2, Clock,
  AlertTriangle, Trash2, ChevronDown, ChevronUp, Loader2, Database,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { read, utils } from '@e965/xlsx';
import { supabase } from '@/integrations/supabase/client';
import {
  useIntegrationProviders,
  useIntegrationConnections,
  useIntegrationImports,
  useFinanceSnapshots,
  getCategoryLabel,
  getImportTypeLabel,
  type IntegrationProvider,
} from '@/hooks/useIntegrations';

// ---- Parse utilities ----

function autoDetectImportType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (/budget|topsheet|top.sheet/i.test(lower)) return 'budget';
  if (/cost.report|actual|eac|variance/i.test(lower)) return 'cost_report';
  if (/payroll|timesheets/i.test(lower)) return 'payroll_summary';
  if (/schedule|stripboard|dood/i.test(lower)) return 'schedule';
  if (/delivery|deliverable|qc/i.test(lower)) return 'delivery_spec';
  if (/incentive|rebate|tax.credit/i.test(lower)) return 'incentive_report';
  return 'budget'; // default
}

async function parseFileToText(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'json') {
    return await file.text();
  }
  if (ext === 'csv' || ext === 'txt') {
    return await file.text();
  }
  // XLS/XLSX
  const data = await file.arrayBuffer();
  const wb = read(data);
  let text = '';
  for (const name of wb.SheetNames) {
    const rows: any[][] = utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    text += `--- Sheet: ${name} ---\n`;
    for (const row of rows) {
      text += row.map(c => String(c ?? '')).join('\t') + '\n';
    }
  }
  return text;
}

// ---- Status icon ----

function StatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'parsing') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ---- Category colors ----

const CATEGORY_COLORS: Record<string, string> = {
  budgeting: 'bg-primary/15 text-primary border-primary/30',
  scheduling: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  payroll: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  accounting: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  bonding: 'bg-red-500/15 text-red-400 border-red-500/30',
  delivery: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  incentive_admin: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

// ---- Main component ----

interface Props {
  projectId: string;
}

export function IntegrationHub({ projectId }: Props) {
  const { data: providers = [] } = useIntegrationProviders();
  const { connections, addConnection, removeConnection } = useIntegrationConnections(projectId);
  const { imports, createImport, updateImport } = useIntegrationImports(projectId);
  const { snapshots, createSnapshot } = useFinanceSnapshots(projectId);

  const [showAddProvider, setShowAddProvider] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [importing, setImporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ providerId?: string; importType?: string } | null>(null);

  // Group providers by category
  const providersByCategory = useMemo(() => {
    const groups: Record<string, IntegrationProvider[]> = {};
    for (const p of providers) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }, [providers]);

  // Connected provider IDs
  const connectedProviderIds = new Set(connections.map(c => c.provider_id));

  // Available providers (not yet connected)
  const availableProviders = useMemo(() => {
    return providers.filter(p => !connectedProviderIds.has(p.id));
  }, [providers, connectedProviderIds]);

  const filteredAvailable = selectedCategory === 'all'
    ? availableProviders
    : availableProviders.filter(p => p.category === selectedCategory);

  // Resolve provider name from ID
  const providerMap = useMemo(() => {
    const m = new Map<string, IntegrationProvider>();
    for (const p of providers) m.set(p.id, p);
    return m;
  }, [providers]);

  // Handle file upload + AI parse
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const importType = uploadTarget?.importType || autoDetectImportType(file.name);
    setImporting(true);

    try {
      // Create import record
      const record = await createImport.mutateAsync({
        provider_id: uploadTarget?.providerId,
        import_type: importType,
        file_name: file.name,
        file_size_bytes: file.size,
        parse_status: 'parsing',
      });

      // Parse file to text
      const text = await parseFileToText(file);

      // Send to AI extraction edge function
      const { data, error } = await supabase.functions.invoke('parse-integration-import', {
        body: { text, file_name: file.name, import_type: importType },
      });

      if (error) throw error;

      const summary = data?.summary || {};

      // Update import record
      await updateImport.mutateAsync({
        id: (record as any).id,
        parse_status: 'complete',
        extracted_summary: summary,
      });

      // Create finance snapshot
      const snapshotData: Record<string, any> = { snapshot_type: importType, import_id: (record as any).id };
      if (importType === 'budget') snapshotData.baseline_budget = summary;
      else if (importType === 'cost_report') snapshotData.latest_cost_report = summary;
      else if (importType === 'payroll_summary') snapshotData.payroll_summary = summary;
      else if (importType === 'schedule') snapshotData.schedule_summary = summary;
      else if (importType === 'delivery_spec') snapshotData.delivery_summary = summary;

      if (summary.currency) snapshotData.currency = summary.currency;

      await createSnapshot.mutateAsync(snapshotData as any);

      toast.success(`Imported ${getImportTypeLabel(importType)} — ${file.name}`);
    } catch (err: any) {
      toast.error(err.message || 'Import failed');
      // Try to update the record as error
    } finally {
      setImporting(false);
      setUploadTarget(null);
    }
  };

  const triggerUpload = (providerId?: string, importType?: string) => {
    setUploadTarget({ providerId, importType });
    setTimeout(() => fileRef.current?.click(), 50);
  };

  // Latest snapshot per type
  const latestSnapshots = useMemo(() => {
    const m = new Map<string, typeof snapshots[0]>();
    for (const s of snapshots) {
      if (!m.has(s.snapshot_type)) m.set(s.snapshot_type, s);
    }
    return m;
  }, [snapshots]);

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.json,.txt,.mbb"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Industry Integrations</h3>
          <Badge variant="outline" className="text-[10px]">{connections.length} connected</Badge>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => triggerUpload()}
            disabled={importing}
          >
            {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Quick Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setShowAddProvider(!showAddProvider)}
          >
            <Plus className="h-3 w-3" /> Connect
          </Button>
        </div>
      </div>

      {/* Connected providers */}
      {connections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {connections.map(conn => {
            const prov = providerMap.get(conn.provider_id);
            if (!prov) return null;
            return (
              <div
                key={conn.id}
                className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">{prov.name}</div>
                  <div className="text-[10px] text-muted-foreground">{getCategoryLabel(prov.category)}</div>
                </div>
                <div className="flex items-center gap-1">
                  {prov.supported_import_types.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-primary"
                      onClick={() => triggerUpload(prov.id, prov.supported_import_types[0])}
                      title="Import file"
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeConnection.mutate(conn.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add provider panel */}
      <AnimatePresence>
        {showAddProvider && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-muted/20 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filter:</span>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {Object.keys(providersByCategory).map(cat => (
                      <SelectItem key={cat} value={cat}>{getCategoryLabel(cat)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {filteredAvailable.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { addConnection.mutate(p.id); setShowAddProvider(false); }}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/40 transition-colors"
                  >
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${CATEGORY_COLORS[p.category] || ''}`}>
                      {getCategoryLabel(p.category)}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.region.join(', ')} · {p.supported_import_types.map(getImportTypeLabel).join(', ')}
                      </div>
                    </div>
                    <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
                {filteredAvailable.length === 0 && (
                  <p className="text-xs text-muted-foreground col-span-2 text-center py-3">
                    All providers in this category are connected.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current Finance Snapshot Summary */}
      {latestSnapshots.size > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-foreground">Normalized Data</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from(latestSnapshots.entries()).map(([type, snap]) => {
              const summary = type === 'budget' ? snap.baseline_budget
                : type === 'cost_report' ? snap.latest_cost_report
                : type === 'payroll_summary' ? snap.payroll_summary
                : type === 'schedule' ? snap.schedule_summary
                : snap.delivery_summary;
              const total = (summary as any)?.total_budget || (summary as any)?.approved_budget || (summary as any)?.total_payroll;
              return (
                <div key={type} className="bg-muted/20 rounded-lg px-3 py-2">
                  <div className="text-[10px] text-muted-foreground">{getImportTypeLabel(type)}</div>
                  {total && (
                    <div className="text-sm font-semibold text-foreground">
                      {snap.currency || '$'}{Number(total).toLocaleString()}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(snap.snapshot_date).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Import History */}
      {imports.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Import History ({imports.length})</span>
            {historyOpen ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-1 mt-2 max-h-40 overflow-y-auto">
              {imports.map(imp => {
                const prov = imp.provider_id ? providerMap.get(imp.provider_id) : null;
                return (
                  <div key={imp.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-muted/20">
                    <StatusIcon status={imp.parse_status} />
                    <span className="text-foreground flex-1 truncate">{imp.file_name}</span>
                    <Badge variant="outline" className="text-[9px]">{getImportTypeLabel(imp.import_type)}</Badge>
                    {prov && <span className="text-muted-foreground text-[10px]">{prov.name}</span>}
                    <span className="text-muted-foreground text-[10px]">
                      {new Date(imp.created_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Empty state */}
      {connections.length === 0 && imports.length === 0 && (
        <div className="text-center py-6 space-y-2">
          <Cable className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <p className="text-xs text-muted-foreground">
            Connect industry-standard software to import budgets, schedules, cost reports, and payroll summaries.
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            Movie Magic · Entertainment Partners · Sargent-Disc · Vista · and more
          </p>
        </div>
      )}
    </div>
  );
}
