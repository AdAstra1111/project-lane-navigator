import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowRight, RefreshCw, AlertTriangle, Shield, Loader2, ShieldAlert,
  ChevronDown, Pencil, SkipForward, CheckCircle2, Pause, Zap,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { NextAction } from '@/lib/next-action';
import { renderActionPillText, buildNoAction } from '@/lib/next-action';

export interface PromotionRecommendation {
  recommendation: 'promote' | 'stabilise' | 'escalate';
  next_document: string | null;
  readiness_score: number;
  confidence: number;
  reasons: string[];
  must_fix_next: string[];
  risk_flags: string[];
  /** Structured next action — replaces raw next_document rendering */
  next_action?: NextAction;
}

interface QueueItem {
  id: string;
  text: string;
  status: 'pending' | 'approved' | 'skipped';
  editedText?: string;
}

interface Props {
  data: PromotionRecommendation | null;
  isLoading: boolean;
  jobId?: string | null;
  onJobRefresh?: () => void;
  onScrollToDecisions?: () => void;
  /** @deprecated Use jobId + onJobRefresh instead */
  onPromote?: () => void;
  /** @deprecated */
  onReReview?: () => void;
  /** @deprecated */
  onEscalate?: () => void;
}

const LABELS: Record<string, { label: string; color: string; icon: typeof ArrowRight }> = {
  promote: { label: 'Promote', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: ArrowRight },
  stabilise: { label: 'Stabilise', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: RefreshCw },
  escalate: { label: 'Escalate', color: 'bg-destructive/15 text-destructive border-destructive/30', icon: AlertTriangle },
};

// DOC_LABELS removed — rendering now uses NextAction model from next-action.ts

async function callAutoRun(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Auto-run error');
  return result;
}

