import { Badge } from '@/components/ui/badge';

interface Props {
  hasProjection: boolean;
  hasStressTest: boolean;
  metricsComplete: boolean;
  driftCritical: number;
  driftWarning: number;
}

export function ScenarioDataHealthBadge({
  hasProjection,
  hasStressTest,
  metricsComplete,
  driftCritical,
  driftWarning,
}: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge
        variant={hasProjection ? 'default' : 'secondary'}
        className="text-[9px] px-1.5 py-0"
      >
        PROJ
      </Badge>
      <Badge
        variant={hasStressTest ? 'default' : 'secondary'}
        className="text-[9px] px-1.5 py-0"
      >
        STRESS
      </Badge>
      <Badge
        variant={metricsComplete ? 'default' : 'secondary'}
        className="text-[9px] px-1.5 py-0"
      >
        METRICS
      </Badge>
      <Badge
        variant={
          driftCritical > 0
            ? 'destructive'
            : driftWarning > 0
              ? 'secondary'
              : 'outline'
        }
        className="text-[9px] px-1.5 py-0"
      >
        DRIFT
      </Badge>
    </div>
  );
}
