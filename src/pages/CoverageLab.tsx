import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FlaskConical, FileText, BookOpen, BarChart3, Settings2, Plus, Copy, Archive,
  ChevronDown, Save, Play, Loader2, CheckCircle2, TrendingUp, AlertTriangle,
  Target, Eye
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format as fmtDate } from 'date-fns';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { GreatNotesLibrary } from '@/components/script/GreatNotesLibrary';

// ─── Prompt Versions Tab ───
function PromptVersionsTab() {
  const { user } = useAuth();
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', analyst_prompt: '', producer_prompt: '', qc_prompt: '', project_type_scope: '' as string, output_contract: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadVersions(); }, []);

  const loadVersions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('coverage_prompt_versions')
      .select('*')
      .order('created_at', { ascending: false });
    setVersions((data as any[]) || []);
    setLoading(false);
  };

  const startEdit = (v: any) => {
    setEditingId(v.id);
    setEditForm({
      name: v.name,
      analyst_prompt: v.analyst_prompt,
      producer_prompt: v.producer_prompt,
      qc_prompt: v.qc_prompt,
      project_type_scope: (v.project_type_scope || []).join(', '),
      output_contract: JSON.stringify(v.output_contract || {}, null, 2),
    });
  };

  const handleSave = async () => {
    if (!editingId) return;
    let outputContract = {};
    try { outputContract = JSON.parse(editForm.output_contract); } catch { /* keep empty */ }
    const { error } = await supabase.from('coverage_prompt_versions').update({
      name: editForm.name,
      analyst_prompt: editForm.analyst_prompt,
      producer_prompt: editForm.producer_prompt,
      qc_prompt: editForm.qc_prompt,
      project_type_scope: editForm.project_type_scope.split(',').map(s => s.trim()).filter(Boolean),
      output_contract: outputContract,
    } as any).eq('id', editingId);
    if (error) { toast.error('Failed to save'); return; }
    toast.success('Prompt version saved');
    setEditingId(null);
    loadVersions();
  };

  const handleClone = async (v: any) => {
    if (!user) return;
    const { error } = await supabase.from('coverage_prompt_versions').insert({
      name: `${v.name} (copy)`,
      status: 'draft',
      analyst_prompt: v.analyst_prompt,
      producer_prompt: v.producer_prompt,
      qc_prompt: v.qc_prompt,
      project_type_scope: v.project_type_scope,
      output_contract: v.output_contract,
      created_by: user.id,
    } as any);
    if (error) { toast.error('Failed to clone'); return; }
    toast.success('Cloned prompt version');
    loadVersions();
  };

  const handleArchive = async (id: string) => {
    await supabase.from('coverage_prompt_versions').update({ status: 'archived' } as any).eq('id', id);
    toast.success('Version archived');
    loadVersions();
  };

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    const { error } = await supabase.from('coverage_prompt_versions').insert({
      name: 'New Version',
      status: 'draft',
      analyst_prompt: 'You are a strict script analyst...',
      producer_prompt: 'You are a producer-grade story editor...',
      qc_prompt: 'You are a coverage quality controller...',
      project_type_scope: [],
      output_contract: {},
      created_by: user.id,
    } as any);
    setCreating(false);
    if (error) { toast.error('Failed to create'); return; }
    toast.success('New prompt version created');
    loadVersions();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{versions.length} prompt versions</p>
        <Button size="sm" onClick={handleCreate} disabled={creating} className="text-xs gap-1.5">
          <Plus className="h-3 w-3" /> New Version
        </Button>
      </div>

      {versions.map(v => (
        <div key={v.id} className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{v.name}</span>
              <Badge variant={v.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{v.status}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => handleClone(v)}>
                <Copy className="h-3 w-3 mr-1" /> Clone
              </Button>
              {v.status !== 'archived' && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => handleArchive(v.id)}>
                  <Archive className="h-3 w-3 mr-1" /> Archive
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => startEdit(v)}>
                <Settings2 className="h-3 w-3 mr-1" /> Edit
              </Button>
            </div>
          </div>
          <div className="px-3 pb-3 text-[10px] text-muted-foreground flex gap-3">
            <span>Scope: {(v.project_type_scope || []).join(', ') || 'All'}</span>
            <span>Created: {fmtDate(new Date(v.created_at), 'dd MMM yyyy')}</span>
          </div>
        </div>
      ))}

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Prompt Version: {editForm.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Project Type Scope (comma-separated)</label>
                <Input value={editForm.project_type_scope} onChange={e => setEditForm(p => ({ ...p, project_type_scope: e.target.value }))} className="h-8 text-xs" placeholder="Film, TV Series, …" />
              </div>
            </div>
            {(['analyst_prompt', 'producer_prompt', 'qc_prompt'] as const).map(field => (
              <div key={field}>
                <label className="text-xs text-muted-foreground mb-1 block capitalize">{field.replace('_', ' ')}</label>
                <Textarea
                  value={editForm[field]}
                  onChange={e => setEditForm(p => ({ ...p, [field]: e.target.value }))}
                  rows={8}
                  className="text-xs font-mono"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Output Contract (JSON)</label>
              <Textarea
                value={editForm.output_contract}
                onChange={e => setEditForm(p => ({ ...p, output_contract: e.target.value }))}
                rows={6}
                className="text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5"><Save className="h-3 w-3" /> Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── House Style Tab ───
function HouseStyleTab() {
  const [style, setStyle] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState('');
  const [styleName, setStyleName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('house_style').select('*').limit(1).single().then(({ data }) => {
      setStyle(data);
      if (data) {
        setJson(JSON.stringify((data as any).preferences || {}, null, 2));
        setStyleName((data as any).style_name || '');
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!style) return;
    let prefs = {};
    try { prefs = JSON.parse(json); } catch { toast.error('Invalid JSON'); return; }
    const { error } = await supabase.from('house_style').update({
      preferences: prefs,
      style_name: styleName,
      updated_at: new Date().toISOString(),
    } as any).eq('id', (style as any).id);
    if (error) { toast.error('Failed to save'); return; }
    toast.success('House style saved');
    setEditing(false);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">{styleName || 'House Style'}</h4>
          <p className="text-xs text-muted-foreground">Coverage tone, preferences, and rules injected into every run</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Style Name</label>
            <Input value={styleName} onChange={e => setStyleName(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Preferences (JSON)</label>
            <Textarea value={json} onChange={e => setJson(e.target.value)} rows={14} className="text-xs font-mono" />
          </div>
          <Button size="sm" onClick={handleSave} className="gap-1.5"><Save className="h-3 w-3" /> Save</Button>
        </div>
      ) : (
        <pre className="text-xs font-mono p-4 rounded-lg bg-muted/30 border border-border/50 overflow-auto max-h-[400px] text-muted-foreground">
          {json || '{}'}
        </pre>
      )}
    </div>
  );
}

// ─── Benchmarks Tab ───
function BenchmarksTab() {
  const [benchmarks, setBenchmarks] = useState<any[]>([]);
  const [benchmarkRuns, setBenchmarkRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('coverage_benchmarks').select('*').order('created_at', { ascending: false }),
      supabase.from('coverage_benchmark_runs').select('*').order('created_at', { ascending: false }).limit(50),
    ]).then(([{ data: bm }, { data: br }]) => {
      setBenchmarks((bm as any[]) || []);
      setBenchmarkRuns((br as any[]) || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{benchmarks.length} benchmark scripts</p>
      </div>

      {benchmarks.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Target className="h-8 w-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">No benchmarks yet</p>
          <p className="text-xs text-muted-foreground/70">Use "Save as Benchmark" on a coverage run to create one</p>
        </div>
      ) : (
        <div className="space-y-3">
          {benchmarks.map(bm => {
            const runs = benchmarkRuns.filter(r => (r as any).benchmark_id === bm.id);
            const mustCatch = (bm as any).must_catch_issues || [];
            return (
              <Collapsible key={bm.id}>
                <div className="rounded-lg border border-border/50 bg-card/50">
                  <CollapsibleTrigger className="w-full p-3 text-left">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">{(bm as any).name}</span>
                        <Badge variant="secondary" className="text-[10px]">{(bm as any).project_type}</Badge>
                        <span className="text-[10px] text-muted-foreground">{mustCatch.length} must-catch issues</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{runs.length} runs</span>
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3 space-y-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Must-Catch Issues</p>
                      {mustCatch.map((issue: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-primary/30">
                          <span className="font-mono text-primary/70">{issue.id}</span>: {issue.issue}
                        </div>
                      ))}
                    </div>
                    {runs.length > 0 && (
                      <div className="space-y-1 mt-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Benchmark Runs</p>
                        {runs.map((r: any) => {
                          const scores = r.scores || {};
                          return (
                            <div key={r.id} className="flex items-center gap-3 text-xs py-1">
                              <span className="text-muted-foreground">{fmtDate(new Date(r.created_at), 'dd MMM yyyy')}</span>
                              <span className="font-mono text-foreground">{r.model}</span>
                              <span className="text-emerald-400">Catch: {scores.must_catch_score ?? '—'}</span>
                              <span className="text-amber-400">Hall: {scores.hallucinations_count ?? '—'}</span>
                              <span className="text-primary">Spec: {scores.specificity_rate ?? '—'}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Metrics Dashboard Tab ───
function MetricsDashboard() {
  const [runs, setRuns] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('coverage_runs').select('id, created_at, metrics, prompt_version_id, model, project_type').order('created_at', { ascending: false }).limit(100),
      supabase.from('coverage_feedback').select('*').order('created_at', { ascending: false }).limit(200),
    ]).then(([{ data: r }, { data: f }]) => {
      setRuns((r as any[]) || []);
      setFeedback((f as any[]) || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  // Compute aggregates
  const totalRuns = runs.length;
  const runsWithMetrics = runs.filter(r => r.metrics && Object.keys(r.metrics).length > 0);
  const avgSpecificity = runsWithMetrics.length > 0
    ? runsWithMetrics.reduce((sum, r) => sum + (typeof r.metrics.specificity_rate === 'number' ? r.metrics.specificity_rate : 0), 0) / runsWithMetrics.length
    : 0;
  const avgHallucinations = runsWithMetrics.length > 0
    ? runsWithMetrics.reduce((sum, r) => sum + (r.metrics.hallucinations_count || 0), 0) / runsWithMetrics.length
    : 0;
  const totalFeedback = feedback.length;
  const avgOverall = totalFeedback > 0
    ? feedback.reduce((sum, f) => sum + ((f as any).overall_usefulness || 0), 0) / totalFeedback
    : 0;
  const avgAccuracy = totalFeedback > 0
    ? feedback.reduce((sum, f) => sum + ((f as any).accuracy_to_script || 0), 0) / totalFeedback
    : 0;
  const avgActionability = totalFeedback > 0
    ? feedback.reduce((sum, f) => sum + ((f as any).actionability || 0), 0) / totalFeedback
    : 0;

  const statCards = [
    { label: 'Total Runs', value: totalRuns, icon: BarChart3, color: 'text-primary' },
    { label: 'Avg Specificity', value: `${Math.round(avgSpecificity * 100)}%`, icon: Target, color: 'text-emerald-400' },
    { label: 'Avg Hallucinations', value: avgHallucinations.toFixed(1), icon: AlertTriangle, color: avgHallucinations > 1 ? 'text-red-400' : 'text-emerald-400' },
    { label: 'Feedback Submissions', value: totalFeedback, icon: CheckCircle2, color: 'text-primary' },
    { label: 'Avg Usefulness', value: `${avgOverall.toFixed(1)}/5`, icon: TrendingUp, color: 'text-amber-400' },
    { label: 'Avg Accuracy', value: `${avgAccuracy.toFixed(1)}/5`, icon: Target, color: 'text-cyan-400' },
  ];

  // Group by prompt_version for trend view
  const byVersion = new Map<string, { runs: number; avgSpec: number; avgHall: number }>();
  runs.forEach(r => {
    const key = r.prompt_version_id || 'unknown';
    const entry = byVersion.get(key) || { runs: 0, avgSpec: 0, avgHall: 0 };
    entry.runs++;
    if (r.metrics?.specificity_rate) entry.avgSpec += r.metrics.specificity_rate;
    if (r.metrics?.hallucinations_count != null) entry.avgHall += r.metrics.hallucinations_count;
    byVersion.set(key, entry);
  });

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(s => (
          <div key={s.label} className="p-3 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-1.5 mb-1">
              <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
              <span className="text-[10px] text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-lg font-display font-semibold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Recent runs table */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Recent Coverage Runs</p>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground">
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Model</th>
                <th className="text-right p-2">Specificity</th>
                <th className="text-right p-2">Hallucinations</th>
                <th className="text-right p-2">Exemplars</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 20).map(r => (
                <tr key={r.id} className="border-t border-border/30 hover:bg-muted/10">
                  <td className="p-2 text-muted-foreground">{fmtDate(new Date(r.created_at), 'dd MMM yyyy')}</td>
                  <td className="p-2 text-foreground">{r.project_type}</td>
                  <td className="p-2 font-mono text-muted-foreground">{r.model?.split('/').pop()}</td>
                  <td className="p-2 text-right text-emerald-400">
                    {r.metrics?.specificity_rate != null ? `${Math.round(r.metrics.specificity_rate * 100)}%` : '—'}
                  </td>
                  <td className={`p-2 text-right ${(r.metrics?.hallucinations_count || 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {r.metrics?.hallucinations_count ?? '—'}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">{r.metrics?.exemplar_count ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Feedback breakdown */}
      {totalFeedback > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Feedback Averages</p>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Usefulness', value: avgOverall },
              { label: 'Accuracy', value: avgAccuracy },
              { label: 'Specificity', value: feedback.reduce((s, f) => s + ((f as any).specificity || 0), 0) / totalFeedback },
              { label: 'Actionability', value: avgActionability },
              { label: 'Market Realism', value: feedback.reduce((s, f) => s + ((f as any).market_realism || 0), 0) / totalFeedback },
            ].map(item => (
              <div key={item.label} className="p-3 rounded-lg border border-border/50 bg-card/50 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">{item.label}</p>
                <p className={`text-xl font-display font-semibold ${item.value >= 4 ? 'text-emerald-400' : item.value >= 3 ? 'text-amber-400' : 'text-red-400'}`}>
                  {item.value.toFixed(1)}
                </p>
                <p className="text-[10px] text-muted-foreground">/ 5</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───
export default function CoverageLab() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PageTransition>
        <main className="container py-8 space-y-6">
          <div className="flex items-center gap-3">
            <FlaskConical className="h-6 w-6 text-primary" />
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Coverage Lab</h1>
              <p className="text-sm text-muted-foreground">Manage prompts, house style, benchmarks, and track coverage quality</p>
            </div>
          </div>

          <Tabs defaultValue="metrics">
            <TabsList className="bg-muted/30">
              <TabsTrigger value="metrics" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Metrics</TabsTrigger>
              <TabsTrigger value="prompts" className="text-xs gap-1"><FileText className="h-3 w-3" />Prompt Versions</TabsTrigger>
              <TabsTrigger value="style" className="text-xs gap-1"><Settings2 className="h-3 w-3" />House Style</TabsTrigger>
              <TabsTrigger value="library" className="text-xs gap-1"><BookOpen className="h-3 w-3" />Great Notes</TabsTrigger>
              <TabsTrigger value="benchmarks" className="text-xs gap-1"><Target className="h-3 w-3" />Benchmarks</TabsTrigger>
            </TabsList>

            <TabsContent value="metrics" className="mt-6">
              <MetricsDashboard />
            </TabsContent>
            <TabsContent value="prompts" className="mt-6">
              <PromptVersionsTab />
            </TabsContent>
            <TabsContent value="style" className="mt-6">
              <HouseStyleTab />
            </TabsContent>
            <TabsContent value="library" className="mt-6">
              <GreatNotesLibrary />
            </TabsContent>
            <TabsContent value="benchmarks" className="mt-6">
              <BenchmarksTab />
            </TabsContent>
          </Tabs>
        </main>
      </PageTransition>
    </div>
  );
}
