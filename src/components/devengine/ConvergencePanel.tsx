/**
 * ConvergencePanel — Compact convergence scores, sparkline, and tiered note counts.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Check } from 'lucide-react';

interface ConvergencePanelProps {
  latestAnalysis: any;
  convergenceHistory: any[];
  convergenceStatus: string;
  tieredNotes: { blockers: any[]; high: any[]; polish: any[] };
}

function Sparkline({ history }: { history: any[] }) {
  if (history.length < 2) return null;
  const w = 200, h = 40, pad = 4;
  const ciPts = history.map(h => Number(h.creative_score));
  const gpPts = history.map(h => Number(h.greenlight_score));
  const all = [...ciPts, ...gpPts];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 100);
  const range = max - min || 1;

  const toPath = (pts: number[]) => pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={toPath(ciPts)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
      <path d={toPath(gpPts)} fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2" />
    </svg>
  );
}

export function ConvergencePanel({ latestAnalysis, convergenceHistory, convergenceStatus, tieredNotes }: ConvergencePanelProps) {
  const ci = latestAnalysis?.ci_score || latestAnalysis?.scores?.ci_score || 0;
  const gp = latestAnalysis?.gp_score || latestAnalysis?.scores?.gp_score || 0;
  const gap = latestAnalysis?.gap || latestAnalysis?.scores?.gap || 0;
  const statusColor = convergenceStatus === 'Converged' ? 'text-emerald-400' :
    convergenceStatus === 'In Progress' ? 'text-amber-400' : 'text-muted-foreground';

  return (
    <Card>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" /> Convergence
          </CardTitle>
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
            convergenceStatus === 'Converged' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
            convergenceStatus === 'In Progress' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
            'bg-muted/20 text-muted-foreground'
          }`}>
            {convergenceStatus === 'Converged' && <Check className="h-2.5 w-2.5 mr-0.5" />}
            {convergenceStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Scores row */}
        {latestAnalysis && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Script</p>
              <p className="text-lg font-display font-bold text-foreground">{ci}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Finance</p>
              <p className="text-lg font-display font-bold text-foreground">{gp}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Gap</p>
              <p className={`text-lg font-display font-bold ${statusColor}`}>{gap}</p>
            </div>
          </div>
        )}

        {/* Sparkline */}
        <Sparkline history={convergenceHistory} />

        {/* Note tier counts */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
            <span className="text-destructive font-medium">{tieredNotes.blockers.length}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span className="text-amber-400 font-medium">{tieredNotes.high.length}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />
            <span className="text-muted-foreground font-medium">{tieredNotes.polish.length}</span>
          </div>
        </div>

        {/* Blocking issues inline */}
        {tieredNotes.blockers.length > 0 && (
          <div className="p-2 rounded bg-destructive/10 border border-destructive/20 space-y-0.5">
            <p className="text-[9px] font-semibold text-destructive">Blocking Issues</p>
            {tieredNotes.blockers.map((b: any, i: number) => (
              <p key={i} className="text-[9px] text-destructive/80">• {b.description || b}</p>
            ))}
          </div>
        )}

        {/* Executive snapshot */}
        {latestAnalysis?.executive_snapshot && (
          <p className="text-[9px] text-muted-foreground italic">{latestAnalysis.executive_snapshot}</p>
        )}

        {/* Summary bullets */}
        {latestAnalysis?.summary && (
          <div className="space-y-0.5">
            {(latestAnalysis.summary as string[]).slice(0, 3).map((s: string, i: number) => (
              <p key={i} className="text-[9px] text-muted-foreground">• {s}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
