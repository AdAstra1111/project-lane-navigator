import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  docType: string;
  oldHash: string;
  currentHash: string;
  seasonEpisodeCount?: number;
  onRegenerate: () => void;
  isRegenerating?: boolean;
}

export function StaleDocBanner({ docType, oldHash, currentHash, seasonEpisodeCount, onRegenerate, isRegenerating }: Props) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5">
        <p className="text-foreground font-medium">
          Stale: <span className="capitalize">{docType.replace(/_/g, ' ')}</span> references outdated qualifications
        </p>
        <p className="text-muted-foreground">
          Document hash{' '}
          <Badge variant="outline" className="text-[9px] mx-0.5 bg-destructive/10 text-destructive font-mono">
            {oldHash.slice(0, 12)}
          </Badge>{' '}
          vs current{' '}
          <Badge variant="outline" className="text-[9px] mx-0.5 bg-primary/10 text-primary font-mono">
            {currentHash.slice(0, 12)}
          </Badge>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={onRegenerate}
          disabled={isRegenerating}
        >
          <RefreshCw className="h-3 w-3" />
          Regenerate {docType.replace(/_/g, ' ')} to match canonical format
          {seasonEpisodeCount ? ` (${seasonEpisodeCount} eps)` : ''}
        </Button>
      </div>
    </div>
  );
}
