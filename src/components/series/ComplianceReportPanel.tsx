/**
 * ComplianceReportPanel — Shows template compliance scores and actionable fixes.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertTriangle, Loader2, Shield } from 'lucide-react';
import type { ComplianceReport } from '@/hooks/useSeriesWriterV2';

interface Props {
  report: ComplianceReport | null;
  onRunCompliance: () => void;
  isRunning: boolean;
  hasScript: boolean;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-medium">{score}</span>
      </div>
      <Progress value={score} className="h-1" />
    </div>
  );
}

export function ComplianceReportPanel({ report, onRunCompliance, isRunning, hasScript }: Props) {
  const pass = report ? report.scores.overall >= 65 : false;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 px-4 pt-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-primary" />
          Template Compliance
          {report && (
            <Badge
              variant="outline"
              className={`text-[8px] ml-auto ${pass ? 'border-emerald-500/30 text-emerald-400' : 'border-orange-500/30 text-orange-400'}`}
            >
              {pass ? 'Pass' : 'Needs Work'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {report ? (
          <>
            <div className="space-y-1.5">
              <ScoreBar label="Tone Match" score={report.scores.tone_match} />
              <ScoreBar label="Pacing" score={report.scores.pacing_match} />
              <ScoreBar label="Dialogue Voice" score={report.scores.dialogue_voice} />
              <ScoreBar label="Cliffhanger" score={report.scores.cliffhanger_strength} />
            </div>

            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
              {pass ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />
              )}
              <span className={`text-xs font-medium ${pass ? 'text-emerald-400' : 'text-orange-400'}`}>
                Overall: {report.scores.overall}%
              </span>
            </div>

            {report.flags.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground uppercase font-medium">Flags</span>
                <div className="flex flex-wrap gap-1">
                  {report.flags.map((flag, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] border-orange-500/30 text-orange-400">
                      {flag.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {report.suggestions && (
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">Fixes</span>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">{report.suggestions}</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              {hasScript ? 'Run compliance check against the season template.' : 'Generate a draft first.'}
            </p>
            {hasScript && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onRunCompliance} disabled={isRunning}>
                {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                Run Compliance
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
