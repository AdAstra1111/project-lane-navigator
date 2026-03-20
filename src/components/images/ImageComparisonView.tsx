/**
 * ImageComparisonView — Side-by-side comparison of 2–4 images.
 * Used for identity consistency evaluation and canon selection.
 * Includes continuity classification, provenance badges, and recommendation summary.
 */
import { useState, useCallback, useMemo } from 'react';
import { X, Crown, XCircle, ZoomIn, ZoomOut, RotateCcw, ShieldCheck, ShieldAlert, AlertTriangle, Link, Unlink, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SHOT_TYPE_LABELS } from '@/lib/images/types';
import { type IdentityAnchorMap } from '@/lib/images/characterIdentityAnchorSet';
import { rankCharacterCandidates } from '@/lib/images/characterCandidateRanking';
import { getSimilarityLabel, getSimilarityColor, type VisualSimilarityResult } from '@/lib/images/anchorVisualSimilarity';
import type { ProjectImage, ShotType } from '@/lib/images/types';

// ── Continuity display helpers ──

const CONTINUITY_CONFIG: Record<string, { label: string; icon: typeof ShieldCheck; colorClass: string }> = {
  strong_match:      { label: 'Locked',     icon: ShieldCheck,  colorClass: 'text-emerald-400 border-emerald-500/40' },
  partial_match:     { label: 'Partial',    icon: Link,         colorClass: 'text-amber-400 border-amber-500/40' },
  no_anchor_context: { label: 'No Anchor',  icon: Unlink,       colorClass: 'text-white/40 border-white/20' },
  identity_drift:    { label: 'Drift Risk', icon: ShieldAlert,  colorClass: 'text-red-400 border-red-500/40' },
  unknown:           { label: 'Unknown',    icon: AlertTriangle, colorClass: 'text-white/30 border-white/15' },
};

function getProvenance(image: ProjectImage) {
  const gc = (image.generation_config || {}) as Record<string, unknown>;
  const locked = !!gc.identity_locked;
  const anchorPaths = gc.identity_anchor_paths as Record<string, string> | undefined;
  const usedSlots: string[] = [];
  if (anchorPaths) {
    if (anchorPaths.headshot) usedSlots.push('H');
    if (anchorPaths.profile) usedSlots.push('P');
    if (anchorPaths.fullBody || anchorPaths.full_body) usedSlots.push('FB');
  }
  return { locked, usedSlots, hasAnchors: usedSlots.length > 0 };
}

// ── Props ──

interface ImageComparisonViewProps {
  images: ProjectImage[];
  open: boolean;
  onClose: () => void;
  onSetPrimary?: (image: ProjectImage) => void;
  onReject?: (imageId: string) => void;
  /** Optional scores per image id */
  scores?: Record<string, number>;
  /** Identity anchor map for continuity classification */
  identityAnchorMap?: IdentityAnchorMap;
  /** Optional per-image visual similarity results */
  visualSimilarities?: Record<string, VisualSimilarityResult>;
}

