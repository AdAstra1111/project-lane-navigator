/**
 * ActorCandidateReview — Wires CandidateFilmstrip + CandidateDetailPanel
 * into an actor's versions and assets, replacing the flat VersionCard grid.
 *
 * Gates candidate display on anchor coverage status:
 * - If coverage is insufficient AND no real image assets exist,
 *   shows an actionable blocking state with upload slots.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CandidateFilmstrip, type CandidateItem, type CandidateStatus } from './CandidateFilmstrip';
import { CandidateDetailPanel, type VersionItem } from './CandidateDetailPanel';
import type { AIActorVersion, AIActorAsset } from '@/lib/aiCast/aiCastApi';
import { aiCastApi } from '@/lib/aiCast/aiCastApi';
import { useAICastMutations } from '@/lib/aiCast/useAICast';
import { supabase } from '@/integrations/supabase/client';
import {
  evaluateAnchorCoverage, persistAnchorStatus,
  type AnchorCoherenceStatus,
} from '@/lib/aiCast/anchorValidation';
import { ImageIcon, Upload, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

type AnchorSlotKey = 'reference_headshot' | 'reference_full_body' | 'reference_profile';

const ANCHOR_SLOTS: { key: AnchorSlotKey; label: string; metaShotType: string }[] = [
  { key: 'reference_headshot', label: 'Headshot', metaShotType: 'headshot' },
  { key: 'reference_full_body', label: 'Full Body', metaShotType: 'full_body' },
  { key: 'reference_profile', label: 'Profile', metaShotType: 'profile' },
];

interface ActorCandidateReviewProps {
  actorId: string;
  versions: AIActorVersion[];
  approvedVersionId?: string | null;
  anchorCoverageStatus?: string;
}

function assetToCandidateStatus(asset: AIActorAsset): CandidateStatus {
  if (asset.public_url) return 'ready';
  if ((asset.meta_json as any)?.error) return 'failed';
  return 'rendering';
}

function buildCandidatesFromVersions(versions: AIActorVersion[]): CandidateItem[] {
  const items: CandidateItem[] = [];
  const ANCHOR_ASSET_TYPES = new Set(['reference_headshot', 'reference_full_body', 'reference_profile']);

  for (const ver of versions) {
    const assets = ver.ai_actor_assets || [];
    // Only show screen_test_still and non-anchor assets as review candidates
    const reviewAssets = assets.filter(a => !ANCHOR_ASSET_TYPES.has(a.asset_type));

    if (reviewAssets.length === 0) continue;

    for (const asset of reviewAssets) {
      items.push({
        id: asset.id,
        label: asset.asset_type === 'screen_test_still'
          ? `Screen Test ${items.length + 1}`
          : asset.asset_type.replace(/_/g, ' '),
        thumbnailUrl: asset.public_url || null,
        status: assetToCandidateStatus(asset),
        score: (asset.meta_json as any)?.score ?? null,
        versionNumber: ver.version_number,
        assetType: asset.asset_type,
      });
    }
  }

  return items;
}

/** Check if any version has real image assets (not just empty versions). */
function hasRealAssets(versions: AIActorVersion[]): boolean {
  return versions.some(v => (v.ai_actor_assets || []).length > 0);
}

/** Determine which anchor slots are filled from assets across all versions. */
function getFilledSlots(versions: AIActorVersion[]): Set<string> {
  const filled = new Set<string>();
  for (const ver of versions) {
    for (const a of (ver.ai_actor_assets || [])) {
      const at = (a.asset_type || '').toLowerCase();
      const mt = ((a.meta_json as any)?.shot_type || '').toLowerCase();
      if (at === 'reference_headshot' || mt === 'headshot' || mt === 'identity_headshot') filled.add('reference_headshot');
      if (at === 'reference_full_body' || mt === 'full_body' || mt === 'identity_full_body') filled.add('reference_full_body');
      if (at === 'reference_profile' || mt === 'profile' || mt === 'identity_profile') filled.add('reference_profile');
    }
  }
  return filled;
}

function getSlotAsset(versions: AIActorVersion[], slotKey: AnchorSlotKey): AIActorAsset | undefined {
  for (const ver of versions) {
    for (const a of (ver.ai_actor_assets || [])) {
      const at = (a.asset_type || '').toLowerCase();
      const mt = ((a.meta_json as any)?.shot_type || '').toLowerCase();
      if (slotKey === 'reference_headshot' && (at === 'reference_headshot' || mt === 'headshot' || mt === 'identity_headshot')) return a;
      if (slotKey === 'reference_full_body' && (at === 'reference_full_body' || mt === 'full_body' || mt === 'identity_full_body')) return a;
      if (slotKey === 'reference_profile' && (at === 'reference_profile' || mt === 'profile' || mt === 'identity_profile')) return a;
    }
  }
  return undefined;
}

