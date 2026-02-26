import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Activity } from 'lucide-react';
import { useStyleEvals } from '@/hooks/useStyleEvals';

interface StyleScoreBadgeProps {
  metaJson: any;
}

export function StyleScoreBadge({ metaJson }: StyleScoreBadgeProps) {
  const summary = metaJson?.style_eval_summary;
  if (!summary) return null;

  const score = typeof summary.score === 'number' ? summary.score : null;
  if (score === null) return null;

  const driftLevel = summary.drift_level || 'low';
  const driftColor = driftLevel === 'high'
    ? 'bg-destructive/10 text-destructive border-destructive/30'
    : driftLevel === 'medium'
    ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
    : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';

  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 gap-1 ${driftColor}`}>
      <Activity className="h-2.5 w-2.5" />
      Style: {Math.round(score * 100)}%
      {driftLevel !== 'low' && ` · ${driftLevel}`}
    </Badge>
  );
}

interface StyleEvalPanelProps {
  projectId: string;
  documentId: string;
  metaJson: any;
}

export function StyleEvalPanel({ projectId, documentId, metaJson }: StyleEvalPanelProps) {
  const { data: evals } = useStyleEvals(projectId, documentId);
  const evalDetail = metaJson?.style_eval;

  if (!evalDetail && (!evals || evals.length === 0)) return null;

  const voiceLabel = evalDetail?.target?.voice_label || evalDetail?.voice_source || 'Unknown';
  const fp = evalDetail?.fingerprint;
  const deltas = evalDetail?.deltas || {};
  const drivers: string[] = deltas.top_3_drivers || [];

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full py-1.5">
        <Activity className="h-3.5 w-3.5" />
        <span>Style Deviation</span>
        {evalDetail && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto">
            {Math.round(evalDetail.score * 100)}% · {evalDetail.drift_level}
          </Badge>
        )}
        <ChevronDown className="h-3 w-3 ml-1" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pl-5 text-[11px] text-muted-foreground">
        {/* Voice source */}
        <div className="flex items-center gap-1.5">
          <span className="font-medium">Voice:</span>
          <span>{voiceLabel}</span>
        </div>

        {/* Fingerprint summary */}
        {fp && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div>Dialogue ratio: <span className="font-mono">{fp.dialogue_ratio}</span></div>
            <div>Avg sentence: <span className="font-mono">{fp.avg_sentence_len}</span> words</div>
            <div>Density: <span className="font-mono">{fp.description_density}</span></div>
            <div>Lexical variety: <span className="font-mono">{fp.lexical_variety}</span></div>
          </div>
        )}

        {/* Top deviation drivers */}
        {drivers.length > 0 && (
          <div>
            <span className="font-medium">Top deviations:</span>
            <ul className="list-disc list-inside mt-0.5 space-y-0.5">
              {drivers.map((d, i) => (
                <li key={i} className="text-[10px]">{d}</li>
              ))}
            </ul>
          </div>
        )}

        {/* History sparkline (simple text list) */}
        {evals && evals.length > 1 && (
          <div>
            <span className="font-medium">Recent scores:</span>
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {evals.slice(0, 10).map((ev) => {
                const c = ev.drift_level === 'high' ? 'text-destructive' : ev.drift_level === 'medium' ? 'text-orange-500' : 'text-emerald-500';
                return (
                  <span key={ev.id} className={`font-mono text-[10px] ${c}`}>
                    {Math.round(ev.score * 100)}%
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
