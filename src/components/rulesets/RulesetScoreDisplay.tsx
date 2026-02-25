import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import type { NuanceGateResult } from '@/lib/rulesets/types';

interface RulesetScoreDisplayProps {
  nuanceScore: number;
  melodramaScore: number;
  similarityRisk: number;
  gateResult?: NuanceGateResult;
  resolvedSummary?: string;
}

export function RulesetScoreDisplay({
  nuanceScore,
  melodramaScore,
  similarityRisk,
  gateResult,
  resolvedSummary,
}: RulesetScoreDisplayProps) {
  const gatePassed = gateResult?.final?.pass ?? true;
  const failures = gateResult?.final?.failures || [];
  const wasRepaired = !!gateResult?.attempt1;

  return (
    <Card className="border-border/50">
      <CardContent className="py-3 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Ruleset Scores
          {gatePassed ? (
            <Badge variant="outline" className="text-[8px] text-green-600 border-green-600/30">
              <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Gate Passed
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[8px]">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Gate Failed
            </Badge>
          )}
          {wasRepaired && (
            <Badge variant="secondary" className="text-[8px]">Repaired</Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <ScoreBar label="Nuance" value={nuanceScore} goodHigh />
          <ScoreBar label="Melodrama" value={melodramaScore} goodHigh={false} />
          <ScoreBar label="Similarity" value={similarityRisk} goodHigh={false} />
        </div>

        {failures.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {failures.map(f => (
              <Badge key={f} variant="destructive" className="text-[8px]">
                {f.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}

        {(resolvedSummary || wasRepaired) && (
          <Accordion type="single" collapsible>
            {resolvedSummary && (
              <AccordionItem value="rules" className="border-border/50">
                <AccordionTrigger className="py-1.5 text-[10px] hover:no-underline text-muted-foreground">
                  Ruleset Used
                </AccordionTrigger>
                <AccordionContent>
                  <pre className="text-[9px] text-muted-foreground whitespace-pre-wrap">{resolvedSummary}</pre>
                </AccordionContent>
              </AccordionItem>
            )}
            {wasRepaired && gateResult?.repair_instruction && (
              <AccordionItem value="repair" className="border-border/50">
                <AccordionTrigger className="py-1.5 text-[10px] hover:no-underline text-muted-foreground">
                  What Changed (Repair)
                </AccordionTrigger>
                <AccordionContent>
                  <pre className="text-[9px] text-muted-foreground whitespace-pre-wrap">
                    {gateResult.repair_instruction}
                  </pre>
                  {gateResult.attempt0 && gateResult.attempt1 && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[9px]">
                      <div>
                        <span className="text-muted-foreground">Before:</span>
                        <p>Melodrama: {gateResult.attempt0.melodrama_score.toFixed(2)}</p>
                        <p>Nuance: {gateResult.attempt0.nuance_score.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">After:</span>
                        <p>Melodrama: {gateResult.attempt1.melodrama_score.toFixed(2)}</p>
                        <p>Nuance: {gateResult.attempt1.nuance_score.toFixed(2)}</p>
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value, goodHigh }: { label: string; value: number; goodHigh: boolean }) {
  const pct = Math.round(value * 100);
  const isGood = goodHigh ? pct >= 50 : pct <= 40;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${isGood ? 'text-green-600' : 'text-amber-500'}`}>{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
