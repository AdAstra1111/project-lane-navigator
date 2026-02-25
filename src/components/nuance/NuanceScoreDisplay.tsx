/**
 * NuanceScoreDisplay — Shows nuance gate results after a run.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Shield } from 'lucide-react';
import type { NuanceGateResult } from '@/lib/nuance/types';

interface NuanceScoreDisplayProps {
  melodramaScore: number;
  nuanceScore: number;
  similarityRisk: number;
  gateResult?: NuanceGateResult | Record<string, never>;
}

function scoreColor(score: number, inverted = false): string {
  const effective = inverted ? 1 - score : score;
  if (effective >= 0.7) return 'text-primary';
  if (effective >= 0.4) return 'text-accent-foreground';
  return 'text-destructive';
}

export function NuanceScoreDisplay({
  melodramaScore,
  nuanceScore,
  similarityRisk,
  gateResult,
}: NuanceScoreDisplayProps) {
  const gate = gateResult && 'attempt0' in gateResult ? gateResult as NuanceGateResult : null;
  const passed = gate?.final?.pass ?? true;
  const wasRepaired = !!gate?.attempt1;
  const failures = gate?.final?.failures || [];

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        {passed ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="font-medium text-muted-foreground">
          Nuance Gate: {passed ? 'Passed' : 'Issues detected'}
          {wasRepaired && ' (repaired)'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className={`text-sm font-semibold tabular-nums ${scoreColor(nuanceScore)}`}>
            {Math.round(nuanceScore * 100)}%
          </div>
          <div className="text-[9px] text-muted-foreground">Nuance</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-semibold tabular-nums ${scoreColor(melodramaScore, true)}`}>
            {Math.round(melodramaScore * 100)}%
          </div>
          <div className="text-[9px] text-muted-foreground">Melodrama</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-semibold tabular-nums ${scoreColor(similarityRisk, true)}`}>
            {Math.round(similarityRisk * 100)}%
          </div>
          <div className="text-[9px] text-muted-foreground">Similarity</div>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {failures.map(f => (
            <Badge key={f} variant="outline" className="text-[9px] border-border text-muted-foreground">
              <Shield className="h-2.5 w-2.5 mr-0.5" />
              {f.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
