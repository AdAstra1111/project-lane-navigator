/**
 * CastingStudio — Project-level casting board for reviewing, shortlisting,
 * comparing, and promoting casting candidates into permanent AI Actors.
 */
import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Users, Sparkles, Star, StarOff, X, Check, Loader2, Eye, ArrowLeft,
  ChevronRight, RefreshCw, Crown, Maximize2, XCircle, Filter, LayoutGrid,
  UserPlus, Columns, Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { aiCastApi } from '@/lib/aiCast/aiCastApi';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// ── Types ───────────────────────────────────────────────────────────────────

type CandidateStatus = 'generated' | 'shortlisted' | 'rejected' | 'promoted';

interface CastingCandidate {
  id: string;
  project_id: string;
  user_id: string;
  character_key: string;
  batch_id: string;
  status: CandidateStatus;
  display_name: string | null;
  headshot_url: string | null;
  full_body_url: string | null;
  additional_refs: string[];
  generation_config: Record<string, any>;
  promoted_actor_id: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<CandidateStatus, { label: string; color: string; icon: React.ElementType }> = {
  generated:   { label: 'New',        color: 'bg-muted text-muted-foreground',          icon: Sparkles },
  shortlisted: { label: 'Shortlisted', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Star },
  rejected:    { label: 'Rejected',    color: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  promoted:    { label: 'Promoted',    color: 'bg-primary/15 text-primary border-primary/30', icon: Crown },
};

// ── Main Page ───────────────────────────────────────────────────────────────

export default function CastingStudio() {
  const { id: projectId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState<CandidateStatus | 'all'>('all');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promoteDialogIds, setPromoteDialogIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Fetch candidates ──
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['casting-candidates', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('casting_candidates')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CastingCandidate[];
    },
    enabled: !!projectId,
  });

  // ── Fetch characters ──
  const { data: characters = [] } = useQuery({
    queryKey: ['casting-characters', projectId],
    queryFn: async () => {
      const { data: canonChars } = await supabase
        .from('canon_facts')
        .select('subject')
        .eq('project_id', projectId!)
        .eq('fact_type', 'character')
        .eq('is_active', true);
      const unique = [...new Set((canonChars || []).map((d: any) => d.subject))];
      if (unique.length > 0) return unique as string[];
      // Fallback
      const { data: imageSubjects } = await (supabase as any)
        .from('project_images')
        .select('subject')
        .eq('project_id', projectId!)
        .in('shot_type', ['identity_headshot', 'identity_full_body'])
        .not('subject', 'is', null);
      return [...new Set((imageSubjects || []).map((d: any) => d.subject).filter(Boolean))] as string[];
    },
    enabled: !!projectId,
  });

  // ── Generate candidates ──
  const handleGenerate = useCallback(async (characterFilter?: string) => {
    if (!projectId || !user?.id) return;
    setIsGenerating(true);
    const toastId = toast.loading(
      characterFilter
        ? `Generating casting options for ${characterFilter}...`
        : 'Generating casting options for all characters...',
      { duration: 120000 }
    );
    try {
      const { data, error } = await supabase.functions.invoke('generate-casting-candidates', {
        body: { projectId, candidatesPerCharacter: 4, characterFilter },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes('credits') || data.error.includes('funds')) {
          toast.error('AI credits exhausted. Please add funds in Settings → Workspace → Usage.', { id: toastId });
        } else {
          toast.error(data.error, { id: toastId });
        }
        return;
      }
      toast.success(
        `Generated ${data.generated} candidate${data.generated !== 1 ? 's' : ''} across ${data.characters} character${data.characters !== 1 ? 's' : ''}${data.failed > 0 ? ` (${data.failed} failed)` : ''}`,
        { id: toastId }
      );
      invalidate();
    } catch (e: any) {
      toast.error(e.message || 'Generation failed', { id: toastId });
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, user?.id]);

  // ── Mutations ──
  const invalidate = () => qc.invalidateQueries({ queryKey: ['casting-candidates', projectId] });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CandidateStatus }) => {
      const { error } = await (supabase as any)
        .from('casting_candidates')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const batchUpdateStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: CandidateStatus }) => {
      const { error } = await (supabase as any)
        .from('casting_candidates')
        .update({ status })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(`${vars.ids.length} candidate(s) updated to ${vars.status}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCandidate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('casting_candidates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Candidate removed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Grouped by character ──
  const characterLanes = useMemo(() => {
    const laneMap = new Map<string, CastingCandidate[]>();
    // Initialize lanes from known characters
    for (const c of characters) laneMap.set(c, []);
    // Add candidates to lanes
    for (const cand of candidates) {
      if (!laneMap.has(cand.character_key)) laneMap.set(cand.character_key, []);
      const filtered = filterStatus === 'all' || cand.status === filterStatus;
      if (filtered) laneMap.get(cand.character_key)!.push(cand);
    }
    return laneMap;
  }, [candidates, characters, filterStatus]);

  // ── Summary stats ──
  const stats = useMemo(() => ({
    total: candidates.length,
    shortlisted: candidates.filter(c => c.status === 'shortlisted').length,
    promoted: candidates.filter(c => c.status === 'promoted').length,
    rejected: candidates.filter(c => c.status === 'rejected').length,
  }), [candidates]);

  const shortlistedIds = useMemo(
    () => candidates.filter(c => c.status === 'shortlisted').map(c => c.id),
    [candidates]
  );

  // ── Compare mode ──
  const toggleCompare = (id: string) => {
    setCompareIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]
    );
  };
  const compareCandidates = useMemo(
    () => compareIds.map(id => candidates.find(c => c.id === id)).filter(Boolean) as CastingCandidate[],
    [compareIds, candidates]
  );

  // ── Expanded candidate ──
  const expandedCandidate = expandedId ? candidates.find(c => c.id === expandedId) : null;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="space-y-1">
        <h1 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Casting Studio
        </h1>
        <p className="text-xs text-muted-foreground">
          Generate, review, and promote casting candidates for each character
        </p>
      </div>

      {/* ── Action Bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <Filter className="h-3 w-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Candidates</SelectItem>
            <SelectItem value="generated" className="text-xs">New</SelectItem>
            <SelectItem value="shortlisted" className="text-xs">Shortlisted</SelectItem>
            <SelectItem value="rejected" className="text-xs">Rejected</SelectItem>
            <SelectItem value="promoted" className="text-xs">Promoted</SelectItem>
          </SelectContent>
        </Select>

        {compareIds.length === 2 && (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setCompareIds([])}>
            <X className="h-3 w-3" /> Clear Compare
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => handleGenerate()}
            disabled={isGenerating || characters.length === 0}
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isGenerating ? 'Generating…' : 'Generate Casting'}
          </Button>
          {shortlistedIds.length > 0 && (
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setPromoteDialogIds(shortlistedIds)}
            >
              <Crown className="h-3.5 w-3.5" />
              Promote Shortlist ({shortlistedIds.length})
            </Button>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="flex items-center gap-5 text-[11px] text-muted-foreground">
        <span>{characters.length} character{characters.length !== 1 ? 's' : ''}</span>
        <span>{stats.total} candidate{stats.total !== 1 ? 's' : ''}</span>
        <span className="text-amber-400">{stats.shortlisted} shortlisted</span>
        <span className="text-primary">{stats.promoted} promoted</span>
      </div>

      {/* ── Compare Panel ── */}
      {compareIds.length === 2 && (
        <ComparePanel
          candidates={compareCandidates}
          onShortlist={(id) => updateStatus.mutate({ id, status: 'shortlisted' })}
          onReject={(id) => updateStatus.mutate({ id, status: 'rejected' })}
          onClose={() => setCompareIds([])}
        />
      )}

      {/* ── Character Lanes ── */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : characters.length === 0 ? (
        <EmptyState type="no_characters" />
      ) : (
        <div className="space-y-8">
          {Array.from(characterLanes.entries()).map(([charName, charCandidates]) => (
            <CharacterLane
              key={charName}
              characterName={charName}
              candidates={charCandidates}
              allCandidates={candidates.filter(c => c.character_key === charName)}
              onShortlist={(id) => updateStatus.mutate({ id, status: 'shortlisted' })}
              onReject={(id) => updateStatus.mutate({ id, status: 'rejected' })}
              onUndo={(id) => updateStatus.mutate({ id, status: 'generated' })}
              onExpand={setExpandedId}
              onToggleCompare={toggleCompare}
              compareIds={compareIds}
              onDelete={(id) => deleteCandidate.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* ── Expanded View Dialog ── */}
      <Dialog open={!!expandedCandidate} onOpenChange={() => setExpandedId(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {expandedCandidate && (
            <CandidateExpanded
              candidate={expandedCandidate}
              onShortlist={() => { updateStatus.mutate({ id: expandedCandidate.id, status: 'shortlisted' }); setExpandedId(null); }}
              onReject={() => { updateStatus.mutate({ id: expandedCandidate.id, status: 'rejected' }); setExpandedId(null); }}
              onPromote={() => { setPromoteDialogIds([expandedCandidate.id]); setExpandedId(null); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Promote Dialog ── */}
      <PromoteDialog
        open={promoteDialogIds.length > 0}
        candidateIds={promoteDialogIds}
        candidates={candidates}
        projectId={projectId!}
        userId={user?.id || ''}
        onClose={() => setPromoteDialogIds([])}
        onPromoted={() => {
          setPromoteDialogIds([]);
          invalidate();
          qc.invalidateQueries({ queryKey: ['ai-actors'] });
        }}
      />
    </div>
  );
}

// ── Character Lane ──────────────────────────────────────────────────────────

interface LaneProps {
  characterName: string;
  candidates: CastingCandidate[];
  allCandidates: CastingCandidate[];
  onShortlist: (id: string) => void;
  onReject: (id: string) => void;
  onUndo: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleCompare: (id: string) => void;
  compareIds: string[];
  onDelete: (id: string) => void;
}

function CharacterLane({
  characterName, candidates, allCandidates, onShortlist, onReject, onUndo, onExpand, onToggleCompare, compareIds, onDelete
}: LaneProps) {
  const shortlisted = allCandidates.filter(c => c.status === 'shortlisted').length;
  const promoted = allCandidates.filter(c => c.status === 'promoted').length;

  return (
    <div className="space-y-3">
      {/* Lane Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">{characterName}</h2>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">{allCandidates.length} total</span>
            {shortlisted > 0 && <Badge variant="outline" className="h-5 text-[10px] text-amber-400 border-amber-500/30">{shortlisted} ★</Badge>}
            {promoted > 0 && <Badge variant="outline" className="h-5 text-[10px] text-primary border-primary/30">{promoted} promoted</Badge>}
          </div>
        </div>
      </div>

      {/* Candidate Grid */}
      {candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 p-6 text-center">
          <Users className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground">No candidates {allCandidates.length > 0 ? 'matching filter' : 'yet'}</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {candidates.map(cand => (
            <CandidateCard
              key={cand.id}
              candidate={cand}
              isComparing={compareIds.includes(cand.id)}
              onShortlist={() => onShortlist(cand.id)}
              onReject={() => onReject(cand.id)}
              onUndo={() => onUndo(cand.id)}
              onExpand={() => onExpand(cand.id)}
              onToggleCompare={() => onToggleCompare(cand.id)}
              onDelete={() => onDelete(cand.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Candidate Card ──────────────────────────────────────────────────────────

interface CardProps {
  candidate: CastingCandidate;
  isComparing: boolean;
  onShortlist: () => void;
  onReject: () => void;
  onUndo: () => void;
  onExpand: () => void;
  onToggleCompare: () => void;
  onDelete: () => void;
}

function CandidateCard({ candidate, isComparing, onShortlist, onReject, onUndo, onExpand, onToggleCompare, onDelete }: CardProps) {
  const cfg = STATUS_CONFIG[candidate.status];
  const thumbnail = candidate.headshot_url || candidate.full_body_url;
  const isActionable = candidate.status === 'generated' || candidate.status === 'shortlisted';

  return (
    <div
      className={cn(
        'group relative rounded-lg border overflow-hidden transition-all duration-200',
        isComparing
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border/40 hover:border-border/80',
        candidate.status === 'rejected' && 'opacity-50'
      )}
    >
      {/* Image */}
      <button onClick={onExpand} className="w-full aspect-[3/4] bg-muted/10 relative overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={candidate.display_name || candidate.character_key}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Users className="h-8 w-8 text-muted-foreground/20" />
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-1.5 left-1.5">
          <Badge className={cn('text-[9px] h-4 px-1.5 border', cfg.color)}>
            <cfg.icon className="h-2.5 w-2.5 mr-0.5" />
            {cfg.label}
          </Badge>
        </div>

        {/* Expand icon */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-background/80 backdrop-blur rounded p-1">
            <Maximize2 className="h-3 w-3 text-foreground" />
          </div>
        </div>

        {/* Compare indicator */}
        {isComparing && (
          <div className="absolute bottom-1.5 right-1.5">
            <div className="bg-primary text-primary-foreground rounded-full p-1">
              <Columns className="h-3 w-3" />
            </div>
          </div>
        )}
      </button>

      {/* Info + Actions */}
      <div className="p-2 space-y-1.5">
        {candidate.display_name && (
          <p className="text-[11px] font-medium text-foreground truncate">{candidate.display_name}</p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {candidate.status === 'generated' && (
            <>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onShortlist} title="Shortlist">
                <Star className="h-3 w-3 text-amber-400" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onReject} title="Reject">
                <XCircle className="h-3 w-3 text-destructive" />
              </Button>
            </>
          )}
          {candidate.status === 'shortlisted' && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onUndo} title="Remove from shortlist">
              <StarOff className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
          {(candidate.status === 'rejected') && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onUndo} title="Undo rejection">
              <RefreshCw className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={onToggleCompare} title="Compare">
            <Columns className={cn('h-3 w-3', isComparing ? 'text-primary' : 'text-muted-foreground')} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Compare Panel ───────────────────────────────────────────────────────────

function ComparePanel({
  candidates, onShortlist, onReject, onClose
}: {
  candidates: CastingCandidate[];
  onShortlist: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}) {
  if (candidates.length !== 2) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Columns className="h-4 w-4 text-primary" /> Compare Candidates
        </h3>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>
          <X className="h-3 w-3 mr-1" /> Close
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {candidates.map(cand => (
          <div key={cand.id} className="space-y-2">
            <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted/10">
              {cand.headshot_url ? (
                <img src={cand.headshot_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Users className="h-10 w-10 text-muted-foreground/20" />
                </div>
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-foreground">{cand.display_name || cand.character_key}</p>
              <Badge className={cn('text-[9px]', STATUS_CONFIG[cand.status].color)}>
                {STATUS_CONFIG[cand.status].label}
              </Badge>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onShortlist(cand.id)}>
                <Star className="h-3 w-3 text-amber-400" /> Shortlist
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onReject(cand.id)}>
                <XCircle className="h-3 w-3 text-destructive" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Expanded Candidate Dialog Content ───────────────────────────────────────

function CandidateExpanded({
  candidate, onShortlist, onReject, onPromote
}: {
  candidate: CastingCandidate;
  onShortlist: () => void;
  onReject: () => void;
  onPromote: () => void;
}) {
  const cfg = STATUS_CONFIG[candidate.status];
  const images = [candidate.headshot_url, candidate.full_body_url, ...(candidate.additional_refs || [])].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          {candidate.display_name || candidate.character_key}
        </DialogTitle>
        <DialogDescription className="text-xs">
          Casting candidate for {candidate.character_key}
        </DialogDescription>
      </DialogHeader>

      {/* Images */}
      {images.length > 0 ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(2, 1fr)' }}>
          {images.map((url, i) => (
            <div key={i} className="aspect-[3/4] rounded-lg overflow-hidden bg-muted/10">
              <img src={url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      ) : (
        <div className="aspect-[3/4] rounded-lg bg-muted/10 flex items-center justify-center">
          <Users className="h-12 w-12 text-muted-foreground/20" />
        </div>
      )}

      {/* Status + Metadata */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge className={cn('text-[10px]', cfg.color)}>
            <cfg.icon className="h-3 w-3 mr-1" />
            {cfg.label}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            Created {new Date(candidate.created_at).toLocaleDateString()}
          </span>
        </div>

        {candidate.generation_config && Object.keys(candidate.generation_config).length > 0 && (
          <div className="rounded-md bg-muted/30 p-3 text-[10px] text-muted-foreground space-y-0.5">
            <p className="font-medium text-foreground text-[11px] mb-1">Generation Details</p>
            {candidate.generation_config.prompt && (
              <p className="line-clamp-3">Prompt: {candidate.generation_config.prompt}</p>
            )}
            {candidate.generation_config.model && (
              <p>Model: {candidate.generation_config.model}</p>
            )}
            <p>Batch: {candidate.batch_id.slice(0, 8)}…</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <DialogFooter className="gap-2">
        {candidate.status !== 'rejected' && candidate.status !== 'promoted' && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onReject}>
            <XCircle className="h-3 w-3" /> Reject
          </Button>
        )}
        {candidate.status !== 'shortlisted' && candidate.status !== 'promoted' && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onShortlist}>
            <Star className="h-3 w-3 text-amber-400" /> Shortlist
          </Button>
        )}
        {(candidate.status === 'shortlisted' || candidate.status === 'generated') && (
          <Button size="sm" className="text-xs gap-1" onClick={onPromote}>
            <Crown className="h-3 w-3" /> Promote to Actor
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

// ── Promote Dialog ──────────────────────────────────────────────────────────

function PromoteDialog({
  open, candidateIds, candidates, projectId, userId, onClose, onPromoted
}: {
  open: boolean;
  candidateIds: string[];
  candidates: CastingCandidate[];
  projectId: string;
  userId: string;
  onClose: () => void;
  onPromoted: () => void;
}) {
  const [promoting, setPromoting] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  const toPromote = useMemo(
    () => candidateIds.map(id => candidates.find(c => c.id === id)).filter(Boolean) as CastingCandidate[],
    [candidateIds, candidates]
  );

  const getName = (cand: CastingCandidate) =>
    names[cand.id] || cand.display_name || cand.character_key;

  const handlePromote = async () => {
    setPromoting(true);
    let successCount = 0;
    try {
      for (const cand of toPromote) {
        if (cand.status === 'promoted') { successCount++; continue; }

        // Create AI Actor
        const actorName = getName(cand);
        const result = await aiCastApi.createActor({
          name: actorName,
          description: `Promoted from casting for ${cand.character_key}`,
          tags: ['casting-promoted', cand.character_key],
        });

        const actorId = result.actor?.id;
        if (!actorId) continue;

        // If we have images, create version + assets
        if (cand.headshot_url || cand.full_body_url) {
          const versionResult = await aiCastApi.createVersion(actorId, {
            invariants: [`Promoted casting candidate for ${cand.character_key}`],
          });
          const versionId = versionResult.version?.id;
          if (versionId) {
            if (cand.headshot_url) {
              await aiCastApi.addAsset(versionId, {
                asset_type: 'reference_headshot',
                public_url: cand.headshot_url,
                meta_json: { shot_type: 'headshot', source: 'casting_promotion' },
              });
            }
            if (cand.full_body_url) {
              await aiCastApi.addAsset(versionId, {
                asset_type: 'reference_full_body',
                public_url: cand.full_body_url,
                meta_json: { shot_type: 'full_body', source: 'casting_promotion' },
              });
            }
            for (const ref of cand.additional_refs || []) {
              await aiCastApi.addAsset(versionId, {
                asset_type: 'reference_image',
                public_url: ref,
                meta_json: { source: 'casting_promotion' },
              });
            }
            // Approve the version
            await aiCastApi.approveVersion(actorId, versionId);
          }
        }

        // Mark candidate as promoted
        await (supabase as any)
          .from('casting_candidates')
          .update({
            status: 'promoted',
            promoted_actor_id: actorId,
            promoted_at: new Date().toISOString(),
            display_name: actorName,
          })
          .eq('id', cand.id);

        successCount++;
      }

      toast.success(`${successCount} candidate(s) promoted to AI Actors`);
      onPromoted();
    } catch (e: any) {
      toast.error(`Promotion error: ${e.message}`);
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Promote to AI Actors
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create permanent AI Actor identities from {toPromote.length} shortlisted candidate(s).
            Assign names before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {toPromote.map(cand => (
            <div key={cand.id} className="flex items-center gap-3 p-2 rounded-lg border border-border/40">
              <div className="h-14 w-10 rounded overflow-hidden bg-muted/10 shrink-0">
                {cand.headshot_url ? (
                  <img src={cand.headshot_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full"><Users className="h-4 w-4 text-muted-foreground/30" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[10px] text-muted-foreground">For: {cand.character_key}</p>
                <Input
                  value={getName(cand)}
                  onChange={(e) => setNames(prev => ({ ...prev, [cand.id]: e.target.value }))}
                  placeholder="Actor name"
                  className="h-7 text-xs"
                />
              </div>
              {cand.status === 'promoted' && (
                <Badge className="text-[9px] bg-primary/15 text-primary shrink-0">Already promoted</Badge>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={promoting}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={handlePromote} disabled={promoting}>
            {promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
            Promote {toPromote.filter(c => c.status !== 'promoted').length} Actor(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Empty States ────────────────────────────────────────────────────────────

function EmptyState({ type }: { type: 'no_characters' | 'no_candidates' }) {
  const configs = {
    no_characters: {
      icon: Users,
      title: 'No characters detected',
      desc: 'Add characters to your project canon or generate identity images to start casting.',
    },
    no_candidates: {
      icon: Sparkles,
      title: 'No casting candidates yet',
      desc: 'Generate casting candidates for each character to begin the review process.',
    },
  };
  const cfg = configs[type];
  return (
    <div className="text-center py-16 space-y-3">
      <cfg.icon className="h-10 w-10 mx-auto text-muted-foreground/30" />
      <h3 className="text-sm font-medium text-foreground">{cfg.title}</h3>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">{cfg.desc}</p>
    </div>
  );
}
