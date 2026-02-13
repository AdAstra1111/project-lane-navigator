import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { useDevEngine } from '@/hooks/useDevEngine';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  ArrowRight, Play, RefreshCw, Check, AlertTriangle, Shield,
  TrendingUp, TrendingDown, Minus, Zap, FileText, RotateCcw,
  ChevronRight, Loader2, Target, Sparkles, ArrowUpRight
} from 'lucide-react';

// ── Convergence gauge ──
function ConvergenceGauge({ ci, gp, gap, status }: { ci: number; gp: number; gap: number; status: string }) {
  const statusColor = status === 'Healthy Divergence' ? 'text-emerald-400' :
    status === 'Strategic Tension' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="grid grid-cols-3 gap-4 text-center">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Creative Integrity</p>
        <p className="text-3xl font-display font-bold text-foreground">{ci}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Greenlight Prob.</p>
        <p className="text-3xl font-display font-bold text-foreground">{gp}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Gap</p>
        <p className={`text-3xl font-display font-bold ${statusColor}`}>{gap}</p>
        <p className={`text-xs ${statusColor}`}>{status}</p>
      </div>
    </div>
  );
}

// ── Delta indicator ──
function DeltaBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <div className="flex items-center gap-1.5">
      {isPositive && <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
      {isNegative && <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
      {!isPositive && !isNegative && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className={`text-sm font-medium ${isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-muted-foreground'}`}>
        {isPositive ? '+' : ''}{value} {label}
      </span>
    </div>
  );
}

// ── Note category card ──
function NoteCategory({ title, items, icon }: { title: string; items: any[]; icon: React.ReactNode }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="font-display font-semibold text-sm text-foreground">{title}</h4>
        <Badge variant="secondary" className="text-xs">{items.length}</Badge>
      </div>
      <ul className="space-y-1.5 pl-6">
        {items.map((item: any, i: number) => (
          <li key={i} className="text-sm text-muted-foreground leading-relaxed">
            {typeof item === 'string' ? item : item.note || JSON.stringify(item)}
            {item.impact && <Badge variant="outline" className="ml-2 text-[10px]">{item.impact}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Strategic notes with approval checkboxes ──
function StrategicNotesPanel({ iteration, onApproveAndRewrite, isLoading }: {
  iteration: any;
  onApproveAndRewrite: (approved: any[]) => void;
  isLoading: boolean;
}) {
  const allNotes = useMemo(() => {
    const cats = [
      { key: 'structural_adjustments', label: 'Structural' },
      { key: 'character_enhancements', label: 'Character' },
      { key: 'escalation_improvements', label: 'Escalation' },
      { key: 'lane_clarity_moves', label: 'Lane Clarity' },
      { key: 'packaging_magnetism_moves', label: 'Packaging' },
      { key: 'risk_mitigation_fixes', label: 'Risk Mitigation' },
    ];
    return cats.flatMap(c =>
      (iteration[c.key] || []).map((n: any, i: number) => ({
        id: `${c.key}-${i}`,
        category: c.label,
        note: typeof n === 'string' ? n : n.note || JSON.stringify(n),
        impact: n.impact || 'medium',
        raw: n,
      }))
    );
  }, [iteration]);

  const [selected, setSelected] = useState<Set<string>>(new Set(allNotes.map(n => n.id)));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allNotes.map(n => n.id)));
  const selectNone = () => setSelected(new Set());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-foreground">Strategic Notes</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>All</Button>
          <Button variant="ghost" size="sm" onClick={selectNone}>None</Button>
        </div>
      </div>
      <ScrollArea className="h-[400px]">
        <div className="space-y-2 pr-4">
          {allNotes.map(n => (
            <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border transition-colors">
              <Checkbox
                checked={selected.has(n.id)}
                onCheckedChange={() => toggle(n.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px]">{n.category}</Badge>
                  <Badge variant={n.impact === 'high' ? 'default' : 'secondary'} className="text-[10px]">{n.impact}</Badge>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{n.note}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <Button
        className="w-full"
        onClick={() => onApproveAndRewrite(allNotes.filter(n => selected.has(n.id)).map(n => n.raw))}
        disabled={isLoading || selected.size === 0}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
        Apply {selected.size} Notes & Rewrite
      </Button>
    </div>
  );
}

// ── Main Page ──
export default function DevelopmentEngine() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSessionId = searchParams.get('session') || undefined;

  const {
    sessions, activeSession, iterations, latestIteration,
    currentPhase, isConverged,
    createSession, runReview, runNotes, runRewrite, runReassess, applyRewrite,
  } = useDevEngine(activeSessionId);

  // New session form
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState('');
  const [inputType, setInputType] = useState('concept');
  const [activeTab, setActiveTab] = useState('workspace');

  const isLoading = createSession.isPending || runReview.isPending || runNotes.isPending ||
    runRewrite.isPending || runReassess.isPending;

  const handleCreate = async () => {
    if (!inputText.trim()) return;
    const result = await createSession.mutateAsync({
      title: title || 'Untitled Session',
      inputText: inputText.trim(),
      inputType,
    });
    setSearchParams({ session: result.id });
    setTitle('');
    setInputText('');
  };

  const phaseIndex = !latestIteration ? -1 :
    latestIteration.phase === 'review' ? 0 :
    latestIteration.phase === 'notes' ? 1 :
    latestIteration.phase === 'rewrite' ? 2 :
    latestIteration.phase === 'reassess' ? 3 : -1;

  const phases = ['Review', 'Strategic Notes', 'Rewrite', 'Reassess'];

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground">Development Engine</h1>
              <p className="text-sm text-muted-foreground">Closed-loop creative–commercial convergence</p>
            </div>
            {activeSessionId && (
              <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>
                <RotateCcw className="h-4 w-4 mr-1" /> New Session
              </Button>
            )}
          </div>

          {/* No active session → create or select */}
          {!activeSessionId && (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Create */}
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Start New Loop
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Session Title</label>
                        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Treatment v2 Loop" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Input Type</label>
                        <Select value={inputType} onValueChange={setInputType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="concept">Concept / Logline</SelectItem>
                            <SelectItem value="treatment">Treatment</SelectItem>
                            <SelectItem value="script">Script / Screenplay</SelectItem>
                            <SelectItem value="pitch">Pitch Document</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Material</label>
                      <Textarea
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        placeholder="Paste your concept, treatment, or script here..."
                        className="min-h-[300px] font-mono text-sm"
                      />
                    </div>
                    <Button onClick={handleCreate} disabled={!inputText.trim() || isLoading} className="w-full">
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                      Begin Development Loop
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Recent sessions */}
              <div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recent Sessions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sessions.length === 0 && (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    )}
                    <div className="space-y-2">
                      {sessions.slice(0, 10).map(s => (
                        <button
                          key={s.id}
                          onClick={() => setSearchParams({ session: s.id })}
                          className="w-full text-left p-3 rounded-lg border border-border/50 hover:border-primary/50 transition-colors"
                        >
                          <p className="text-sm font-medium text-foreground truncate">{s.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px]">Loop {s.current_iteration}</Badge>
                            {s.convergence_status && (
                              <Badge variant={s.convergence_status === 'Healthy Divergence' ? 'default' : 'secondary'} className="text-[10px]">
                                {s.convergence_status}
                              </Badge>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Active session workspace */}
          {activeSessionId && activeSession && (
            <div className="space-y-6">
              {/* Session header */}
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-display font-bold text-foreground">{activeSession.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        Loop {activeSession.current_iteration} · {activeSession.input_type}
                        {activeSession.project_id && (
                          <Link to={`/projects/${activeSession.project_id}`} className="ml-2 text-primary hover:underline">
                            View Project
                          </Link>
                        )}
                      </p>
                    </div>
                    {isConverged && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        <Check className="h-3 w-3 mr-1" /> Converged
                      </Badge>
                    )}
                  </div>

                  {/* Scores */}
                  {activeSession.latest_ci != null && (
                    <ConvergenceGauge
                      ci={Number(activeSession.latest_ci)}
                      gp={Number(activeSession.latest_gp)}
                      gap={Number(activeSession.latest_gap)}
                      status={activeSession.convergence_status || 'Unknown'}
                    />
                  )}

                  {/* Phase progress */}
                  <div className="flex items-center gap-1 mt-4">
                    {phases.map((p, i) => (
                      <div key={p} className="flex items-center flex-1">
                        <div className={`flex-1 h-1.5 rounded-full transition-colors ${
                          i <= phaseIndex ? 'bg-primary' : 'bg-muted'
                        }`} />
                        {i < phases.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground mx-0.5 shrink-0" />}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-1">
                    {phases.map((p, i) => (
                      <span key={p} className={`text-[10px] ${i <= phaseIndex ? 'text-primary' : 'text-muted-foreground'}`}>{p}</span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Main workspace */}
              <div className="grid lg:grid-cols-5 gap-6">
                {/* Left: Material & Output */}
                <div className="lg:col-span-3 space-y-4">
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                      <TabsTrigger value="workspace">Workspace</TabsTrigger>
                      <TabsTrigger value="history">Loop History</TabsTrigger>
                    </TabsList>

                    <TabsContent value="workspace" className="space-y-4 mt-4">
                      {/* Current material */}
                      <Card>
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <FileText className="h-4 w-4" /> Current Material
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px]">
                            <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                              {activeSession.input_text || 'No material loaded.'}
                            </pre>
                          </ScrollArea>
                        </CardContent>
                      </Card>

                      {/* Rewrite output */}
                      {latestIteration?.rewritten_text && (
                        <Card className="border-primary/30">
                          <CardHeader className="py-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-primary" /> Rewritten Material
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ScrollArea className="h-[300px]">
                              <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                                {latestIteration.rewritten_text}
                              </pre>
                            </ScrollArea>
                            {latestIteration.changes_summary && (
                              <div className="mt-3 p-3 rounded-lg bg-muted/50 text-sm">
                                <p className="font-medium text-foreground mb-1">Changes Summary</p>
                                <p className="text-muted-foreground">{latestIteration.changes_summary}</p>
                              </div>
                            )}
                            {latestIteration.creative_preserved && (
                              <div className="mt-2 p-3 rounded-lg bg-emerald-500/5 text-sm">
                                <p className="font-medium text-emerald-400 mb-1">Creative Preserved</p>
                                <p className="text-muted-foreground">{latestIteration.creative_preserved}</p>
                              </div>
                            )}
                            <div className="flex gap-2 mt-3">
                              <Button size="sm" onClick={() => applyRewrite.mutate()} disabled={isLoading}>
                                <Check className="h-3 w-3 mr-1" /> Accept & Apply
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                      <Card>
                        <CardContent className="pt-4">
                          {iterations.length === 0 && (
                            <p className="text-sm text-muted-foreground">No iterations yet. Start with Review.</p>
                          )}
                          <div className="space-y-4">
                            {iterations.map((it, idx) => (
                              <div key={it.id} className="p-4 rounded-lg border border-border/50">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="font-display font-semibold text-sm">Iteration {it.iteration_number}</h4>
                                  <Badge variant="outline" className="text-[10px]">{it.phase}</Badge>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                                  <div>
                                    <p className="text-muted-foreground text-xs">CI</p>
                                    <p className="font-bold">{it.reassess_ci ?? it.ci_score ?? '—'}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-xs">GP</p>
                                    <p className="font-bold">{it.reassess_gp ?? it.gp_score ?? '—'}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-xs">Gap</p>
                                    <p className="font-bold">{it.reassess_gap ?? it.gap ?? '—'}</p>
                                  </div>
                                </div>
                                {it.delta_ci != null && (
                                  <div className="flex gap-4 mt-2 justify-center">
                                    <DeltaBadge value={Number(it.delta_ci)} label="CI" />
                                    <DeltaBadge value={Number(it.delta_gp)} label="GP" />
                                    <DeltaBadge value={Number(it.delta_gap)} label="Gap" />
                                  </div>
                                )}
                                {it.trajectory && (
                                  <p className="text-xs text-center mt-1 text-muted-foreground">Trajectory: <span className="text-foreground font-medium">{it.trajectory}</span></p>
                                )}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Right: Controls & Intelligence */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Phase actions */}
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Loop Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button
                        className="w-full justify-between"
                        variant={phaseIndex < 0 ? 'default' : 'outline'}
                        onClick={() => runReview.mutate({})}
                        disabled={isLoading}
                      >
                        <span className="flex items-center gap-2">
                          {runReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {phaseIndex >= 3 ? 'Re-Review (Next Loop)' : 'Phase 1: Review'}
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>

                      <Button
                        className="w-full justify-between"
                        variant={phaseIndex === 0 ? 'default' : 'outline'}
                        onClick={() => runNotes.mutate()}
                        disabled={isLoading || phaseIndex < 0}
                      >
                        <span className="flex items-center gap-2">
                          {runNotes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                          Phase 2: Strategic Notes
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>

                      <Button
                        className="w-full justify-between"
                        variant={phaseIndex === 1 ? 'default' : 'outline'}
                        onClick={() => runReassess.mutate()}
                        disabled={isLoading || phaseIndex < 2}
                      >
                        <span className="flex items-center gap-2">
                          {runReassess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Phase 4: Reassess
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>

                      {isConverged && (
                        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                          <p className="text-sm font-medium text-emerald-400">✓ Convergence Achieved</p>
                          <p className="text-xs text-muted-foreground mt-1">Both CI and GP above 75. Loop can stop.</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Review findings */}
                  {latestIteration && latestIteration.ci_score != null && (
                    <Card>
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm">Review Findings</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {latestIteration.primary_creative_risk && (
                          <div className="p-2 rounded bg-amber-500/10 text-sm">
                            <p className="text-amber-400 font-medium text-xs">Creative Risk</p>
                            <p className="text-foreground">{latestIteration.primary_creative_risk}</p>
                          </div>
                        )}
                        {latestIteration.primary_commercial_risk && (
                          <div className="p-2 rounded bg-red-500/10 text-sm">
                            <p className="text-red-400 font-medium text-xs">Commercial Risk</p>
                            <p className="text-foreground">{latestIteration.primary_commercial_risk}</p>
                          </div>
                        )}
                        <Separator />
                        <NoteCategory title="Protect" items={latestIteration.protect_items || []} icon={<Shield className="h-4 w-4 text-emerald-400" />} />
                        <NoteCategory title="Strengthen" items={latestIteration.strengthen_items || []} icon={<TrendingUp className="h-4 w-4 text-primary" />} />
                        <NoteCategory title="Clarify" items={latestIteration.clarify_items || []} icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} />
                        <NoteCategory title="Elevate" items={latestIteration.elevate_items || []} icon={<ArrowUpRight className="h-4 w-4 text-purple-400" />} />
                        <NoteCategory title="Remove" items={latestIteration.remove_items || []} icon={<Minus className="h-4 w-4 text-red-400" />} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Strategic notes with approval */}
                  {latestIteration && (latestIteration.structural_adjustments?.length > 0 || latestIteration.phase === 'notes') && (
                    <Card>
                      <CardContent className="pt-4">
                        <StrategicNotesPanel
                          iteration={latestIteration}
                          onApproveAndRewrite={(approved) => runRewrite.mutate(approved)}
                          isLoading={runRewrite.isPending}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Reassess results */}
                  {latestIteration?.reassess_ci != null && (
                    <Card className="border-primary/30">
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 text-primary" /> Reassessment
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <ConvergenceGauge
                          ci={Number(latestIteration.reassess_ci)}
                          gp={Number(latestIteration.reassess_gp)}
                          gap={Number(latestIteration.reassess_gap)}
                          status={latestIteration.reassess_convergence || 'Unknown'}
                        />
                        <div className="flex gap-4 justify-center">
                          <DeltaBadge value={Number(latestIteration.delta_ci)} label="CI" />
                          <DeltaBadge value={Number(latestIteration.delta_gp)} label="GP" />
                          <DeltaBadge value={Number(latestIteration.delta_gap)} label="Gap" />
                        </div>
                        {latestIteration.trajectory && (
                          <div className="text-center">
                            <Badge variant={latestIteration.trajectory === 'Converging' || latestIteration.trajectory === 'Strengthened' ? 'default' : 'secondary'}>
                              {latestIteration.trajectory}
                            </Badge>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
