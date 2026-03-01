/**
 * DevEngineSimpleView — Reduced-visibility lens for autopilot monitoring.
 * Shows seed snapshot, live step progress, and current/approved documents.
 * No new data fetching — all data is passed from ProjectDevelopmentEngine.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2, ArrowRight,
  FileText, Eye, Radio, Clock, ChevronRight,
} from 'lucide-react';
import type { SeedDocInfo } from '@/hooks/useSeedPackStatus';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';
import type { ConnectionState } from '@/hooks/useAutoRunMissionControl';

// ── Seed doc type labels ──
const SEED_LABELS: Record<string, string> = {
  project_overview: 'Project Overview',
  creative_brief: 'Creative Brief',
  market_positioning: 'Market Positioning',
  canon: 'Canon & Constraints',
  nec: 'Narrative Energy Contract',
};

// ── Props ──
export interface DevEngineSimpleViewProps {
  projectId: string;
  projectTitle: string;
  format: string;
  documents: any[];
  docsLoading: boolean;
  approvedVersionMap: Record<string, string>;
  selectedDocId: string | null;
  selectedVersionId: string | null;
  versionText: string;
  selectDocument: (docId: string) => void;
  setSelectedVersionId: (versionId: string) => void;
  // Auto-run
  autoRunJob: AutoRunJob | null;
  autoRunSteps: AutoRunStep[];
  autoRunIsRunning: boolean;
  autoRunConnectionState: ConnectionState;
  autoRunError: string | null;
  autoRunActivated: boolean;
  // Seed
  seedDocs: SeedDocInfo[];
  seedLoading: boolean;
}

// ── Helpers ──
function statusIcon(status: string) {
  if (status === 'present') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === 'short') return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" />;
}

function jobStatusBadge(status: string | undefined) {
  if (!status) return <Badge variant="outline" className="text-[9px]">No Job</Badge>;
  const map: Record<string, { className: string; label: string }> = {
    queued: { className: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Queued' },
    running: { className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Running' },
    completed: { className: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'Complete' },
    failed: { className: 'bg-destructive/15 text-destructive border-destructive/30', label: 'Failed' },
    paused: { className: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30', label: 'Paused' },
    stopped: { className: 'bg-orange-500/15 text-orange-400 border-orange-500/30', label: 'Stopped' },
  };
  const m = map[status] || { className: 'bg-muted text-muted-foreground', label: status };
  return <Badge variant="outline" className={`text-[9px] ${m.className}`}>{m.label}</Badge>;
}

function formatDocType(dt: string) {
  return dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ──
export function DevEngineSimpleView({
  projectId, projectTitle, format,
  documents, docsLoading, approvedVersionMap,
  selectedDocId, selectedVersionId, versionText,
  selectDocument, setSelectedVersionId,
  autoRunJob, autoRunSteps, autoRunIsRunning, autoRunConnectionState, autoRunError, autoRunActivated,
  seedDocs, seedLoading,
}: DevEngineSimpleViewProps) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [docTab, setDocTab] = useState<'current' | 'approved'>('current');

  // ── Derive current/last/next step deterministically ──
  const { currentStep, lastCompletedStep, nextStep, stepProgress } = useMemo(() => {
    if (!autoRunSteps.length) return { currentStep: null, lastCompletedStep: null, nextStep: null, stepProgress: '0 / 0' };

    const sorted = [...autoRunSteps].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0));
    const total = sorted.length;

    // Current = highest index step (latest action)
    const current = sorted[sorted.length - 1];

    // Last completed = highest index step that isn't the current active one
    const completed = sorted.length > 1 ? sorted[sorted.length - 2] : null;

    // Next = any step after current that is queued/pending (from DB — deterministic)
    const next: AutoRunStep | null = null; // Steps are created on-demand, not pre-queued

    const jobStepCount = autoRunJob?.step_count ?? total;
    const maxSteps = autoRunJob?.max_total_steps ?? total;

    return {
      currentStep: current,
      lastCompletedStep: completed,
      nextStep: next,
      stepProgress: `${jobStepCount} / ${maxSteps}`,
    };
  }, [autoRunSteps, autoRunJob]);

  // ── Resolve current doc from auto-run state ──
  const currentDocType = currentStep?.document || autoRunJob?.current_document || null;
  const currentDoc = useMemo(() => {
    if (!currentDocType || !documents.length) return null;
    return documents.find((d: any) => d.doc_type === currentDocType) || null;
  }, [currentDocType, documents]);

  // ── Approved docs list ──
  const approvedDocs = useMemo(() => {
    return documents.filter((d: any) => !!approvedVersionMap[d.id]);
  }, [documents, approvedVersionMap]);

  // ── Whether the selected doc matches the current auto-run doc ──
  const isViewingCurrentDoc = currentDoc && selectedDocId === currentDoc.id;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_1fr] gap-3">

      {/* ═══ LEFT: Seed Snapshot ═══ */}
      <Card className="h-fit">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-primary" />
            Seed Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-1.5">
          {seedLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          ) : (
            seedDocs.map(doc => (
              <div key={doc.doc_type} className="flex items-center gap-2 py-1 border-b border-border/30 last:border-0">
                {statusIcon(doc.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{SEED_LABELS[doc.doc_type] || doc.doc_type}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {doc.status === 'missing' ? 'Not created' :
                     doc.status === 'short' ? `${doc.char_count} chars (short)` :
                     `${doc.char_count.toLocaleString()} chars`}
                    {doc.approval_status === 'approved' && ' · ✓ Approved'}
                  </p>
                </div>
              </div>
            ))
          )}
          <div className="pt-1">
            <Badge variant="outline" className="text-[8px]">{format}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* ═══ CENTER: Autopilot Now ═══ */}
      <Card className="h-fit">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-primary" />
            Autopilot Now
            {jobStatusBadge(autoRunJob?.status)}
            {autoRunIsRunning && (
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 animate-pulse">
                LIVE
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {!autoRunActivated || !autoRunJob ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No active Auto-Run job.
              <br />
              <Button
                variant="link"
                size="sm"
                className="text-[10px] p-0 h-auto mt-1"
                onClick={() => {
                  setSearchParams(prev => {
                    prev.set('mode', 'advanced');
                    prev.set('tab', 'autorun');
                    return prev;
                  });
                }}
              >
                Open Mission Control →
              </Button>
            </p>
          ) : (
            <>
              {/* Step progress */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Steps</span>
                <Badge variant="outline" className="text-[9px] font-mono">{stepProgress}</Badge>
              </div>

              {/* Current step */}
              {currentStep && (
                <div className="bg-muted/40 rounded-md p-2 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    {autoRunIsRunning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                    <span className="text-[10px] font-medium">Current</span>
                  </div>
                  <p className="text-[11px] font-medium">{formatDocType(currentStep.document)}</p>
                  <p className="text-[9px] text-muted-foreground truncate">{currentStep.action}: {currentStep.summary?.slice(0, 80)}</p>
                  {currentStep.ci != null && (
                    <div className="flex gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[8px] px-1 py-0">CI {currentStep.ci}</Badge>
                      <Badge variant="secondary" className="text-[8px] px-1 py-0">GP {currentStep.gp}</Badge>
                    </div>
                  )}
                </div>
              )}

              {/* Last completed */}
              {lastCompletedStep && (
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last: {formatDocType(lastCompletedStep.document)} — {lastCompletedStep.action}
                </div>
              )}

              {/* Current doc being worked */}
              {currentDocType && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <ChevronRight className="h-3 w-3 text-primary" />
                  Working on: <strong>{formatDocType(currentDocType)}</strong>
                </div>
              )}

              {/* Error */}
              {autoRunError && (
                <p className="text-[9px] text-destructive bg-destructive/10 rounded px-2 py-1">{autoRunError}</p>
              )}

              {/* Connection */}
              {autoRunConnectionState !== 'online' && (
                <Badge variant="outline" className="text-[8px] bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
                  {autoRunConnectionState === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}
                </Badge>
              )}

              {/* Open Mission Control */}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[10px] h-7 mt-1"
                onClick={() => {
                  setSearchParams(prev => {
                    prev.set('mode', 'advanced');
                    prev.set('tab', 'autorun');
                    return prev;
                  });
                }}
              >
                Open Mission Control <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ RIGHT: Documents ═══ */}
      <Card className="h-fit">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5 text-primary" />
            Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <Tabs value={docTab} onValueChange={(v) => setDocTab(v as 'current' | 'approved')}>
            <TabsList className="w-full h-7 bg-muted/30">
              <TabsTrigger value="current" className="text-[10px] flex-1">Current Doc</TabsTrigger>
              <TabsTrigger value="approved" className="text-[10px] flex-1">
                Approved ({approvedDocs.length})
              </TabsTrigger>
            </TabsList>

            {/* Current Doc tab */}
            <TabsContent value="current" className="mt-2 space-y-2">
              {!currentDoc ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {autoRunJob ? 'No active document detected.' : 'Start Auto-Run to see the current document.'}
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-medium">{formatDocType(currentDoc.doc_type)}</p>
                      <p className="text-[9px] text-muted-foreground">{currentDoc.title || formatDocType(currentDoc.doc_type)}</p>
                    </div>
                    {!isViewingCurrentDoc && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[9px] h-6 px-2"
                        onClick={() => selectDocument(currentDoc.id)}
                      >
                        Open
                      </Button>
                    )}
                  </div>

                  {/* Generating indicator */}
                  {autoRunIsRunning && (
                    <div className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 rounded px-2 py-1.5">
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      <span className="text-[9px] text-primary">
                        Generating… Updates appear when step completes.
                      </span>
                    </div>
                  )}

                  {/* Document content */}
                  {isViewingCurrentDoc && versionText ? (
                    <ScrollArea className="h-[300px] rounded border border-border/50 bg-muted/20">
                      <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap font-body text-foreground">
                        {versionText}
                      </pre>
                    </ScrollArea>
                  ) : isViewingCurrentDoc ? (
                    <p className="text-[9px] text-muted-foreground text-center py-4">No content yet.</p>
                  ) : (
                    <p className="text-[9px] text-muted-foreground text-center py-2">
                      Click "Open" to view document content.
                    </p>
                  )}
                </>
              )}
            </TabsContent>

            {/* Approved Docs tab */}
            <TabsContent value="approved" className="mt-2 space-y-1">
              {approvedDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No approved documents yet.</p>
              ) : (
                <ScrollArea className="max-h-[400px]">
                  {approvedDocs.map((doc: any) => {
                    const approvedVersionId = approvedVersionMap[doc.id];
                    const isSelected = selectedDocId === doc.id && selectedVersionId === approvedVersionId;
                    return (
                      <div
                        key={doc.id}
                        className={`flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/40 transition-colors ${isSelected ? 'bg-primary/10 border border-primary/20' : ''}`}
                        onClick={() => {
                          selectDocument(doc.id);
                          if (approvedVersionId) setSelectedVersionId(approvedVersionId);
                        }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span className="text-[10px] font-medium truncate">{formatDocType(doc.doc_type)}</span>
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      </div>
                    );
                  })}
                </ScrollArea>
              )}

              {/* Show selected approved doc content */}
              {selectedDocId && approvedVersionMap[selectedDocId] === selectedVersionId && versionText && (
                <ScrollArea className="h-[250px] rounded border border-border/50 bg-muted/20 mt-2">
                  <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap font-body text-foreground">
                    {versionText}
                  </pre>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
