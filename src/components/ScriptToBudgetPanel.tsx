import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Brain, Loader2, Zap, DollarSign, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { BUDGET_CATEGORIES } from '@/hooks/useBudgets';
import { useExtractDocuments } from '@/hooks/useExtractDocuments';

interface AutoBudgetLine {
  category: string;
  line_name: string;
  amount: number;
  rationale: string;
}

interface AutoBudgetResult {
  estimated_total: number;
  confidence: number;
  reasoning: string;
  lines: AutoBudgetLine[];
}

interface Props {
  projectId: string;
  scriptText: string | null;
  format?: string;
  genres?: string[];
  budgetRange?: string;
  lane?: string;
  totalBudget?: number;
  onImport: (lines: { category: string; line_name: string; amount: number }[], estimatedTotal: number) => void;
}

const CAT_STYLES: Record<string, string> = {
  atl: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  btl: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  post: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  vfx: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  logistics: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  schedule: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  contingency: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'soft-money': 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  other: 'bg-muted text-muted-foreground border-border',
};

export function ScriptToBudgetPanel({ projectId, scriptText, format, genres, budgetRange, lane, totalBudget, onImport }: Props) {
  const [result, setResult] = useState<AutoBudgetResult | null>(null);
  const [resolvedText, setResolvedText] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const extract = useExtractDocuments(projectId);

  // If scriptText is the sentinel, fetch extracted text from project_documents
  const needsFetch = scriptText === '__SCRIPT_EXISTS_NO_TEXT__';
  const effectiveText = needsFetch ? resolvedText : scriptText;
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // ~60s total polling
    const tryFetch = async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from('project_documents')
        .select('extracted_text')
        .eq('project_id', projectId)
        .not('extracted_text', 'is', null)
        .limit(1)
        .single();
      if (cancelled) return;
      if (data?.extracted_text) {
        setResolvedText(data.extracted_text);
      } else {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(tryFetch, 3000);
        } else {
          setFetchFailed(true);
        }
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, [needsFetch, projectId]);

  const STAGES = [
    { at: 5, label: 'Parsing script structure…' },
    { at: 15, label: 'Counting scenes & locations…' },
    { at: 30, label: 'Analysing cast & crew needs…' },
    { at: 50, label: 'Estimating department budgets…' },
    { at: 70, label: 'Applying format & genre rules…' },
    { at: 85, label: 'Finalising line items…' },
    { at: 95, label: 'Almost done…' },
  ];

  const startProgress = () => {
    setProgress(0);
    setProgressLabel('Preparing script…');
    let current = 0;
    progressTimer.current = setInterval(() => {
      current += Math.random() * 3 + 0.5;
      if (current > 96) current = 96;
      setProgress(current);
      const stage = [...STAGES].reverse().find(s => current >= s.at);
      if (stage) setProgressLabel(stage.label);
    }, 600);
  };

  const stopProgress = () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = null;
    setProgress(100);
    setProgressLabel('Done!');
  };

  useEffect(() => () => { if (progressTimer.current) clearInterval(progressTimer.current); }, []);

  const estimate = useMutation({
    mutationFn: async () => {
      if (!effectiveText) throw new Error('No script text available');
      startProgress();

      const { data, error } = await supabase.functions.invoke('script-to-budget', {
        body: { scriptText: effectiveText, format, genres, budgetRange, lane, totalBudget },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as AutoBudgetResult;
    },
    onSuccess: (data) => { stopProgress(); setResult(data); },
    onError: (e: Error) => { stopProgress(); toast.error(e.message); },
  });

  if (!scriptText) {
    return (
      <Card className="p-4 border-dashed border-2 border-border/50 bg-card/30 text-center">
        <Brain className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Upload a script to enable AI budget estimation.</p>
      </Card>
    );
  }

  if (needsFetch && !resolvedText && !fetchFailed) {
    return (
      <Card className="p-4 border-dashed border-2 border-border/50 bg-card/30 text-center space-y-3">
        <Brain className="h-6 w-6 mx-auto text-primary/40" />
        <p className="text-xs text-muted-foreground">Script detected — extracting text for budget estimation…</p>
        <Progress value={undefined} className="h-1.5 mx-auto max-w-[200px] animate-pulse" />
      </Card>
    );
  }

  if (needsFetch && !resolvedText && fetchFailed) {
    return (
      <Card className="p-4 border-dashed border-2 border-border/50 bg-card/30 text-center space-y-3">
        <Brain className="h-6 w-6 mx-auto text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Script text not yet extracted.</p>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => {
            setFetchFailed(false);
            extract.mutate();
          }}
          disabled={extract.isPending}
        >
          <RotateCw className={`h-3 w-3 ${extract.isPending ? 'animate-spin' : ''}`} />
          {extract.isPending ? 'Extracting…' : 'Extract Document Text'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Script → Auto Budget</h4>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => estimate.mutate()}
          disabled={estimate.isPending}
          className="text-xs"
        >
          {estimate.isPending ? (
            <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Estimating…</>
          ) : result ? (
            <><Zap className="h-3 w-3 mr-1.5" /> Re-estimate</>
          ) : (
            <><Zap className="h-3 w-3 mr-1.5" /> Estimate Budget</>
          )}
        </Button>
      </div>

      {estimate.isPending && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
          <Progress value={progress} className="h-2" />
          <p className="text-[11px] text-muted-foreground text-center">{progressLabel}</p>
        </motion.div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {/* Summary */}
          <div className="bg-primary/5 rounded-lg px-3 py-2 border border-primary/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">AI Estimated Budget</span>
              <Badge className="text-[10px]">{Math.round(result.confidence * 100)}% confident</Badge>
            </div>
            <p className="text-xl font-bold text-foreground">
              ${result.estimated_total.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{result.reasoning}</p>
          </div>

          {/* Line items */}
          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            {result.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-1.5">
                <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ${CAT_STYLES[l.category] || CAT_STYLES.other}`}>
                  {BUDGET_CATEGORIES.find(b => b.value === l.category)?.label || l.category}
                </Badge>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-foreground block truncate">{l.line_name}</span>
                  {l.rationale && <span className="text-[10px] text-muted-foreground block truncate">{l.rationale}</span>}
                </div>
                <span className="text-xs font-medium text-foreground shrink-0">
                  ${l.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {/* Import button */}
          <Button
            size="sm"
            onClick={() => onImport(result.lines, result.estimated_total)}
            className="w-full text-xs gap-1.5"
          >
            <DollarSign className="h-3 w-3" /> Create Budget from Estimate
          </Button>
        </motion.div>
      )}
    </div>
  );
}
