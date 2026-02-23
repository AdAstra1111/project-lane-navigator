import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X } from 'lucide-react';
import type { DiffJson } from '@/lib/types/visualUnits';

interface Props {
  diffSummary: string;
  diffJson: DiffJson;
  onClose: () => void;
}

export function VisualUnitDiffPanel({ diffSummary, diffJson, onClose }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs">Diff Comparison</CardTitle>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-[10px] text-muted-foreground mb-3">{diffSummary}</p>

        {/* Score Deltas */}
        {Object.keys(diffJson.score_deltas || {}).length > 0 && (
          <div className="mb-3">
            <p className="text-[9px] font-medium text-muted-foreground uppercase mb-1">Score Deltas</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(diffJson.score_deltas).map(([field, delta]) => (
                <span key={field} className={`text-[10px] font-mono ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {field}: {delta > 0 ? '+' : ''}{delta}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Shot Deltas */}
        {(diffJson.shot_deltas?.added > 0 || diffJson.shot_deltas?.removed > 0) && (
          <div className="mb-3">
            <p className="text-[9px] font-medium text-muted-foreground uppercase mb-1">Shot Changes</p>
            <p className="text-[10px]">
              {diffJson.shot_deltas.added > 0 && <span className="text-emerald-400">+{diffJson.shot_deltas.added} added</span>}
              {diffJson.shot_deltas.added > 0 && diffJson.shot_deltas.removed > 0 && ' / '}
              {diffJson.shot_deltas.removed > 0 && <span className="text-red-400">-{diffJson.shot_deltas.removed} removed</span>}
            </p>
          </div>
        )}

        {/* Changed Fields */}
        <ScrollArea className="h-[30vh]">
          <div className="space-y-2">
            {diffJson.changed_fields?.map((cf, i) => (
              <div key={i} className="p-2 rounded border border-border space-y-1">
                <p className="text-[10px] font-medium">{cf.field}</p>
                <div className="grid grid-cols-2 gap-1">
                  <div className="p-1 rounded bg-red-500/5 border border-red-500/20">
                    <p className="text-[8px] text-muted-foreground">From</p>
                    <p className="text-[9px] break-all">{typeof cf.from === 'object' ? JSON.stringify(cf.from) : String(cf.from ?? '—')}</p>
                  </div>
                  <div className="p-1 rounded bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[8px] text-muted-foreground">To</p>
                    <p className="text-[9px] break-all">{typeof cf.to === 'object' ? JSON.stringify(cf.to) : String(cf.to ?? '—')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
