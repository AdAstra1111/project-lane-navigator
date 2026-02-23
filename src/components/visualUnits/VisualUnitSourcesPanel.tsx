import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, FileText } from 'lucide-react';
import type { SourceVersionInfo } from '@/lib/types/visualUnits';

interface Props {
  sources?: Record<string, SourceVersionInfo>;
  warnings?: string[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function VisualUnitSourcesPanel({ sources, warnings, isLoading, onRefresh }: Props) {
  const entries = sources ? Object.entries(sources) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs">Source Documents</CardTitle>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[25vh]">
          {entries.length === 0 && !isLoading && (
            <p className="text-[10px] text-muted-foreground text-center py-4">No sources found</p>
          )}
          <div className="space-y-0.5 px-3 pb-3">
            {entries.map(([docType, info]) => (
              <div key={docType} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium truncate">{docType.replace(/_/g, ' ')}</p>
                  <p className="text-[9px] text-muted-foreground">v{info.version_number}</p>
                </div>
                <Badge variant="outline" className="text-[7px] shrink-0">
                  {info.label}
                </Badge>
              </div>
            ))}
          </div>
          {warnings && warnings.length > 0 && (
            <div className="px-3 pb-3">
              {warnings.map((w, i) => (
                <p key={i} className="text-[9px] text-amber-400">{w}</p>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
