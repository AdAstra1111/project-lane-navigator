/**
 * VisualCanonResetPanel — Visual Canon Reset + Rebuild workflow UI.
 *
 * Provides:
 * 1. Reset Visual Canon button (opens scoped modal)
 * 2. Required Visual Set status (filled vs empty slots)
 * 3. Auto Populate Visual Set — batch generation pipeline
 * 4. Approval queue for recommended candidates
 * 5. Batch Approve All + Download All actions
 * 6. Reuse pool management
 * 7. Archive browser
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  RotateCcw, Loader2, CheckCircle, XCircle, Archive, RefreshCw,
  AlertTriangle, ChevronRight, Star, Recycle, Eye, ShieldCheck,
  Lock, Package, Wand2, Zap, CheckCheck, Download, Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useProjectImages } from '@/hooks/useProjectImages';
import { useVisualCanonReset } from '@/hooks/useVisualCanonReset';
import { useVisualSets } from '@/hooks/useVisualSets';
import { resolveRequiredVisualSet, getDimensionsForShot, type RequiredSlot, type RequiredVisualSet } from '@/lib/images/requiredVisualSet';
import { ResetVisualCanonModal } from '@/components/images/ResetVisualCanonModal';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectImage, AssetGroup } from '@/lib/images/types';

interface VisualCanonResetPanelProps {
  projectId: string;
  /** Optional callback to trigger lookbook rebuild after full canon rebuild */
  onLookbookRebuild?: () => Promise<void>;
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

