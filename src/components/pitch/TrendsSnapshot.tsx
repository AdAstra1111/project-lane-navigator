import { Badge } from '@/components/ui/badge';
import { TrendingUp, X } from 'lucide-react';

interface SignalsMetadata {
  signals_used?: string[];
  influence_value?: number;
  applied?: boolean;
  rationale?: string;
  convergence_applied?: boolean;
  convergence_summary?: any;
  modality?: string;
  trends_production_type_filter?: string | null;
  animation_meta?: { primary?: string; style?: string; tags_count?: number; tags_sample?: string[] };
  context_version?: string;
}

interface Props {
  signalsMetadata: SignalsMetadata | null | undefined;
  updating?: boolean;
  onClear?: () => void;
}

export function TrendsSnapshot({ signalsMetadata, updating, onClear }: Props) {
  if (!signalsMetadata) return null;

  const sm = signalsMetadata;
  const signalsCount = sm.signals_used?.length || 0;
  const convergenceApplied = sm.convergence_applied || false;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">Trends Context</span>
          <span className="text-[10px] text-muted-foreground">— from last generation</span>
          {updating && <span className="text-[10px] text-primary animate-pulse ml-1">updating…</span>}
        </div>
        {onClear && (
          <button onClick={onClear} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-border/30 bg-muted/20 text-xs text-muted-foreground">
        {sm.modality && (
          <Badge variant="outline" className="text-[10px]">
            modality: {sm.modality}
          </Badge>
        )}

        {sm.trends_production_type_filter && (
          <Badge variant="outline" className="text-[10px]">
            filter: {sm.trends_production_type_filter}
          </Badge>
        )}

        {signalsCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {signalsCount} signal{signalsCount !== 1 ? 's' : ''} used
          </Badge>
        )}

        <Badge variant={convergenceApplied ? 'default' : 'secondary'} className="text-[10px]">
          convergence: {convergenceApplied ? 'applied' : 'none'}
        </Badge>

        {sm.animation_meta?.primary && (
          <Badge variant="outline" className="text-[10px]">
            anim: {sm.animation_meta.primary}
            {sm.animation_meta.style ? ` / ${sm.animation_meta.style}` : ''}
            {sm.animation_meta.tags_count ? ` (${sm.animation_meta.tags_count} tags)` : ''}
          </Badge>
        )}

        {sm.context_version && (
          <span className="text-muted-foreground/50 ml-auto">{sm.context_version}</span>
        )}
      </div>
    </div>
  );
}
