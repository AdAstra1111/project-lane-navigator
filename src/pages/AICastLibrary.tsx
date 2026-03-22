/**
 * AI Actors Agency — Global actor registry with search, filter, identity strength, usage tracking.
 */
import { useState, useRef, useMemo } from 'react';
import {
  Users, Plus, Loader2, CheckCircle2, Search, Sparkles, ChevronRight,
  ImagePlus, ShieldCheck, Trash2, Upload, X, ArrowLeft, Film, Shield,
  AlertTriangle, Eye, SlidersHorizontal, ArrowUpDown
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
import { useQueryClient } from '@tanstack/react-query';
import { useActorUsage, getActorUsageCounts } from '@/lib/aiCast/useActorUsage';
import { getIdentityStrength, getActorThumbnail, type IdentityStrength } from '@/lib/aiCast/identityStrength';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

type SortMode = 'recent' | 'name' | 'usage';
type FilterStatus = 'all' | 'active' | 'draft';

export default function AICastLibrary() {
  const { data, isLoading } = useAIActors();
  const actors: AIActor[] = data?.actors || [];
  const { data: usageData } = useActorUsage();
  const usageCounts = useMemo(() => getActorUsageCounts(usageData || []), [usageData]);

  const [search, setSearch] = useState('');
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const filtered = useMemo(() => {
    let list = actors.filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some(t => t.toLowerCase().includes(search.toLowerCase())) ||
      a.description?.toLowerCase().includes(search.toLowerCase())
    );

    if (filterStatus !== 'all') {
      list = list.filter(a => a.status === filterStatus);
    }

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

      {/* Search + Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, tags, description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
          <SelectTrigger className="h-9 w-[120px] text-xs">
            <SlidersHorizontal className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Status</SelectItem>
            <SelectItem value="active" className="text-xs">Active</SelectItem>
            <SelectItem value="draft" className="text-xs">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-9 w-[120px] text-xs">
            <ArrowUpDown className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent" className="text-xs">Recent</SelectItem>
            <SelectItem value="name" className="text-xs">Name</SelectItem>
            <SelectItem value="usage" className="text-xs">Most Used</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{actors.length} actor{actors.length !== 1 ? 's' : ''}</span>
        <span>{actors.filter(a => a.status === 'active').length} active</span>
        <span>{actors.filter(a => a.ai_actor_versions?.some(v => v.is_approved)).length} approved</span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {actors.length === 0
              ? 'No AI actors yet. Create your first one to start building your cast.'
              : 'No actors match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(actor => (
            <ActorCard
              key={actor.id}
              actor={actor}
              usageCount={usageCounts.get(actor.id) || 0}
              onClick={() => setSelectedActorId(actor.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Actor Card ──────────────────────────────────────────────────────────────

function ActorCard({ actor, usageCount, onClick }: {
  actor: AIActor;
  usageCount: number;
  onClick: () => void;
}) {
  const thumbnail = getActorThumbnail(actor.ai_actor_versions);
  const identity = getIdentityStrength(actor.ai_actor_versions);

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border/50 bg-card/50 hover:bg-muted/20 transition-colors overflow-hidden group"
    >
      {/* Thumbnail */}
      <div className="aspect-[3/2] bg-muted/10 relative overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={actor.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Users className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {/* Identity strength badge */}
        <div className="absolute top-2 right-2">
          <IdentityBadge strength={identity.strength} size="sm" />
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground truncate">{actor.name}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-2">
          {actor.description || 'No description'}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={actor.status === 'active' ? 'default' : 'secondary'}
            className="text-[10px] h-5"
          >
            {actor.status}
          </Badge>
          {actor.ai_actor_versions?.some(v => v.is_approved) && (
            <Badge variant="outline" className="text-[10px] h-5 gap-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" /> Approved
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {actor.ai_actor_versions?.length || 0} ver.
          </span>
          {usageCount > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Film className="h-2.5 w-2.5" /> {usageCount} project{usageCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {actor.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {actor.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Identity Strength Badge ─────────────────────────────────────────────────

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
      <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {config.label}
    </span>
  );
}

// ── Create Actor Form ───────────────────────────────────────────────────────

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
    }, {
      onSuccess: (data) => onCreated(data.actor.id),
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Detective Mira Vasquez" className="text-xs h-9" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description (identity prompt)</label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A weathered detective in her late 40s, sharp eyes, silver-streaked dark hair..."
          className="text-xs min-h-[80px]"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
        <Input
          value={negativePrompt}
          onChange={e => setNegativePrompt(e.target.value)}
          placeholder="celebrity, real person, cartoon, anime..."
          className="text-xs h-9"
        />
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

// ── Actor Detail ────────────────────────────────────────────────────────────

function ActorDetail({ actorId, usageEntries, onBack }: {
  actorId: string;
  usageEntries: { projectId: string; projectTitle: string; characterKey: string }[];
  onBack: () => void;
}) {
  const { data, isLoading } = useAIActor(actorId);
  const { updateActor, createVersion } = useAICastMutations();
  const actor: AIActor | undefined = data?.actor;

  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editNeg, setEditNeg] = useState('');
  const [initialized, setInitialized] = useState(false);

  if (actor && !initialized) {
    setEditName(actor.name);
    setEditDesc(actor.description);
    setEditNeg(actor.negative_prompt);
    setInitialized(true);
  }

  const handleSave = () => {
    updateActor.mutate({ actorId, name: editName, description: editDesc, negative_prompt: editNeg });
  };

  if (isLoading || !actor) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const versions: AIActorVersion[] = actor.ai_actor_versions || [];
  const identity = getIdentityStrength(versions);
  const thumbnail = getActorThumbnail(versions);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> Back to library
      </button>

      {/* Actor header with thumbnail */}
      <div className="flex gap-4">
        <div className="w-20 h-20 rounded-lg border border-border/50 overflow-hidden shrink-0 bg-muted/10">
          {thumbnail ? (
            <img src={thumbnail} alt={actor.name} className="w-full h-full object-cover" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Users className="h-6 w-6 text-muted-foreground/30" />
            </div>
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
              {identity.hasHeadshot ? '✓ Headshot' : '✗ No headshot'}
              {' · '}
              {identity.hasFullBody ? '✓ Full body' : '✗ No full body'}
              {' · '}
              {identity.totalAssets} asset{identity.totalAssets !== 1 ? 's' : ''}
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
        <Button size="sm" onClick={handleSave} disabled={updateActor.isPending} className="h-8 text-xs">
          Save Changes
        </Button>
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

      {/* Versions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Versions</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createVersion.mutate({ actorId })}>
            <Plus className="h-3 w-3" /> New Version
          </Button>
        </div>
        {versions.map(ver => (
          <VersionCard key={ver.id} ver={ver} actorId={actorId} />
        ))}
      </div>
    </div>
  );
}

// ── Version Card ────────────────────────────────────────────────────────────

function VersionCard({ ver, actorId }: { ver: AIActorVersion; actorId: string }) {
  const { approveVersion, generateScreenTest, deleteAsset } = useAICastMutations();
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
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" is not a supported image type (JPG, PNG, WEBP).`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`"${file.name}" exceeds the 10MB limit.`);
        continue;
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const rand = Math.random().toString(36).slice(2, 8);
      const storagePath = `actors/${actorId}/${ver.id}/reference/${Date.now()}_${rand}.${ext}`;
      try {
        const { error: uploadErr } = await supabase.storage
          .from('ai-media')
          .upload(storagePath, file, { contentType: file.type, upsert: false });
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
      toast.success(`Uploaded ${successCount} reference image${successCount > 1 ? 's' : ''}`);
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
          {ver.is_approved && (
            <Badge variant="outline" className="text-[10px] h-5 gap-0.5 text-emerald-600 border-emerald-600/30">
              <ShieldCheck className="h-2.5 w-2.5" /> Approved
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!ver.is_approved && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => approveVersion.mutate({ actorId, versionId: ver.id })}
              disabled={approveVersion.isPending}>
              <ShieldCheck className="h-3 w-3" /> Approve
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
            onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload
          </Button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleUpload} />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
            onClick={() => generateScreenTest.mutate({ actorId, versionId: ver.id, count: 4 })}
            disabled={generateScreenTest.isPending}>
            {generateScreenTest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Screen Test
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
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <ImagePlus className="h-5 w-5" />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1">
                <span className="text-[9px] text-white/80">{asset.asset_type.replace(/_/g, ' ')}</span>
              </div>
              <button
                onClick={() => setDeleteTarget(asset)}
                className="absolute top-1 right-1 p-1 rounded bg-background/70 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
              >
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