export function ImageComparisonView({
  images, open, onClose, onSetPrimary, onReject, scores, identityAnchorMap, visualSimilarities,
}: ImageComparisonViewProps) {
  const [syncZoom, setSyncZoom] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [showSummary, setShowSummary] = useState(true);

  const resetZoom = useCallback(() => setZoom(1), []);

  // Use canonical ranking helper for character candidates
  const characterAnchorSet = useMemo(() => {
    const firstChar = images.find(i => i.asset_group === 'character' && i.subject);
    if (!firstChar?.subject || !identityAnchorMap) return null;
    return identityAnchorMap[firstChar.subject] || null;
  }, [images, identityAnchorMap]);

  const ranking = useMemo(() => {
    const isCharacterSet = images.some(i => i.asset_group === 'character');
    if (isCharacterSet) {
      return rankCharacterCandidates(images, characterAnchorSet, scores ?? undefined, visualSimilarities ?? null);
    }
    // Non-character: simple score-based ranking
    const ranked = images.map(img => ({
      image: img,
      continuityStatus: 'unknown' as const,
      continuityReason: 'Non-character image',
      driftPenalty: 0,
      score: scores?.[img.id] ?? null,
      visualSimilarity: null,
      similarityAdjustment: 0,
      driftPenalty: 0,
      score: scores?.[img.id] ?? null,
      rankValue: scores?.[img.id] ?? 0,
      rankReason: 'default ranking',
    }));
    ranked.sort((a, b) => (b.rankValue) - (a.rankValue));
    return { ranked, top: ranked[0] || null, topReason: ranked[0]?.rankReason || 'No candidates' };
  }, [images, characterAnchorSet, scores]);

  // Compute per-image analysis with rank reason from canonical helper
  const analysis = useMemo(() => {
    return ranking.ranked.map(rc => ({
      image: rc.image,
      continuity: { status: rc.continuityStatus, reason: rc.continuityReason },
      provenance: getProvenance(rc.image),
      score: rc.score,
      rankReason: rc.rankReason,
      driftPenalty: rc.driftPenalty,
    }));
  }, [ranking]);

  const recommended = useMemo(() => {
    if (!ranking.top) return analysis[0] || null;
    return analysis.find(a => a.image.id === ranking.top!.image.id) || analysis[0] || null;
  }, [ranking, analysis]);

  // Summary diagnostics
  const summary = useMemo(() => {
    const isCharacterSet = analysis.some(a => a.image.asset_group === 'character');
    const statuses = analysis.map(a => a.continuity.status);
    const hasDrift = statuses.includes('identity_drift');
    const allStrong = statuses.every(s => s === 'strong_match');
    const allNoAnchor = statuses.every(s => s === 'no_anchor_context' || s === 'unknown');

    let continuityLabel = 'Mixed';
    let continuityColor = 'text-amber-400';
    if (allStrong) { continuityLabel = 'Strong'; continuityColor = 'text-emerald-400'; }
    else if (allNoAnchor) { continuityLabel = 'No anchor context'; continuityColor = 'text-white/40'; }
    else if (hasDrift) { continuityLabel = 'Drift detected'; continuityColor = 'text-red-400'; }

    const mainRisk = hasDrift
      ? 'One or more candidates generated without identity anchors'
      : allNoAnchor
        ? 'No identity anchors available for comparison'
        : null;

    return { isCharacterSet, continuityLabel, continuityColor, mainRisk, recommendedId: recommended.image.id };
  }, [analysis, recommended]);

  const gridCols = images.length <= 2 ? 'grid-cols-2' : images.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';

  return (
    <Dialog open={open && images.length >= 2} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-[90vh] p-0 bg-black border-none rounded-lg overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Image comparison</DialogTitle>

        {/* Toolbar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-white/60">{images.length} images</span>
            {syncZoom && (
              <>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => setZoom(z => Math.min(4, z + 0.5))}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={() => setZoom(z => Math.max(1, z - 0.5))}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={resetZoom}>
                  <RotateCcw className="h-3 w-3" />
                </Button>
                <span className="text-[10px] text-white/40 tabular-nums">{Math.round(zoom * 100)}%</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {summary.isCharacterSet && (
              <Button size="sm" variant="ghost"
                className={cn('h-7 text-[10px] px-2 text-white/70 hover:text-white hover:bg-white/10', showSummary && 'bg-white/10 text-white')}
                onClick={() => setShowSummary(v => !v)}>
                {showSummary ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                Summary
              </Button>
            )}
            <Button size="sm" variant="ghost"
              className={cn('h-7 text-[10px] px-2 text-white/70 hover:text-white hover:bg-white/10', syncZoom && 'bg-white/10 text-white')}
              onClick={() => setSyncZoom(v => !v)}>
              {syncZoom ? 'Sync Zoom' : 'Independent'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
              onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Comparison Summary Bar */}
        {summary.isCharacterSet && showSummary && (
          <div className="absolute top-10 left-0 right-0 z-10 px-3 py-1.5 bg-black/80 border-b border-white/10">
            <div className="flex items-center gap-3 flex-wrap text-[10px]">
              <span className="text-white/50">Continuity:</span>
              <span className={cn('font-medium', summary.continuityColor)}>{summary.continuityLabel}</span>

              <span className="text-white/20">|</span>

              <span className="text-white/50">Recommended:</span>
              <span className="text-white/80 font-medium">
                {recommended.image.subject || 'Candidate'} — {SHOT_TYPE_LABELS[(recommended.image.shot_type as ShotType)] || recommended.image.shot_type || 'unknown'}
              </span>
              {ranking.topReason && (
                <span className="text-white/40 text-[9px] italic">{ranking.topReason}</span>
              )}
              {recommended.score != null && (
                <span className="text-white/40 tabular-nums">({recommended.score.toFixed(2)})</span>
              )}

              {summary.mainRisk && (
                <>
                  <span className="text-white/20">|</span>
                  <span className="text-red-400/80 flex items-center gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {summary.mainRisk}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Comparison grid */}
        <div className={cn(
          'w-full h-full pb-2 px-2 grid gap-2',
          gridCols,
          summary.isCharacterSet && showSummary ? 'pt-[4.5rem]' : 'pt-12',
        )}>
          {analysis.map(entry => (
            <ComparisonCell
              key={entry.image.id}
              image={entry.image}
              zoom={syncZoom ? zoom : undefined}
              score={entry.score}
              continuity={entry.continuity}
              provenance={entry.provenance}
              isRecommended={entry.image.id === summary.recommendedId}
              rankReason={entry.rankReason}
              driftPenalty={entry.driftPenalty}
              onSetPrimary={onSetPrimary}
              onReject={onReject}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Comparison Cell ──

function ComparisonCell({
  image, zoom: syncedZoom, score, continuity, provenance, isRecommended, rankReason, driftPenalty, onSetPrimary, onReject,
}: {
  image: ProjectImage;
  zoom?: number;
  score: number | null;
  continuity: { status: string; reason: string };
  provenance: { locked: boolean; usedSlots: string[]; hasAnchors: boolean };
  isRecommended: boolean;
  rankReason?: string;
  driftPenalty?: number;
  onSetPrimary?: (img: ProjectImage) => void;
  onReject?: (id: string) => void;
}) {
  const [localZoom, setLocalZoom] = useState(1);
  const effectiveZoom = syncedZoom ?? localZoom;

  const config = CONTINUITY_CONFIG[continuity.status] || CONTINUITY_CONFIG.unknown;
  const ContinuityIcon = config.icon;

  return (
    <div className={cn(
      'relative flex flex-col rounded-md overflow-hidden border transition-colors',
      isRecommended
        ? 'bg-emerald-950/30 border-emerald-500/40'
        : 'bg-black/50 border-white/10',
    )}>
      {/* Recommended indicator */}
      {isRecommended && (
        <div className="absolute top-1 right-1 z-10">
          <Badge className="text-[8px] px-1.5 py-0 gap-0.5 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
            <Star className="h-2.5 w-2.5" />
            Top
          </Badge>
        </div>
      )}

      {/* Image area */}
      <div className="flex-1 overflow-hidden flex items-center justify-center"
        onDoubleClick={() => !syncedZoom && setLocalZoom(z => z === 1 ? 2.5 : 1)}>
        {image.signedUrl ? (
          <img
            src={image.signedUrl}
            alt=""
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `scale(${effectiveZoom})`,
              transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20 text-xs">No image</div>
        )}
      </div>

      {/* Bottom info panel */}
      <div className="px-2 py-1.5 bg-black/60 space-y-1">
        {/* Row 1: shot type, subject, score, dims */}
        <div className="flex items-center gap-1 flex-wrap">
          {image.shot_type && (
            <Badge variant="secondary" className="text-[8px] bg-white/10 text-white/80 border-0 px-1 py-0">
              {SHOT_TYPE_LABELS[image.shot_type as ShotType] || image.shot_type}
            </Badge>
          )}
          {image.subject && (
            <Badge variant="outline" className="text-[8px] border-white/20 text-white/60 px-1 py-0">
              {image.subject}
            </Badge>
          )}
          {score != null && (
            <Badge variant="outline" className="text-[8px] border-white/20 text-white/50 px-1 py-0 tabular-nums">
              {score.toFixed(2)}
            </Badge>
          )}
          {image.width && image.height && (
            <span className="text-[8px] text-white/30 tabular-nums ml-auto">{image.width}×{image.height}</span>
          )}
        </div>

        {/* Row 2: continuity + provenance */}
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className={cn('text-[8px] px-1 py-0 gap-0.5', config.colorClass)}>
            <ContinuityIcon className="h-2.5 w-2.5" />
            {config.label}
          </Badge>
          {provenance.locked && (
            <span className="text-[8px] text-emerald-400/70">🔒</span>
          )}
          {provenance.hasAnchors && (
            <span className="text-[8px] text-white/40">Anchors: {provenance.usedSlots.join('+')}</span>
          )}
        </div>

        {/* Row 3: rank reason from canonical helper */}
        {rankReason && (
          <p className="text-[7px] text-white/35 italic truncate" title={rankReason}>
            {isRecommended ? '★ ' : ''}{rankReason}
            {driftPenalty != null && driftPenalty < 0 && (
              <span className="text-red-400/60 ml-1">({driftPenalty})</span>
            )}
          </p>
        )}

        {/* Row 4: actions */}
        <div className="flex items-center gap-1">
          {onSetPrimary && (
            <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5 text-white/70 hover:text-white hover:bg-white/10 px-1.5"
              onClick={() => onSetPrimary(image)}>
              <Crown className="h-3 w-3" /> Primary
            </Button>
          )}
          {onReject && (
            <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-0.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10 px-1.5"
              onClick={() => onReject(image.id)}>
              <XCircle className="h-3 w-3" /> Reject
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
