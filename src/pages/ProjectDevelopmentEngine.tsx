import { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { useDevEngineV2 } from '@/hooks/useDevEngineV2';
import { useScriptPipeline } from '@/hooks/useScriptPipeline';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  ArrowRight, Play, Check, Shield, TrendingUp, TrendingDown, Minus,
  Zap, FileText, Loader2, Target, Sparkles, ArrowUpRight,
  Plus, ClipboardPaste, Upload, ChevronDown, BarChart3,
  AlertTriangle, GitBranch, Clock, RefreshCw, Film, Pause, Square, RotateCcw, Trash2
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OperationProgress, DEV_ANALYZE_STAGES, DEV_NOTES_STAGES, DEV_REWRITE_STAGES, DEV_CONVERT_STAGES } from '@/components/OperationProgress';

// ── Convergence Gauge ──
function ConvergenceGauge({ ci, gp, gap, status, allowedGap }: { ci: number; gp: number; gap: number; status: string; allowedGap?: number }) {
  const statusColor = status === 'Healthy Divergence' ? 'text-emerald-400' :
    status === 'Strategic Tension' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CI</p>
        <p className="text-2xl font-display font-bold text-foreground">{ci}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">GP</p>
        <p className="text-2xl font-display font-bold text-foreground">{gp}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Gap</p>
        <p className={`text-2xl font-display font-bold ${statusColor}`}>{gap}</p>
        <p className={`text-[10px] ${statusColor}`}>{status}</p>
      </div>
    </div>
  );
}

// ── Sparkline for convergence ──
function ConvergenceSparkline({ history }: { history: any[] }) {
  if (history.length < 2) return null;
  const w = 200, h = 48, pad = 4;
  const ciPoints = history.map(h => Number(h.creative_score));
  const gpPoints = history.map(h => Number(h.greenlight_score));
  const all = [...ciPoints, ...gpPoints];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 100);
  const range = max - min || 1;

  const toPath = (pts: number[]) => pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={toPath(ciPoints)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
      <path d={toPath(gpPoints)} fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
    </svg>
  );
}

// ── Doc type badge ──
const DOC_TYPE_LABELS: Record<string, string> = {
  idea: 'Idea', logline: 'Logline', one_pager: 'One-Pager', treatment: 'Treatment',
  script: 'Script', blueprint: 'Blueprint', architecture: 'Architecture',
  notes: 'Notes', outline: 'Outline', deck_text: 'Deck', other: 'Other',
};