export function VisualCanonResetPanel({ projectId, onLookbookRebuild }: VisualCanonResetPanelProps) {
  const [canonJson, setCanonJson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showReusePool, setShowReusePool] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [batchApproving, setBatchApproving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [projectFormat, setProjectFormat] = useState<string>('');
  const [projectLane, setProjectLane] = useState<string>('');

  // Full Canon Rebuild state
  const [fullRebuilding, setFullRebuilding] = useState(false);
  const [rebuildStage, setRebuildStage] = useState<string | null>(null);

  // Auto-populate state
  const [populating, setPopulating] = useState(false);
  const [populateProgress, setPopulateProgress] = useState<{
    generated: number;
    total: number;
    failed: number;
    currentSlot: string | null;
    currentPhase: string | null;
    completedSlots: Array<{ key: string; status: 'generated' | 'failed'; label: string }>;
  } | null>(null);
  const [useCanonDescriptions, setUseCanonDescriptions] = useState(true);
  const [useApprovedAnchors, setUseApprovedAnchors] = useState(true);
  const abortRef = useRef(false);

  const {
    resetScopedCanon, restoreFromArchive, markForReusePool,
    approveIntoCanon, batchApproveAll, rejectCandidate, resetting, lastReset,
  } = useVisualCanonReset(projectId);

  const vs = useVisualSets(projectId);

  const { refetch: refetchImages } = useProjectImages(projectId, {
    activeOnly: false,
    curationStates: ['active', 'candidate', 'archived', 'rejected'],
    limit: 500,
  });

  // Load canon + project format
  useEffect(() => {
    (async () => {
      const [canonRes, projectRes] = await Promise.all([
        (supabase as any).from('project_canon').select('canon_json').eq('project_id', projectId).maybeSingle(),
        (supabase as any).from('projects').select('format, assigned_lane').eq('id', projectId).maybeSingle(),
      ]);
      setCanonJson(canonRes.data?.canon_json || null);
      setProjectFormat((projectRes.data?.format || '').toLowerCase());
      setProjectLane(projectRes.data?.assigned_lane || '');
      setLoading(false);
    })();
  }, [projectId]);

  /** Detect vertical drama from format or lane */
  const isVerticalDrama = projectFormat.includes('vertical') || projectLane === 'vertical_drama';

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
  const candidateImages = useMemo(() => allImages.filter(i => i.curation_state === 'candidate'), [allImages]);
  const archivedImages = useMemo(() => allImages.filter(i => i.curation_state === 'archived'), [allImages]);
  const reusePoolImages = useMemo(() => allImages.filter(i => (i as any).reuse_pool_eligible), [allImages]);
  const pendingSlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length > 0), [requiredSet]);
  const emptySlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length === 0), [requiredSet]);

  // ── Batch Approve All handler ──
  const handleBatchApprove = useCallback(async () => {
    if (candidateImages.length === 0) return;
    setBatchApproving(true);
    try {
      await batchApproveAll(candidateImages);
      refetchImages();
    } finally {
      setBatchApproving(false);
    }
  }, [candidateImages, batchApproveAll, refetchImages]);

  // ── Download All handler ──
  const handleDownloadAll = useCallback(async () => {
    const downloadImages = activeImages.filter(i => i.signedUrl || i.storage_path);
    if (downloadImages.length === 0) {
      toast.info('No active images with URLs to download');
      return;
    }

    setDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Group by asset_group into folders
      const grouped = new Map<string, ProjectImage[]>();
      for (const img of downloadImages) {
        const group = (img as any).asset_group || 'uncategorized';
        if (!grouped.has(group)) grouped.set(group, []);
        grouped.get(group)!.push(img);
      }

      let fetched = 0;
      for (const [group, images] of grouped) {
        const folder = zip.folder(group)!;
        for (const img of images) {
          const url = img.signedUrl || '';
          if (!url) continue;
          try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            const ext = blob.type.includes('png') ? 'png' : 'jpg';
            const filename = `${img.subject || img.shot_type || img.id}_${img.shot_type || 'image'}.${ext}`;
            folder.file(filename, blob);
            fetched++;
          } catch {
            console.warn(`[download] Failed to fetch image ${img.id}`);
          }
        }
      }

      if (fetched === 0) {
        toast.error('No images could be downloaded');
        return;
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `visual-canon-${projectId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${fetched} images`);
    } catch (err: any) {
      toast.error('Download failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  }, [activeImages, projectId]);

  // Phase labels
  const PHASE_LABELS: Record<number, string> = {
    1: 'Identity',
    2: 'Character References',
    3: 'World & Locations',
    4: 'Visual Language & Key Moments',
  };

  // Build slot manifest from required visual set (mirrors edge function logic)
  const buildSlotManifest = useCallback((identityOnly: boolean) => {
    const IDENTITY_PACK = ['identity_headshot', 'identity_profile', 'identity_full_body'];
    const CHAR_REF_PACK = ['close_up', 'medium', 'full_body', 'profile', 'emotional_variant'];
    const WORLD_PACK = ['wide', 'atmospheric', 'detail', 'time_variant'];
    const VIS_LANG_PACK = ['lighting_ref', 'texture_ref', 'composition_ref', 'color_ref'];
    const KEY_MOMENT_PACK = ['tableau', 'medium', 'close_up', 'wide'];

    type SlotSpec = {
      assetGroup: string; subject: string | null; shotType: string;
      isIdentity: boolean; phase: number; label: string; section: string;
    };

    const slots: SlotSpec[] = [];
    const empty = requiredSet.slots.filter(s => !s.filled && s.candidates.length === 0);

    // Phase 1: Identity
    for (const s of empty) {
      if (s.assetGroup === 'character' && s.isIdentity && s.shotType && IDENTITY_PACK.includes(s.shotType)) {
        slots.push({ assetGroup: 'character', subject: s.subject, shotType: s.shotType, isIdentity: true, phase: 1, label: s.label, section: 'character' });
      }
    }
    if (!identityOnly) {
      // Phase 2: Character refs
      for (const s of empty) {
        if (s.assetGroup === 'character' && !s.isIdentity && s.shotType && CHAR_REF_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'character', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 2, label: s.label, section: 'character' });
        }
      }
      // Phase 3: World
      for (const s of empty) {
        if (s.assetGroup === 'world' && s.shotType && WORLD_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'world', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 3, label: s.label, section: 'world' });
        }
      }
      // Phase 4: Visual Language + Key Moments
      for (const s of empty) {
        if (s.assetGroup === 'visual_language' && s.shotType && VIS_LANG_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'visual_language', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 4, label: s.label, section: 'visual_language' });
        }
      }
      for (const s of empty) {
        if (s.assetGroup === 'key_moment' && s.shotType && KEY_MOMENT_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'key_moment', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 4, label: s.label, section: 'key_moment' });
        }
      }
    }

    slots.sort((a, b) => a.phase - b.phase);
    return slots;
  }, [requiredSet]);

  // Extract character/location descriptions from canon
  const getCanonDescription = useCallback((subject: string | null, assetGroup: string) => {
    if (!subject || !canonJson) return undefined;
    if (assetGroup === 'character' && Array.isArray(canonJson.characters)) {
      const c = canonJson.characters.find((ch: any) => {
        const name = typeof ch === 'string' ? ch.trim() : (ch.name || ch.character_name || '').trim();
        return name === subject;
      });
      if (c && typeof c === 'object') return c.description || c.physical_description || undefined;
    }
    if (assetGroup === 'world' && Array.isArray(canonJson.locations)) {
      const l = canonJson.locations.find((loc: any) => {
        const name = typeof loc === 'string' ? loc.trim() : (loc.name || loc.location_name || '').trim();
        return name === subject;
      });
      if (l && typeof l === 'object') return l.description || undefined;
    }
    return undefined;
  }, [canonJson]);

  // Progressive auto-populate — slot by slot with live UI updates
  // Now also wires generated images into governed visual sets
  const handleAutoPopulate = useCallback(async (identityOnly: boolean) => {
    const slots = buildSlotManifest(identityOnly);
    if (slots.length === 0) {
      toast.info('All slots already have candidates');
      return;
    }

    abortRef.current = false;
    setPopulating(true);
    setPopulateProgress({
      generated: 0, total: slots.length, failed: 0,
      currentSlot: slots[0]?.label || null,
      currentPhase: PHASE_LABELS[slots[0]?.phase] || null,
      completedSlots: [],
    });

    let generated = 0;
    let failed = 0;
    const completedSlots: Array<{ key: string; status: 'generated' | 'failed'; label: string }> = [];

    // Track visual sets created per target for wiring
    const visualSetCache = new Map<string, string>(); // "domain:targetName" -> setId

    // Resolve DNA version for character sets
    let characterDnaVersionId: string | null = null;
    if (entities.characters.length > 0) {
      const { data: dnaRow } = await (supabase as any)
        .from('character_visual_dna')
        .select('id, character_name')
        .eq('project_id', projectId)
        .eq('is_current', true)
        .limit(10);
      if (dnaRow?.length) {
        // Store first match - for per-character DNA we'd need per-character resolution
        characterDnaVersionId = dnaRow[0]?.id || null;
      }
    }

    for (let i = 0; i < slots.length; i++) {
      if (abortRef.current) break;
      const slot = slots[i];
      const slotKey = `${slot.assetGroup}:${slot.subject || '_'}:${slot.shotType}`;

      // Update current slot indicator
      setPopulateProgress(prev => prev ? {
        ...prev,
        currentSlot: slot.label,
        currentPhase: PHASE_LABELS[slot.phase] || null,
      } : prev);

      // Build request body with enforced aspect ratio dimensions (portrait for vertical drama)
      const dims = getDimensionsForShot(slot.shotType, isVerticalDrama);
      const genBody: Record<string, any> = {
        project_id: projectId,
        section: slot.section,
        count: 1,
        asset_group: slot.assetGroup,
        pack_mode: false,
        forced_shot_type: slot.shotType,
        width: dims.width,
        height: dims.height,
        aspect_ratio: dims.aspectRatio,
      };

      if (slot.assetGroup === 'character') {
        genBody.character_name = slot.subject;
      } else if (slot.assetGroup === 'world') {
        genBody.location_name = slot.subject;
      }

      if (useCanonDescriptions && slot.subject) {
        const desc = getCanonDescription(slot.subject, slot.assetGroup);
        if (desc) {
          if (slot.assetGroup === 'character') genBody.identity_canon_facts = desc;
          if (slot.assetGroup === 'world') genBody.location_description = desc;
        }
      }

      try {
        const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
          body: genBody,
        });

        if (error) throw new Error(error.message);
        const firstResult = (data as any)?.results?.[0];
        if (firstResult?.status === 'ready' && firstResult?.image_id) {
          generated++;
          completedSlots.push({ key: slotKey, status: 'generated', label: slot.label });

          // ── Wire into governed visual set ──
          try {
            const domain = slot.assetGroup === 'character'
              ? 'character_identity'
              : slot.assetGroup === 'world'
                ? 'world_refs'
                : 'character_identity';
            const targetName = slot.subject || 'Project';
            const cacheKey = `${domain}:${targetName}`;

            let setId = visualSetCache.get(cacheKey);
            if (!setId) {
              const visualSet = await vs.ensureVisualSetForTarget({
                domain,
                targetType: slot.assetGroup === 'character' ? 'character' : slot.assetGroup === 'world' ? 'location' : 'project',
                targetName,
                dnaVersionId: slot.assetGroup === 'character' ? characterDnaVersionId : null,
              });
              setId = visualSet.id;
              visualSetCache.set(cacheKey, setId);
            }

            // Wire image into correct slot
            await vs.wireImageToSlot({
              setId,
              imageId: firstResult.image_id,
              shotType: slot.shotType,
              selectForSlot: true,
            });
          } catch (wireErr) {
            console.error(`[auto-populate] Visual set wiring failed for ${slotKey}:`, wireErr);
            // Non-fatal: image was generated, just not wired into governed set
          }
        } else {
          failed++;
          completedSlots.push({ key: slotKey, status: 'failed', label: slot.label });
        }
      } catch (err: any) {
        console.error(`[auto-populate] Slot ${slotKey} error:`, err);
        failed++;
        completedSlots.push({ key: slotKey, status: 'failed', label: slot.label });
      }

      // Progressive update — refresh images and update counts after each slot
      setPopulateProgress({
        generated, total: slots.length, failed,
        currentSlot: i < slots.length - 1 ? slots[i + 1]?.label || null : null,
        currentPhase: i < slots.length - 1 ? PHASE_LABELS[slots[i + 1]?.phase] || null : null,
        completedSlots: [...completedSlots],
      });

      // Refresh image queries so Approval Queue / Required Visual Set update live
      refetchImages();
    }

    setPopulating(false);
    vs.invalidate(); // Refresh visual sets after autopopulate

    if (generated > 0) {
      toast.success(`Generated ${generated} candidate image${generated !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);
    } else {
      toast.error(`Generation failed for all ${failed} slots`);
    }
  }, [projectId, buildSlotManifest, useCanonDescriptions, getCanonDescription, refetchImages, entities, vs, isVerticalDrama]);

  // ── Full Canon Rebuild — one-click end-to-end pipeline ──
  const REBUILD_STAGES = [
    'Resetting canon',
    'Archiving images',
    'Generating images',
    'Approving candidates',
    'Attaching to canon',
    'Building lookbook',
    'Preparing download',
    'Complete',
  ] as const;

  const handleFullCanonRebuild = useCallback(async () => {
    if (fullRebuilding) return;
    setFullRebuilding(true);

    try {
      // Stage 1: Reset canon
      setRebuildStage('Resetting canon');
      const allSections = ['character_identity', 'world_locations', 'atmosphere_lighting', 'texture_detail', 'symbolic_motifs', 'key_moments', 'poster_directions'];
      await resetScopedCanon(allSections, { archiveOnly: true, clearPrimaries: true });
      await refetchImages();

      // Stage 2: Archive confirmation
      setRebuildStage('Archiving images');
      // resetScopedCanon already archived — brief pause for DB propagation
      await new Promise(r => setTimeout(r, 500));
      await refetchImages();

      // Stage 3: Generate full visual set
      setRebuildStage('Generating images');
      await handleAutoPopulate(false);
      await refetchImages();

      // Stage 4: Approve all candidates
      setRebuildStage('Approving candidates');
      const freshImages = await refetchImages();
      const candidates = (freshImages?.data || []).filter((i: any) => i.curation_state === 'candidate');
      if (candidates.length > 0) {
        await batchApproveAll(candidates);
        await refetchImages();
      }

      // Stage 5: Attach to canon (confirm primaries)
      setRebuildStage('Attaching to canon');
      const postApproval = await refetchImages();
      const activeCount = (postApproval?.data || []).filter((i: any) => i.curation_state === 'active' && i.is_primary).length;
      toast.success(`Visual canon confirmed: ${activeCount} primary images bound`);

      // Stage 6: Build lookbook
      setRebuildStage('Building lookbook');
      if (onLookbookRebuild) {
        await onLookbookRebuild();
      }

      // Stage 7: Download
      setRebuildStage('Preparing download');
      await handleDownloadAll();

      // Done
      setRebuildStage('Complete');
      toast.success('Full Canon Rebuild complete');
    } catch (err: any) {
      console.error('[full-canon-rebuild] Error:', err);
      toast.error('Rebuild failed at stage: ' + (rebuildStage || 'unknown') + ' — ' + (err.message || 'Unknown error'));
    } finally {
      setFullRebuilding(false);
      setRebuildStage(null);
    }
  }, [fullRebuilding, resetScopedCanon, refetchImages, handleAutoPopulate, batchApproveAll, onLookbookRebuild, handleDownloadAll, rebuildStage]);

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
      {(emptySlots.length > 0 || populating) && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
                Auto Populate Visual Set
              </span>
              {!populating && emptySlots.length > 0 && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0">
                  {emptySlots.length} empty
                </Badge>
              )}
            </div>

            <p className="text-[9px] text-muted-foreground mb-3">
              Generate candidate images for all missing visual slots. Nothing is auto-approved — each image enters the Approval Queue for review.
            </p>

            {/* Controls */}
            {!populating && (
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] text-muted-foreground">Use canon descriptions</label>
                  <Switch
                    checked={useCanonDescriptions}
                    onCheckedChange={setUseCanonDescriptions}
                    className="scale-75 origin-right"
                  />
                </div>
              </div>
            )}

            {/* Live Progress */}
            {populating && populateProgress && (
              <div className="mb-3 space-y-2">
                <div className="p-2.5 rounded-md bg-muted/50 space-y-2">
                  {/* Progress bar */}
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">
                      {populateProgress.generated + populateProgress.failed}/{populateProgress.total} slots
                    </span>
                    <span className="text-foreground font-medium">
                      {Math.round(((populateProgress.generated + populateProgress.failed) / populateProgress.total) * 100)}%
                    </span>
                  </div>
                  <Progress
                    value={((populateProgress.generated + populateProgress.failed) / populateProgress.total) * 100}
                    className="h-1.5"
                  />

                  {/* Current slot */}
                  {populateProgress.currentSlot && (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[9px] text-foreground font-medium truncate">
                          {populateProgress.currentSlot}
                        </p>
                        {populateProgress.currentPhase && (
                          <p className="text-[8px] text-muted-foreground">
                            Phase: {populateProgress.currentPhase}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Live counts */}
                  <div className="flex gap-3 text-[8px]">
                    <span className="text-emerald-500">✓ {populateProgress.generated} generated</span>
                    {populateProgress.failed > 0 && (
                      <span className="text-destructive">✗ {populateProgress.failed} failed</span>
                    )}
                  </div>
                </div>

                {/* Recent completions log */}
                {populateProgress.completedSlots.length > 0 && (
                  <div className="max-h-[80px] overflow-y-auto space-y-0.5">
                    {populateProgress.completedSlots.slice(-5).reverse().map((cs, idx) => (
                      <div key={cs.key + idx} className="flex items-center gap-1.5 text-[8px]">
                        {cs.status === 'generated' ? (
                          <CheckCircle className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-2.5 w-2.5 text-destructive shrink-0" />
                        )}
                        <span className={cs.status === 'generated' ? 'text-muted-foreground' : 'text-destructive'}>
                          {cs.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Cancel button */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[9px] h-6 text-muted-foreground"
                  onClick={() => { abortRef.current = true; }}
                >
                  Cancel remaining
                </Button>
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
            {!populating && (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  className="gap-1.5 text-[10px] h-7"
                  disabled={emptySlots.length === 0}
                  onClick={() => handleAutoPopulate(false)}
                >
                  <Wand2 className="h-2.5 w-2.5" />
                  Auto Populate Visual Set
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-[10px] h-7"
                  onClick={() => handleAutoPopulate(true)}
                  title="Generate candidate cast identity images first (headshot, profile, full body) before the rest of the visual set."
                >
                  <Zap className="h-2.5 w-2.5" />
                  Generate Identity Only
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Workflow Action Bar: Reset → Generate → Approve → Lock → Export ── */}
      <Card className="border-border/40 bg-muted/10">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
              Workflow Actions
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {/* 1. Reset — destructive */}
            <Button
              size="sm"
              variant="destructive"
              className="gap-1 text-[10px] h-7"
              disabled={resetting || (activeImages.length === 0 && candidateImages.length === 0)}
              onClick={() => setShowResetModal(true)}
            >
              {resetting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
              Reset Canon
            </Button>

            {/* 2. Auto Populate — visible until canon-complete */}
            {requiredSet.filledCount < requiredSet.totalCount && !populating && (
              <Button
                size="sm"
                className="gap-1 text-[10px] h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => handleAutoPopulate(false)}
              >
                <Wand2 className="h-2.5 w-2.5" />
                {emptySlots.length > 0
                  ? `Auto Populate (${emptySlots.length} empty)`
                  : `Generate More Options`}
              </Button>
            )}

            {/* 3. Approve All — success green */}
            {candidateImages.length > 0 && (
              <Button
                size="sm"
                className="gap-1 text-[10px] h-7 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={batchApproving}
                onClick={handleBatchApprove}
              >
                {batchApproving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCheck className="h-2.5 w-2.5" />}
                Approve All ({candidateImages.length})
              </Button>
            )}

            {/* 4. Attach to Canon — secondary highlight */}
            {activeImages.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="gap-1 text-[10px] h-7 border border-primary/30 text-primary"
                onClick={() => {
                  const primaryCount = activeImages.filter(i => i.is_primary).length;
                  toast.success(`Visual canon confirmed: ${primaryCount} primary image${primaryCount !== 1 ? 's' : ''} bound as canonical selections`);
                }}
              >
                <Link2 className="h-2.5 w-2.5" />
                Attach to Canon
              </Button>
            )}

            {/* 5. Download All — neutral utility */}
            {activeImages.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-[10px] h-7"
                disabled={downloading}
                onClick={handleDownloadAll}
              >
                {downloading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />}
                Download All ({activeImages.length})
              </Button>
            )}
          </div>

          {/* Secondary toggles */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pendingSlots.length > 0 && (
              <Button
                size="sm" variant="ghost"
                className="gap-1 text-[10px] h-6 text-muted-foreground"
                onClick={() => setShowApprovalQueue(!showApprovalQueue)}
              >
                <CheckCircle className="h-2.5 w-2.5" />
                Approval Queue ({pendingSlots.length})
              </Button>
            )}

            {archivedImages.length > 0 && (
              <Button
                size="sm" variant="ghost"
                className="gap-1 text-[10px] h-6 text-muted-foreground"
                onClick={() => setShowArchive(!showArchive)}
              >
                <Archive className="h-2.5 w-2.5" />
                Archive ({archivedImages.length})
              </Button>
            )}

            {reusePoolImages.length > 0 && (
              <Button
                size="sm" variant="ghost"
                className="gap-1 text-[10px] h-6 text-muted-foreground"
                onClick={() => setShowReusePool(!showReusePool)}
              >
                <Recycle className="h-2.5 w-2.5" />
                Reuse Pool ({reusePoolImages.length})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ResetVisualCanonModal
        open={showResetModal}
        onOpenChange={setShowResetModal}
        images={allImages}
        resetting={resetting}
        onReset={resetScopedCanon}
        onRegenerateAfterReset={(sections) => {
          handleAutoPopulate(false);
        }}
      />


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
