/**
 * AI Cast Library — Global actor list + create + detail management.
 */
import { useState } from 'react';
import { Users, Plus, Loader2, CheckCircle2, Search, Tag, Sparkles, ChevronRight, ImagePlus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAIActors, useAIActor, useAICastMutations } from '@/lib/aiCast/useAICast';
import type { AIActor, AIActorVersion, AIActorAsset } from '@/lib/aiCast/aiCastApi';

export default function AICastLibrary() {
  const { data, isLoading } = useAIActors();
  const actors: AIActor[] = data?.actors || [];
  const [search, setSearch] = useState('');
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const filtered = actors.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  if (selectedActorId) {
    return <ActorDetail actorId={selectedActorId} onBack={() => setSelectedActorId(null)} />;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5" /> AI Cast Library
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Create and manage original AI actors for your productions</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs gap-1.5"><Plus className="h-3.5 w-3.5" /> New Actor</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create AI Actor</DialogTitle></DialogHeader>
            <CreateActorForm onCreated={(id) => { setShowCreate(false); setSelectedActorId(id); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Search actors..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-xs" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {actors.length === 0 ? 'No AI actors yet. Create your first one.' : 'No actors match your search.'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(actor => (
            <button
              key={actor.id}
              onClick={() => setSelectedActorId(actor.id)}
              className="text-left p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-muted/20 transition-colors space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground truncate">{actor.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">{actor.description || 'No description'}</p>
              <div className="flex items-center gap-2">
                <Badge variant={actor.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-5">
                  {actor.status}
                </Badge>
                {actor.ai_actor_versions?.some((v: any) => v.is_approved) && (
                  <Badge variant="outline" className="text-[10px] h-5 gap-0.5">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Approved
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {actor.ai_actor_versions?.length || 0} ver.
                </span>
              </div>
              {actor.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {actor.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tag}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateActorForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { createActor } = useAICastMutations();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [negativePompt, setNegativePrompt] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  const handleSubmit = () => {
    createActor.mutate({
      name: name || 'Untitled Actor',
      description,
      negative_prompt: negativePompt,
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
        <Textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="A weathered detective in her late 40s, sharp eyes, silver-streaked dark hair..."
          className="text-xs min-h-[80px]" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Negative prompt</label>
        <Input value={negativePompt} onChange={e => setNegativePrompt(e.target.value)}
          placeholder="celebrity, real person, cartoon, anime..." className="text-xs h-9" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
        <Input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="lead, detective, noir" className="text-xs h-9" />
      </div>
      <Button onClick={handleSubmit} disabled={createActor.isPending} className="w-full h-9 text-xs">
        {createActor.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
        Create Actor
      </Button>
    </div>
  );
}

function ActorDetail({ actorId, onBack }: { actorId: string; onBack: () => void }) {
  const { data, isLoading } = useAIActor(actorId);
  const { updateActor, approveVersion, generateScreenTest, createVersion } = useAICastMutations();
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
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const versions: AIActorVersion[] = actor.ai_actor_versions || [];
  const latestVersion = versions[versions.length - 1];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Back to library</button>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-semibold text-foreground">{actor.name}</h2>
        <Badge variant={actor.status === 'active' ? 'default' : 'secondary'}>{actor.status}</Badge>
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

      {/* Versions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Versions</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createVersion.mutate({ actorId })}>
            <Plus className="h-3 w-3" /> New Version
          </Button>
        </div>

        {versions.map((ver) => (
          <div key={ver.id} className="border border-border/50 rounded-lg p-4 space-y-3 bg-card/30">
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
                  onClick={() => generateScreenTest.mutate({ actorId, versionId: ver.id, count: 4 })}
                  disabled={generateScreenTest.isPending}>
                  {generateScreenTest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Screen Test
                </Button>
              </div>
            </div>

            {/* Assets grid */}
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
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">No assets yet. Run a screen test to generate reference images.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
