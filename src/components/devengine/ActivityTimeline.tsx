import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Trash2, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { toast } from 'sonner';

export interface ActivityItem {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface ActivityTimelineProps {
  items: ActivityItem[];
  onClear?: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-amber-500',
  error: 'text-destructive',
  success: 'text-green-600',
};

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-muted-foreground',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
  success: 'bg-green-600',
};

export function ActivityTimeline({ items, onClear }: ActivityTimelineProps) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const handleCopy = () => {
    const text = items.map(i => `[${i.ts}] [${i.level}] ${i.message}`).join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Activity log copied');
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`} />
          Activity ({items.length})
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-0.5">
          <div className="flex items-center gap-1 justify-end mb-1">
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleCopy}>
              <Copy className="h-2.5 w-2.5 mr-0.5" /> Copy
            </Button>
            {onClear && (
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={onClear}>
                <Trash2 className="h-2.5 w-2.5 mr-0.5" /> Clear
              </Button>
            )}
          </div>
          <ScrollArea className="max-h-32">
            <div className="space-y-0.5">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px]">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${LEVEL_DOT[item.level]}`} />
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={LEVEL_COLORS[item.level]}>{item.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
