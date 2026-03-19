/**
 * VisualSetCurationPanel — Slot-based visual set curation UI.
 * Grid of slots with evaluation badges, approve/reject/replace per slot, global controls.
 */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Lock, CheckCircle, AlertTriangle, XCircle, RotateCcw,
  ShieldCheck, Grid3X3, Loader2, ChevronDown, ChevronRight,
  Image as ImageIcon, Replace, Archive, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ImageEvaluationOverlay } from './ImageEvaluationBadge';
import {
  useVisualSets,
  getSlotsForDomain,
  type VisualSet,
  type VisualSetSlot,
  type VisualSetCandidate,
  type VisualSetStatus,
} from '@/hooks/useVisualSets';
import { useImageEvaluation } from '@/hooks/useImageEvaluation';
import { useProjectImages } from '@/hooks/useProjectImages';

// ── Status Config ──

const SET_STATUS_CONFIG: Record<VisualSetStatus, { color: string; label: string; icon: typeof CheckCircle }> = {
  draft: { color: 'text-muted-foreground', label: 'Draft', icon: Grid3X3 },
  autopopulated: { color: 'text-blue-500', label: 'Autopopulated', icon: Grid3X3 },
  curating: { color: 'text-amber-500', label: 'Curating', icon: Grid3X3 },
  ready_to_lock: { color: 'text-emerald-500', label: 'Ready to Lock', icon: ShieldCheck },
  locked: { color: 'text-emerald-600', label: 'Locked', icon: Lock },
  stale: { color: 'text-destructive', label: 'Stale', icon: AlertTriangle },
  archived: { color: 'text-muted-foreground', label: 'Archived', icon: Archive },
};

const SLOT_STATE_ICONS: Record<string, { icon: typeof CheckCircle; color: string }> = {
  empty: { icon: Plus, color: 'text-muted-foreground' },
  candidate_present: { icon: ImageIcon, color: 'text-blue-500' },
  approved: { icon: CheckCircle, color: 'text-emerald-500' },
  needs_replacement: { icon: RotateCcw, color: 'text-amber-500' },
  locked: { icon: Lock, color: 'text-emerald-600' },
};

// ── Main Panel ──

interface Props {
  projectId: string;
  domain?: string;
  targetName?: string;
}

