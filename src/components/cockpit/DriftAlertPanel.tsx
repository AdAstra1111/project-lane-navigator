import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DriftAlert } from '@/hooks/useStateGraph';
import { AlertTriangle, Check } from 'lucide-react';

interface Props {
  alerts: DriftAlert[];
  onAcknowledge: (alertId: string) => void;
}

const severityColors: Record<string, string> = {
  info: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

export function DriftAlertPanel({ alerts, onAcknowledge }: Props) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Drift Alerts ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map(a => (
          <div key={a.id} className="flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2 min-w-0">
              <Badge variant="outline" className={`shrink-0 text-[10px] ${severityColors[a.severity] || ''}`}>
                {a.severity}
              </Badge>
              <div className="min-w-0">
                <p className="font-medium">{a.message}</p>
                <p className="text-muted-foreground">{a.layer} · {a.metric_key} = {a.current_value}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 h-6 w-6 p-0" onClick={() => onAcknowledge(a.id)}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