export function PromotionIntelligenceCard({ data, isLoading, jobId, onJobRefresh, onScrollToDecisions, onPromote, onReReview, onEscalate }: Props) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!data) { setQueueItems([]); return; }
    const items: QueueItem[] = (data.must_fix_next.length > 0
      ? data.must_fix_next
      : data.reasons.slice(0, 2).length > 0 ? data.reasons.slice(0, 2) : ['Review current stage']
    ).map((text, i) => ({
      id: `q-${i}`,
      text,
      status: 'pending' as const,
    }));
    setQueueItems(items);
    setSelectedIds(new Set(items.map(i => i.id)));
  }, [data?.must_fix_next?.join(','), data?.reasons?.join(',')]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const executeAction = useCallback(async (actionName: string) => {
    if (!jobId || actionLoading) return;
    setActionLoading(actionName);
    try {
      const result = await callAutoRun(actionName, { jobId });
      // Mark queue items as approved
      setQueueItems(prev => prev.map(item =>
        selectedIds.has(item.id) ? { ...item, status: 'approved' as const } : item
      ));
      onJobRefresh?.();
      // If the action hints at run-next, auto-trigger once
      if (result?.next_action_hint === 'run-next') {
        setTimeout(async () => {
          try {
            await callAutoRun('run-next', { jobId });
            onJobRefresh?.();
          } catch { /* ignore */ }
        }, 500);
      }
    } catch (e: any) {
      console.error(`Action ${actionName} failed:`, e.message);
    } finally {
      setActionLoading(null);
    }
  }, [jobId, actionLoading, selectedIds, onJobRefresh]);

  // Legacy fallback for when jobId is not provided
  const handleApproveSelected = useCallback(() => {
    if (jobId) {
      if (data?.recommendation === 'promote') executeAction('force-promote');
      else if (data?.recommendation === 'stabilise') executeAction('apply-rewrite');
      else if (data?.recommendation === 'escalate') executeAction('run-strategy');
      return;
    }
    // Legacy callbacks
    setQueueItems(prev => prev.map(item =>
      selectedIds.has(item.id) ? { ...item, status: 'approved' as const } : item
    ));
    if (data?.recommendation === 'promote') onPromote?.();
    else if (data?.recommendation === 'stabilise') onReReview?.();
    else if (data?.recommendation === 'escalate') onEscalate?.();
  }, [jobId, selectedIds, data?.recommendation, executeAction, onPromote, onReReview, onEscalate]);

  const handleApproveNext = useCallback(() => {
    const next = queueItems.find(i => i.status === 'pending');
    if (!next) return;
    setQueueItems(prev => prev.map(item =>
      item.id === next.id ? { ...item, status: 'approved' as const } : item
    ));
  }, [queueItems]);

  const handleSkip = useCallback(() => {
    const next = queueItems.find(i => i.status === 'pending');
    if (!next) return;
    setQueueItems(prev => prev.map(item =>
      item.id === next.id ? { ...item, status: 'skipped' as const } : item
    ));
  }, [queueItems]);

  const handleSaveEdit = useCallback((id: string) => {
    setQueueItems(prev => prev.map(item =>
      item.id === id ? { ...item, editedText: editText } : item
    ));
    setEditingId(null);
  }, [editText]);

  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Analysing promotion readiness…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { recommendation, next_document, readiness_score, confidence, reasons, risk_flags } = data;
  const meta = LABELS[recommendation] || LABELS.stabilise;
  const Icon = meta.icon;
  const hasHardGate = risk_flags.some(f => f.startsWith('hard_gate:'));
  const hasBlockers = risk_flags.includes('hard_gate:blockers');
  const pendingCount = queueItems.filter(i => i.status === 'pending').length;
  const whyText = reasons[0] || '—';
  const isAnyLoading = !!actionLoading;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs">Next Step</CardTitle>
          <div className="flex items-center gap-2 text-[10px]">
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-primary" />
              <span className="font-semibold text-foreground">{readiness_score}</span>
            </div>
            <span className="text-muted-foreground">{confidence}%</span>
            {hasHardGate && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-destructive border-destructive/40 bg-destructive/10 gap-0.5">
                <ShieldAlert className="h-2.5 w-2.5" /> Hard Gate
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2">
        {/* Recommendation pill */}
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${meta.color}`}>
            <Icon className="h-3 w-3 mr-1" />
            {(() => {
              const action = data.next_action || buildNoAction();
              const pillText = renderActionPillText(action);
              if (pillText) return `${meta.label} — ${pillText}`;
              return meta.label;
            })()}
          </Badge>
        </div>

        {/* Why */}
        <p className="text-[10px] text-muted-foreground line-clamp-1">{whyText}</p>
        {reasons.length > 1 && (
          <button onClick={() => setShowDetails(!showDetails)} className="text-[9px] text-primary hover:underline">
            {showDetails ? 'Hide details' : `Show details (${reasons.length - 1} more)`}
          </button>
        )}
        {showDetails && (
          <div className="space-y-0.5 pl-2 border-l-2 border-border/50">
            {reasons.slice(1).map((r, i) => (
              <p key={i} className="text-[9px] text-muted-foreground">• {r}</p>
            ))}
          </div>
        )}

        {/* Risk flags */}
        {risk_flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {risk_flags.slice(0, 4).map((f, i) => (
              <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 text-amber-500 border-amber-500/30">
                {f.replace('hard_gate:', '⚠ ')}
              </Badge>
            ))}
            {risk_flags.length > 4 && (
              <span className="text-[7px] text-muted-foreground">+{risk_flags.length - 4}</span>
            )}
          </div>
        )}

        {/* Direct Action Buttons */}
        {jobId && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
            {/* If paused for decisions, show Review Decisions CTA */}
            {data.recommendation === 'stabilise' && risk_flags.some(f => f === 'hard_gate:blockers' || f === 'hard_gate:early_stage_high_impact') ? (
              <Button
                size="sm"
                className="h-6 text-[9px] gap-1 px-2 bg-amber-600 hover:bg-amber-700"
                disabled={isAnyLoading}
                onClick={() => onScrollToDecisions?.()}
              >
                <AlertTriangle className="h-3 w-3" />
                Review Decisions
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-6 text-[9px] gap-1 px-2"
                disabled={isAnyLoading || (hasBlockers && recommendation !== 'promote')}
                onClick={() => executeAction('force-promote')}
                title={hasBlockers ? 'Blockers active — resolve before promoting' : undefined}
              >
                {actionLoading === 'force-promote' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                {hasBlockers ? 'Force Promote' : 'Promote'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] gap-1 px-2"
              disabled={isAnyLoading}
              onClick={() => executeAction('apply-rewrite')}
            >
              {actionLoading === 'apply-rewrite' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Rewrite
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] gap-1 px-2"
              disabled={isAnyLoading}
              onClick={() => executeAction('run-strategy')}
            >
              {actionLoading === 'run-strategy' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Strategy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[9px] gap-1 px-2"
              disabled={isAnyLoading}
              onClick={() => executeAction('pause')}
            >
              {actionLoading === 'pause' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
              Pause
            </Button>
          </div>
        )}

        {/* Approval Queue */}
        <Collapsible open={queueOpen} onOpenChange={setQueueOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full pt-1 border-t border-border/40">
            <span className="text-[10px] font-medium text-foreground">
              Actions to approve
              {pendingCount > 0 && (
                <span className="ml-1 text-muted-foreground">({pendingCount} pending)</span>
              )}
            </span>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${queueOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 space-y-1">
              {queueItems.map((item) => (
                <div key={item.id} className={`rounded px-2 py-1.5 ${
                  item.status === 'approved' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                  item.status === 'skipped' ? 'bg-muted/30 opacity-50' :
                  'bg-muted/30'
                }`}>
                  <div className="flex items-start gap-1.5">
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      disabled={item.status !== 'pending'}
                      onCheckedChange={() => toggleSelected(item.id)}
                      className="mt-0.5 h-3 w-3"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-foreground leading-tight">
                        {item.editedText || item.text}
                        {item.status === 'approved' && <CheckCircle2 className="h-3 w-3 inline ml-1 text-emerald-400" />}
                      </p>
                    </div>
                    {item.status === 'pending' && (
                      <button
                        onClick={() => { setEditingId(item.id); setEditText(item.editedText || item.text); }}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                  {editingId === item.id && (
                    <div className="mt-1.5 space-y-1">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="text-[10px] min-h-[40px] h-10"
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-5 text-[9px] px-2" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="sm" className="h-5 text-[9px] px-2" onClick={() => handleSaveEdit(item.id)}>Save</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {pendingCount > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <Button size="sm" className="h-6 text-[9px] gap-1 px-2" disabled={isAnyLoading} onClick={handleApproveSelected}>
                  {isAnyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve selected
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2" onClick={handleApproveNext}>
                  Approve next
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1 px-2" onClick={handleSkip}>
                  <SkipForward className="h-3 w-3" /> Skip
                </Button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