// ── Main Page ──
export default function ProjectDevelopmentEngine() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  const {
    documents, docsLoading, versions, versionsLoading,
    selectedDoc, selectedVersion, selectedDocId, selectedVersionId,
    selectDocument, setSelectedVersionId,
    runs, allDocRuns, convergenceHistory,
    latestAnalysis, latestNotes, isConverged, isLoading,
    analyze, generateNotes, rewrite, convert, createPaste, deleteDocument,
  } = useDevEngineV2(projectId);

  // Script pipeline
  const pipeline = useScriptPipeline(projectId);

  // Controls
  const [strategicPriority, setStrategicPriority] = useState('BALANCED');
  const [developmentStage, setDevelopmentStage] = useState('IDEA');
  const [analysisMode, setAnalysisMode] = useState('DUAL');
  const [activeTab, setActiveTab] = useState('content');
  const [targetPages, setTargetPages] = useState(100);
  // Paste dialog
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteType, setPasteType] = useState('treatment');
  const [pasteText, setPasteText] = useState('');

  // Notes selection
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());

  // Import landing: auto-select doc/version from query params
  const [importHandled, setImportHandled] = useState(false);
  useEffect(() => {
    if (importHandled || docsLoading) return;
    const docParam = searchParams.get('doc');
    const versionParam = searchParams.get('version');
    if (docParam && documents.some(d => d.id === docParam)) {
      selectDocument(docParam);
      if (versionParam) {
        setSelectedVersionId(versionParam);
      }
      setImportHandled(true);
    }
  }, [documents, docsLoading, searchParams, importHandled, selectDocument, setSelectedVersionId]);




  const allPrioritizedMoves = useMemo(() => {
    if (!latestNotes?.prioritized_moves) return [];
    return latestNotes.prioritized_moves as any[];
  }, [latestNotes]);

  // Auto-select all notes when they load
  useMemo(() => {
    if (allPrioritizedMoves.length > 0) {
      setSelectedNotes(new Set(allPrioritizedMoves.map((_, i) => i)));
    }
  }, [allPrioritizedMoves]);

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    createPaste.mutate({ title: pasteTitle || 'Pasted Document', docType: pasteType, text: pasteText.trim() });
    setPasteOpen(false);
    setPasteTitle('');
    setPasteText('');
  };

  const handleAnalyze = () => {
    // Find previous version for trajectory
    const prevVersion = versions.length > 1 ? versions[versions.length - 2] : null;
    analyze.mutate({
      strategicPriority,
      developmentStage,
      analysisMode,
      previousVersionId: prevVersion?.id,
    });
  };

  const handleRewrite = () => {
    const approved = allPrioritizedMoves.filter((_, i) => selectedNotes.has(i));
    rewrite.mutate({
      approvedNotes: approved,
      protectItems: latestNotes?.protect || latestAnalysis?.protect || [],
    });
  };

  const versionText = selectedVersion?.plaintext ||
    selectedDoc?.plaintext || selectedDoc?.extracted_text || '';

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-[1600px] mx-auto px-4 py-4">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">
                ← Project
              </Link>
              <h1 className="text-lg font-display font-bold text-foreground">Development Engine</h1>
              {isConverged && (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <Check className="h-3 w-3 mr-1" /> Converged
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select value={strategicPriority} onValueChange={setStrategicPriority}>
                <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRESTIGE">Prestige</SelectItem>
                  <SelectItem value="BALANCED">Balanced</SelectItem>
                  <SelectItem value="COMMERCIAL_EXPANSION">Commercial</SelectItem>
                  <SelectItem value="CASHFLOW_STABILISATION">Cashflow</SelectItem>
                </SelectContent>
              </Select>
              <Select value={developmentStage} onValueChange={setDevelopmentStage}>
                <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IDEA">Idea</SelectItem>
                  <SelectItem value="EARLY_DRAFT">Early Draft</SelectItem>
                  <SelectItem value="REDRAFT">Redraft</SelectItem>
                  <SelectItem value="PRE_PACKAGING">Pre-Packaging</SelectItem>
                  <SelectItem value="FINANCE">Finance</SelectItem>
                </SelectContent>
              </Select>
              <Select value={analysisMode} onValueChange={setAnalysisMode}>
                <SelectTrigger className="h-8 text-xs w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DUAL">Dual</SelectItem>
                  <SelectItem value="CREATIVE_INTEGRITY">CI Only</SelectItem>
                  <SelectItem value="GREENLIGHT_ARCHITECT">GP Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3-column layout */}
          <div className="grid grid-cols-12 gap-4" style={{ minHeight: 'calc(100vh - 140px)' }}>

            {/* ── LEFT: Document Selector ── */}
            <div className="col-span-3 space-y-3">
              <Card>
                <CardHeader className="py-3 px-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Documents</CardTitle>
                    <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                          <Plus className="h-3 w-3" /> New
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Paste New Document</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Input placeholder="Title" value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} />
                          <Select value={pasteType} onValueChange={setPasteType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="idea">Idea</SelectItem>
                              <SelectItem value="logline">Logline</SelectItem>
                              <SelectItem value="treatment">Treatment</SelectItem>
                              <SelectItem value="script">Script</SelectItem>
                              <SelectItem value="one_pager">One-Pager</SelectItem>
                              <SelectItem value="outline">Outline</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <Textarea placeholder="Paste material here..." value={pasteText}
                            onChange={e => setPasteText(e.target.value)} className="min-h-[200px] font-mono text-sm" />
                          <Button onClick={handlePaste} disabled={!pasteText.trim() || createPaste.isPending} className="w-full">
                            {createPaste.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
                            Create Document
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent className="px-2 pb-2">
                  <ScrollArea className="h-[calc(100vh-320px)]">
                    <div className="space-y-1">
                      {documents.map(doc => (
                        <div
                          key={doc.id}
                          className={`flex items-start justify-between w-full text-left p-2.5 rounded-md transition-colors text-sm cursor-pointer ${
                            selectedDocId === doc.id
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted/50 border border-transparent'
                          }`}
                          onClick={() => selectDocument(doc.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate text-xs">{doc.title || doc.file_name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className="text-[9px] px-1 py-0">
                                {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                              </Badge>
                              <span className="text-[9px] text-muted-foreground">
                                {doc.source === 'generated' ? '✨' : doc.source === 'paste' ? '📋' : '📄'}
                              </span>
                            </div>
                          </div>
                          <div className="flex-shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                            <ConfirmDialog
                              title="Delete Document"
                              description={`Delete "${doc.title || doc.file_name}" and all its versions? This cannot be undone.`}
                              confirmLabel="Delete"
                              variant="destructive"
                              onConfirm={() => deleteDocument.mutate(doc.id)}
                            >
                              <button className="p-1 rounded hover:bg-destructive/30 text-muted-foreground hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </ConfirmDialog>
                          </div>
                        </div>
                      ))}
                      {documents.length === 0 && !docsLoading && (
                        <p className="text-xs text-muted-foreground p-3 text-center">No documents yet. Paste or upload to start.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Version selector */}
              {selectedDocId && versions.length > 0 && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <GitBranch className="h-3 w-3" /> Versions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <div className="space-y-1">
                      {versions.map(v => (
                        <button
                          key={v.id}
                          onClick={() => setSelectedVersionId(v.id)}
                          className={`w-full text-left p-2 rounded-md text-xs transition-colors ${
                            selectedVersionId === v.id
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted/50 border border-transparent'
                          }`}
                        >
                          <span className="font-medium">v{v.version_number}</span>
                          {v.label && <span className="text-muted-foreground ml-1">— {v.label}</span>}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Convert dropdown */}
              {selectedDocId && selectedVersionId && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs">Convert To</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2 space-y-1">
                    {['BLUEPRINT', 'ARCHITECTURE', 'TREATMENT', 'ONE_PAGER', 'OUTLINE'].map(t => (
                      <Button key={t} variant="ghost" size="sm" className="w-full justify-start text-xs h-7"
                        disabled={isLoading}
                        onClick={() => convert.mutate({ targetOutput: t, protectItems: latestAnalysis?.protect })}>
                        <ArrowRight className="h-3 w-3 mr-1.5" />
                        {t.replace(/_/g, ' ')}
                      </Button>
                    ))}
                    <OperationProgress isActive={convert.isPending} stages={DEV_CONVERT_STAGES} className="mt-2" />
                  </CardContent>
                </Card>
              )}

              {/* Generate Feature Script Pipeline */}
              {selectedDocId && selectedVersionId && (
                <Card className="border-primary/20">
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Film className="h-3 w-3" /> Feature Script Pipeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 space-y-2">
                    {pipeline.status === 'idle' && (
                      <>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-muted-foreground whitespace-nowrap">Target pages:</label>
                          <Input
                            type="number" min={80} max={130} value={targetPages}
                            onChange={e => setTargetPages(Number(e.target.value))}
                            className="h-7 text-xs w-20"
                          />
                        </div>
                        <Button
                          size="sm" className="w-full h-8 text-xs gap-1.5"
                          disabled={isLoading}
                          onClick={() => {
                            if (selectedDocId && selectedVersionId) {
                              pipeline.startPipeline(
                                selectedDocId,
                                selectedVersionId,
                                targetPages,
                                latestAnalysis?.protect || [],
                              );
                            }
                          }}
                        >
                          <Film className="h-3 w-3" />
                          Generate Feature Script
                        </Button>
                        <p className="text-[9px] text-muted-foreground text-center">
                          Plans scenes → writes in batches → assembles full screenplay
                        </p>
                      </>
                    )}

                    {pipeline.status !== 'idle' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[9px]">
                            {pipeline.status === 'planning' && 'Planning scenes…'}
                            {pipeline.status === 'writing' && `Writing batch ${pipeline.currentBatch + 1}/${pipeline.totalBatches}`}
                            {pipeline.status === 'assembling' && 'Assembling screenplay…'}
                            {pipeline.status === 'paused' && 'Paused'}
                            {pipeline.status === 'complete' && 'Complete ✓'}
                            {pipeline.status === 'error' && 'Error'}
                          </Badge>
                          <div className="flex gap-1">
                            {(pipeline.status === 'writing') && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.pause}>
                                <Pause className="h-3 w-3" />
                              </Button>
                            )}
                            {pipeline.status === 'paused' && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.resume}>
                                <Play className="h-3 w-3" />
                              </Button>
                            )}
                            {['writing', 'paused'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.abort}>
                                <Square className="h-3 w-3" />
                              </Button>
                            )}
                            {['complete', 'error'].includes(pipeline.status) && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={pipeline.reset}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Progress bar */}
                        {pipeline.totalBatches > 0 && (
                          <div className="space-y-1">
                            <Progress
                              value={
                                pipeline.status === 'planning' ? 5 :
                                pipeline.status === 'assembling' ? 95 :
                                pipeline.status === 'complete' ? 100 :
                                Math.round((pipeline.currentBatch / pipeline.totalBatches) * 90) + 5
                              }
                              className="h-1.5"
                            />
                            <div className="flex justify-between text-[9px] text-muted-foreground">
                              <span>{pipeline.pageEstimate} pages</span>
                              <span>{pipeline.wordCount.toLocaleString()} words</span>
                            </div>
                          </div>
                        )}

                        {pipeline.error && (
                          <p className="text-[10px] text-destructive">{pipeline.error}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── CENTER: Workspace ── */}
            <div className="col-span-6">
              {!selectedDocId ? (
                <Card className="h-full flex items-center justify-center">
                  <div className="text-center space-y-3 p-8">
                    <Target className="h-10 w-10 text-muted-foreground mx-auto" />
                    <p className="text-muted-foreground">Select a document or paste new material to begin</p>
                    <Button variant="outline" onClick={() => setPasteOpen(true)}>
                      <ClipboardPaste className="h-4 w-4 mr-2" /> Paste New Document
                    </Button>
                  </div>
                </Card>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <div className="flex items-center justify-between mb-2">
                    <TabsList className="h-8">
                      <TabsTrigger value="content" className="text-xs h-7">Content</TabsTrigger>
                      <TabsTrigger value="scores" className="text-xs h-7">Scores</TabsTrigger>
                      <TabsTrigger value="notes" className="text-xs h-7">Notes</TabsTrigger>
                      <TabsTrigger value="rewrite" className="text-xs h-7">Rewrite</TabsTrigger>
                      <TabsTrigger value="history" className="text-xs h-7">History</TabsTrigger>
                    </TabsList>
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={handleAnalyze} disabled={isLoading || !versionText}>
                        {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Analyze
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={() => generateNotes.mutate(undefined)} disabled={isLoading || !latestAnalysis}>
                        {generateNotes.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Notes
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={handleRewrite} disabled={isLoading || !latestNotes || selectedNotes.size === 0}>
                        {rewrite.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Rewrite
                      </Button>
                    </div>
                  </div>
                  <OperationProgress isActive={analyze.isPending} stages={DEV_ANALYZE_STAGES} className="mb-2" />
                  <OperationProgress isActive={generateNotes.isPending} stages={DEV_NOTES_STAGES} className="mb-2" />
                  <OperationProgress isActive={rewrite.isPending} stages={DEV_REWRITE_STAGES} className="mb-2" />
                  <OperationProgress isActive={convert.isPending} stages={DEV_CONVERT_STAGES} className="mb-2" />

                  {/* Content tab */}
                  <TabsContent value="content" className="mt-0">
                    <Card>
                      <CardContent className="p-4">
                        <ScrollArea className="h-[calc(100vh-260px)]">
                          <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                            {versionText || 'No content available.'}
                          </pre>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Scores tab */}
                  <TabsContent value="scores" className="mt-0">
                    <Card>
                      <CardContent className="p-4 space-y-4">
                        {latestAnalysis ? (
                          <>
                            <ConvergenceGauge
                              ci={latestAnalysis.ci_score} gp={latestAnalysis.gp_score}
                              gap={latestAnalysis.gap} status={latestAnalysis.convergence_status}
                              allowedGap={latestAnalysis.allowed_gap}
                            />
                            {latestAnalysis.trajectory && (
                              <div className="text-center">
                                <Badge variant={latestAnalysis.trajectory === 'Converging' || latestAnalysis.trajectory === 'Strengthened' ? 'default' : 'secondary'}>
                                  {latestAnalysis.trajectory}
                                </Badge>
                              </div>
                            )}
                            <Separator />
                            <div className="grid grid-cols-2 gap-3">
                              {latestAnalysis.primary_creative_risk && (
                                <div className="p-3 rounded-lg bg-amber-500/10 text-sm">
                                  <p className="text-amber-400 font-medium text-xs mb-1">Creative Risk</p>
                                  <p className="text-foreground text-xs">{latestAnalysis.primary_creative_risk}</p>
                                </div>
                              )}
                              {latestAnalysis.primary_commercial_risk && (
                                <div className="p-3 rounded-lg bg-red-500/10 text-sm">
                                  <p className="text-red-400 font-medium text-xs mb-1">Commercial Risk</p>
                                  <p className="text-foreground text-xs">{latestAnalysis.primary_commercial_risk}</p>
                                </div>
                              )}
                            </div>
                            {latestAnalysis.executive_snapshot && (
                              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                                <p className="text-foreground">{latestAnalysis.executive_snapshot}</p>
                              </div>
                            )}
                            <Separator />
                            {/* Protect / Strengthen / Clarify / Elevate / Remove */}
                            <div className="space-y-3">
                              {[
                                { key: 'protect', label: 'Protect', icon: <Shield className="h-3.5 w-3.5 text-emerald-400" />, color: 'text-emerald-400' },
                                { key: 'strengthen', label: 'Strengthen', icon: <TrendingUp className="h-3.5 w-3.5 text-primary" />, color: 'text-primary' },
                                { key: 'clarify', label: 'Clarify', icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />, color: 'text-amber-400' },
                                { key: 'elevate', label: 'Elevate', icon: <ArrowUpRight className="h-3.5 w-3.5 text-purple-400" />, color: 'text-purple-400' },
                                { key: 'remove', label: 'Remove', icon: <Minus className="h-3.5 w-3.5 text-red-400" />, color: 'text-red-400' },
                              ].map(cat => {
                                const items = latestAnalysis[cat.key] || [];
                                if (!items.length) return null;
                                return (
                                  <div key={cat.key}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                      {cat.icon}
                                      <span className={`text-xs font-semibold ${cat.color}`}>{cat.label}</span>
                                      <Badge variant="secondary" className="text-[9px]">{items.length}</Badge>
                                    </div>
                                    <ul className="space-y-1 pl-5">
                                      {items.map((item: string, i: number) => (
                                        <li key={i} className="text-xs text-muted-foreground">{item}</li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                            {latestAnalysis.verdict && (
                              <div className="text-center pt-2">
                                <Badge variant={latestAnalysis.verdict === 'Invest' ? 'default' : 'secondary'} className="text-sm px-4 py-1">
                                  {latestAnalysis.verdict}
                                </Badge>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-center py-12 text-muted-foreground">
                            <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No analysis yet. Click "Analyze" to score this version.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Notes tab */}
                  <TabsContent value="notes" className="mt-0">
                    <Card>
                      <CardContent className="p-4">
                        {latestNotes ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-display font-semibold text-sm">Strategic Notes</h3>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" className="text-xs h-6"
                                  onClick={() => setSelectedNotes(new Set(allPrioritizedMoves.map((_, i) => i)))}>All</Button>
                                <Button variant="ghost" size="sm" className="text-xs h-6"
                                  onClick={() => setSelectedNotes(new Set())}>None</Button>
                              </div>
                            </div>
                            <ScrollArea className="h-[calc(100vh-340px)]">
                              <div className="space-y-2 pr-2">
                                {allPrioritizedMoves.map((move: any, i: number) => (
                                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/50 hover:border-border transition-colors">
                                    <Checkbox
                                      checked={selectedNotes.has(i)}
                                      onCheckedChange={() => {
                                        setSelectedNotes(prev => {
                                          const next = new Set(prev);
                                          if (next.has(i)) next.delete(i); else next.add(i);
                                          return next;
                                        });
                                      }}
                                      className="mt-0.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <Badge variant="outline" className="text-[9px]">{move.category}</Badge>
                                        <Badge variant={move.impact === 'high' ? 'default' : 'secondary'} className="text-[9px]">{move.impact}</Badge>
                                        {move.convergence_lift && (
                                          <span className="text-[9px] text-emerald-400">+{move.convergence_lift}</span>
                                        )}
                                      </div>
                                      <p className="text-xs text-foreground leading-relaxed">{move.note}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                            <Button className="w-full" size="sm" onClick={handleRewrite}
                              disabled={isLoading || selectedNotes.size === 0}>
                              {rewrite.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                              Apply {selectedNotes.size} Notes & Rewrite
                            </Button>
                          </div>
                        ) : (
                          <div className="text-center py-12 text-muted-foreground">
                            <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No notes yet. Analyze first, then generate notes.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Rewrite tab — shows latest rewrite output */}
                  <TabsContent value="rewrite" className="mt-0">
                    <Card>
                      <CardContent className="p-4">
                        {(() => {
                          const rewriteRun = runs.filter(r => r.run_type === 'REWRITE').pop();
                          if (!rewriteRun) return (
                            <div className="text-center py-12 text-muted-foreground">
                              <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No rewrite for this version yet.</p>
                            </div>
                          );
                          const out = rewriteRun.output_json;
                          return (
                            <div className="space-y-3">
                              {out.changes_summary && (
                                <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                  <p className="font-medium text-foreground mb-1">Changes</p>
                                  <p className="text-muted-foreground">{out.changes_summary}</p>
                                </div>
                              )}
                              {out.creative_preserved && (
                                <div className="p-3 rounded-lg bg-emerald-500/5 text-xs">
                                  <p className="font-medium text-emerald-400 mb-1">Preserved</p>
                                  <p className="text-muted-foreground">{out.creative_preserved}</p>
                                </div>
                              )}
                              {out.commercial_improvements && (
                                <div className="p-3 rounded-lg bg-primary/5 text-xs">
                                  <p className="font-medium text-primary mb-1">Improvements</p>
                                  <p className="text-muted-foreground">{out.commercial_improvements}</p>
                                </div>
                              )}
                              <p className="text-xs text-muted-foreground">
                                The rewrite was saved as a new version. Select it from the version list to view the full text.
                              </p>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* History tab */}
                  <TabsContent value="history" className="mt-0">
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        {allDocRuns.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-8">No runs yet.</p>
                        ) : (
                          <ScrollArea className="h-[calc(100vh-280px)]">
                            <div className="space-y-2 pr-2">
                              {allDocRuns.map(run => {
                                const out = run.output_json || {};
                                return (
                                  <div key={run.id} className="p-3 rounded-lg border border-border/50">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <Badge variant="outline" className="text-[9px]">{run.run_type}</Badge>
                                      <span className="text-[9px] text-muted-foreground">
                                        {new Date(run.created_at).toLocaleString()}
                                      </span>
                                    </div>
                                    {out.ci_score != null && (
                                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                        <div><span className="text-muted-foreground">CI</span> <span className="font-bold">{out.ci_score}</span></div>
                                        <div><span className="text-muted-foreground">GP</span> <span className="font-bold">{out.gp_score}</span></div>
                                        <div><span className="text-muted-foreground">Gap</span> <span className="font-bold">{out.gap}</span></div>
                                      </div>
                                    )}
                                    {out.verdict && (
                                      <p className="text-[10px] text-center mt-1">
                                        <Badge variant="secondary" className="text-[9px]">{out.verdict}</Badge>
                                      </p>
                                    )}
                                    {out.changes_summary && (
                                      <p className="text-[10px] text-muted-foreground mt-1 truncate">{out.changes_summary}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </div>

            {/* ── RIGHT: Progress Tracker ── */}
            <div className="col-span-3 space-y-3">
              {/* Convergence chart */}
              <Card>
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <BarChart3 className="h-3 w-3" /> Convergence
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  {convergenceHistory.length >= 2 ? (
                    <div className="space-y-2">
                      <ConvergenceSparkline history={convergenceHistory} />
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>— CI <span className="text-primary">━</span></span>
                        <span>GP <span className="text-emerald-400">╌</span></span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground py-4 text-center">
                      Analyze 2+ versions to see trend
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Latest scores summary */}
              {latestAnalysis && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs">Latest Scores</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <ConvergenceGauge
                      ci={latestAnalysis.ci_score} gp={latestAnalysis.gp_score}
                      gap={latestAnalysis.gap} status={latestAnalysis.convergence_status}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Convergence timeline */}
              {convergenceHistory.length > 0 && (
                <Card>
                  <CardHeader className="py-2 px-3">
                    <CardTitle className="text-xs flex items-center gap-1.5">
                      <Clock className="h-3 w-3" /> Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-2">
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-1.5">
                        {convergenceHistory.slice().reverse().map((pt, i) => (
                          <div key={pt.id} className="p-2 rounded bg-muted/30 text-[10px]">
                            <div className="flex justify-between">
                              <span>CI: {Number(pt.creative_score)} | GP: {Number(pt.greenlight_score)}</span>
                              <span className="text-muted-foreground">Gap: {Number(pt.gap)}</span>
                            </div>
                            <div className="flex justify-between mt-0.5">
                              <Badge variant="outline" className="text-[8px] px-1 py-0">{pt.convergence_status}</Badge>
                              {pt.trajectory && <span className="text-muted-foreground">{pt.trajectory}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Convergence indicator */}
              {isConverged && (
                <Card className="border-emerald-500/30">
                  <CardContent className="p-3 text-center">
                    <p className="text-sm font-medium text-emerald-400">✓ High Convergence</p>
                    <p className="text-[10px] text-muted-foreground mt-1">CI ≥ 80, GP ≥ 80, Gap within tolerance</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
