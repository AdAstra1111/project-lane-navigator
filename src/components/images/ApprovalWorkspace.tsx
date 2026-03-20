/**
 * ApprovalWorkspace — Visual Decision Workspace replacing the simple approval queue.
 * Supports list view, character-grouped view, image lightbox, and side-by-side comparison.
 * Identity-aware: displays anchor continuity status per character candidate.
 *
 * HARDENED v0.5: No mount-time competition writes. All competition orchestration
 * is explicit via useSlotCompetitionOrchestrator. This component only reads
 * canonical DB-backed state and triggers explicit user actions.
 */
import { useState, useMemo, useCallback } from 'react';
import type { VisualSimilarityResult } from '@/lib/images/anchorVisualSimilarity';
import { useSlotCompetitionOrchestrator } from '@/hooks/useSlotCompetitionOrchestrator';
import { rankCharacterCandidates } from '@/lib/images/characterCandidateRanking';
import {
  CheckCircle, XCircle, Recycle, Eye, Expand, LayoutGrid, List,
  Users, ChevronRight, Crown, Link, Unlink, AlertTriangle, ShieldCheck,
  Swords,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { ProjectImage, ShotType } from '@/lib/images/types';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import { getDisplayAspectClass, getOrientationLabel } from '@/lib/images/orientationUtils';
import { classifyIdentityContinuity, type IdentityAnchorMap, type IdentityContinuityStatus } from '@/lib/images/characterIdentityAnchorSet';
import { ImageLightbox } from './ImageLightbox';
import { ImageComparisonView } from './ImageComparisonView';

interface RequiredSlot {
  key: string;
  label: string;
  assetGroup: string;
  subject: string | null;
  shotType: string | null;
  filled: boolean;
  candidates: ProjectImage[];
  recommended: ProjectImage | null;
  recommendedReason: string | null;
  isIdentity: boolean;
  primaryImage: ProjectImage | null;
}

type ViewMode = 'list' | 'character';

interface ApprovalWorkspaceProps {
  slots: RequiredSlot[];
  onApprove: (image: ProjectImage) => void;
  onReject: (imageId: string, markReuse: boolean) => void;
  onSetPrimary?: (image: ProjectImage) => void;
  dnaTraitsByCharacter?: Record<string, Array<{ label: string; value: string; region?: string }>>;
  identityAnchorMap?: IdentityAnchorMap;
  visualSimilarities?: Record<string, VisualSimilarityResult>;
  projectId?: string;
}

export function ApprovalWorkspace({
  slots, onApprove, onReject, onSetPrimary, dnaTraitsByCharacter, identityAnchorMap, visualSimilarities, projectId,
}: ApprovalWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [lightboxImage, setLightboxImage] = useState<ProjectImage | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<ProjectImage[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  // ── Canonical competition state from DB via orchestrator hook ──
  const competition = useSlotCompetitionOrchestrator(projectId);

  const pendingSlots = useMemo(() => slots.filter(s => !s.filled && s.candidates.length > 0), [slots]);

  // ── Explicit action: initialize competition for all pending slots ──
  const handleInitializeCompetition = useCallback(() => {
    const slotInfos = pendingSlots
      .filter(s => s.candidates.length >= 2)
      .map(s => ({
        key: s.key,
        assetGroup: s.assetGroup,
        subject: s.subject,
        candidateIds: s.candidates.map(c => c.id),
      }));
    if (slotInfos.length > 0) {
      competition.initializeAllSlots(slotInfos);
    }
  }, [pendingSlots, competition]);

  // ── Explicit action: approve with competition winner selection ──
  const handleApproveWithCompetition = useCallback(async (image: ProjectImage, slot?: RequiredSlot) => {
    // Always call existing approve
    onApprove(image);

    // Persist competition winner if group exists in canonical state
    if (slot && projectId) {
      const group = competition.slotGroupMap[slot.key];
      if (group) {
        try {
          const details = await competition.loadGroupDetails(group.id);
          if (details) {
            const cv = details.versions.find(v => v.version_ref_id === image.id);
            if (cv) {
              // Persist ranking first if not yet done
              if (details.rankings.length === 0) {
                const anchorSet = slot.subject && identityAnchorMap ? identityAnchorMap[slot.subject] || null : null;
                const ranking = rankCharacterCandidates(slot.candidates, anchorSet, null, visualSimilarities || null);
                const refToVersion = new Map(details.versions.map(v => [v.version_ref_id, v]));
                const rankingRows = ranking.ranked
                  .map((r, i) => {
                    const matched = refToVersion.get(r.image.id);
                    if (!matched) return null;
                    return {
                      candidateVersionId: matched.id,
                      rankPosition: i + 1,
                      rankScore: r.rankValue,
                      scoreJson: {
                        continuityStatus: r.continuityStatus,
                        driftPenalty: r.driftPenalty,
                        similarityAdjustment: r.similarityAdjustment,
                        score: r.score,
                      },
                      rankingInputsJson: {
                        rankReason: r.rankReason,
                        continuityReason: r.continuityReason,
                      },
                    };
                  })
                  .filter(Boolean) as any[];

                if (rankingRows.length > 0) {
                  await competition.persistRanking.mutateAsync({
                    groupId: group.id,
                    rankings: rankingRows,
                  });
                }
              }

              await competition.selectCompetitionWinner.mutateAsync({
                groupId: group.id,
                candidateVersionId: cv.id,
              });
            }
          }
        } catch (err) {
          console.warn('[Competition] Winner selection on approve failed:', err);
        }
      }
    }
  }, [onApprove, projectId, competition, identityAnchorMap, visualSimilarities]);

  const toggleCompareSelect = useCallback((img: ProjectImage) => {
    setSelectedForCompare(prev => {
      const exists = prev.find(i => i.id === img.id);
      if (exists) return prev.filter(i => i.id !== img.id);
      if (prev.length >= 4) return [...prev.slice(1), img];
      return [...prev, img];
    });
  }, []);

  const openComparison = useCallback(() => {
    if (selectedForCompare.length >= 2) setShowComparison(true);
  }, [selectedForCompare]);

  // Group by character for character view
  const characterGroups = useMemo(() => {
    const groups: Record<string, { slots: RequiredSlot[]; allCandidates: ProjectImage[] }> = {};
    for (const slot of pendingSlots) {
      if (slot.assetGroup !== 'character') continue;
      const charName = slot.subject || 'Unknown';
      if (!groups[charName]) groups[charName] = { slots: [], allCandidates: [] };
      groups[charName].slots.push(slot);
      groups[charName].allCandidates.push(...slot.candidates);
    }
    return groups;
  }, [pendingSlots]);

  const currentDnaTraits = lightboxImage?.subject
    ? dnaTraitsByCharacter?.[lightboxImage.subject]
    : undefined;

  // Check if any slots are eligible for competition
  const hasCompetitionEligibleSlots = pendingSlots.some(s => s.candidates.length >= 2);
  const hasInitializedCompetition = Object.keys(competition.slotGroupMap).length > 0;

  if (pendingSlots.length === 0) {
    return (
      <div className="py-4 text-center text-[10px] text-muted-foreground">
        No pending candidates to review.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with view toggle + compare action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <CheckCircle className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
            Approval Queue
          </span>
          <Badge variant="secondary" className="text-[8px] px-1 py-0">{pendingSlots.length}</Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Explicit competition initialization */}
          {hasCompetitionEligibleSlots && !hasInitializedCompetition && (
            <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2"
              onClick={handleInitializeCompetition}
              disabled={competition.initializeSlotCompetition.isPending}>
              <Swords className="h-3 w-3" /> Initialize Competition
            </Button>
          )}
          {selectedForCompare.length >= 2 && (
            <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2"
              onClick={openComparison}>
              <Eye className="h-3 w-3" /> Compare ({selectedForCompare.length})
            </Button>
          )}
          <Button size="sm" variant="ghost"
            className={cn('h-6 w-6 p-0', viewMode === 'list' && 'bg-muted')}
            onClick={() => setViewMode('list')} title="List view">
            <List className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost"
            className={cn('h-6 w-6 p-0', viewMode === 'character' && 'bg-muted')}
            onClick={() => setViewMode('character')} title="Character view">
            <Users className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Selection hint */}
      {selectedForCompare.length > 0 && selectedForCompare.length < 2 && (
        <p className="text-[8px] text-muted-foreground">
          Select {2 - selectedForCompare.length} more to compare side-by-side
        </p>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="space-y-2">
          {pendingSlots.map(slot => (
            <SlotApprovalRow
              key={slot.key}
              slot={slot}
              onApprove={(img) => handleApproveWithCompetition(img, slot)}
              onReject={onReject}
              onExpand={setLightboxImage}
              onToggleCompare={toggleCompareSelect}
              selectedForCompare={selectedForCompare}
              identityAnchorMap={identityAnchorMap}
              competitionGroup={competition.slotGroupMap[slot.key]}
            />
          ))}
        </div>
      )}

      {/* Character View */}
      {viewMode === 'character' && (
        <div className="space-y-3">
          {Object.entries(characterGroups).map(([charName, group]) => (
            <CharacterGroupRow
              key={charName}
              characterName={charName}
              slots={group.slots}
              onApprove={onApprove}
              onReject={onReject}
              onExpand={setLightboxImage}
              onToggleCompare={toggleCompareSelect}
              selectedForCompare={selectedForCompare}
              identityAnchorMap={identityAnchorMap}
            />
          ))}
          {/* Non-character pending slots */}
          {pendingSlots.filter(s => s.assetGroup !== 'character').length > 0 && (
            <div>
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Other Slots
              </p>
              <div className="space-y-2">
                {pendingSlots.filter(s => s.assetGroup !== 'character').map(slot => (
                  <SlotApprovalRow
                    key={slot.key}
                    slot={slot}
                    onApprove={onApprove}
                    onReject={onReject}
                    onExpand={setLightboxImage}
                    onToggleCompare={toggleCompareSelect}
                    selectedForCompare={selectedForCompare}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      <ImageLightbox
        image={lightboxImage}
        open={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        dnaTraits={currentDnaTraits}
      />

      {/* Comparison */}
      <ImageComparisonView
        images={selectedForCompare}
        open={showComparison}
        onClose={() => setShowComparison(false)}
        onSetPrimary={onSetPrimary}
        onReject={(id) => onReject(id, false)}
        identityAnchorMap={identityAnchorMap}
        visualSimilarities={visualSimilarities}
      />
    </div>
  );
}

// ── Slot Approval Row ──

function SlotApprovalRow({
  slot, onApprove, onReject, onExpand, onToggleCompare, selectedForCompare, identityAnchorMap, competitionGroup,
}: {
  slot: RequiredSlot;
  onApprove: (img: ProjectImage) => void;
  onReject: (id: string, markReuse: boolean) => void;
  onExpand: (img: ProjectImage) => void;
  onToggleCompare: (img: ProjectImage) => void;
  selectedForCompare: ProjectImage[];
  identityAnchorMap?: IdentityAnchorMap;
  competitionGroup?: CandidateGroup;
}) {
  const [expanded, setExpanded] = useState(slot.candidates.length <= 3);

  return (
    <div className="rounded-md border border-border/40 bg-muted/20 overflow-hidden">
      {/* Slot header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <p className="text-[9px] font-medium text-foreground flex-1 truncate">{slot.label}</p>
        {slot.isIdentity && (
          <Badge variant="outline" className="text-[7px] px-1 py-0 border-primary/40 text-primary/70">Identity</Badge>
        )}
        <Badge variant="secondary" className="text-[8px] px-1 py-0">
          {slot.candidates.length} candidate{slot.candidates.length !== 1 ? 's' : ''}
        </Badge>
        {competitionGroup && (
          <Badge variant="outline" className={cn(
            'text-[7px] px-1 py-0',
            competitionGroup.status === 'winner_selected' ? 'border-emerald-500/50 text-emerald-600' :
            competitionGroup.status === 'ranked' ? 'border-primary/40 text-primary/70' :
            'border-border/40 text-muted-foreground',
          )}>
            {competitionGroup.status === 'winner_selected' ? '✓ Winner' :
             competitionGroup.status === 'ranked' ? 'Ranked' : 'Competing'}
          </Badge>
        )}
        {slot.candidates.length > 3 && (
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setExpanded(!expanded)}>
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </Button>
        )}
      </div>

      {/* Candidates */}
      <div className="px-2 pb-2">
        <div className="grid grid-cols-3 gap-1.5">
          {(expanded ? slot.candidates : slot.candidates.slice(0, 3)).map(img => (
            <CandidateCard
              key={img.id}
              image={img}
              isRecommended={img.id === slot.recommended?.id}
              isSelectedForCompare={selectedForCompare.some(c => c.id === img.id)}
              identityContinuity={img.asset_group === 'character' && img.subject ? classifyIdentityContinuity(img, identityAnchorMap?.[img.subject] || null).status : undefined}
              rankReason={img.id === slot.recommended?.id ? (slot.recommendedReason ?? undefined) : undefined}
              onApprove={() => onApprove(img)}
              onReject={() => onReject(img.id, false)}
              onRejectReuse={() => onReject(img.id, true)}
              onExpand={() => onExpand(img)}
              onToggleCompare={() => onToggleCompare(img)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Character Group Row ──

function CharacterGroupRow({
  characterName, slots, onApprove, onReject, onExpand, onToggleCompare, selectedForCompare, identityAnchorMap,
}: {
  characterName: string;
  slots: RequiredSlot[];
  onApprove: (img: ProjectImage) => void;
  onReject: (id: string, markReuse: boolean) => void;
  onExpand: (img: ProjectImage) => void;
  onToggleCompare: (img: ProjectImage) => void;
  selectedForCompare: ProjectImage[];
  identityAnchorMap?: IdentityAnchorMap;
}) {
  // Group slots by shot type category
  const slotsByType = useMemo(() => {
    const groups: Record<string, RequiredSlot[]> = {};
    for (const slot of slots) {
      const key = slot.shotType || 'general';
      if (!groups[key]) groups[key] = [];
      groups[key].push(slot);
    }
    return groups;
  }, [slots]);

  return (
    <div className="rounded-md border border-border/40 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/30">
        <Users className="h-3 w-3 text-primary/60" />
        <span className="text-[9px] font-semibold text-foreground">{characterName}</span>
        <Badge variant="secondary" className="text-[7px] px-1 py-0">{slots.length} slots</Badge>
      </div>

      <div className="space-y-1.5 p-2">
        {Object.entries(slotsByType).map(([typeKey, typeSlots]) => (
          <div key={typeKey}>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">
              {SHOT_TYPE_LABELS[typeKey as ShotType] || typeKey}
            </p>
            <ScrollArea className="w-full">
              <div className="flex gap-1.5 pb-1">
                {typeSlots.flatMap(s => s.candidates).map(img => (
                  <div key={img.id} className="flex-shrink-0 w-[100px]">
                    <CandidateCard
                      image={img}
                      isRecommended={false}
                      isSelectedForCompare={selectedForCompare.some(c => c.id === img.id)}
                      identityContinuity={img.subject ? classifyIdentityContinuity(img, identityAnchorMap?.[img.subject] || null).status : undefined}
                      onApprove={() => onApprove(img)}
                      onReject={() => onReject(img.id, false)}
                      onRejectReuse={() => onReject(img.id, true)}
                      onExpand={() => onExpand(img)}
                      onToggleCompare={() => onToggleCompare(img)}
                      compact
                    />
                  </div>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Candidate Card (internal) ──

function CandidateCard({
  image, isRecommended, isSelectedForCompare, identityContinuity, rankReason,
  onApprove, onReject, onRejectReuse, onExpand, onToggleCompare, compact,
}: {
  image: ProjectImage;
  isRecommended: boolean;
  isSelectedForCompare: boolean;
  identityContinuity?: IdentityContinuityStatus;
  rankReason?: string;
  onApprove: () => void;
  onReject: () => void;
  onRejectReuse: () => void;
  onExpand: () => void;
  onToggleCompare: () => void;
  compact?: boolean;
}) {
  const genConfig = image.generation_config as Record<string, any> | null;
  const identityLocked = genConfig?.identity_locked === true;
  const anchorPaths = genConfig?.identity_anchor_paths as string[] | undefined;
  const anchorCount = anchorPaths?.length || 0;

  const continuityColor = identityContinuity === 'strong_match' ? 'text-emerald-600' :
    identityContinuity === 'partial_match' ? 'text-amber-500' :
    identityContinuity === 'identity_drift' ? 'text-destructive' :
    'text-muted-foreground';

  const continuityLabel = identityContinuity === 'strong_match' ? 'Strong' :
    identityContinuity === 'partial_match' ? 'Partial' :
    identityContinuity === 'identity_drift' ? 'Drift' :
    identityContinuity === 'no_anchor_context' ? 'No Anchor' : '';

  return (
    <Card className={cn(
      'relative group overflow-hidden',
      isSelectedForCompare && 'ring-2 ring-primary',
      isRecommended && 'ring-1 ring-emerald-500/50',
    )}>
      {/* Image */}
      <div className={cn(
        'relative overflow-hidden bg-muted cursor-pointer',
        compact ? 'aspect-square' : 'aspect-[3/4]',
      )} onClick={onExpand}>
        <img
          src={image.signedUrl || image.storage_path}
          alt={'Candidate'}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {/* Badges overlay */}
        <div className="absolute top-1 left-1 flex flex-col gap-0.5">
          {isRecommended && (
            <Badge className="bg-emerald-600/90 text-white text-[7px] px-1 py-0 gap-0.5">
              <Crown className="h-2.5 w-2.5" /> Top
            </Badge>
          )}
          {identityLocked && (
            <Badge variant="outline" className="bg-background/80 text-[7px] px-1 py-0 gap-0.5 border-primary/40">
              <Link className="h-2 w-2" /> Locked
            </Badge>
          )}
          {!identityLocked && anchorCount > 0 && (
            <Badge variant="outline" className="bg-background/80 text-[7px] px-1 py-0 gap-0.5 border-amber-400/50">
              <Link className="h-2 w-2" /> {anchorCount} anchor{anchorCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {/* Continuity badge */}
        {identityContinuity && identityContinuity !== 'no_anchor_context' && (
          <div className="absolute top-1 right-1">
            <Badge variant="outline" className={cn(
              'bg-background/80 text-[7px] px-1 py-0 gap-0.5',
              identityContinuity === 'strong_match' && 'border-emerald-500/50',
              identityContinuity === 'partial_match' && 'border-amber-400/50',
              identityContinuity === 'identity_drift' && 'border-destructive/50',
            )}>
              {identityContinuity === 'strong_match' ? <ShieldCheck className="h-2 w-2" /> :
               identityContinuity === 'identity_drift' ? <AlertTriangle className="h-2 w-2" /> :
               <Unlink className="h-2 w-2" />}
              <span className={continuityColor}>{continuityLabel}</span>
            </Badge>
          </div>
        )}

        {/* Compare checkbox */}
        <div className="absolute bottom-1 right-1">
          <Button
            size="sm"
            variant={isSelectedForCompare ? 'default' : 'outline'}
            className="h-5 w-5 p-0 bg-background/80"
            onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          >
            <Eye className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Rank reason tooltip */}
      {rankReason && (
        <div className="px-1.5 py-0.5 bg-muted/30 border-t border-border/30">
          <p className="text-[7px] text-muted-foreground truncate" title={rankReason}>
            {rankReason}
          </p>
        </div>
      )}

      {/* Metadata */}
      <CardContent className="p-1.5 space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          {image.shot_type && (
            <Badge variant="secondary" className="text-[7px] px-1 py-0">
              {SHOT_TYPE_LABELS[image.shot_type as ShotType] || image.shot_type}
            </Badge>
          )}
          {image.orientation && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-border/40">
              {getOrientationLabel(image.orientation)}
            </Badge>
          )}
        </div>

        {/* Always-visible action row */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-6 flex-1 text-[8px] gap-0.5 px-1"
            onClick={onExpand}>
            <Expand className="h-2.5 w-2.5" /> Expand
          </Button>
          <Button size="sm" variant="default"
            className="h-6 flex-1 text-[8px] gap-0.5 px-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={onApprove}>
            <CheckCircle className="h-2.5 w-2.5" /> Approve
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="destructive" className="h-6 flex-1 text-[8px] gap-0.5 px-1"
            onClick={onReject}>
            <XCircle className="h-2.5 w-2.5" /> Reject
          </Button>
          <Button size="sm" variant="outline" className="h-6 flex-1 text-[8px] gap-0.5 px-1"
            onClick={onRejectReuse}>
            <Recycle className="h-2.5 w-2.5" /> Reuse
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
