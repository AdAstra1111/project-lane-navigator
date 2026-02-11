import { useState } from 'react';
import { ArrowRight, Sparkles, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PipelineStage } from '@/lib/types';
import { PIPELINE_STAGES } from '@/lib/types';
import type { StageGates } from '@/lib/pipeline-gates';

interface PipelineStageSuggestionProps {
  projectId: string;
  currentStage: PipelineStage;
  nextStageGates: StageGates | null;
}

export function PipelineStageSuggestion({ projectId, currentStage, nextStageGates }: PipelineStageSuggestionProps) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !nextStageGates) return null;

  const stageOrder: PipelineStage[] = ['development', 'packaging', 'financing', 'pre-production'];
  const currentIdx = stageOrder.indexOf(currentStage);
  const nextStage = stageOrder[currentIdx + 1];
  if (!nextStage) return null;

  const nextLabel = PIPELINE_STAGES.find(s => s.value === nextStage)?.label || nextStage;
  const metCount = nextStageGates.gates.filter(g => g.met).length;
  const totalCount = nextStageGates.gates.length;

  const handleAdvance = async () => {
    const { error } = await supabase
      .from('projects')
      .update({ pipeline_stage: nextStage })
      .eq('id', projectId);
    if (error) {
      toast.error('Failed to advance stage');
    } else {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      toast.success(`Project advanced to ${nextLabel}`);
    }
  };

  // All gates met → show advance banner
  if (nextStageGates.allMet) {
    return (
      <div className="flex items-center gap-3 glass-card rounded-lg px-4 py-2.5 border-l-4 border-emerald-500/50">
        <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-foreground">
            All <strong>{nextLabel}</strong> gates are met — ready to advance?
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalCount} of {totalCount} requirements satisfied
          </p>
        </div>
        <Button size="sm" variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={handleAdvance}>
          <ArrowRight className="h-3 w-3 mr-1" />
          Advance
        </Button>
        <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Some gates unmet → show blocker checklist
  const unblockers = nextStageGates.gates.filter(g => !g.met);

  return (
    <div className="glass-card rounded-lg px-4 py-3 border-l-4 border-amber-500/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm text-foreground">
            <strong>{nextLabel}</strong> — {metCount}/{totalCount} gates met
          </p>
        </div>
        <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1 pl-6">
        {nextStageGates.gates.map((gate, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {gate.met ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />
            )}
            <span className={gate.met ? 'text-muted-foreground line-through' : 'text-foreground'}>
              {gate.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
