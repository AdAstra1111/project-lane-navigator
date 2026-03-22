/**
 * ActorCandidateReview — Wires CandidateFilmstrip + CandidateDetailPanel
 * into an actor's versions and assets, replacing the flat VersionCard grid.
 */
import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CandidateFilmstrip, type CandidateItem, type CandidateStatus } from './CandidateFilmstrip';
import { CandidateDetailPanel, type VersionItem } from './CandidateDetailPanel';
import type { AIActorVersion, AIActorAsset } from '@/lib/aiCast/aiCastApi';
import { useAICastMutations } from '@/lib/aiCast/useAICast';

interface ActorCandidateReviewProps {
  actorId: string;
  versions: AIActorVersion[];
  approvedVersionId?: string | null;
}

function assetToCandidateStatus(asset: AIActorAsset): CandidateStatus {
  // For now, all persisted assets with a URL are "ready"
  if (asset.public_url) return 'ready';
  if ((asset.meta_json as any)?.error) return 'failed';
  return 'rendering';
}

function buildCandidatesFromVersions(versions: AIActorVersion[]): CandidateItem[] {
  const items: CandidateItem[] = [];

  for (const ver of versions) {
    const assets = ver.ai_actor_assets || [];
    if (assets.length === 0) {
      // Version exists, but no generated/uploaded images were persisted for it yet.
      items.push({
        id: ver.id,
        label: `Version ${ver.version_number}`,
        thumbnailUrl: null,
        status: 'empty',
        score: null,
        versionNumber: ver.version_number,
      });
    } else {
      // Each asset is a candidate
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

export function ActorCandidateReview({ actorId, versions, approvedVersionId }: ActorCandidateReviewProps) {
  const { generateScreenTest, approveVersion, deleteAsset } = useAICastMutations();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);

  const candidates = useMemo(() => buildCandidatesFromVersions(versions), [versions]);

  // Auto-select first ready candidate if nothing selected
  const selected = useMemo(() => {
    if (selectedId) {
      return candidates.find(c => c.id === selectedId) || candidates[0] || null;
    }
    return candidates.find(c => c.status === 'ready') || candidates[0] || null;
  }, [candidates, selectedId]);

  // Build version items for carousel
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
  }, [actorId, versions, generateScreenTest, queryClient]);

  const handleApprove = useCallback((id: string) => {
    // Find which version contains this asset
    for (const ver of versions) {
      if (ver.ai_actor_assets?.some(a => a.id === id) || ver.id === id) {
        approveVersion.mutate({ actorId, versionId: ver.id });
        return;
      }
    }
  }, [actorId, versions, approveVersion]);

  const handleReject = useCallback((id: string) => {
    // Delete the asset
    deleteAsset.mutate(id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
        toast.success('Candidate rejected');
      },
    });
  }, [actorId, deleteAsset, queryClient]);

  const handleRegenerate = useCallback((id: string) => {
    // Find version and regenerate
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
  }, [actorId, versions, generateScreenTest, queryClient]);

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
      {/* Filmstrip */}
      <CandidateFilmstrip
        candidates={candidates}
        selectedId={selected?.id || null}
        onSelect={setSelectedId}
        onCreateAnother={handleCreateAnother}
        isGenerating={generateScreenTest.isPending}
      />

      {/* Detail Panel */}
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
