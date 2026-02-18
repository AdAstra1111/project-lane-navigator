/**
 * PackageBar — approval-aware deliverable chain driven by useProjectPackage resolver.
 * Approved ✅ / Latest (Unapproved) 🟡 / Missing 🔲 per stage.
 * Single source of truth: useProjectPackage.
 */
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, FileQuestion } from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { useProjectPackage } from '@/hooks/useProjectPackage';

interface Props {
  projectId: string;
  format: string;
  onDocClick?: (docId: string, docType: string, versionId: string | null) => void;
}

type ChipStatus = 'approved' | 'latest' | 'missing';

const STATUS_CONFIG: Record<ChipStatus, {
  icon: React.ReactNode;
  chip: string;
  tooltip: string;
}> = {
  approved: {
    icon: <CheckCircle2 className="h-3 w-3 shrink-0 text-[hsl(var(--chart-2))]" />,
    chip: 'border-[hsl(var(--chart-2)/0.35)] bg-[hsl(var(--chart-2)/0.1)] text-[hsl(var(--chart-2))]',
    tooltip: 'Approved',
  },
  latest: {
    icon: <Circle className="h-3 w-3 shrink-0 text-[hsl(var(--chart-4))]" />,
    chip: 'border-[hsl(var(--chart-4)/0.35)] bg-[hsl(var(--chart-4)/0.1)] text-[hsl(var(--chart-4))]',
    tooltip: 'Latest (Unapproved)',
  },
  missing: {
    icon: <FileQuestion className="h-3 w-3 shrink-0 text-muted-foreground/40" />,
    chip: 'border-border/30 bg-muted/20 text-muted-foreground/50',
    tooltip: 'Missing',
  },
};

export function PackageBar({ projectId, format, onDocClick }: Props) {
  const { pkg, isLoading } = useProjectPackage(projectId);

  if (isLoading) {
    return (
      <div className="flex gap-1 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-5 w-16 rounded bg-muted/40" />
        ))}
      </div>
    );
  }

  if (!pkg) return null;

  const ladder = pkg.ladder;

  // Build quick lookup maps
  const deliverableMap = new Map(pkg.deliverables.map(d => [d.deliverable_type, d]));

  // For season_master_script, collapse all seasons into a single chip (or per-season chips)
  const seasonScripts = pkg.season_scripts;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1 flex-wrap">
        {ladder.map((docType, idx) => {
          // season_master_script: render one chip per season script (or one placeholder)
          if (docType === 'season_master_script') {
            if (seasonScripts.length === 0) {
              const cfg = STATUS_CONFIG.missing;
              return (
                <div key={docType} className="flex items-center">
                  {idx > 0 && <div className="w-2 h-px bg-border/30 shrink-0" />}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium cursor-default',
                          cfg.chip,
                        )}
                        disabled
                      >
                        {cfg.icon}
                        <span className="whitespace-nowrap">Master Season Script</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p className="font-medium">Master Season Script</p>
                      <p className="text-muted-foreground">{cfg.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            }

            return (
              <>
                {seasonScripts.map((ss, ssIdx) => {
                  const status: ChipStatus = ss.is_approved ? 'approved' : 'latest';
                  const cfg = STATUS_CONFIG[status];
                  const label = ss.season_number
                    ? `Master Script S${ss.season_number}`
                    : 'Master Season Script';
                  const clickable = !!ss.document_id;
                  return (
                    <div key={`sms-${ss.document_id}`} className="flex items-center">
                      {(idx > 0 || ssIdx > 0) && <div className="w-2 h-px bg-border/30 shrink-0" />}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className={cn(
                              'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium transition-all',
                              cfg.chip,
                              clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                            )}
                            disabled={!clickable}
                            onClick={() => {
                              if (clickable && onDocClick) {
                                onDocClick(ss.document_id, 'season_master_script', ss.version_id);
                              }
                            }}
                          >
                            {cfg.icon}
                            <span className="whitespace-nowrap">{label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-medium">{label}</p>
                          <p className="text-muted-foreground">{cfg.tooltip}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </>
            );
          }

          // Regular deliverable
          const deliverable = deliverableMap.get(docType);
          const status: ChipStatus = !deliverable
            ? 'missing'
            : deliverable.is_approved
            ? 'approved'
            : 'latest';
          const cfg = STATUS_CONFIG[status];
          const clickable = !!deliverable?.document_id;

          return (
            <div key={docType} className="flex items-center">
              {idx > 0 && <div className="w-2 h-px bg-border/30 shrink-0" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-medium transition-all',
                      cfg.chip,
                      clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                    )}
                    disabled={!clickable}
                    onClick={() => {
                      if (clickable && deliverable && onDocClick) {
                        onDocClick(deliverable.document_id, docType, deliverable.version_id);
                      }
                    }}
                  >
                    {cfg.icon}
                    <span className="whitespace-nowrap">
                      {deliverable?.label ?? docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">
                    {deliverable?.label ?? docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </p>
                  <p className="text-muted-foreground">{cfg.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
