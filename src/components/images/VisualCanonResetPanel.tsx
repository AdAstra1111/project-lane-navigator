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
import { resolveIdentityAnchorsFromImages, shouldPrioritizeIdentityGeneration, type IdentityAnchorMap } from '@/lib/images/characterIdentityAnchorSet';
import { useVisualSimilarityCache } from '@/hooks/useVisualSimilarityCache';
import { useProcessBridge } from '@/hooks/useProcessBridge';
import {
  RotateCcw, Loader2, CheckCircle, XCircle, Archive, RefreshCw,
  AlertTriangle, ChevronRight, Star, Recycle, Eye, ShieldCheck,
  Lock, Unlock, Package, Wand2, Zap, CheckCheck, Download, Link2, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDisplayAspectClass } from '@/lib/images/orientationUtils';
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
import { ApprovalWorkspace } from './ApprovalWorkspace';
import {
  type RebuildMode, type RebuildResult,
} from '@/lib/images/canonRebuildScoring';
import {
  executeCanonRebuild,
  extractEntities,
} from '@/lib/images/canonRebuildExecutor';
import { ResetVisualCanonModal } from '@/components/images/ResetVisualCanonModal';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectImage, AssetGroup } from '@/lib/images/types';
interface VisualCanonResetPanelProps {
  projectId: string;
  /** Optional callback to trigger lookbook rebuild after full canon rebuild */
  onLookbookRebuild?: () => Promise<void>;
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
  const [rebuildMode, setRebuildMode] = useState<RebuildMode>('RESET_FULL_CANON_REBUILD');
  const [lastRebuildResult, setLastRebuildResult] = useState<RebuildResult | null>(null);

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

  const populateBridge = useProcessBridge({
    keyPrefix: 'autopopulate',
    type: 'Image Generation',
    projectId,
    href: `/projects/${projectId}/visual-dev`,
  });

