import { InfoTooltip } from '@/components/InfoTooltip';

interface DeviationBarProps {
  label: string;
  value: number | null;
  median: number | null;
  unit?: string;
  tooltip?: string;
}

function DeviationBar({ label, value, median, unit = '', tooltip }: DeviationBarProps) {
  if (value == null || median == null || median === 0) return null;
  const deviation = Math.round(((value - median) / median) * 100);
  const absDeviation = Math.abs(deviation);
  const color = absDeviation <= 10 ? 'text-emerald-400' : absDeviation <= 25 ? 'text-amber-400' : 'text-red-400';
  const bgColor = absDeviation <= 10 ? 'bg-emerald-500' : absDeviation <= 25 ? 'bg-amber-500' : 'bg-red-500';
  const barWidth = Math.min(absDeviation, 50);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1">
          {label}
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {Math.round(value)}{unit} vs {Math.round(median)}{unit}
          </span>
          <span className={`font-mono font-medium text-xs ${color}`}>
            {deviation > 0 ? '+' : ''}{deviation}%
          </span>
        </div>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden flex">
        <div className="flex-1" />
        <div className={`h-full rounded-full ${bgColor} transition-all`} style={{ width: `${barWidth}%` }} />
        <div className="flex-1" />
      </div>
    </div>
  );
}

interface Props {
  pageCount?: number | null;
  sceneCount?: number | null;
  dialogueRatio?: number | null;
  runtime?: number | null;
  calibration: {
    median_page_count?: number;
    median_scene_count?: number;
    median_dialogue_ratio?: number;
    median_runtime?: number;
  } | null;
}

export function DeviationGauge({ pageCount, sceneCount, dialogueRatio, runtime, calibration }: Props) {
  if (!calibration) return null;

  const hasAny = (pageCount != null && calibration.median_page_count) ||
    (sceneCount != null && calibration.median_scene_count) ||
    (dialogueRatio != null && calibration.median_dialogue_ratio) ||
    (runtime != null && calibration.median_runtime);

  if (!hasAny) return null;

  return (
    <div className="space-y-2 p-3 rounded-lg border border-border/50 bg-muted/10">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Corpus Deviation
      </p>
      <div className="space-y-1.5">
        <DeviationBar
          label="Length"
          value={pageCount}
          median={calibration.median_page_count ?? null}
          unit=" pp"
          tooltip="Page count vs corpus median for this format"
        />
        <DeviationBar
          label="Scenes"
          value={sceneCount}
          median={calibration.median_scene_count ?? null}
          tooltip="Scene count vs corpus median"
        />
        <DeviationBar
          label="Dialogue"
          value={dialogueRatio != null ? dialogueRatio * 100 : null}
          median={calibration.median_dialogue_ratio != null ? calibration.median_dialogue_ratio * 100 : null}
          unit="%"
          tooltip="Dialogue ratio vs corpus median"
        />
        <DeviationBar
          label="Runtime"
          value={runtime}
          median={calibration.median_runtime ?? null}
          unit=" min"
          tooltip="Estimated runtime vs corpus median"
        />
      </div>
    </div>
  );
}
