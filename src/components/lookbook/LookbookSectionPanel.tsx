/**
 * LookbookSectionPanel — Renders a canonical lookbook section with
 * image content, curation filters, populate CTA, and blockers.
 * Driven entirely by canonical section keys.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ImageSelectorGrid } from '@/components/images/ImageSelectorGrid';
import { useLookbookSectionContent } from '@/hooks/useLookbookSectionContent';
import type { LookbookSection, CanonicalSectionKey } from '@/hooks/useLookbookSections';
import { SECTION_UPSTREAM_MAP } from '@/hooks/useLookbookSections';
import { User, Globe, Sun, Layers, Sparkles, Image as ImageIcon, AlertCircle } from 'lucide-react';
import type { CurationState } from '@/lib/images/types';

const ICON_MAP: Record<string, React.ElementType> = {
  User, Globe, Sun, Layers, Sparkles, Image: ImageIcon,
};

type CurationFilter = CurationState | 'all';

interface LookbookSectionPanelProps {
  projectId: string;
  section: LookbookSection;
  onPopulate?: (sectionKey: CanonicalSectionKey) => void;
  isPopulating?: boolean;
}

export function LookbookSectionPanel({
  projectId,
  section,
  onPopulate,
  isPopulating,
}: LookbookSectionPanelProps) {
  const sectionKey = section.section_key as CanonicalSectionKey;
  const upstream = SECTION_UPSTREAM_MAP[sectionKey];
  const IconComp = upstream ? ICON_MAP[upstream.icon] || Globe : Globe;

  const [filter, setFilter] = useState<CurationFilter>('all');
  const { images, total, isLoading, blockers } = useLookbookSectionContent(
    projectId,
    sectionKey,
    { curationFilter: filter === 'all' ? 'all' : filter, pageSize: 12 },
  );

  const hasImages = images.length > 0;
  const isEmpty = section.section_status === 'empty_but_bootstrapped' || section.section_status === 'repaired';
  const [open, setOpen] = useState(hasImages || !isEmpty);

  const activeCount = images.filter(i => i.curation_state === 'active').length;
  const candidateCount = images.filter(i => i.curation_state === 'candidate').length;
  const archivedCount = images.filter(i => i.curation_state === 'archived').length;
  const hasBlockers = blockers.length > 0 && !hasImages;

  const statusBadge = () => {
    if (hasImages && activeCount > 0) return <Badge variant="default" className="text-[10px] bg-primary/15 text-primary border-0">{activeCount} active</Badge>;
    if (hasImages) return <Badge variant="secondary" className="text-[10px]">{total} images</Badge>;
    if (isEmpty) return <Badge variant="outline" className="text-[10px] text-muted-foreground">Empty</Badge>;
    return null;
  };

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
          {upstream && !hasImages && (
            <span className="text-[10px] text-muted-foreground">{upstream.sources[0]}</span>
          )}
          {hasImages && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {candidateCount > 0 && <span className="text-[10px] text-muted-foreground">{candidateCount} candidates</span>}
              {archivedCount > 0 && <span className="text-[10px] text-muted-foreground/50">{archivedCount} archived</span>}
            </div>
          )}
        </div>
        <ChevronRight className={cn(
          'h-4 w-4 text-muted-foreground transition-transform',
          open && 'rotate-90',
        )} />
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3 pt-2">
        {/* Empty state with upstream info + blockers + populate CTA */}
        {!hasImages && !isLoading ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
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

            {hasBlockers && (
              <div className="mb-3 rounded-md bg-destructive/5 border border-destructive/20 p-2.5">
                <p className="text-xs font-medium text-destructive flex items-center gap-1 mb-1">
                  <AlertCircle className="h-3 w-3" /> Upstream blockers
                </p>
                {blockers.map((b, i) => (
                  <p key={i} className="text-[11px] text-destructive/80 ml-4">{b.message}</p>
                ))}
              </div>
            )}

            {onPopulate && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs gap-1.5"
                onClick={(e) => { e.stopPropagation(); onPopulate(sectionKey); }}
                disabled={isPopulating}
              >
                {upstream?.populateCta || 'Populate Section'}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Curation filters */}
            {hasImages && (
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                {(['all', 'active', 'candidate', 'archived'] as CurationFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize',
                      filter === f ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f}
                    {f === 'active' && activeCount > 0 && ` (${activeCount})`}
                    {f === 'candidate' && candidateCount > 0 && ` (${candidateCount})`}
                    {f === 'archived' && archivedCount > 0 && ` (${archivedCount})`}
                  </button>
                ))}
              </div>
            )}

            <ImageSelectorGrid
              projectId={projectId}
              images={images}
              isLoading={isLoading}
              emptyLabel={`No ${section.section_label.toLowerCase()} images yet`}
              showShotTypes
              showCurationControls
              enableCompare
              showProvenance
            />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