  const rebuildBridge = useProcessBridge({
    keyPrefix: 'canon-rebuild',
    type: 'Visual Canon Rebuild',
    projectId,
    href: `/projects/${projectId}/visual-dev`,
  });

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
    () => resolveRequiredVisualSet(entities.characters, entities.locations, allImages, isVerticalDrama),
    [entities, allImages, isVerticalDrama],
  );

  const activeImages = useMemo(() => allImages.filter(i => i.curation_state === 'active'), [allImages]);
  const candidateImages = useMemo(() => allImages.filter(i => i.curation_state === 'candidate'), [allImages]);
  const archivedImages = useMemo(() => allImages.filter(i => i.curation_state === 'archived'), [allImages]);
  const reusePoolImages = useMemo(() => allImages.filter(i => (i as any).reuse_pool_eligible), [allImages]);
  const pendingSlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length > 0), [requiredSet]);
  const emptySlots = useMemo(() => requiredSet.slots.filter(s => !s.filled && s.candidates.length === 0), [requiredSet]);

  // Resolve identity anchor map from loaded images — used for generation + approval display
  const identityAnchorMap: IdentityAnchorMap = useMemo(
    () => resolveIdentityAnchorsFromImages(allImages),
    [allImages],
  );

  // Batch-load cached visual similarity results for all candidates
  const { similarities: cachedSimilarities } = useVisualSimilarityCache(
    projectId, candidateImages, identityAnchorMap,
  );

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
  // targetSlotKeys: if provided, only generate for these specific slot keys (preserve-mode scoping)
  const buildSlotManifest = useCallback((identityOnly: boolean, targetSlotKeys?: Set<string>) => {
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

    // When targetSlotKeys is provided (preserve mode), include ALL matching slots
    // regardless of fill state — they were classified as weak/missing by the rebuild engine
    const candidateSlots = targetSlotKeys
      ? requiredSet.slots.filter(s => targetSlotKeys.has(s.key))
      : requiredSet.slots.filter(s => !s.filled && s.candidates.length === 0);

    // Phase 1: Identity
    for (const s of candidateSlots) {
      if (s.assetGroup === 'character' && s.isIdentity && s.shotType && IDENTITY_PACK.includes(s.shotType)) {
        slots.push({ assetGroup: 'character', subject: s.subject, shotType: s.shotType, isIdentity: true, phase: 1, label: s.label, section: 'character' });
      }
    }
    if (!identityOnly) {
      // Phase 2: Character refs — only for characters with at least partial identity lock
      for (const s of candidateSlots) {
        if (s.assetGroup === 'character' && !s.isIdentity && s.shotType && CHAR_REF_PACK.includes(s.shotType)) {
          const charName = s.subject || '';
          const priority = shouldPrioritizeIdentityGeneration(charName, identityAnchorMap);
          if (priority.prioritize) {
            console.log(`[buildSlotManifest] Deferring ref slot ${s.shotType} for ${charName}: ${priority.reason}`);
            continue; // Skip — identity anchors incomplete
          }
          slots.push({ assetGroup: 'character', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 2, label: s.label, section: 'character' });
        }
      }
      // Phase 3: World
      for (const s of candidateSlots) {
        if (s.assetGroup === 'world' && s.shotType && WORLD_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'world', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 3, label: s.label, section: 'world' });
        }
      }
      // Phase 4: Visual Language + Key Moments
      for (const s of candidateSlots) {
        if (s.assetGroup === 'visual_language' && s.shotType && VIS_LANG_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'visual_language', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 4, label: s.label, section: 'visual_language' });
        }
      }
      for (const s of candidateSlots) {
        if (s.assetGroup === 'key_moment' && s.shotType && KEY_MOMENT_PACK.includes(s.shotType)) {
          slots.push({ assetGroup: 'key_moment', subject: s.subject, shotType: s.shotType, isIdentity: false, phase: 4, label: s.label, section: 'key_moment' });
        }
      }
    }

    slots.sort((a, b) => a.phase - b.phase);
    return slots;
  }, [requiredSet, identityAnchorMap]);

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
  // targetSlotKeys: if provided, only generate for these specific slot keys (preserve-mode scoping)
  const handleAutoPopulate = useCallback(async (identityOnly: boolean, targetSlotKeys?: Set<string>) => {
    const slots = buildSlotManifest(identityOnly, targetSlotKeys);
    if (slots.length === 0) {
      if (!targetSlotKeys) toast.info('All slots already have candidates');
      return;
    }

    abortRef.current = false;
    setPopulating(true);
    populateBridge.register({
      total: slots.length,
      processed: 0,
      percent: 0,
      stageDescription: `Generating candidate images for ${slots.length} slots…`,
    });
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
        // ── Identity anchor injection for character generation ──
        if (!slot.isIdentity && slot.subject && identityAnchorMap[slot.subject]) {
          const anchors = identityAnchorMap[slot.subject];
          if (anchors.anchorPaths.headshot || anchors.anchorPaths.fullBody) {
            genBody.identity_anchor_paths = anchors.anchorPaths;
            console.log(`[auto-populate] Injecting identity anchors for ${slot.subject}: completeness=${anchors.completeness}`);
          }
        }
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
      const pct = Math.round(((i + 1) / slots.length) * 100);
      setPopulateProgress({
        generated, total: slots.length, failed,
        currentSlot: i < slots.length - 1 ? slots[i + 1]?.label || null : null,
        currentPhase: i < slots.length - 1 ? PHASE_LABELS[slots[i + 1]?.phase] || null : null,
        completedSlots: [...completedSlots],
      });
      populateBridge.update({
        processed: i + 1,
        percent: pct,
        stageDescription: i < slots.length - 1
          ? `Generating: ${slots[i + 1]?.label || 'next slot'}…`
          : 'Finalizing…',
      });

      // Refresh image queries so Approval Queue / Required Visual Set update live
      refetchImages();
    }

    setPopulating(false);
    vs.invalidate(); // Refresh visual sets after autopopulate

    if (generated > 0) {
      populateBridge.complete();
      toast.success(`Generated ${generated} candidate image${generated !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);
    } else {
      populateBridge.fail(`Generation failed for all ${failed} slots`);
      toast.error(`Generation failed for all ${failed} slots`);
    }
  }, [projectId, buildSlotManifest, useCanonDescriptions, getCanonDescription, refetchImages, entities, vs, isVerticalDrama, populateBridge]);

  // ── Full Canon Rebuild — score-based end-to-end pipeline ──
  const REBUILD_STAGES_RESET = [
    'Resetting canon',
    'Archiving images',
    'Generating images',
    'Scoring candidates',
    'Selecting winners',
    'Attaching winners',
    'Building lookbook',
    'Preparing download',
    'Complete',
  ] as const;

  const REBUILD_STAGES_PRESERVE = [
    'Analysing incumbents',
    'Generating missing slots',
    'Scoring candidates',
    'Evaluating replacements',
    'Attaching winners',
    'Building lookbook',
    'Preparing download',
    'Complete',
  ] as const;

  const currentStages = rebuildMode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD'
    ? REBUILD_STAGES_PRESERVE
    : REBUILD_STAGES_RESET;

  const handleFullCanonRebuild = useCallback(async () => {
    if (fullRebuilding) return;
    setFullRebuilding(true);
    setLastRebuildResult(null);
    rebuildBridge.register({
      stages: [...currentStages],
      stageDescription: 'Starting visual canon rebuild…',
    });

    const mode = rebuildMode;
    const isPreserve = mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';

    const result = await executeCanonRebuild({
      projectId,
      mode,
      triggerSource: 'manual_ui',
      canonJson,
      projectFormat,
      projectLane,
      isVerticalDrama,
      onStageChange: (stage) => {
        setRebuildStage(stage);
        const idx = [...currentStages].findIndex(s => s.toLowerCase().includes((stage || '').toLowerCase().split(' ')[0]));
        rebuildBridge.update({
          currentStageIndex: idx >= 0 ? idx : undefined,
          stageDescription: stage || undefined,
        });
      },
      generateSlotImages: (targetKeys) => handleAutoPopulate(false, targetKeys),
      resetCanon: async () => {
        await resetScopedCanon({
          sections: [],
          clearPrimary: true,
          targetState: 'archived',
          regenerateAfter: false,
        });
      },
      refetchImages: async () => {
        const r = await refetchImages();
        return { data: (r?.data || []) as ProjectImage[] };
      },
      onLookbookRebuild,
      downloadWinners: (ids) => downloadWinnersOnly(ids),
    });

    setLastRebuildResult(result.rebuildResult);

    // ── Honest completion messaging ──
    if (result.executionStatus === 'failed') {
      rebuildBridge.fail(result.failureMessage || 'Unknown error');
      toast.error(`Rebuild failed: ${result.failureMessage || 'Unknown error'}`);
    } else if (result.executionStatus === 'no_op') {
      rebuildBridge.complete();
      toast.info('No weak slots detected — no generation performed');
    } else {
      const { resolvedSlots, unresolvedSlots, attachedWinnerCount, preservedPrimaryCount, replacedPrimaryCount, totalSlots } = result.rebuildResult;
      const modeLabel = isPreserve ? 'Preserve rebuild' : 'Reset rebuild';

      if (unresolvedSlots > 0) {
        toast.warning(
          `${modeLabel}: ${unresolvedSlots} unresolved slot${unresolvedSlots !== 1 ? 's' : ''} — ` +
          `${attachedWinnerCount} of ${totalSlots} attached` +
          (isPreserve ? ` (${preservedPrimaryCount} preserved, ${replacedPrimaryCount} replaced)` : '') +
          (isVerticalDrama ? ' — strict 9:16 enforced' : ''),
        );
      } else {
        toast.success(
          `${modeLabel}: ${attachedWinnerCount} winner${attachedWinnerCount !== 1 ? 's' : ''} from ${totalSlots} slots` +
          (isPreserve ? ` (${preservedPrimaryCount} preserved, ${replacedPrimaryCount} replaced)` : '') +
          (isVerticalDrama ? ' — strict vertical compliance verified' : ''),
        );
      }
      rebuildBridge.complete();
    }
    console.log('[rebuild-ui] Execution result:', {
      status: result.executionStatus,
      durationMs: result.durationMs,
      triggerSource: result.triggerSource,
      targetedSlotKeys: result.targetedSlotKeys,
    });

    setFullRebuilding(false);
    setRebuildStage(null);
  }, [fullRebuilding, rebuildMode, resetScopedCanon, refetchImages, handleAutoPopulate, onLookbookRebuild, canonJson, projectId, isVerticalDrama, projectFormat, projectLane, rebuildBridge, currentStages]);

  // ── Download winners only (not all active images) ──
  const downloadWinnersOnly = useCallback(async (winnerIds: Set<string>) => {
    if (winnerIds.size === 0) {
      toast.info('No winners to download');
      return;
    }

    setDownloading(true);
    try {
      // Fetch fresh signed URLs for winner images
      const { data: winnerImages } = await (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId)
        .in('id', Array.from(winnerIds));

      if (!winnerImages || winnerImages.length === 0) {
        toast.info('No winner images found');
        return;
      }

      // Get signed URLs
      const imagesWithUrls: Array<{ id: string; storage_path: string; asset_group: string; subject: string; shot_type: string; url: string }> = [];
      for (const img of winnerImages) {
        if (img.storage_path) {
          const { data: signedData } = await supabase.storage
            .from('project-images')
            .createSignedUrl(img.storage_path, 300);
          if (signedData?.signedUrl) {
            imagesWithUrls.push({
              id: img.id,
              storage_path: img.storage_path,
              asset_group: img.asset_group || 'uncategorized',
              subject: img.subject || '',
              shot_type: img.shot_type || 'image',
              url: signedData.signedUrl,
            });
          }
        }
      }

      if (imagesWithUrls.length === 0) {
        toast.info('No downloadable URLs for winners');
        return;
      }

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Group by asset_group
      const grouped = new Map<string, typeof imagesWithUrls>();
      for (const img of imagesWithUrls) {
        if (!grouped.has(img.asset_group)) grouped.set(img.asset_group, []);
        grouped.get(img.asset_group)!.push(img);
      }

      let fetched = 0;
      for (const [group, images] of grouped) {
        const folder = zip.folder(group)!;
        for (const img of images) {
          try {
            const resp = await fetch(img.url);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            const ext = blob.type.includes('png') ? 'png' : 'jpg';
            const filename = `${img.subject || 'image'}_${img.shot_type}.${ext}`;
            folder.file(filename, blob);
            fetched++;
          } catch {
            console.warn(`[download-winners] Failed to fetch image ${img.id}`);
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
      a.download = `canon-winners-${projectId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${fetched} winner images`);
    } catch (err: any) {
      toast.error('Download failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  }, [projectId]);

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

      {/* ── Full Canon Rebuild ── */}
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <RefreshCw className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
              Full Canon Rebuild
            </span>
            {isVerticalDrama && (
              <Badge variant="secondary" className="text-[8px] px-1 py-0">Portrait 9:16</Badge>
            )}
          </div>

          {/* Mode selector */}
          <div className="flex gap-1 mb-2">
            <Button
              size="sm"
              variant={rebuildMode === 'RESET_FULL_CANON_REBUILD' ? 'default' : 'outline'}
              className="text-[9px] h-6 px-2"
              disabled={fullRebuilding}
              onClick={() => setRebuildMode('RESET_FULL_CANON_REBUILD')}
            >
              Reset &amp; Rebuild
            </Button>
            <Button
              size="sm"
              variant={rebuildMode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD' ? 'default' : 'outline'}
              className="text-[9px] h-6 px-2"
              disabled={fullRebuilding}
              onClick={() => setRebuildMode('PRESERVE_PRIMARIES_FULL_CANON_REBUILD')}
            >
              Preserve &amp; Repair
            </Button>
          </div>

          <p className="text-[9px] text-muted-foreground leading-tight mb-2">
            {rebuildMode === 'RESET_FULL_CANON_REBUILD'
              ? 'Clears all primaries → regenerates → scores → attaches winners from scratch.'
              : 'Keeps valid primaries → generates only weak/missing → replaces only when challenger significantly better.'}
            {isVerticalDrama && ' Strict 9:16 compliance enforced.'}
          </p>

          {fullRebuilding && rebuildStage && (
            <div className="mb-2 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="text-[10px] text-primary font-medium">{rebuildStage}</span>
              <Progress
                value={
                  (currentStages as readonly string[]).indexOf(rebuildStage) >= 0
                    ? (((currentStages as readonly string[]).indexOf(rebuildStage) + 1) / currentStages.length) * 100
                    : 0
                }
                className="h-1 flex-1"
              />
            </div>
          )}

          {/* Last rebuild result diagnostics strip */}
          {lastRebuildResult && !fullRebuilding && (() => {
            const r = lastRebuildResult;
            const isPreserveMode = r.mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';
            const modeLabel = isPreserveMode ? 'Preserve' : 'Reset';
            const isZeroTarget = isPreserveMode && r.generatedCount === 0 && r.replacedPrimaryCount === 0;
            const severity = r.unresolvedSlots === 0 ? 'success' : 'warning';
            const severityBorder = severity === 'success' ? 'border-green-600/30' : 'border-amber-500/30';
            const severityBg = severity === 'success' ? 'bg-green-50/50 dark:bg-green-950/20' : 'bg-amber-50/50 dark:bg-amber-950/20';

            return (
              <div className={`mb-2 rounded-md border ${severityBorder} ${severityBg} text-[10px]`}>
                {/* Header */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/20">
                  {severity === 'success'
                    ? <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                  <span className="font-semibold text-foreground">{modeLabel} rebuild</span>
                  <span className="ml-auto text-muted-foreground">
                    {r.resolvedSlots}/{r.totalSlots} resolved
                  </span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-3 gap-x-3 gap-y-1 px-2.5 py-1.5">
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.generatedCount}</span> generated
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.compliantCount}</span> compliant
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.attachedWinnerCount}</span> attached
                  </div>
                  {isPreserveMode && (
                    <>
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">{r.preservedPrimaryCount}</span> preserved
                      </div>
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">{r.replacedPrimaryCount}</span> replaced
                      </div>
                    </>
                  )}
                  {r.rejectedNonCompliantCount > 0 && (
                    <div className="text-amber-600 dark:text-amber-400">
                      <span className="font-medium">{r.rejectedNonCompliantCount}</span> rejected
                    </div>
                  )}
                  {r.unresolvedSlots > 0 && (
                    <div className="text-amber-600 dark:text-amber-400">
                      <span className="font-medium">{r.unresolvedSlots}</span> unresolved
                    </div>
                  )}
                </div>

                {/* Zero-target preserve message */}
                {isZeroTarget && (
                  <div className="px-2.5 pb-1.5 text-muted-foreground italic">
                    No weak slots detected — no generation performed
                  </div>
                )}

                {/* Unresolved reasons expander */}
                {r.unresolvedReasons.length > 0 && (
                  <details className="border-t border-border/20">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 select-none">
                      {r.unresolvedReasons.length} unresolved slot{r.unresolvedReasons.length !== 1 ? 's' : ''} — details
                    </summary>
                    <ul className="px-2.5 pb-1.5 space-y-0.5 text-muted-foreground">
                      {r.unresolvedReasons.map((ur, i) => (
                        <li key={ur.slotKey || i} className="flex gap-1">
                          <span className="text-foreground/70 font-medium shrink-0">{ur.slotKey}:</span>
                          <span>{ur.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })()}

          <Button
            size="sm"
            className="gap-1.5 text-[10px] h-8 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            disabled={fullRebuilding || populating}
            onClick={handleFullCanonRebuild}
          >
            {fullRebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {rebuildMode === 'RESET_FULL_CANON_REBUILD' ? 'Reset & Rebuild' : 'Preserve & Repair'}
          </Button>
        </CardContent>
      </Card>

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

      {/* ── Character Identity Staging Strip ── */}
      {entities.characters.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">Character Identity Staging</span>
            </div>
            {entities.characters.map((char) => {
              const priority = shouldPrioritizeIdentityGeneration(char.name, identityAnchorMap);
              const anchors = identityAnchorMap[char.name];
              const completeness = anchors?.completeness || 'no_anchors';
              return (
                <div key={char.name} className="flex items-start gap-2 py-1 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-1 min-w-0 flex-shrink-0">
                    {completeness === 'full_lock' ? (
                      <Lock className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                    ) : completeness === 'partial_lock' ? (
                      <Unlock className="h-3 w-3 text-amber-500 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />
                    )}
                    <span className="text-[11px] font-medium text-foreground truncate">{char.name}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge
                        variant={completeness === 'full_lock' ? 'default' : 'secondary'}
                        className={cn(
                          'text-[8px] px-1 py-0',
                          completeness === 'full_lock' && 'bg-emerald-600 text-white',
                          completeness === 'partial_lock' && 'bg-amber-500/20 text-amber-700 border-amber-500/30',
                          completeness === 'no_anchors' && 'bg-destructive/15 text-destructive border-destructive/30',
                        )}
                      >
                        {completeness === 'full_lock' ? 'Full Lock' : completeness === 'partial_lock' ? 'Partial Lock' : 'No Anchors'}
                      </Badge>
                      {priority.prioritize && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 text-amber-600 border-amber-400/50">
                          Refs Deferred
                        </Badge>
                      )}
                    </div>
                    {priority.missingSlots.length > 0 && (
                      <span className="text-[9px] text-muted-foreground">
                        Missing: {priority.missingSlots.map(s => s.replace('identity_', '')).join(', ')}
                      </span>
                    )}
                    {priority.prioritize && (
                      <span className="text-[9px] text-muted-foreground/70 italic">
                        {completeness === 'no_anchors'
                          ? 'Generate identity pack first'
                          : `Complete ${priority.missingSlots.map(s => s.replace('identity_', '')).join(' + ')} before refs`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {showApprovalQueue && pendingSlots.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-3">
            <ApprovalWorkspace
              slots={pendingSlots}
              onApprove={approveIntoCanon}
              onReject={rejectCandidate}
              onSetPrimary={approveIntoCanon}
              identityAnchorMap={identityAnchorMap}
              visualSimilarities={cachedSimilarities}
              projectId={projectId}
            />
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
                <div key={img.id} className={cn('relative rounded-md overflow-hidden bg-muted border border-border/50', getDisplayAspectClass(img.width, img.height))}>
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
    <div className={cn('group relative rounded-md overflow-hidden bg-muted border border-border/30 opacity-70 hover:opacity-100 transition-opacity', getDisplayAspectClass(image.width, image.height))}>
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
