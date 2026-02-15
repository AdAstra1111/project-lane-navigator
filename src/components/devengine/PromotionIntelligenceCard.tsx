import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowRight, RefreshCw, AlertTriangle, Shield, Loader2, ShieldAlert,
  ChevronDown, Pencil, SkipForward, CheckCircle2,
} from 'lucide-react';

export interface PromotionRecommendation {
  recommendation: 'promote' | 'stabilise' | 'escalate';
  next_document: string | null;
  readiness_score: number;
  confidence: number;
  reasons: string[];
  must_fix_next: string[];
  risk_flags: string[];
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
  onPromote?: () => void;
  onReReview?: () => void;
  onEscalate?: () => void;
}

const LABELS: Record<string, { label: string; color: string; icon: typeof ArrowRight }> = {
  promote: { label: 'Promote', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: ArrowRight },
  stabilise: { label: 'Stabilise', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: RefreshCw },
  escalate: { label: 'Escalate', color: 'bg-destructive/15 text-destructive border-destructive/30', icon: AlertTriangle },
};

const DOC_LABELS: Record<string, string> = {
  idea: 'Idea', concept_brief: 'Concept Brief', blueprint: 'Blueprint',
  architecture: 'Architecture', draft: 'Draft', coverage: 'Coverage',
};

export function PromotionIntelligenceCard({ data, isLoading, onPromote, onReReview, onEscalate }: Props) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset queue when data changes
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

  const handleApproveSelected = useCallback(() => {
    setQueueItems(prev => prev.map(item =>
      selectedIds.has(item.id) ? { ...item, status: 'approved' as const } : item
    ));
    // Execute the recommended action
    if (data?.recommendation === 'promote') onPromote?.();
    else if (data?.recommendation === 'stabilise') onReReview?.();
    else if (data?.recommendation === 'escalate') onEscalate?.();
  }, [selectedIds, data?.recommendation, onPromote, onReReview, onEscalate]);

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
  const pendingCount = queueItems.filter(i => i.status === 'pending').length;
  const whyText = reasons[0] || '—';

  return (
    <Card className="border-primary/20">
      {/* Header */}
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
            {meta.label}
            {next_document ? ` → ${DOC_LABELS[next_document] || next_document}` : ''}
          </Badge>
        </div>

        {/* Why (single line) */}
        <p className="text-[10px] text-muted-foreground line-clamp-1">{whyText}</p>
        {reasons.length > 1 && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[9px] text-primary hover:underline"
          >
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

        {/* Risk flags (compact) */}
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

                  {/* Inline edit */}
                  {editingId === item.id && (
                    <div className="mt-1.5 space-y-1">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="text-[10px] min-h-[40px] h-10"
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-5 text-[9px] px-2" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" className="h-5 text-[9px] px-2" onClick={() => handleSaveEdit(item.id)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Queue buttons */}
            {pendingCount > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <Button size="sm" className="h-6 text-[9px] gap-1 px-2" onClick={handleApproveSelected}>
                  <CheckCircle2 className="h-3 w-3" /> Approve selected
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
