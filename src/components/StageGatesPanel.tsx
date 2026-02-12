import { CheckCircle2, Circle, Loader2, AlertTriangle, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { useStageGates } from '@/hooks/usePromotionModules';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { icon: any; color: string; label: string }> = {
  NOT_STARTED: { icon: Circle, color: 'text-muted-foreground', label: 'Not Started' },
  IN_PROGRESS: { icon: Loader2, color: 'text-blue-400', label: 'In Progress' },
  PASSED: { icon: CheckCircle2, color: 'text-green-400', label: 'Passed' },
  BLOCKED: { icon: AlertTriangle, color: 'text-red-400', label: 'Blocked' },
};

interface Props { projectId: string; }

export function StageGatesPanel({ projectId }: Props) {
  const { gates, updateGate } = useStageGates(projectId);

  if (gates.length === 0) return null;

  const currentGateIdx = gates.findIndex(g => g.status === 'IN_PROGRESS');
  const currentGate = currentGateIdx >= 0 ? gates[currentGateIdx] : null;

  return (
    <Card className="border-border/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Stage Gates
          </CardTitle>
          {currentGate && (
            <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
              Current: {currentGate.gate_name}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1">
        {gates.map((gate, idx) => {
          const meta = STATUS_META[gate.status] || STATUS_META.NOT_STARTED;
          const Icon = meta.icon;
          const artifacts = (gate.required_artifacts as string[]) || [];
          const blockers = (gate.blockers as string[]) || [];
          const isCurrent = gate.status === 'IN_PROGRESS';

          return (
            <Collapsible key={gate.id}>
              <CollapsibleTrigger className="w-full">
                <div className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors',
                  isCurrent && 'bg-blue-500/5 border border-blue-500/20'
                )}>
                  <div className="flex items-center gap-2 flex-1">
                    <Icon className={cn('h-4 w-4 shrink-0', meta.color, gate.status === 'IN_PROGRESS' && 'animate-spin')} />
                    <span className={cn('text-sm font-medium', isCurrent && 'text-blue-400')}>
                      {gate.gate_name}
                    </span>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px]', meta.color)}>{meta.label}</Badge>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-9 pr-3 pb-2 space-y-2">
                {artifacts.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Required Artifacts</span>
                    {artifacts.map((a, i) => (
                      <p key={i} className="text-xs text-muted-foreground">• {a}</p>
                    ))}
                  </div>
                )}
                {blockers.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Blockers</span>
                    {blockers.map((b, i) => (
                      <p key={i} className="text-xs text-red-400/80">• {b}</p>
                    ))}
                  </div>
                )}
                <Select
                  value={gate.status}
                  onValueChange={(val) => updateGate({ id: gate.id, status: val })}
                >
                  <SelectTrigger className="h-7 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_META).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
