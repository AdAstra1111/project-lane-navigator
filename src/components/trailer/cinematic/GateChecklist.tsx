/**
 * Gate Checklist — Shows pass/fail status for cinematic proof gates
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Check, X, ChevronDown, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

interface GateResult {
  passed: boolean;
  failures: string[];
}

interface GateChecklistProps {
  scriptGates?: GateResult | null;
  shotDesignGates?: GateResult | null;
  assemblyGates?: GateResult | null;
  judgeScores?: Record<string, number> | null;
}

// Define the gate items with labels
const SCRIPT_GATE_LABELS = [
  { key: 'canon_hash', label: 'Canon context hash' },
  { key: 'citations', label: 'Source citations' },
  { key: 'movement', label: 'Movement escalation' },
  { key: 'silence', label: 'Silence windows' },
  { key: 'montage', label: 'Crescendo micro-montage' },
  { key: 'beat_count', label: 'Beat count range' },
  { key: 'canon_ground', label: 'Canon grounding' },
];

const SHOT_GATE_LABELS = [
  { key: 'non_static', label: 'Non-static movement' },
  { key: 'transitions', label: 'Transition variety (≥3)' },
  { key: 'crescendo', label: 'Crescendo density (≥3 shots)' },
];

const JUDGE_THRESHOLDS: { key: string; label: string; threshold: number }[] = [
  { key: 'canon_adherence', label: 'Canon adherence', threshold: 0.9 },
  { key: 'movement_escalation', label: 'Movement escalation', threshold: 0.75 },
  { key: 'contrast_density', label: 'Contrast density', threshold: 0.75 },
  { key: 'style_cohesion', label: 'Style cohesion', threshold: 0.7 },
];

const ASSEMBLY_GATE_LABELS = [
  { key: 'clip_coverage', label: 'Clip coverage (≥60%)' },
  { key: 'beat_count', label: 'Beat count (≥6)' },
  { key: 'duration', label: 'Duration range (15–300s)' },
];

function GateItem({ passed, label, detail }: { passed: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      {passed ? (
        <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
      ) : (
        <X className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <span className={`text-xs ${passed ? 'text-muted-foreground' : 'text-destructive'}`}>{label}</span>
        {detail && !passed && (
          <p className="text-[10px] text-destructive/70 mt-0.5 truncate">{detail}</p>
        )}
      </div>
    </div>
  );
}

function GateSection({ title, gates, labels, failures }: {
  title: string;
  gates: GateResult | null | undefined;
  labels: { key: string; label: string }[];
  failures?: string[];
}) {
  if (!gates) return null;
  const failureSet = new Set(failures || gates.failures || []);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 mb-1">
        {gates.passed ? (
          <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        <Badge variant={gates.passed ? 'default' : 'destructive'} className="text-[8px] px-1 py-0 ml-auto">
          {gates.passed ? 'PASS' : `${gates.failures.length} FAIL`}
        </Badge>
      </div>
      {/* If passed, show compact summary. If failed, show detail. */}
      {gates.passed ? (
        <p className="text-[10px] text-green-400/70 pl-5">All gates passed</p>
      ) : (
        <div className="pl-1 space-y-0">
          {gates.failures.map((f, i) => (
            <GateItem key={i} passed={false} label={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GateChecklist({ scriptGates, shotDesignGates, assemblyGates, judgeScores }: GateChecklistProps) {
  const [open, setOpen] = useState(false);

  const hasAnyGates = scriptGates || shotDesignGates || assemblyGates || judgeScores;
  if (!hasAnyGates) return null;

  const allPassed = (scriptGates?.passed ?? true) && (shotDesignGates?.passed ?? true) && (assemblyGates?.passed ?? true);
  const totalFailures = (scriptGates?.failures?.length || 0) + (shotDesignGates?.failures?.length || 0) + (assemblyGates?.failures?.length || 0);

  // Judge score gate check
  const judgeFailures: string[] = [];
  if (judgeScores) {
    for (const t of JUDGE_THRESHOLDS) {
      const val = judgeScores[t.key];
      if (val != null && val < t.threshold) {
        judgeFailures.push(`${t.label}: ${val.toFixed(2)} < ${t.threshold}`);
      }
    }
  }
  const judgePassed = judgeFailures.length === 0;
  const overallPassed = allPassed && judgePassed;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
          overallPassed 
            ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10' 
            : 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
        }`}>
          {overallPassed ? (
            <ShieldCheck className="h-4 w-4 text-green-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-destructive" />
          )}
          <span className="text-xs font-medium flex-1">
            {overallPassed ? 'All Proof Gates Passed' : `${totalFailures + judgeFailures.length} Gate Failure${totalFailures + judgeFailures.length > 1 ? 's' : ''}`}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="py-3 space-y-4">
            <GateSection title="Script Gates" gates={scriptGates} labels={SCRIPT_GATE_LABELS} />
            <GateSection title="Shot Design Gates" gates={shotDesignGates} labels={SHOT_GATE_LABELS} />
            
            {judgeScores && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 mb-1">
                  {judgePassed ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Judge Gates</span>
                  <Badge variant={judgePassed ? 'default' : 'destructive'} className="text-[8px] px-1 py-0 ml-auto">
                    {judgePassed ? 'PASS' : `${judgeFailures.length} FAIL`}
                  </Badge>
                </div>
                {judgePassed ? (
                  <p className="text-[10px] text-green-400/70 pl-5">All judge thresholds met</p>
                ) : (
                  <div className="pl-1 space-y-0">
                    {judgeFailures.map((f, i) => (
                      <GateItem key={i} passed={false} label={f} />
                    ))}
                  </div>
                )}
                {/* Show all judge scores */}
                <div className="flex flex-wrap gap-2 pl-5 mt-1">
                  {JUDGE_THRESHOLDS.map(t => {
                    const val = judgeScores[t.key];
                    if (val == null) return null;
                    const ok = val >= t.threshold;
                    return (
                      <span key={t.key} className={`text-[9px] font-mono ${ok ? 'text-green-400/70' : 'text-destructive/70'}`}>
                        {t.label.split(' ').map(w => w[0]).join('')}: {val.toFixed(2)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <GateSection title="Assembly Gates" gates={assemblyGates} labels={ASSEMBLY_GATE_LABELS} />
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
