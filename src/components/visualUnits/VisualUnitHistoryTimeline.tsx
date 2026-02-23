import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { VisualUnitEvent } from '@/lib/types/visualUnits';

interface Props {
  events: VisualUnitEvent[];
  isLoading: boolean;
}

const eventIcons: Record<string, string> = {
  proposed: '📝',
  accepted: '✅',
  rejected: '❌',
  modified: '✏️',
  locked: '🔒',
  unlocked: '🔓',
  overridden: '🔄',
  stale_marked: '⚠️',
  compared: '🔍',
  regenerated: '♻️',
};

export function VisualUnitHistoryTimeline({ events, isLoading }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : events.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-6 px-3">Select a candidate to see its history.</p>
        ) : (
          <ScrollArea className="h-[40vh]">
            <div className="px-3 pb-3 space-y-0.5">
              {events.map(ev => (
                <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
                  <span className="text-sm mt-0.5">{eventIcons[ev.event_type] || '📌'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[7px]">{ev.event_type}</Badge>
                    </div>
                    {ev.payload?.reason && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">{ev.payload.reason}</p>
                    )}
                    {ev.payload?.note && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">{ev.payload.note}</p>
                    )}
                    <p className="text-[8px] text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