export function ActorCandidateReview({ actorId, versions, approvedVersionId, anchorCoverageStatus }: ActorCandidateReviewProps) {
  const { generateScreenTest, approveVersion, deleteAsset } = useAICastMutations();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSlot, setUploadSlot] = useState<AnchorSlotKey>('reference_headshot');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coverageInsufficient = anchorCoverageStatus !== 'sufficient' && anchorCoverageStatus !== 'complete';
  const realAssetsExist = hasRealAssets(versions);
  const isBlocked = coverageInsufficient && !realAssetsExist;

  const filledSlots = useMemo(() => getFilledSlots(versions), [versions]);
  const anchorsFilled = filledSlots.size;

  // ── Upload handler ──────────────────────────────────────────────────────
  const triggerUpload = useCallback((slot: AnchorSlotKey) => {
    setUploadSlot(slot);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    e.target.value = '';
    setUploading(true);

    // Find version to attach to (latest)
    const targetVersion = versions[versions.length - 1];
    if (!targetVersion) {
      toast.error('No version available');
      setUploading(false);
      return;
    }

    let successCount = 0;
    for (const file of Array.from(files)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { toast.error(`"${file.name}" not supported.`); continue; }
      if (file.size > MAX_IMAGE_SIZE) { toast.error(`"${file.name}" too large (max 10MB).`); continue; }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const rand = Math.random().toString(36).slice(2, 8);
      const storagePath = `actors/${actorId}/${targetVersion.id}/reference/${Date.now()}_${rand}.${ext}`;
      try {
        const { error: uploadErr } = await supabase.storage.from('ai-media').upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadErr) { toast.error(`Upload failed: ${uploadErr.message}`); continue; }
        const { data: urlData } = supabase.storage.from('ai-media').getPublicUrl(storagePath);

        const slotDef = ANCHOR_SLOTS.find(s => s.key === uploadSlot);
        const metaShotType = slotDef?.metaShotType || 'reference';

        await aiCastApi.addAsset(targetVersion.id, {
          asset_type: uploadSlot,
          storage_path: storagePath,
          public_url: urlData.publicUrl,
          meta_json: {
            filename: file.name, size: file.size, content_type: file.type,
            shot_type: metaShotType,
            uploaded_at: new Date().toISOString(),
          },
        });
        successCount++;
      } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    }
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} image${successCount > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });

      // Re-evaluate and persist anchor coverage
      try {
        const coverage = await evaluateAnchorCoverage(actorId);
        const coherence = coverage.coverageStatus === 'insufficient'
          ? 'unknown' as AnchorCoherenceStatus
          : (await import('@/lib/aiCast/anchorValidation').then(m => m.evaluateAnchorCoherence(actorId, coverage))).coherenceStatus;
        await persistAnchorStatus(actorId, coverage.coverageStatus, coherence);
        queryClient.invalidateQueries({ queryKey: ['ai-actors'] });
        queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
      } catch (err) {
        console.warn('[AnchorUpload] Re-evaluation failed:', err);
      }
    }
    setUploading(false);
  }, [actorId, versions, uploadSlot, queryClient]);

  const candidates = useMemo(() => {
    if (isBlocked) return [];
    return buildCandidatesFromVersions(versions);
  }, [versions, isBlocked]);

  const selected = useMemo(() => {
    if (selectedId) {
      return candidates.find(c => c.id === selectedId) || candidates[0] || null;
    }
    return candidates.find(c => c.status === 'ready') || candidates[0] || null;
  }, [candidates, selectedId]);

  const versionItems = useMemo((): VersionItem[] => {
    return versions.map(v => {
      const assets = v.ai_actor_assets || [];
      const thumb = assets.find(a => a.public_url)?.public_url || null;
      return {
        id: v.id,
        versionNumber: v.version_number,
        thumbnailUrl: thumb,
        isApproved: v.id === approvedVersionId,
      };
    });
  }, [versions, approvedVersionId]);

  const handleCreateAnother = useCallback(() => {
    if (isBlocked) {
      toast.error('Add anchor references (headshot, profile, full-body) before generating images.');
      return;
    }
    const latestVersion = versions[versions.length - 1];
    if (!latestVersion) {
      toast.error('No version available to generate from');
      return;
    }
    generateScreenTest.mutate(
      { actorId, versionId: latestVersion.id, count: 4 },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
        },
      }
    );
  }, [actorId, versions, generateScreenTest, queryClient, isBlocked]);

  const handleApprove = useCallback((id: string) => {
    for (const ver of versions) {
      if (ver.ai_actor_assets?.some(a => a.id === id) || ver.id === id) {
        approveVersion.mutate({ actorId, versionId: ver.id });
        return;
      }
    }
  }, [actorId, versions, approveVersion]);

  const handleReject = useCallback((id: string) => {
    deleteAsset.mutate(id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
        toast.success('Candidate rejected');
      },
    });
  }, [actorId, deleteAsset, queryClient]);

  const handleRegenerate = useCallback((id: string) => {
    if (isBlocked) {
      toast.error('Add anchor references before generating images.');
      return;
    }
    for (const ver of versions) {
      if (ver.ai_actor_assets?.some(a => a.id === id) || ver.id === id) {
        generateScreenTest.mutate(
          { actorId, versionId: ver.id, count: 1 },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
            },
          }
        );
        return;
      }
    }
  }, [actorId, versions, generateScreenTest, queryClient, isBlocked]);

  // ── Hidden file input ───────────────────────────────────────────────────
  const fileInput = (
    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} />
  );

  // ── Anchor upload grid (shown when blocked OR always as a section) ──────
  const anchorUploadGrid = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          Anchor References ({anchorsFilled}/3)
        </span>
        {anchorsFilled >= 3 && (
          <Badge variant="outline" className="h-5 text-[10px] gap-1 border-primary/30 text-primary">
            <CheckCircle2 className="h-2.5 w-2.5" /> Coverage met
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ANCHOR_SLOTS.map(slot => {
          const isFilled = filledSlots.has(slot.key);
          const slotAsset = getSlotAsset(versions, slot.key);

          return (
            <div
              key={slot.key}
              onClick={() => !isFilled && !uploading && triggerUpload(slot.key)}
              className={cn(
                "relative aspect-[3/4] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors",
                isFilled
                  ? "border-primary/30 bg-primary/5 cursor-default"
                  : "border-border/50 hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
              )}
            >
              {isFilled && slotAsset?.public_url ? (
                <>
                  <img src={slotAsset.public_url} alt={slot.label} className="w-full h-full object-cover rounded-md" />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1.5 rounded-b-md">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5 text-primary" />
                      <span className="text-[9px] font-medium text-primary">{slot.label}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-[10px] text-muted-foreground font-medium">{slot.label}</span>
                  <span className="text-[9px] text-muted-foreground/60">Tap to upload</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Blocked state: anchor coverage insufficient ──────────────────────────
  if (isBlocked) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
        {fileInput}
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/10 p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-foreground">
              Upload reference images to unlock generation
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload a <strong>headshot</strong>, <strong>full body</strong>, and <strong>profile</strong> reference 
              to establish visual identity. Once all three are uploaded, image generation and validation will unlock.
            </p>
          </div>
        </div>

        {anchorUploadGrid}

        <div className="flex items-center gap-4 pl-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500/60" />
            Text draft created
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <div className="w-2 h-2 rounded-full bg-amber-500/60" />
            {anchorsFilled}/3 anchors uploaded
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
            <div className="w-2 h-2 rounded-full bg-muted/40" />
            Generation locked
          </div>
        </div>
      </div>
    );
  }

  // ── No versions at all ───────────────────────────────────────────────────
  if (candidates.length === 0 && versions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 p-8 text-center space-y-3">
        {fileInput}
        <p className="text-xs text-muted-foreground">No candidates yet.</p>
        <p className="text-[10px] text-muted-foreground">
          Generate screen test images to start reviewing candidate looks for this actor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {fileInput}

      {/* Always show anchor upload grid if coverage not met */}
      {coverageInsufficient && anchorUploadGrid}

      <CandidateFilmstrip
        candidates={candidates}
        selectedId={selected?.id || null}
        onSelect={setSelectedId}
        onCreateAnother={handleCreateAnother}
        isGenerating={generateScreenTest.isPending}
        generationBlocked={coverageInsufficient}
      />

      {selected && (
        <CandidateDetailPanel
          candidate={selected}
          allCandidates={candidates}
          versions={versionItems}
          onApprove={handleApprove}
          onReject={handleReject}
          onCreateAnother={handleCreateAnother}
          onRegenerate={handleRegenerate}
          isActioning={approveVersion.isPending || deleteAsset.isPending}
          comparisonMode={comparisonMode}
          onToggleComparison={() => setComparisonMode(!comparisonMode)}
        />
      )}
    </div>
  );
}
