/**
 * ApprovalWorkspace — Visual Decision Workspace replacing the simple approval queue.
 * Supports list view, character-grouped view, image lightbox, and side-by-side comparison.
 * Identity-aware: displays anchor continuity status per character candidate.
 */
import { useState, useMemo, useCallback } from 'react';
import type { VisualSimilarityResult } from '@/lib/images/anchorVisualSimilarity';
import {
  CheckCircle, XCircle, Recycle, Eye, Expand, LayoutGrid, List,
  Users, ChevronRight, Crown, Link, Unlink, AlertTriangle, ShieldCheck,
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
  /** DNA traits per character name */
  dnaTraitsByCharacter?: Record<string, Array<{ label: string; value: string; region?: string }>>;
  /** Identity anchor map for continuity classification */
  identityAnchorMap?: IdentityAnchorMap;
  /** Cached visual similarity results keyed by image id */
  visualSimilarities?: Record<string, VisualSimilarityResult>;
}

export function ApprovalWorkspace({
  slots, onApprove, onReject, onSetPrimary, dnaTraitsByCharacter, identityAnchorMap, visualSimilarities,
}: ApprovalWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [lightboxImage, setLightboxImage] = useState<ProjectImage | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<ProjectImage[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const pendingSlots = useMemo(() => slots.filter(s => !s.filled && s.candidates.length > 0), [slots]);

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
              onApprove={onApprove}
              onReject={onReject}
              onExpand={setLightboxImage}
              onToggleCompare={toggleCompareSelect}
              selectedForCompare={selectedForCompare}
              identityAnchorMap={identityAnchorMap}
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
  slot, onApprove, onReject, onExpand, onToggleCompare, selectedForCompare, identityAnchorMap,
}: {
  slot: RequiredSlot;
  onApprove: (img: ProjectImage) => void;
  onReject: (id: string, markReuse: boolean) => void;
  onExpand: (img: ProjectImage) => void;
  onToggleCompare: (img: ProjectImage) => void;
  selectedForCompare: ProjectImage[];
  identityAnchorMap?: IdentityAnchorMap;
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
              identityContinuity={img.asset_group === 'character' && img.subject ? classifyIdentityContinuity(img, identityAnchorMap?.[img.subject] || null) : undefined}
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
    <div className="rounded-md border border-border/40 bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/30">
        <Users className="h-3 w-3 text-primary/70" />
        <span className="text-[10px] font-semibold text-foreground">{characterName}</span>
        <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto">
          {slots.reduce((a, s) => a + s.candidates.length, 0)} candidates
        </Badge>
      </div>

      <div className="px-2 py-1.5 space-y-2">
        {Object.entries(slotsByType).map(([shotKey, groupSlots]) => (
          <div key={shotKey}>
            <p className="text-[8px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              {SHOT_TYPE_LABELS[shotKey as ShotType] || shotKey}
            </p>
            <ScrollArea className="w-full">
              <div className="flex gap-1.5 pb-1">
                {groupSlots.flatMap(slot => slot.candidates).map(img => (
                  <div key={img.id} className="shrink-0 w-24">
                    <CandidateCard
                      image={img}
                      isRecommended={groupSlots.some(s => s.recommended?.id === img.id)}
                      isSelectedForCompare={selectedForCompare.some(c => c.id === img.id)}
                      identityContinuity={img.subject ? classifyIdentityContinuity(img, identityAnchorMap?.[img.subject] || null) : undefined}
                      rankReason={groupSlots.find(s => s.recommended?.id === img.id)?.recommendedReason ?? undefined}
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

// ── Candidate Card ──

function CandidateCard({
  image, isRecommended, isSelectedForCompare, compact, identityContinuity, rankReason,
  onApprove, onReject, onRejectReuse, onExpand, onToggleCompare,
}: {
  image: ProjectImage;
  isRecommended: boolean;
  isSelectedForCompare: boolean;
  compact?: boolean;
  identityContinuity?: { status: IdentityContinuityStatus; reason: string };
  rankReason?: string;
  onApprove: () => void;
  onReject: () => void;
  onRejectReuse: () => void;
  onExpand: () => void;
  onToggleCompare: () => void;
}) {
  return (
    <div className={cn(
      'rounded-md overflow-hidden border-2 transition-all flex flex-col',
      isSelectedForCompare
        ? 'border-accent ring-1 ring-accent/40'
        : isRecommended
          ? 'border-primary/60 ring-1 ring-primary/20'
          : 'border-border/40',
    )}>
      {/* Image area */}
      <div
        className={cn(
          'relative cursor-pointer',
          getDisplayAspectClass(image.width, image.height),
        )}
        onClick={onExpand}
      >
        {image.signedUrl ? (
          <img src={image.signedUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Eye className="h-3 w-3 text-muted-foreground/30" />
          </div>
        )}

        {/* Recommended badge with rank reason tooltip */}
        {isRecommended && (
          <Badge className="absolute top-0.5 left-0.5 text-[7px] px-1 py-0 bg-primary/80 text-primary-foreground gap-0.5"
            title={rankReason || 'Recommended candidate'}>
            <Crown className="h-2 w-2" /> Top
          </Badge>
        )}

        {/* Identity continuity badge — uses canonical anchor-based classification */}
        {(() => {
          const isChar = image.asset_group === 'character';
          if (!isChar || !identityContinuity) return null;
          const { status, reason } = identityContinuity;
          switch (status) {
            case 'strong_match':
              return (
                <Badge className="absolute top-0.5 right-6 text-[7px] px-1 py-0 bg-emerald-500/70 text-white gap-0.5"
                  title={reason}>
                  <ShieldCheck className="h-2 w-2" /> Locked
                </Badge>
              );
            case 'partial_match':
              return (
                <Badge className="absolute top-0.5 right-6 text-[7px] px-1 py-0 bg-blue-500/70 text-white gap-0.5"
                  title={reason}>
                  <Link className="h-2 w-2" /> Partial
                </Badge>
              );
            case 'identity_drift':
              return (
                <Badge className="absolute top-0.5 right-6 text-[7px] px-1 py-0 bg-destructive/70 text-white gap-0.5"
                  title={reason}>
                  <AlertTriangle className="h-2 w-2" /> Drift
                </Badge>
              );
            case 'no_anchor_context':
              return (
                <Badge className="absolute top-0.5 right-6 text-[7px] px-1 py-0 bg-amber-500/70 text-white gap-0.5"
                  title={reason}>
                  <Unlink className="h-2 w-2" /> No Anchor
                </Badge>
              );
            default:
              return null;
          }
        })()}

        {/* Compare selection indicator */}
        {isSelectedForCompare && (
          <Badge className="absolute top-0.5 right-0.5 text-[7px] px-1 py-0 bg-accent text-accent-foreground">
            ✓
          </Badge>
        )}

        {/* Orientation label */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
          <p className="text-[7px] text-white/70 truncate">
            {getOrientationLabel(image.width, image.height)}
            {image.width && image.height ? ` ${image.width}×${image.height}` : ''}
          </p>
          {/* Anchor provenance — grounded in actual generation_config */}
          {(() => {
            if (image.asset_group !== 'character') return null;
            const gc = (image.generation_config || {}) as Record<string, unknown>;
            const locked = !!gc.identity_locked;
            const anchorPaths = gc.identity_anchor_paths as Record<string, string> | undefined;
            const usedSlots: string[] = [];
            if (anchorPaths) {
              if (anchorPaths.headshot) usedSlots.push('H');
              if (anchorPaths.fullBody) usedSlots.push('FB');
            }
            if (!locked && usedSlots.length === 0) return null;
            return (
              <p className="text-[6px] text-white/50 truncate mt-px">
                {locked ? '🔒 Lock' : ''}
                {usedSlots.length > 0 ? `${locked ? ' · ' : ''}Anchors: ${usedSlots.join('+')}` : ''}
              </p>
            );
          })()}
        </div>
      </div>

      {/* Persistent action bar — always visible */}
      <div className={cn(
        'flex items-center bg-muted/40 border-t border-border/30',
        compact ? 'gap-0.5 px-0.5 py-0.5' : 'gap-1 px-1 py-1',
      )}>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'flex-1 gap-0.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10',
            compact ? 'h-5 text-[7px] px-0.5' : 'h-6 text-[8px] px-1',
          )}
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
        >
          <CheckCircle className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          {!compact && 'Approve'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'flex-1 gap-0.5 text-destructive hover:text-destructive hover:bg-destructive/10',
            compact ? 'h-5 text-[7px] px-0.5' : 'h-6 text-[8px] px-1',
          )}
          onClick={(e) => { e.stopPropagation(); onReject(); }}
        >
          <XCircle className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          {!compact && 'Reject'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'gap-0.5 text-muted-foreground hover:text-foreground',
            compact ? 'h-5 w-5 p-0' : 'h-6 w-6 p-0',
          )}
          onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          title={isSelectedForCompare ? 'Deselect' : 'Select for compare'}
        >
          <LayoutGrid className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        </Button>
      </div>
    </div>
  );
}
