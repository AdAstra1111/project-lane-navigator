import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface MonthlyPoint {
  month: number;
  budget_estimate: number;
  confidence_score: number;
  downside_exposure: number;
  capital_stack_stress: number;
  schedule_compression_risk: number;
}

interface Props {
  series: MonthlyPoint[];
  summary: string[];
  riskScore: number;
}

export function ScenarioProjectionChart({ series, summary, riskScore }: Props) {
  const chartData = series.map(p => ({
    ...p,
    budget_m: +(p.budget_estimate / 1_000_000).toFixed(2),
  }));

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Forward Projection
          </CardTitle>
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${riskScore > 50 ? 'bg-destructive/10 text-destructive' : riskScore > 25 ? 'bg-amber-500/10 text-amber-500' : 'bg-primary/10 text-primary'}`}>
            Risk: {riskScore.toFixed(1)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} label={{ value: 'Month', position: 'insideBottom', offset: -3, fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: 'Confidence', angle: -90, position: 'insideLeft', fontSize: 10 }} domain={[0, 100]} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: 'Budget ($M)', angle: 90, position: 'insideRight', fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="left" type="monotone" dataKey="confidence_score" name="Confidence" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="budget_m" name="Budget ($M)" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {summary.length > 0 && (
          <div className="text-[10px] text-muted-foreground font-mono space-y-0.5 border-t border-border/40 pt-2">
            {summary.map((s, i) => <p key={i}>• {s}</p>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
