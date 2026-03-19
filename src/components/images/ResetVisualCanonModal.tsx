/**
 * ResetVisualCanonModal — Scoped visual canon reset with section selection,
 * behavior options, and optional regeneration trigger.
 *
 * Replaces the old "Reset Active Canon" AlertDialog.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  RotateCcw, Loader2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  computeSectionInfo,
  type ScopedResetOptions,
  type ResetSectionInfo,
  type CanonResetResult,
} from '@/hooks/useVisualCanonReset';
import type { ProjectImage } from '@/lib/images/types';

interface ResetVisualCanonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: ProjectImage[];
  resetting: boolean;
  onReset: (options: ScopedResetOptions) => Promise<CanonResetResult | null>;
  onRegenerateAfterReset?: (sections: string[]) => void;
}

export function ResetVisualCanonModal({
  open,
  onOpenChange,
  images,
  resetting,
  onReset,
  onRegenerateAfterReset,
}: ResetVisualCanonModalProps) {
  // Section selection state
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Behavior options
  const [clearPrimary, setClearPrimary] = useState(true);
  const [targetState, setTargetState] = useState<'candidate' | 'archived'>('candidate');
  const [regenerateAfter, setRegenerateAfter] = useState(false);

  // Compute section info from images
  const sectionInfo = useMemo(() => {
    const active = images.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate');
    return computeSectionInfo(active);
  }, [images]);

  const hasAnySections = sectionInfo.length > 0;

  // Effective sections (what will be reset)
  const effectiveSections = useMemo(() => {
    if (selectAll) return sectionInfo.map(s => s.assetGroup);
    return Array.from(selectedSections);
  }, [selectAll, selectedSections, sectionInfo]);

  // Affected count
  const affectedCount = useMemo(() => {
    if (selectAll) {
      return images.filter(i => i.curation_state === 'active' || i.curation_state === 'candidate').length;
    }
    return images.filter(i =>
      (i.curation_state === 'active' || i.curation_state === 'candidate') &&
      selectedSections.has((i as any).asset_group || ''),
    ).length;
  }, [images, selectAll, selectedSections]);

  const affectedPrimaryCount = useMemo(() => {
    if (selectAll) {
      return images.filter(i => i.is_primary).length;
    }
    return images.filter(i =>
      i.is_primary && selectedSections.has((i as any).asset_group || ''),
    ).length;
  }, [images, selectAll, selectedSections]);

  const canSubmit = effectiveSections.length > 0 && !resetting;

  const handleSectionToggle = useCallback((assetGroup: string, checked: boolean) => {
    setSelectedSections(prev => {
      const next = new Set(prev);
      if (checked) next.add(assetGroup);
      else next.delete(assetGroup);
      return next;
    });
    if (selectAll) setSelectAll(false);
  }, [selectAll]);

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedSections(new Set(sectionInfo.map(s => s.assetGroup)));
    } else {
      setSelectedSections(new Set());
    }
  }, [sectionInfo]);

  const handleReset = useCallback(async () => {
    const options: ScopedResetOptions = {
      sections: selectAll ? [] : Array.from(selectedSections),
      clearPrimary,
      targetState,
      regenerateAfter,
    };

    const result = await onReset(options);

    if (result) {
      onOpenChange(false);

      // Trigger regeneration if requested
      if (regenerateAfter && onRegenerateAfterReset) {
        setTimeout(() => {
          onRegenerateAfterReset(effectiveSections);
        }, 500);
      }

      // Reset form state
      setSelectedSections(new Set());
      setSelectAll(false);
      setRegenerateAfter(false);
    }
  }, [selectAll, selectedSections, clearPrimary, targetState, regenerateAfter, onReset, onOpenChange, onRegenerateAfterReset, effectiveSections]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-destructive" />
            Reset Visual Canon
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select which sections to reset. Images are never deleted — they move to{' '}
            {targetState === 'archived' ? 'archive' : 'candidate'} state.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Section Selection ── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sections to Reset
            </Label>

            {!hasAnySections ? (
              <p className="text-xs text-muted-foreground italic">
                No active visual canon sections found.
              </p>
            ) : (
              <div className="space-y-1.5">
                {/* All Visual Canon option */}
                <label className="flex items-center gap-2.5 p-2 rounded-md border border-border/60 hover:bg-muted/30 transition-colors cursor-pointer">
                  <Checkbox
                    checked={selectAll}
                    onCheckedChange={(c) => handleSelectAll(!!c)}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground">All Visual Canon</span>
                  </div>
                  <Badge variant="secondary" className="text-[9px] shrink-0">
                    {images.filter(i => i.is_primary).length} primaries
                  </Badge>
                </label>

                {/* Individual sections */}
                {sectionInfo.map(section => (
                  <label
                    key={section.assetGroup}
                    className={cn(
                      'flex items-center gap-2.5 p-2 rounded-md border transition-colors cursor-pointer',
                      selectedSections.has(section.assetGroup) || selectAll
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/60 hover:bg-muted/30',
                    )}
                  >
                    <Checkbox
                      checked={selectAll || selectedSections.has(section.assetGroup)}
                      onCheckedChange={(c) => handleSectionToggle(section.assetGroup, !!c)}
                      disabled={selectAll}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-foreground">
                        {section.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-1.5">
                        {section.activeCount} active, {section.candidateCount} candidates
                      </span>
                    </div>
                    {section.primaryCount > 0 && (
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {section.primaryCount} {section.primaryCount === 1 ? 'primary' : 'primaries'}
                      </Badge>
                    )}
                    {section.primaryCount === 0 && (
                      <Badge variant="secondary" className="text-[9px] text-muted-foreground shrink-0">
                        0 primaries
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Reset Behavior ── */}
          <div className="space-y-2.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Reset Behavior
            </Label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={clearPrimary}
                onCheckedChange={(c) => setClearPrimary(!!c)}
              />
              <span className="text-xs text-foreground">Clear primary selections</span>
            </label>

            <RadioGroup
              value={targetState}
              onValueChange={(v) => setTargetState(v as 'candidate' | 'archived')}
              className="space-y-1"
            >
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioGroupItem value="candidate" />
                <span className="text-xs text-foreground">Move images to Candidate</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioGroupItem value="archived" />
                <span className="text-xs text-foreground">Archive images instead</span>
              </label>
            </RadioGroup>
          </div>

          {/* ── Optional Regeneration ── */}
          {onRegenerateAfterReset && (
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Optional
              </Label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <Checkbox
                  checked={regenerateAfter}
                  onCheckedChange={(c) => setRegenerateAfter(!!c)}
                />
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-foreground">Immediately regenerate images for cleared slots</span>
                </div>
              </label>
            </div>
          )}

          {/* ── Summary / Warning ── */}
          {canSubmit && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <div className="text-[10px] text-destructive/90 space-y-0.5">
                <p className="font-medium">
                  {affectedCount} image{affectedCount !== 1 ? 's' : ''} will be {targetState === 'archived' ? 'archived' : 'moved to candidates'}
                  {clearPrimary && affectedPrimaryCount > 0 && ` and ${affectedPrimaryCount} primary selection${affectedPrimaryCount !== 1 ? 's' : ''} cleared`}.
                </p>
                <p>This will remove active visual canon bindings and primary selections. This cannot be undone.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={resetting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={!canSubmit}
            onClick={handleReset}
          >
            {resetting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Reset Selected Sections
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
