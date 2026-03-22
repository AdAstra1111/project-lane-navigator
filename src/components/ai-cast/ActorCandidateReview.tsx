/**
 * ActorCandidateReview — Wires CandidateFilmstrip + CandidateDetailPanel
 * into an actor's versions and assets, replacing the flat VersionCard grid.
 *
 * Gates candidate display on anchor coverage status:
 * - If coverage is insufficient AND no real image assets exist,
 *   shows an actionable blocking state instead of empty candidates.
 */
import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CandidateFilmstrip, type CandidateItem, type CandidateStatus } from './CandidateFilmstrip';
import { CandidateDetailPanel, type VersionItem } from './CandidateDetailPanel';
import type { AIActorVersion, AIActorAsset } from '@/lib/aiCast/aiCastApi';
import { useAICastMutations } from '@/lib/aiCast/useAICast';
import { ImageIcon, Upload, AlertTriangle } from 'lucide-react';

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

  for (const ver of versions) {
    const assets = ver.ai_actor_assets || [];
    if (assets.length === 0) {
      items.push({
        id: ver.id,
        label: `Version ${ver.version_number}`,
        thumbnailUrl: null,
        status: 'empty',
        score: null,
        versionNumber: ver.version_number,
      });
    } else {
      for (const asset of assets) {
        items.push({
          id: asset.id,
          label: asset.asset_type.replace(/_/g, ' '),
          thumbnailUrl: asset.public_url || null,
          status: assetToCandidateStatus(asset),
          score: (asset.meta_json as any)?.score ?? null,
          versionNumber: ver.version_number,
          assetType: asset.asset_type,
        });
      }
    }
  }

  return items;
}

/** Check if any version has real image assets (not just empty versions). */
function hasRealAssets(versions: AIActorVersion[]): boolean {
  return versions.some(v => (v.ai_actor_assets || []).length > 0);
}

export function ActorCandidateReview({ actorId, versions, approvedVersionId, anchorCoverageStatus }: ActorCandidateReviewProps) {
  const { generateScreenTest, approveVersion, deleteAsset } = useAICastMutations();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);

  const coverageInsufficient = anchorCoverageStatus !== 'sufficient' && anchorCoverageStatus !== 'complete';
  const realAssetsExist = hasRealAssets(versions);

  // If coverage is insufficient AND no real assets exist, show blocking state
  // (If real assets already exist from prior runs, still show them)
  const isBlocked = coverageInsufficient && !realAssetsExist;

  const candidates = useMemo(() => {
    if (isBlocked) return []; // Don't show empty version cards as fake candidates
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

  // ── Blocked state: anchor coverage insufficient ──────────────────────────
  if (isBlocked) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/10 p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div className="space-y-1.5">
            <h4 className="text-sm font-medium text-foreground">
              Needs references before image generation
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This actor's text identity has been drafted, but image generation requires anchor references 
              to ensure visual consistency. Upload at least a <strong>headshot</strong>, <strong>profile</strong>, 
              and <strong>full-body</strong> reference image to unlock generation and validation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 pl-12">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500/60" />
            Text draft created
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <div className="w-2 h-2 rounded-full bg-amber-500/60" />
            Anchor images needed
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
            <div className="w-2 h-2 rounded-full bg-muted/40" />
            Image generation locked
          </div>
        </div>
      </div>
    );
  }

  // ── No versions at all ───────────────────────────────────────────────────
  if (candidates.length === 0 && versions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 p-8 text-center space-y-3">
        <p className="text-xs text-muted-foreground">No candidates yet.</p>
        <p className="text-[10px] text-muted-foreground">
          Generate screen test images to start reviewing candidate looks for this actor.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
