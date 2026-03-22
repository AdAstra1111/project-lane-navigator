/**
 * AI Actors Agency — Global actor registry with search, filter, identity strength, usage tracking.
 * Includes: create from project images, actor detail, version management, anchor validation badges.
 * Phase 3: Scoring results display, auto-trigger scoring, hard fail visibility.
 */
import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Users, Plus, Loader2, CheckCircle2, Search, Sparkles, ChevronRight,
  ImagePlus, ShieldCheck, Trash2, Upload, ArrowLeft, Film, Shield,
  AlertTriangle, Eye, SlidersHorizontal, ArrowUpDown, Image, ShieldAlert,
  FlaskConical, Clock, XCircle, TrendingUp, Zap, BarChart3, Crown, Ban,
  RotateCcw, FileText, ShieldOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAIActors, useAIActor, useAICastMutations } from '@/lib/aiCast/useAICast';
import { aiCastApi } from '@/lib/aiCast/aiCastApi';
import type { AIActor, AIActorVersion, AIActorAsset } from '@/lib/aiCast/aiCastApi';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActorUsage, getActorUsageCounts } from '@/lib/aiCast/useActorUsage';
import { getIdentityStrength, getActorThumbnail, type IdentityStrength } from '@/lib/aiCast/identityStrength';
import {
  evaluateAnchorCoverage, persistAnchorStatus,
  type AnchorCoverageStatus, type AnchorCoherenceStatus,
} from '@/lib/aiCast/anchorValidation';
import {
  useLatestValidationRun, useValidationImages, useValidationResult, useStartValidation,
  VALIDATION_SLOTS, type ValidationRun, type ValidationImage, type ValidationResult,
} from '@/lib/aiCast/actorValidation';
import {
  getScoreBandColor, getConfidenceColor,
} from '@/lib/aiCast/validationScoring';
import {
  usePromotionEligibility, usePromotionDecisions, useActorPromotionState, useApplyPromotionDecision,
} from '@/lib/aiCast/usePromotion';
import type { PromotionDecision, FinalDecisionStatus } from '@/lib/aiCast/promotionPolicy';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

