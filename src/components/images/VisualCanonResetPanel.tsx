/**
 * VisualCanonResetPanel — Visual Canon Reset + Rebuild workflow UI.
 *
 * Provides:
 * 1. Reset Active Canon button
 * 2. Required Visual Set status (filled vs empty slots)
 * 3. Auto Populate Visual Set — batch generation pipeline
 * 4. Approval queue for recommended candidates
 * 5. Reuse pool management
 * 6. Archive browser
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RotateCcw, Loader2, CheckCircle, XCircle, Archive, RefreshCw,
  AlertTriangle, ChevronRight, Star, Recycle, Eye, ShieldCheck,
  Lock, Package, Wand2, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useVisualCanonReset } from '@/hooks/useVisualCanonReset';
import { resolveRequiredVisualSet, type RequiredSlot, type RequiredVisualSet } from '@/lib/images/requiredVisualSet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectImage, AssetGroup } from '@/lib/images/types';

interface VisualCanonResetPanelProps {
  projectId: string;
}

function extractEntities(canonJson: any): { characters: { name: string }[]; locations: { name: string }[] } {
  const characters: { name: string }[] = [];
  const locations: { name: string }[] = [];

  if (canonJson?.characters && Array.isArray(canonJson.characters)) {
    for (const c of canonJson.characters) {
      const name = typeof c === 'string' ? c.trim() : (c.name || c.character_name || '').trim();
      if (name && name !== 'Unknown') characters.push({ name });
    }
  }

  if (canonJson?.locations && Array.isArray(canonJson.locations)) {
    for (const l of canonJson.locations) {
      const name = typeof l === 'string' ? l.trim() : (l.name || l.location_name || '').trim();
      if (name) locations.push({ name });
    }
  }

  return { characters: characters.slice(0, 10), locations: locations.slice(0, 10) };
}

export function VisualCanonResetPanel({ projectId }: VisualCanonResetPanelProps) {
  const [canonJson, setCanonJson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showReusePool, setShowReusePool] = useState(false);

  // Auto-populate state
  const [populating, setPopulating] = useState(false);
  const [populateProgress, setPopulateProgress] = useState<{ generated: number; total: number; failed: number } | null>(null);
  const [useCanonDescriptions, setUseCanonDescriptions] = useState(true);
  const [useApprovedAnchors, setUseApprovedAnchors] = useState(true);

  const {
    resetActiveCanon, restoreFromArchive, markForReusePool,
    approveIntoCanon, rejectCandidate, resetting, lastReset,
  } = useVisualCanonReset(projectId);

  const { refetch: refetchImages } = useProjectImages(projectId, {
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived', 'rejected'],
    limit: 500,
  });

  // Load canon
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('project_canon')
        .select('canon_json')
        .eq('project_id', projectId)
        .maybeSingle();
      setCanonJson(data?.canon_json || null);
      setLoading(false);
    })();
  }, [projectId]);

  // Fetch ALL project images (including archived/rejected) for the resolver
  const { data: allImages = [], isLoading: imagesLoading } = useProjectImages(projectId, {
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived', 'rejected'],
    limit: 500,
  });

  const entities = useMemo(() => extractEntities(canonJson), [canonJson]);
  const requiredSet = useMemo(
    () => resolveRequiredVisualSet(entities.characters, entities.locations, allImages),
    [entities, allImages],
  );

  const activeImages = useMemo(() => allImages.filter(i => i.curation_state === 'active'), [allImages]);
  const archivedImages = useMemo(() => allImages.filter(i => i.curation_state === 'archived'), [allImages]);
  const reusePoolImages = useMemo(() => allImages.filter(i => (i as any).reuse_pool_eligible), [allImages]);
  const pendingSlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length > 0), [requiredSet]);
  const emptySlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length === 0), [requiredSet]);

  // Auto-populate handler
  const handleAutoPopulate = useCallback(async (identityOnly: boolean) => {
    setPopulating(true);
    setPopulateProgress(null);
    toast.info(identityOnly ? 'Generating identity images…' : 'Auto-populating visual set…', { duration: 3000 });

    try {
      const { data, error } = await supabase.functions.invoke('auto-populate-visual-set', {
        body: {
          project_id: projectId,
          identity_only: identityOnly,
          use_canon_descriptions: useCanonDescriptions,
          use_approved_anchors: useApprovedAnchors,
        },
      });

      if (error) throw new Error(error.message || 'Generation failed');

      const result = data as any;
      setPopulateProgress({
        generated: result.generated || 0,
        total: result.total_slots || 0,
        failed: result.failed || 0,
      });

      if (result.generated > 0) {
        toast.success(`Generated ${result.generated} candidate image${result.generated !== 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} failed)` : ''}`);
        // Refresh images
        refetchImages();
      } else if (result.status === 'complete') {
        toast.info('All slots already have candidates');
      } else {
        toast.error(`Generation failed: ${result.failed} slot${result.failed !== 1 ? 's' : ''} had errors`);
      }
    } catch (err: any) {
      console.error('[auto-populate] error:', err);
      toast.error(`Auto-populate failed: ${err.message || 'Unknown error'}`);
    } finally {
      setPopulating(false);
    }
  }, [projectId, useCanonDescriptions, useApprovedAnchors, refetchImages]);

  if (loading || imagesLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Loading visual canon status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Status Overview ── */}
      <Card className="border-border/60 bg-muted/20">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
              Visual Canon Status
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active Canon:</span>
              <span className="font-medium text-foreground">{activeImages.length} images</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Archived:</span>
              <span className="font-medium text-muted-foreground">{archivedImages.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slots Filled:</span>
              <span className={cn('font-medium', requiredSet.completionPercent >= 80 ? 'text-emerald-600' : requiredSet.completionPercent >= 40 ? 'text-amber-600' : 'text-destructive')}>
                {requiredSet.filledCount}/{requiredSet.totalCount} ({requiredSet.completionPercent}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reuse Pool:</span>
              <span className="font-medium text-muted-foreground">{reusePoolImages.length}</span>
            </div>
          </div>

          {/* Completion bar */}
          {requiredSet.totalCount > 0 && (
            <Progress
              value={requiredSet.completionPercent}
              className="h-1.5 mb-2"
            />
          )}

          {pendingSlots.length > 0 && (
            <p className="text-[9px] text-amber-600 mb-1">
              ⚠ {pendingSlots.length} slot{pendingSlots.length !== 1 ? 's' : ''} have candidates awaiting approval
            </p>
          )}
          {emptySlots.length > 0 && (
            <p className="text-[9px] text-muted-foreground">
              {emptySlots.length} slot{emptySlots.length !== 1 ? 's' : ''} need images generated
            </p>
          )}

          {lastReset && (
            <p className="text-[8px] text-muted-foreground/60 mt-1">
              Last reset: {new Date(lastReset.timestamp).toLocaleString()} ({lastReset.archivedCount} archived)
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Auto Populate Visual Set ── */}
      {emptySlots.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
                Auto Populate Visual Set
              </span>
              <Badge variant="secondary" className="text-[8px] px-1 py-0">
                {emptySlots.length} empty
              </Badge>
            </div>

            <p className="text-[9px] text-muted-foreground mb-3">
              Generate candidate images for all missing visual slots. Nothing is auto-approved — each image enters the Approval Queue for review.
            </p>

            {/* Controls */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between">
                <label className="text-[9px] text-muted-foreground">Use canon descriptions</label>
                <Switch
                  checked={useCanonDescriptions}
                  onCheckedChange={setUseCanonDescriptions}
                  disabled={populating}
                  className="scale-75 origin-right"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[9px] text-muted-foreground">Use approved images as anchors</label>
                <Switch
                  checked={useApprovedAnchors}
                  onCheckedChange={setUseApprovedAnchors}
                  disabled={populating}
                  className="scale-75 origin-right"
                />
              </div>
            </div>

            {/* Progress */}
            {populating && (
              <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-muted/50">
                <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                <span className="text-[9px] text-muted-foreground">
                  Generating images across {emptySlots.length} slots… This may take a few minutes.
                </span>
              </div>
            )}

            {/* Completion summary */}
            {populateProgress && !populating && (
              <div className="mb-3 p-2 rounded-md bg-muted/30 text-[9px]">
                <span className="text-foreground font-medium">
                  Generated {populateProgress.generated}/{populateProgress.total} slots
                </span>
                {populateProgress.failed > 0 && (
                  <span className="text-destructive ml-1">
                    ({populateProgress.failed} failed)
                  </span>
                )}
              </div>
            )}

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                className="gap-1.5 text-[10px] h-7"
                disabled={populating || emptySlots.length === 0}
                onClick={() => handleAutoPopulate(false)}
              >
                {populating ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Wand2 className="h-2.5 w-2.5" />
                )}
                Auto Populate Visual Set
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-[10px] h-7"
                disabled={populating}
                onClick={() => handleAutoPopulate(true)}
                title="Generate candidate cast identity images first (headshot, profile, full body) before the rest of the visual set."
              >
                <Zap className="h-2.5 w-2.5" />
                Generate Identity Only
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Action Buttons ── */}
      <div className="flex flex-wrap gap-1.5">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" className="gap-1 text-[10px] h-7" disabled={resetting || activeImages.length === 0}>
              {resetting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
              Reset Active Canon
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Active Visual Canon?</AlertDialogTitle>
              <AlertDialogDescription>
                This will archive all {activeImages.length} active images and clear all primary selections.
                <br /><br />
                <strong>No images will be deleted.</strong> All images remain accessible in the archive
                and can be restored or marked for future reuse.
                <br /><br />
                After reset, the system will show required slots for you to populate with fresh imagery.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => resetActiveCanon()}>
                Reset & Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {pendingSlots.length > 0 && (
          <Button
            size="sm" variant="outline"
            className="gap-1 text-[10px] h-7"
            onClick={() => setShowApprovalQueue(!showApprovalQueue)}
          >
            <CheckCircle className="h-2.5 w-2.5" />
            Approval Queue ({pendingSlots.length})
          </Button>
        )}

        {archivedImages.length > 0 && (
          <Button
            size="sm" variant="ghost"
            className="gap-1 text-[10px] h-7"
            onClick={() => setShowArchive(!showArchive)}
          >
            <Archive className="h-2.5 w-2.5" />
            Archive ({archivedImages.length})
          </Button>
        )}

        {reusePoolImages.length > 0 && (
          <Button
            size="sm" variant="ghost"
            className="gap-1 text-[10px] h-7"
            onClick={() => setShowReusePool(!showReusePool)}
          >
            <Recycle className="h-2.5 w-2.5" />
            Reuse Pool ({reusePoolImages.length})
          </Button>
        )}
      </div>

      {/* ── Approval Queue ── */}
      {showApprovalQueue && pendingSlots.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
                Approval Queue
              </span>
            </div>
            <div className="space-y-2">
              {pendingSlots.map(slot => (
                <ApprovalSlotRow
                  key={slot.key}
                  slot={slot}
                  onApprove={approveIntoCanon}
                  onReject={rejectCandidate}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Required Slots Status ── */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors text-left group">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium text-foreground">Required Visual Set</span>
          <Badge variant="secondary" className="text-[8px] px-1 py-0">
            {requiredSet.filledCount}/{requiredSet.totalCount}
          </Badge>
          <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto group-data-[state=open]:rotate-90 transition-transform" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-2 pb-2">
          <RequiredSlotsList slots={requiredSet.slots} />
        </CollapsibleContent>
      </Collapsible>

      {/* ── Archive Browser ── */}
      {showArchive && (
        <Card className="border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
                Archived Images
              </span>
              <Badge variant="secondary" className="text-[8px] px-1 py-0">{archivedImages.length}</Badge>
            </div>
            <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
              {archivedImages.slice(0, 24).map(img => (
                <ArchiveImageCard
                  key={img.id}
                  image={img}
                  onRestore={() => restoreFromArchive(img.id)}
                  onMarkReuse={() => markForReusePool(img.id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Reuse Pool Browser ── */}
      {showReusePool && (
        <Card className="border-border/60">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Recycle className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
                Reuse / Casting Pool
              </span>
              <Badge variant="secondary" className="text-[8px] px-1 py-0">{reusePoolImages.length}</Badge>
            </div>
            <p className="text-[8px] text-muted-foreground mb-2">
              Strong images not selected for current project — available for future casting/reuse.
            </p>
            <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
              {reusePoolImages.slice(0, 24).map(img => (
                <div key={img.id} className="relative rounded-md overflow-hidden aspect-square bg-muted border border-border/50">
                  {img.signedUrl ? (
                    <img src={img.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Recycle className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                    <p className="text-[7px] text-white/80 truncate">{img.subject || img.shot_type || 'image'}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-Components ──

function ApprovalSlotRow({
  slot,
  onApprove,
  onReject,
}: {
  slot: RequiredSlot;
  onApprove: (img: ProjectImage) => void;
  onReject: (id: string, markReuse: boolean) => void;
}) {
  const recommended = slot.recommended;
  if (!recommended) return null;

  return (
    <div className="flex items-center gap-2 p-1.5 rounded-md bg-muted/30 border border-border/40">
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded overflow-hidden bg-muted shrink-0">
        {recommended.signedUrl ? (
          <img src={recommended.signedUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Eye className="h-3 w-3 text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-medium text-foreground truncate">{slot.label}</p>
        <p className="text-[8px] text-muted-foreground">
          {slot.candidates.length} candidate{slot.candidates.length !== 1 ? 's' : ''}
          {slot.isIdentity && ' • identity'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="p-1 rounded bg-emerald-500/80 text-white hover:bg-emerald-600 transition-colors"
          onClick={() => onApprove(recommended)}
          title="Approve into active canon"
        >
          <CheckCircle className="h-3 w-3" />
        </button>
        <button
          className="p-1 rounded bg-destructive/80 text-white hover:bg-destructive transition-colors"
          onClick={() => onReject(recommended.id, false)}
          title="Reject"
        >
          <XCircle className="h-3 w-3" />
        </button>
        <button
          className="p-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          onClick={() => onReject(recommended.id, true)}
          title="Reject but save to reuse pool"
        >
          <Recycle className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function RequiredSlotsList({ slots }: { slots: RequiredSlot[] }) {
  // Group by asset group
  const grouped = useMemo(() => {
    const groups: Record<string, RequiredSlot[]> = {};
    for (const slot of slots) {
      const key = slot.assetGroup;
      if (!groups[key]) groups[key] = [];
      groups[key].push(slot);
    }
    return groups;
  }, [slots]);

  const groupLabels: Record<string, string> = {
    character: 'Characters',
    world: 'World / Locations',
    visual_language: 'Visual Language',
    key_moment: 'Key Moments',
  };

  return (
    <div className="space-y-2 mt-1">
      {Object.entries(grouped).map(([group, groupSlots]) => {
        const filled = groupSlots.filter(s => s.filled).length;
        return (
          <div key={group}>
            <p className="text-[8px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
              {groupLabels[group] || group} ({filled}/{groupSlots.length})
            </p>
            <div className="space-y-0.5">
              {groupSlots.map(slot => (
                <div key={slot.key} className="flex items-center gap-1.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/20">
                  {slot.filled ? (
                    <CheckCircle className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                  ) : slot.candidates.length > 0 ? (
                    <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                  )}
                  <span className={cn(
                    'truncate',
                    slot.filled ? 'text-foreground' : 'text-muted-foreground',
                  )}>
                    {slot.label}
                  </span>
                  {slot.isIdentity && (
                    <Lock className="h-2 w-2 text-primary/60 shrink-0" />
                  )}
                  {!slot.filled && slot.candidates.length > 0 && (
                    <Badge variant="secondary" className="text-[7px] px-1 py-0 ml-auto shrink-0">
                      {slot.candidates.length} candidates
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArchiveImageCard({
  image,
  onRestore,
  onMarkReuse,
}: {
  image: ProjectImage;
  onRestore: () => void;
  onMarkReuse: () => void;
}) {
  return (
    <div className="group relative rounded-md overflow-hidden aspect-square bg-muted border border-border/30 opacity-70 hover:opacity-100 transition-opacity">
      {image.signedUrl ? (
        <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Archive className="h-4 w-4 text-muted-foreground/30" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors">
        <div className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="flex-1 text-[7px] py-0.5 rounded bg-muted/90 text-foreground hover:bg-muted"
            onClick={onRestore}
          >
            Restore
          </button>
          <button
            className="flex-1 text-[7px] py-0.5 rounded bg-primary/80 text-primary-foreground hover:bg-primary"
            onClick={onMarkReuse}
          >
            Reuse
          </button>
        </div>
      </div>
    </div>
  );
}
