/**
 * LookbookSectionShell — Renders a lookbook section in any state:
 * empty (with CTA + upstream sources), populated, or blocked.
 */
import { User, Globe, Sun, Layers, Sparkles, Image, ChevronRight, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import type { LookbookSection } from '@/hooks/useLookbookSections';
import { SECTION_UPSTREAM_MAP, type CanonicalSectionKey } from '@/hooks/useLookbookSections';

const ICON_MAP: Record<string, React.ElementType> = {
  User, Globe, Sun, Layers, Sparkles, Image,
};

interface LookbookSectionShellProps {
  section: LookbookSection;
  children?: React.ReactNode;
  onPopulate?: () => void;
  isPopulating?: boolean;
  blockers?: string[];
}

export function LookbookSectionShell({
  section,
  children,
  onPopulate,
  isPopulating,
  blockers,
}: LookbookSectionShellProps) {
  const [open, setOpen] = useState(section.section_status !== 'empty_but_bootstrapped');
  const upstream = SECTION_UPSTREAM_MAP[section.section_key as CanonicalSectionKey];
  const IconComp = upstream ? ICON_MAP[upstream.icon] || Globe : Globe;

  const statusBadge = () => {
    switch (section.section_status) {
      case 'fully_populated': return <Badge variant="default" className="text-[10px] bg-primary/15 text-primary border-0">Complete</Badge>;
      case 'partially_populated': return <Badge variant="secondary" className="text-[10px]">Partial</Badge>;
      case 'empty_but_bootstrapped': return <Badge variant="outline" className="text-[10px] text-muted-foreground">Empty</Badge>;
      case 'repaired': return <Badge variant="secondary" className="text-[10px]">Repaired</Badge>;
      default: return null;
    }
  };

  const isEmpty = section.section_status === 'empty_but_bootstrapped' || section.section_status === 'repaired';
  const hasBlockers = blockers && blockers.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors text-left group border border-border/50">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <IconComp className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{section.section_label}</span>
            {statusBadge()}
          </div>
          {section.pack_count > 0 && (
            <span className="text-[10px] text-muted-foreground">{section.pack_count} packs · {section.slot_count} slots</span>
          )}
        </div>
        <ChevronRight className={cn(
          'h-4 w-4 text-muted-foreground transition-transform',
          open && 'rotate-90',
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-2">
        {isEmpty && !children ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
            {/* Upstream sources */}
            {upstream && (
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Feeds from:</p>
                <ul className="space-y-1">
                  {upstream.sources.map((src, i) => (
                    <li key={i} className="text-xs text-muted-foreground/80 flex items-start gap-1.5">
                      <span className="text-primary/60 mt-0.5">•</span>
                      {src}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Blockers */}
            {hasBlockers && (
              <div className="mb-3 rounded-md bg-destructive/5 border border-destructive/20 p-2.5">
                <p className="text-xs font-medium text-destructive flex items-center gap-1 mb-1">
                  <AlertCircle className="h-3 w-3" /> Upstream blockers
                </p>
                {blockers!.map((b, i) => (
                  <p key={i} className="text-[11px] text-destructive/80 ml-4">{b}</p>
                ))}
              </div>
            )}

            {/* Populate CTA */}
            {onPopulate && !hasBlockers && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs gap-1.5"
                onClick={(e) => { e.stopPropagation(); onPopulate(); }}
                disabled={isPopulating}
              >
                {upstream?.populateCta || 'Populate Section'}
              </Button>
            )}
          </div>
        ) : (
          children
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