type SortMode = 'recent' | 'name' | 'usage';
type FilterStatus = 'all' | 'active' | 'draft';

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AICastLibrary() {
  const { data, isLoading } = useAIActors();
  const actors: AIActor[] = data?.actors || [];
  const { data: usageData } = useActorUsage();
  const usageCounts = useMemo(() => getActorUsageCounts(usageData || []), [usageData]);

  const [search, setSearch] = useState('');
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateFromImages, setShowCreateFromImages] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const filtered = useMemo(() => {
    let list = actors.filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some(t => t.toLowerCase().includes(search.toLowerCase())) ||
      a.description?.toLowerCase().includes(search.toLowerCase())
    );
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus);
    list.sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'usage') return (usageCounts.get(b.id) || 0) - (usageCounts.get(a.id) || 0);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [actors, search, filterStatus, sortMode, usageCounts]);

  if (selectedActorId) {
    return (
      <ActorDetail
        actorId={selectedActorId}
        usageEntries={(usageData || []).filter(u => u.actorId === selectedActorId)}
        onBack={() => setSelectedActorId(null)}
      />
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5" /> AI Actors Agency
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create, manage and cast reusable AI actor identities across productions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setShowCreateFromImages(true)}>
            <Image className="h-3.5 w-3.5" /> From Images
          </Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Actor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create AI Actor</DialogTitle></DialogHeader>
              <CreateActorForm onCreated={(id) => { setShowCreate(false); setSelectedActorId(id); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search by name, tags, description..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-xs" />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
          <SelectTrigger className="h-9 w-[120px] text-xs">
            <SlidersHorizontal className="h-3 w-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Status</SelectItem>
            <SelectItem value="active" className="text-xs">Active</SelectItem>
            <SelectItem value="draft" className="text-xs">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-9 w-[120px] text-xs">
            <ArrowUpDown className="h-3 w-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent" className="text-xs">Recent</SelectItem>
            <SelectItem value="name" className="text-xs">Name</SelectItem>
            <SelectItem value="usage" className="text-xs">Most Used</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{actors.length} actor{actors.length !== 1 ? 's' : ''}</span>
        <span>{actors.filter(a => a.status === 'active').length} active</span>
        <span>{actors.filter(a => (a as any).roster_ready).length} roster</span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {actors.length === 0 ? 'No AI actors yet. Create your first one to start building your cast.' : 'No actors match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(actor => (
            <ActorCard key={actor.id} actor={actor} usageCount={usageCounts.get(actor.id) || 0} onClick={() => setSelectedActorId(actor.id)} />
          ))}
        </div>
      )}

      {/* Create from images dialog */}
      <Dialog open={showCreateFromImages} onOpenChange={setShowCreateFromImages}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Actor from Project Images</DialogTitle>
            <DialogDescription className="text-xs">
              Select existing identity images from a project to seed a new actor.
            </DialogDescription>
          </DialogHeader>
          <CreateActorFromImagesFlow onCreated={(id) => { setShowCreateFromImages(false); setSelectedActorId(id); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Actor Card ──────────────────────────────────────────────────────────────

function ActorCard({ actor, usageCount, onClick }: { actor: AIActor; usageCount: number; onClick: () => void }) {
  const thumbnail = getActorThumbnail(actor.ai_actor_versions);
  const identity = getIdentityStrength(actor.ai_actor_versions);
  const coverageStatus = (actor as any).anchor_coverage_status as AnchorCoverageStatus | undefined;
  const rosterReady = (actor as any).roster_ready as boolean | undefined;
  const promotionStatus = (actor as any).promotion_status as string | undefined;

  return (
    <button onClick={onClick} className="text-left rounded-lg border border-border/50 bg-card/50 hover:bg-muted/20 transition-colors overflow-hidden group">
      <div className="aspect-[3/2] bg-muted/10 relative overflow-hidden">
        {thumbnail ? (
          <img src={thumbnail} alt={actor.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="flex items-center justify-center h-full"><Users className="h-8 w-8 text-muted-foreground/30" /></div>
        )}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {rosterReady && <RosterBadge />}
          <IdentityBadge strength={identity.strength} size="sm" />
          {coverageStatus && coverageStatus !== 'insufficient' && (
            <AnchorCoverageBadge status={coverageStatus} />
          )}
        </div>
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground truncate">{actor.name}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-2">{actor.description || 'No description'}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={actor.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-5">{actor.status}</Badge>
          {rosterReady && (
            <Badge variant="outline" className="text-[10px] h-5 gap-0.5 text-amber-300 border-amber-300/30">
              <Crown className="h-2.5 w-2.5" /> Roster
            </Badge>
          )}
          {!rosterReady && promotionStatus && !['none', 'rejected', 'override_rejected'].includes(promotionStatus) && (
            <PromotionStatusChip status={promotionStatus} />
          )}
          <span className="text-[10px] text-muted-foreground">{actor.ai_actor_versions?.length || 0} ver.</span>
          {usageCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Film className="h-2.5 w-2.5" /> {usageCount} project{usageCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {actor.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {actor.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Roster Badge ────────────────────────────────────────────────────────────

function RosterBadge() {
  return (
    <span className="rounded-full text-[8px] px-1.5 py-0.5 font-medium bg-amber-500/90 text-white inline-flex items-center gap-0.5">
      <Crown className="h-2 w-2" /> Roster
    </span>
  );
}

// ── Promotion Status Chip ───────────────────────────────────────────────────

function PromotionStatusChip({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    approved: { label: 'Approved', className: 'text-emerald-400 border-emerald-400/30' },
    override_approved: { label: 'Override ✓', className: 'text-amber-400 border-amber-400/30' },
    rejected: { label: 'Rejected', className: 'text-destructive border-destructive/30' },
    override_rejected: { label: 'Override ✗', className: 'text-destructive border-destructive/30' },
    revoked: { label: 'Revoked', className: 'text-muted-foreground border-border' },
    pending_review: { label: 'Review', className: 'text-amber-400 border-amber-400/30' },
  };
  const cfg = config[status] || { label: status, className: 'text-muted-foreground border-border' };
  return <Badge variant="outline" className={cn('text-[9px] h-5', cfg.className)}>{cfg.label}</Badge>;
}

// ── Anchor Coverage Badge ───────────────────────────────────────────────────

function AnchorCoverageBadge({ status }: { status: AnchorCoverageStatus }) {
  const config = {
    complete: { label: 'Anchors ✓', className: 'bg-emerald-500/90 text-white' },
    partial: { label: 'Partial', className: 'bg-amber-500/90 text-white' },
    insufficient: { label: 'Missing', className: 'bg-destructive/90 text-white' },
  }[status];
  return (
    <span className={cn('rounded-full text-[8px] px-1.5 py-0.5 font-medium', config.className)}>
      {config.label}
    </span>
  );
}

// ── Validation Status Chip ──────────────────────────────────────────────────

function ValidationStatusChip({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ElementType }> = {
    pending: { label: 'Queued', className: 'bg-muted text-muted-foreground', icon: Clock },
    generating: { label: 'Generating…', className: 'bg-primary/15 text-primary border-primary/30', icon: Loader2 },
    scoring: { label: 'Scoring…', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: FlaskConical },
    pack_generated: { label: 'Pack Generated · Awaiting Scoring', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Clock },
    scored: { label: 'Scored', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
    complete: { label: 'Validated', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
    failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle },
  };
  const cfg = config[status] || config.pending;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn('text-[9px] h-5 gap-0.5', cfg.className)}>
      <Icon className={cn('h-2.5 w-2.5', status === 'generating' && 'animate-spin')} /> {cfg.label}
    </Badge>
  );
}



function IdentityBadge({ strength, size = 'sm' }: { strength: IdentityStrength; size?: 'sm' | 'md' }) {
  const config = {
    strong: { icon: Shield, label: 'Strong', className: 'bg-emerald-500/90 text-white' },
    partial: { icon: Eye, label: 'Partial', className: 'bg-amber-500/90 text-white' },
    weak: { icon: AlertTriangle, label: 'Weak', className: 'bg-destructive/90 text-white' },
  }[strength];
  const Icon = config.icon;
  const sizeClasses = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1';
  return (
    <span className={cn('rounded-full inline-flex items-center gap-1 font-medium', config.className, sizeClasses)}>
      <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />{config.label}
    </span>
  );
}

// ── Create Actor Form (manual) ──────────────────────────────────────────────

function CreateActorForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { createActor } = useAICastMutations();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const handleSubmit = () => {
    createActor.mutate({
      name: name || 'Untitled Actor',
      description,
      negative_prompt: negativePrompt,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
    }, { onSuccess: (data) => onCreated(data.actor.id) });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Detective Mira Vasquez" className="text-xs h-9" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description (identity prompt)</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="A weathered detective in her late 40s..." className="text-xs min-h-[80px]" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
        <Input value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="celebrity, real person, cartoon..." className="text-xs h-9" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
        <Input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="lead, detective, noir" className="text-xs h-9" />
      </div>
      <Button onClick={handleSubmit} disabled={createActor.isPending} className="w-full h-9 text-xs">
        {createActor.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        Create Actor
      </Button>
    </div>
  );
}

// ── Create Actor From Project Images ────────────────────────────────────────

type AssetClassification = 'reference_headshot' | 'reference_full_body' | 'reference_image';

interface SelectedProjectImage {
  id: string;
  subject: string;
  storage_path: string;
  public_url: string;
  shot_type: string;
  classification: AssetClassification;
}

function CreateActorFromImagesFlow({ onCreated }: { onCreated: (id: string) => void }) {
  const { createActor } = useAICastMutations();
  const qc = useQueryClient();
  const [step, setStep] = useState<'select_project' | 'select_images' | 'confirm'>('select_project');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<SelectedProjectImage[]>([]);
  const [actorName, setActorName] = useState('');
  const [actorDesc, setActorDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Fetch user's projects
  const { data: projects } = useQuery({
    queryKey: ['user-projects-list'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, title').order('updated_at', { ascending: false }).limit(50);
      return data || [];
    },
  });

  // Fetch identity images for selected project
  const { data: projectImages, isLoading: imagesLoading } = useQuery({
    queryKey: ['project-identity-images', selectedProjectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_images' as any)
        .select('id, subject, storage_path, shot_type, curation_state')
        .eq('project_id', selectedProjectId!)
        .in('shot_type', ['identity_headshot', 'identity_full_body', 'identity_profile', 'close_up', 'medium', 'three_quarter'])
        .in('curation_state', ['active', 'approved', 'locked'])
        .limit(100) as { data: any };
      if (!data) return [];
      // Generate public URLs
      return data.map((img: any) => {
        const { data: urlData } = supabase.storage.from('project-images').getPublicUrl(img.storage_path);
        return { ...img, public_url: urlData?.publicUrl || img.storage_path };
      });
    },
    enabled: !!selectedProjectId,
  });

  const toggleImage = (img: any) => {
    const existing = selectedImages.find(s => s.id === img.id);
    if (existing) {
      setSelectedImages(prev => prev.filter(s => s.id !== img.id));
    } else {
      // Auto-classify based on shot_type
      let classification: AssetClassification = 'reference_image';
      if (img.shot_type === 'identity_headshot' || img.shot_type === 'close_up') classification = 'reference_headshot';
      else if (img.shot_type === 'identity_full_body' || img.shot_type === 'medium' || img.shot_type === 'three_quarter') classification = 'reference_full_body';

      setSelectedImages(prev => [...prev, {
        id: img.id,
        subject: img.subject || '',
        storage_path: img.storage_path,
        public_url: img.public_url,
        shot_type: img.shot_type,
        classification,
      }]);

      // Auto-fill name from first selected image's subject
      if (selectedImages.length === 0 && img.subject) {
        setActorName(img.subject);
      }
    }
  };

  const updateClassification = (imageId: string, classification: AssetClassification) => {
    setSelectedImages(prev => prev.map(s => s.id === imageId ? { ...s, classification } : s));
  };

  const handleCreate = async () => {
    if (selectedImages.length === 0) { toast.error('Select at least one image'); return; }
    setCreating(true);
    try {
      // 1. Create actor
      const actorResult = await aiCastApi.createActor({
        name: actorName || 'Unnamed Actor',
        description: actorDesc,
        tags: [],
      });
      const actorId = actorResult.actor.id;

      // 2. Create version
      const versionResult = await aiCastApi.createVersion(actorId);
      const versionId = versionResult.version.id;

      // 3. Add assets — reuse existing storage paths, no file duplication
      for (const img of selectedImages) {
        await aiCastApi.addAsset(versionId, {
          asset_type: img.classification,
          storage_path: img.storage_path,
          public_url: img.public_url,
          meta_json: {
            shot_type: img.classification === 'reference_headshot' ? 'headshot'
              : img.classification === 'reference_full_body' ? 'full_body'
              : 'reference',
            source_project_id: selectedProjectId,
            source_image_id: img.id,
            original_shot_type: img.shot_type,
            created_at: new Date().toISOString(),
          },
        });
      }

      toast.success(`Actor "${actorName || 'Unnamed Actor'}" created with ${selectedImages.length} reference images`);
      qc.invalidateQueries({ queryKey: ['ai-actors'] });
      onCreated(actorId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create actor');
    } finally {
      setCreating(false);
    }
  };

  // Step 1: Select project
  if (step === 'select_project') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Select a project to browse identity images:</p>
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {(projects || []).map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProjectId(p.id); setStep('select_images'); }}
              className="w-full text-left px-3 py-2 rounded text-xs hover:bg-muted/30 transition-colors border border-transparent hover:border-border/30"
            >
              {p.title || 'Untitled'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: Select images
  if (step === 'select_images') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => { setStep('select_project'); setSelectedImages([]); }} className="text-xs text-muted-foreground hover:text-foreground">
            ← Change project
          </button>
          <span className="text-xs text-muted-foreground">{selectedImages.length} selected</span>
        </div>

        {imagesLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : !projectImages || projectImages.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No identity images found in this project.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-[350px] overflow-y-auto">
            {projectImages.map((img: any) => {
              const isSelected = selectedImages.some(s => s.id === img.id);
              return (
                <button
                  key={img.id}
                  onClick={() => toggleImage(img)}
                  className={cn(
                    'relative aspect-square rounded-lg overflow-hidden border-2 transition-colors',
                    isSelected ? 'border-primary' : 'border-transparent hover:border-border/50'
                  )}
                >
                  <img src={img.public_url} alt={img.subject || ''} className="w-full h-full object-cover" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1">
                    <span className="text-[8px] text-white/80 truncate block">{img.subject || img.shot_type}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedImages.length > 0 && (
          <Button onClick={() => setStep('confirm')} className="w-full h-8 text-xs">
            Continue with {selectedImages.length} image{selectedImages.length > 1 ? 's' : ''}
          </Button>
        )}
      </div>
    );
  }

  // Step 3: Classify + confirm
  return (
    <div className="space-y-4">
      <button onClick={() => setStep('select_images')} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to selection
      </button>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Actor Name</label>
        <Input value={actorName} onChange={e => setActorName(e.target.value)} placeholder="Character name..." className="text-xs h-9" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <Textarea value={actorDesc} onChange={e => setActorDesc(e.target.value)} placeholder="Visual description..." className="text-xs min-h-[60px]" />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Classify Images</label>
        {selectedImages.map(img => (
          <div key={img.id} className="flex items-center gap-3 p-2 rounded border border-border/30 bg-card/30">
            <div className="w-10 h-10 rounded overflow-hidden shrink-0">
              <img src={img.public_url} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground truncate">{img.subject || 'Unknown'} · {img.shot_type}</p>
            </div>
            <Select value={img.classification} onValueChange={(v) => updateClassification(img.id, v as AssetClassification)}>
              <SelectTrigger className="h-7 w-[140px] text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reference_headshot" className="text-xs">Headshot</SelectItem>
                <SelectItem value="reference_full_body" className="text-xs">Full Body</SelectItem>
                <SelectItem value="reference_image" className="text-xs">Reference</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Button onClick={handleCreate} disabled={creating} className="w-full h-9 text-xs">
        {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        Create Actor with {selectedImages.length} Image{selectedImages.length > 1 ? 's' : ''}
      </Button>
    </div>
  );
}

// ── Actor Detail ────────────────────────────────────────────────────────────

function ActorDetail({ actorId, usageEntries, onBack }: {
  actorId: string;
  usageEntries: { projectId: string; projectTitle: string; characterKey: string }[];
  onBack: () => void;
}) {
  const { data, isLoading } = useAIActor(actorId);
  const { updateActor, createVersion } = useAICastMutations();
  const actor: AIActor | undefined = data?.actor;
  const startValidation = useStartValidation();
  const { data: latestRun } = useLatestValidationRun(actorId);
  const { data: validationImages } = useValidationImages(latestRun?.id);
  const { data: validationResult } = useValidationResult(latestRun?.id);
  const { data: eligibility } = usePromotionEligibility(actorId);
  const { data: promotionState } = useActorPromotionState(actorId);
  const { data: decisions } = usePromotionDecisions(actorId);
  const applyDecision = useApplyPromotionDecision();
  const [overrideReason, setOverrideReason] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [showOverride, setShowOverride] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editNeg, setEditNeg] = useState('');

  // Safe state init via useEffect — replaces render-time setState
  useEffect(() => {
    if (actor) {
      setEditName(actor.name);
      setEditDesc(actor.description);
      setEditNeg(actor.negative_prompt);
    }
  }, [actor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scoring is now server-orchestrated (run-actor-validation auto-invokes score-actor-validation).
  // UI only reflects state — no client-side scoring trigger.

  const handleSave = () => {
    updateActor.mutate({ actorId, name: editName, description: editDesc, negative_prompt: editNeg });
  };

  if (isLoading || !actor) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const versions: AIActorVersion[] = actor.ai_actor_versions || [];
  const identity = getIdentityStrength(versions);
  const thumbnail = getActorThumbnail(versions);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> Back to library
      </button>

      {/* Actor header */}
      <div className="flex gap-4">
        <div className="w-20 h-20 rounded-lg border border-border/50 overflow-hidden shrink-0 bg-muted/10">
          {thumbnail ? (
            <img src={thumbnail} alt={actor.name} className="w-full h-full object-cover" />
          ) : (
            <div className="flex items-center justify-center h-full"><Users className="h-6 w-6 text-muted-foreground/30" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-display font-semibold text-foreground truncate">{actor.name}</h2>
            <Badge variant={actor.status === 'active' ? 'default' : 'secondary'}>{actor.status}</Badge>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <IdentityBadge strength={identity.strength} size="md" />
            <span className="text-[11px] text-muted-foreground">{identity.label}</span>
          </div>
          {identity.totalAssets > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {identity.hasHeadshot ? '✓ Headshot' : '✗ No headshot'} · {identity.hasFullBody ? '✓ Full body' : '✗ No full body'} · {identity.totalAssets} asset{identity.totalAssets !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Edit fields */}
      <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-card/50">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
          <Input value={editName} onChange={e => setEditName(e.target.value)} className="text-xs h-9" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Identity Description</label>
          <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className="text-xs min-h-[80px]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Negative Prompt</label>
          <Input value={editNeg} onChange={e => setEditNeg(e.target.value)} className="text-xs h-9" />
        </div>
        <Button size="sm" onClick={handleSave} disabled={updateActor.isPending} className="h-8 text-xs">Save Changes</Button>
      </div>

      {/* Project Usage */}
      {usageEntries.length > 0 && (
        <div className="border border-border/50 rounded-lg p-4 space-y-2 bg-card/30">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Film className="h-3 w-3" /> Used In
          </h3>
          <div className="space-y-1">
            {usageEntries.map((u, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-foreground font-medium">{u.projectTitle}</span>
                <span className="text-muted-foreground">as</span>
                <span className="text-primary">{u.characterKey}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Validation Section */}
      <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-card/30">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" /> Identity Validation
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => startValidation.mutate({ actorId })}
            disabled={startValidation.isPending || (latestRun?.status === 'generating') || (latestRun?.status === 'pending') || (latestRun?.status === 'scoring')}
          >
            {(startValidation.isPending || latestRun?.status === 'generating' || latestRun?.status === 'pending' || latestRun?.status === 'scoring')
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <FlaskConical className="h-3 w-3" />
            }
            {latestRun?.status === 'generating' ? 'Generating…' : latestRun?.status === 'pending' ? 'Queued…' : latestRun?.status === 'scoring' ? 'Scoring…' : 'Run Validation'}
          </Button>
        </div>

        {!latestRun ? (
          <p className="text-[10px] text-muted-foreground">No validation runs yet. Run a quick validation to generate 22 test images across 11 controlled conditions.</p>
        ) : (
          <div className="space-y-3">
            {/* Status + Coverage */}
            <div className="flex items-center gap-3 flex-wrap">
              <ValidationStatusChip status={latestRun.status} />
              {latestRun.pack_coverage && (latestRun.pack_coverage as any).coverage_percent != null && (
                <span className="text-[10px] text-muted-foreground">
                  Coverage: {(latestRun.pack_coverage as any).completed_images || 0}/22 images · {(latestRun.pack_coverage as any).coverage_percent}%
                </span>
              )}
              {latestRun.completed_at && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {new Date(latestRun.completed_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Scoring Results */}
            {validationResult && validationResult.overall_score != null && (
              <ValidationScorePanel result={validationResult} />
            )}

            {/* Validation Images Grid */}
            {validationImages && validationImages.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground font-medium">Validation Pack</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
                  {VALIDATION_SLOTS.map(slot => {
                    const slotImages = validationImages.filter((i: ValidationImage) => i.slot_key === slot.key);
                    const hasComplete = slotImages.some((i: ValidationImage) => i.status === 'complete' && i.public_url);
                    const primaryImage = slotImages.find((i: ValidationImage) => i.status === 'complete' && i.public_url);
                    const isPending = slotImages.some((i: ValidationImage) => i.status === 'pending' || i.status === 'generating');
                    const isFailed = slotImages.length > 0 && slotImages.every((i: ValidationImage) => i.status === 'failed');

                    // Get per-slot stability score if available
                    const intraDetail = (validationResult?.axis_scores as any)?.intra_slot_detail;
                    const slotScore = intraDetail?.[slot.key];

                    return (
                      <div key={slot.key} className="space-y-0.5">
                        <div className={cn(
                          'aspect-square rounded-md overflow-hidden border relative',
                          hasComplete ? 'border-border/50' : isPending ? 'border-primary/30' : isFailed ? 'border-destructive/30' : 'border-border/20'
                        )}>
                          {primaryImage?.public_url ? (
                            <img src={primaryImage.public_url} alt={slot.label} className="w-full h-full object-cover" />
                          ) : isPending ? (
                            <div className="flex items-center justify-center h-full bg-muted/10">
                              <Loader2 className="h-3 w-3 animate-spin text-primary/50" />
                            </div>
                          ) : isFailed ? (
                            <div className="flex items-center justify-center h-full bg-destructive/5">
                              <XCircle className="h-3 w-3 text-destructive/50" />
                            </div>
                          ) : (
                            <div className="flex items-center justify-center h-full bg-muted/5">
                              <Image className="h-3 w-3 text-muted-foreground/20" />
                            </div>
                          )}
                          {slotScore != null && (
                            <div className={cn(
                              'absolute bottom-0 right-0 text-[7px] font-bold px-1 py-0.5 rounded-tl',
                              slotScore >= 7 ? 'bg-emerald-500/80 text-white' :
                              slotScore >= 5 ? 'bg-amber-500/80 text-white' :
                              'bg-destructive/80 text-white'
                            )}>
                              {slotScore.toFixed(0)}
                            </div>
                          )}
                        </div>
                        <p className="text-[7px] text-muted-foreground truncate text-center">{slot.label}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {latestRun.error && (
              <p className="text-[10px] text-destructive">{latestRun.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Promotion / Roster Section */}
      <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-card/30">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Crown className="h-3 w-3" /> Promotion & Roster
          </h3>
          {promotionState?.roster_ready && (
            <Badge variant="outline" className="text-[9px] h-5 gap-0.5 text-amber-300 border-amber-300/30">
              <Crown className="h-2.5 w-2.5" /> Roster Ready
            </Badge>
          )}
        </div>

        {/* Current State */}
        <div className="rounded-md bg-muted/20 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <PromotionStatusChip status={promotionState?.promotion_status || 'none'} />
          </div>
          {promotionState?.approved_version_id && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Approved Version</span>
              <span className="text-foreground font-mono text-[10px]">{promotionState.approved_version_id.slice(0, 8)}…</span>
            </div>
          )}
        </div>

        {/* Eligibility */}
        {eligibility && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground">Policy Evaluation</p>
            <div className="flex items-center gap-2">
              {eligibility.eligible_for_promotion ? (
                <Badge variant="outline" className="text-[9px] h-5 gap-0.5 text-emerald-400 border-emerald-400/30">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Eligible
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] h-5 gap-0.5 text-destructive border-destructive/30">
                  <Ban className="h-2.5 w-2.5" /> Not Eligible
                </Badge>
              )}
              {eligibility.review_required && (
                <Badge variant="outline" className="text-[9px] h-5 text-amber-400 border-amber-400/30">Review Required</Badge>
              )}
            </div>
            {eligibility.block_reasons.length > 0 && (
              <div className="space-y-0.5">
                {eligibility.block_reasons.map((r, i) => (
                  <p key={i} className="text-[9px] text-destructive/80 flex items-start gap-1">
                    <ShieldAlert className="h-2.5 w-2.5 mt-0.5 shrink-0" /> {r}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Approve — only if eligible */}
          {eligibility?.eligible_for_promotion && !promotionState?.roster_ready && (
            <Button
              size="sm" className="h-7 text-xs gap-1"
              onClick={() => applyDecision.mutate({ actorId, action: 'approve', decisionNote })}
              disabled={applyDecision.isPending}
            >
              {applyDecision.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className="h-3 w-3" />}
              Approve for Roster
            </Button>
          )}

          {/* Reject — available when not roster-ready (rejection is a version-level decision, not actor-level) */}
          {!promotionState?.roster_ready && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => applyDecision.mutate({ actorId, action: 'reject', decisionNote })}
              disabled={applyDecision.isPending}
            >
              <Ban className="h-3 w-3" /> Reject
            </Button>
          )}

          {/* Revoke — only if roster ready */}
          {promotionState?.roster_ready && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => applyDecision.mutate({ actorId, action: 'revoke', decisionNote })}
              disabled={applyDecision.isPending}
            >
              <ShieldOff className="h-3 w-3" /> Revoke Roster
            </Button>
          )}

          {/* Override toggle */}
          {!eligibility?.eligible_for_promotion && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowOverride(!showOverride)}>
              <RotateCcw className="h-3 w-3" /> Override…
            </Button>
          )}
        </div>

        {/* Override panel */}
        {showOverride && (
          <div className="border border-amber-500/30 rounded-md p-3 space-y-2 bg-amber-500/5">
            <p className="text-[10px] font-medium text-amber-400">Override Promotion Decision</p>
            <Input
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="Reason for override (required)…"
              className="text-xs h-8"
            />
            <div className="flex gap-2">
              <Button
                size="sm" className="h-7 text-xs gap-1"
                onClick={() => {
                  applyDecision.mutate({ actorId, action: 'override_approve', overrideReason, decisionNote });
                  setShowOverride(false);
                }}
                disabled={!overrideReason.trim() || applyDecision.isPending}
              >
                Override Approve
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={() => setShowOverride(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Decision Note */}
        <div className="space-y-1">
          <Input
            value={decisionNote}
            onChange={e => setDecisionNote(e.target.value)}
            placeholder="Optional decision note…"
            className="text-xs h-8"
          />
        </div>

        {/* Decision History */}
        {decisions && decisions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <FileText className="h-2.5 w-2.5" /> Decision History
            </p>
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {decisions.map((d: PromotionDecision) => (
                <div key={d.id} className="flex items-center gap-2 text-[9px] px-2 py-1 rounded bg-muted/10 border border-border/20">
                  <PromotionStatusChip status={d.final_decision_status} />
                  <span className="text-muted-foreground">{d.decision_mode.replace(/_/g, ' ')}</span>
                  {d.override_reason && <span className="text-amber-400 truncate">"{d.override_reason}"</span>}
                  <span className="text-muted-foreground/60 ml-auto shrink-0">{new Date(d.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Versions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Versions</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createVersion.mutate({ actorId })}>
            <Plus className="h-3 w-3" /> New Version
          </Button>
        </div>
        {versions.map(ver => <VersionCard key={ver.id} ver={ver} actorId={actorId} />)}
      </div>
    </div>
  );
}

// ── Validation Score Panel ──────────────────────────────────────────────────

function ValidationScorePanel({ result }: { result: ValidationResult }) {
  const axes = result.axis_scores as any;
  const hardFails = result.hard_fail_codes || [];
  const advisories = result.advisory_penalty_codes || [];

  return (
    <div className="border border-border/30 rounded-lg p-3 space-y-3 bg-card/20">
      {/* Top row: score + band + confidence */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={cn(
          'rounded-lg px-3 py-1.5 border font-bold text-lg tabular-nums',
          getScoreBandColor(result.score_band)
        )}>
          {result.overall_score}
        </div>
        <div>
          <Badge variant="outline" className={cn('text-[9px] h-5 uppercase tracking-wider', getScoreBandColor(result.score_band))}>
            {result.score_band}
          </Badge>
          <p className={cn('text-[9px] mt-0.5', getConfidenceColor(result.confidence))}>
            {result.confidence} confidence
          </p>
        </div>

        {hardFails.length > 0 && (
          <div className="flex gap-1 ml-auto">
            {hardFails.map(code => (
              <Badge key={code} variant="destructive" className="text-[8px] h-5 gap-0.5">
                <ShieldAlert className="h-2.5 w-2.5" /> {code}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Canonical axis scores */}
      <div className="grid grid-cols-2 gap-2">
        <AxisScoreRow label="Identity Consistency" value={axes?.identity_consistency_score} icon={<Zap className="h-2.5 w-2.5" />} />
        <AxisScoreRow label="Structural Consistency" value={axes?.structural_consistency_score} icon={<TrendingUp className="h-2.5 w-2.5" />} />
        <AxisScoreRow label="Variation Integrity" value={axes?.variation_integrity_score} icon={<BarChart3 className="h-2.5 w-2.5" />} />
        <AxisScoreRow label="Slot Compliance" value={axes?.slot_compliance_score} icon={<Image className="h-2.5 w-2.5" />} subtitle="(eligibility)" />
      </div>

      {/* Hard fail explanations */}
      {hardFails.length > 0 && (
        <div className="space-y-1">
          {hardFails.includes('HF-08') && (
            <p className="text-[9px] text-destructive flex items-start gap-1">
              <ShieldAlert className="h-2.5 w-2.5 mt-0.5 shrink-0" />
              HF-08 Regeneration Drift — identity is unstable across regenerations. Score capped at 59.
            </p>
          )}
          {hardFails.includes('HF-COV') && (
            <p className="text-[9px] text-destructive flex items-start gap-1">
              <ShieldAlert className="h-2.5 w-2.5 mt-0.5 shrink-0" />
              HF-COV Insufficient Coverage — fewer than 8 of 11 validation slots completed.
            </p>
          )}
        </div>
      )}

      {/* Advisory penalties */}
      {advisories.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {advisories.map(code => (
            <Badge key={code} variant="outline" className="text-[8px] h-4 text-amber-400 border-amber-400/30">
              {code}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function AxisScoreRow({ label, value, icon, subtitle }: { label: string; value: number | undefined; icon: React.ReactNode; subtitle?: string }) {
  if (value == null) return null;
  const pct = (value / 10) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground flex items-center gap-1">{icon} {label}{subtitle && <span className="opacity-60">{subtitle}</span>}</span>
        <span className={cn(
          'text-[9px] font-semibold tabular-nums',
          value >= 7 ? 'text-emerald-400' : value >= 5 ? 'text-amber-400' : 'text-destructive'
        )}>{value.toFixed(1)}/10</span>
      </div>
      <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            value >= 7 ? 'bg-emerald-500' : value >= 5 ? 'bg-amber-500' : 'bg-destructive'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Version Card ────────────────────────────────────────────────────────────

function VersionCard({ ver, actorId }: { ver: AIActorVersion; actorId: string }) {
  const { approveVersion, generateScreenTest } = useAICastMutations();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AIActorAsset | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    e.target.value = '';
    setUploading(true);
    let successCount = 0;
    for (const file of Array.from(files)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { toast.error(`"${file.name}" not supported.`); continue; }
      if (file.size > MAX_IMAGE_SIZE) { toast.error(`"${file.name}" too large.`); continue; }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const rand = Math.random().toString(36).slice(2, 8);
      const storagePath = `actors/${actorId}/${ver.id}/reference/${Date.now()}_${rand}.${ext}`;
      try {
        const { error: uploadErr } = await supabase.storage.from('ai-media').upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadErr) { toast.error(`Upload failed: ${uploadErr.message}`); continue; }
        const { data: urlData } = supabase.storage.from('ai-media').getPublicUrl(storagePath);
        await aiCastApi.addAsset(ver.id, {
          asset_type: 'reference_image',
          storage_path: storagePath,
          public_url: urlData.publicUrl,
          meta_json: { filename: file.name, size: file.size, content_type: file.type, uploaded_at: new Date().toISOString() },
        });
        successCount++;
      } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    }
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} image${successCount > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
    }
    setUploading(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await aiCastApi.deleteAsset(deleteTarget.id);
      toast.success('Asset deleted');
      queryClient.invalidateQueries({ queryKey: ['ai-actor', actorId] });
    } catch (err: any) { toast.error(err.message); }
    setDeleteTarget(null);
  };

  return (
    <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-card/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Version {ver.version_number}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
          </Button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleUpload} />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
            onClick={() => generateScreenTest.mutate({ actorId, versionId: ver.id, count: 4 })} disabled={generateScreenTest.isPending}>
            {generateScreenTest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Screen Test
          </Button>
        </div>
      </div>

      {ver.ai_actor_assets && ver.ai_actor_assets.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {ver.ai_actor_assets.map((asset: AIActorAsset) => (
            <div key={asset.id} className="relative group rounded-lg overflow-hidden border border-border/30 aspect-square bg-muted/10">
              {asset.public_url ? (
                <img src={asset.public_url} alt={asset.asset_type} className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1">
                <span className="text-[9px] text-white/80">{asset.asset_type.replace(/_/g, ' ')}</span>
              </div>
              <button onClick={() => setDeleteTarget(asset)}
                className="absolute top-1 right-1 p-1 rounded bg-background/70 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No assets yet. Upload reference images or run a screen test.</p>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Asset</DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete this {deleteTarget?.asset_type.replace(/_/g, ' ')}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