export function VisualSetCurationPanel({ projectId, domain, targetName }: Props) {
  const vs = useVisualSets(projectId);
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null);

  const filteredSets = useMemo(() => {
    let sets = vs.sets;
    if (domain) sets = sets.filter(s => s.domain === domain);
    if (targetName) sets = sets.filter(s => s.target_name === targetName);
    return sets;
  }, [vs.sets, domain, targetName]);

  const activeSets = filteredSets.filter(s => s.status !== 'archived');
  const archivedSets = filteredSets.filter(s => s.status === 'archived');

  if (vs.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Loading visual sets...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Visual Sets</span>
          <Badge variant="secondary" className="text-[9px]">
            {activeSets.length} active
          </Badge>
        </div>
      </div>

      {activeSets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-muted-foreground mb-2">
              No visual sets yet. Run autopopulate or create a set manually.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activeSets.map(set => (
            <VisualSetCard
              key={set.id}
              projectId={projectId}
              set={set}
              expanded={expandedSetId === set.id}
              onToggle={() => setExpandedSetId(expandedSetId === set.id ? null : set.id)}
              vs={vs}
            />
          ))}
        </div>
      )}

      {archivedSets.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground">
            <Archive className="h-3 w-3" /> {archivedSets.length} archived set(s)
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {archivedSets.map(set => (
              <VisualSetCard
                key={set.id}
                projectId={projectId}
                set={set}
                expanded={expandedSetId === set.id}
                onToggle={() => setExpandedSetId(expandedSetId === set.id ? null : set.id)}
                vs={vs}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── Set Card ──

function VisualSetCard({
  projectId,
  set,
  expanded,
  onToggle,
  vs,
}: {
  projectId: string;
  set: VisualSet;
  expanded: boolean;
  onToggle: () => void;
  vs: ReturnType<typeof useVisualSets>;
}) {
  const statusCfg = SET_STATUS_CONFIG[set.status] || SET_STATUS_CONFIG.draft;
  const StatusIcon = statusCfg.icon;

  return (
    <Card className={cn(
      'transition-all',
      set.status === 'locked' && 'border-emerald-500/30',
      set.status === 'stale' && 'border-destructive/30',
      set.status === 'ready_to_lock' && 'border-emerald-500/20',
    )}>
      <button
        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
        onClick={onToggle}
      >
        <StatusIcon className={cn('h-4 w-4 shrink-0', statusCfg.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{set.target_name}</span>
            <Badge variant="outline" className="text-[8px] px-1 py-0">{set.domain}</Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-[10px] font-medium', statusCfg.color)}>{statusCfg.label}</span>
            <span className="text-[9px] text-muted-foreground">
              {set.required_slot_count} required slot{set.required_slot_count !== 1 ? 's' : ''}
            </span>
            {set.current_dna_version_id && (
              <Badge className="text-[7px] px-1 py-0 bg-primary/10 text-primary border-primary/20">DNA linked</Badge>
            )}
          </div>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <VisualSetSlotGrid projectId={projectId} set={set} vs={vs} />
      )}
    </Card>
  );
}

// ── Slot Grid ──

function VisualSetSlotGrid({
  projectId,
  set,
  vs,
}: {
  projectId: string;
  set: VisualSet;
  vs: ReturnType<typeof useVisualSets>;
}) {
  const [slots, setSlots] = useState<VisualSetSlot[]>([]);
  const [candidates, setCandidates] = useState<VisualSetCandidate[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const { getEvaluation } = useImageEvaluation(projectId);
  const { data: allImages = [] } = useProjectImages(projectId, { activeOnly: false, curationStates: ['active', 'candidate'] });

  // Load slots and candidates
  useState(() => {
    (async () => {
      try {
        const [s, c] = await Promise.all([
          vs.fetchSlotsForSet(set.id),
          vs.fetchCandidatesForSet(set.id),
        ]);
        setSlots(s);
        setCandidates(c);
      } finally {
        setLoadingSlots(false);
      }
    })();
  });

  const candidatesBySlot = useMemo(() => {
    const map = new Map<string, VisualSetCandidate[]>();
    for (const c of candidates) {
      const arr = map.get(c.visual_set_slot_id) || [];
      arr.push(c);
      map.set(c.visual_set_slot_id, arr);
    }
    return map;
  }, [candidates]);

  const imageMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const img of allImages) {
      map.set(img.id, img);
    }
    return map;
  }, [allImages]);

  const isLocked = set.status === 'locked';
  const unresolvedSlots = slots.filter(s => s.state === 'empty' || s.state === 'needs_replacement');
  const approvedCount = slots.filter(s => s.state === 'approved' || s.state === 'locked').length;

  if (loadingSlots) {
    return <div className="px-3 pb-3"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="px-3 pb-3 space-y-3 border-t border-border/40">
      {/* Global Controls */}
      {!isLocked && (
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] gap-1"
            onClick={() => vs.approveAllSafe.mutate({ setId: set.id })}
            disabled={vs.approveAllSafe.isPending}
          >
            {vs.approveAllSafe.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            Approve All Safe
          </Button>

          {unresolvedSlots.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-[9px]">
                    {unresolvedSlots.length} unresolved
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="text-[9px]">
                  {unresolvedSlots.map(s => s.slot_label).join(', ')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {set.status === 'ready_to_lock' && (
            <Button
              size="sm"
              className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => vs.lockSet.mutate(set.id)}
              disabled={vs.lockSet.isPending}
            >
              {vs.lockSet.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Lock className="h-3 w-3" />
              )}
              Lock Set
            </Button>
          )}

          {set.status === 'stale' && (
            <Badge className="text-[9px] bg-destructive/15 text-destructive border-destructive/30">
              <AlertTriangle className="h-3 w-3 mr-0.5" /> DNA changed — re-evaluate required
            </Badge>
          )}

          <span className="text-[9px] text-muted-foreground ml-auto">
            {approvedCount}/{slots.length} approved
          </span>
        </div>
      )}

      {/* Slot Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {slots.map(slot => (
          <SlotCard
            key={slot.id}
            slot={slot}
            candidates={candidatesBySlot.get(slot.id) || []}
            imageMap={imageMap}
            getEvaluation={getEvaluation}
            isSetLocked={isLocked}
            onDeselect={() => vs.deselectSlot.mutate({ slotId: slot.id })}
            onSelectCandidate={(candidateId, imageId) => vs.selectCandidate.mutate({ slotId: slot.id, candidateId, imageId })}
          />
        ))}
      </div>
    </div>
  );
}

// ── Slot Card ──

function SlotCard({
  slot,
  candidates,
  imageMap,
  getEvaluation,
  isSetLocked,
  onDeselect,
  onSelectCandidate,
}: {
  slot: VisualSetSlot;
  candidates: VisualSetCandidate[];
  imageMap: Map<string, any>;
  getEvaluation: (imageId: string) => any;
  isSetLocked: boolean;
  onDeselect: () => void;
  onSelectCandidate: (candidateId: string, imageId: string) => void;
}) {
  const [showCandidates, setShowCandidates] = useState(false);
  const stateConfig = SLOT_STATE_ICONS[slot.state] || SLOT_STATE_ICONS.empty;
  const StateIcon = stateConfig.icon;

  const selectedImage = slot.selected_image_id ? imageMap.get(slot.selected_image_id) : null;
  const evaluation = slot.selected_image_id ? getEvaluation(slot.selected_image_id) : null;
  const otherCandidates = candidates.filter(c => !c.selected_for_slot && c.producer_decision !== 'rejected');

  return (
    <Card className={cn(
      'relative overflow-hidden transition-all',
      slot.state === 'approved' && 'border-emerald-500/30',
      slot.state === 'locked' && 'border-emerald-600/40',
      slot.state === 'needs_replacement' && 'border-amber-500/30',
      !slot.is_required && 'opacity-80',
    )}>
      <CardContent className="p-2">
        {/* Header */}
        <div className="flex items-center gap-1 mb-1.5">
          <StateIcon className={cn('h-3 w-3', stateConfig.color)} />
          <span className="text-[9px] font-medium text-foreground truncate flex-1">{slot.slot_label}</span>
          {slot.is_required && (
            <Badge className="text-[6px] px-0.5 py-0 bg-primary/10 text-primary border-primary/20">REQ</Badge>
          )}
        </div>

        {/* Image Preview */}
        {selectedImage?.signedUrl ? (
          <div className="relative aspect-[4/3] rounded overflow-hidden mb-1.5 bg-muted">
            <img
              src={selectedImage.signedUrl}
              alt={slot.slot_label}
              className="w-full h-full object-cover"
            />
            {evaluation && <ImageEvaluationOverlay evaluation={evaluation} />}
          </div>
        ) : (
          <div className="aspect-[4/3] rounded border-2 border-dashed border-border/50 bg-muted/30 flex items-center justify-center mb-1.5">
            <div className="text-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground/40 mx-auto" />
              <span className="text-[8px] text-muted-foreground/40 block mt-0.5">
                {slot.state === 'needs_replacement' ? 'Needs replacement' : 'Empty slot'}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        {!isSetLocked && (
          <div className="flex items-center gap-1">
            {slot.selected_image_id && slot.state !== 'locked' && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={onDeselect}
                    >
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-[9px]">Deselect / Replace</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {otherCandidates.length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => setShowCandidates(!showCandidates)}
                    >
                      <Replace className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-[9px]">{otherCandidates.length} candidate(s)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {slot.replacement_count > 0 && (
              <span className="text-[7px] text-muted-foreground ml-auto">
                ×{slot.replacement_count} replaced
              </span>
            )}
          </div>
        )}

        {/* Candidate Strip */}
        {showCandidates && otherCandidates.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mt-1.5 pt-1.5 border-t border-border/30"
          >
            <p className="text-[8px] text-muted-foreground mb-1">Other candidates:</p>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {otherCandidates.map(c => {
                const img = imageMap.get(c.image_id);
                return (
                  <button
                    key={c.id}
                    className="shrink-0 w-10 h-10 rounded overflow-hidden border border-border/50 hover:border-primary/50 transition-colors"
                    onClick={() => onSelectCandidate(c.id, c.image_id)}
                  >
                    {img?.signedUrl ? (
                      <img src={img.signedUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <ImageIcon className="h-3 w-3 text-muted-foreground/40" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
