/**
 * VisualReferencesPage — Project-level hub for character/location/style reference packs.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { PageTransition } from '@/components/PageTransition';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, Plus, Trash2, Upload, Lock, Unlock, Palette,
  MapPin, User, Loader2, X, ImagePlus, Star,
} from 'lucide-react';
import { useVisualReferences, type VisualReferenceSet, type VisualReferenceAsset } from '@/hooks/useVisualReferences';

export default function VisualReferencesPage() {
  const { id: projectId } = useParams<{ id: string }>();

  const { data: project } = useQuery({
    queryKey: ['visref-project', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('title').eq('id', projectId!).single();
      return data;
    },
    enabled: !!projectId,
  });

  const {
    characters, locations, styles, refAssets, setsLoading,
    createRefSet, updateRefSet, deleteRefSet, uploadRefImage, deleteRefAsset, getImageUrl,
  } = useVisualReferences(projectId);

  const [activeTab, setActiveTab] = useState('characters');
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<'character' | 'location' | 'style'>('character');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPromptStub, setNewPromptStub] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);

  const openCreate = (type: 'character' | 'location' | 'style') => {
    setCreateType(type);
    setNewName('');
    setNewDesc('');
    setNewPromptStub('');
    setNewIsDefault(false);
    setCreateOpen(true);
  };

  const handleCreate = () => {
    const data = createType === 'style' ? { prompt_stub: newPromptStub } : null;
    createRefSet.mutate({
      ref_type: createType,
      name: newName,
      description: newDesc || undefined,
      data,
      is_default: newIsDefault,
    });
    setCreateOpen(false);
  };

  const renderRefList = (items: VisualReferenceSet[], type: 'character' | 'location' | 'style') => {
    if (setsLoading) {
      return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    }
    if (items.length === 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No {type} references yet.
            </p>
            <Button size="sm" className="gap-1 text-xs" onClick={() => openCreate(type)}>
              <Plus className="h-3 w-3" />Add {type}
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => openCreate(type)}>
            <Plus className="h-3 w-3" />Add {type}
          </Button>
        </div>
        {items.map(item => (
          <RefSetCard
            key={item.id}
            refSet={item}
            assets={refAssets.filter(a => a.reference_set_id === item.id)}
            onUpdate={(updates) => updateRefSet.mutate({ id: item.id, updates })}
            onDelete={() => deleteRefSet.mutate(item.id)}
            onUploadImage={(file) => uploadRefImage.mutate({ refSetId: item.id, file })}
            onDeleteAsset={(id, path) => deleteRefAsset.mutate({ id, storagePath: path })}
            getImageUrl={getImageUrl}
          />
        ))}
      </div>
    );
  };

  return (
    <PageTransition>
      <Header />
      <div className="min-h-screen bg-background pt-16">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-6">
            <Link to={`/projects/${projectId}`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                <ArrowLeft className="h-3 w-3" />Back
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                Visual References
              </h1>
              {project?.title && (
                <p className="text-xs text-muted-foreground">{project.title}</p>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="characters" className="gap-1 text-xs">
                <User className="h-3 w-3" />Characters ({characters.length})
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-1 text-xs">
                <MapPin className="h-3 w-3" />Locations ({locations.length})
              </TabsTrigger>
              <TabsTrigger value="styles" className="gap-1 text-xs">
                <Palette className="h-3 w-3" />Styles ({styles.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="characters">{renderRefList(characters, 'character')}</TabsContent>
            <TabsContent value="locations">{renderRefList(locations, 'location')}</TabsContent>
            <TabsContent value="styles">{renderRefList(styles, 'style')}</TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Add {createType} reference</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs" placeholder={createType === 'character' ? 'e.g. SARAH' : createType === 'location' ? 'e.g. Warehouse' : 'e.g. Clean Line'} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} className="text-xs min-h-[60px]" placeholder={createType === 'character' ? 'Age, wardrobe, vibe…' : createType === 'location' ? 'Architecture, palette, time of day…' : 'Rendering rules…'} />
            </div>
            {createType === 'style' && (
              <div className="space-y-1">
                <Label className="text-xs">Prompt stub</Label>
                <Textarea value={newPromptStub} onChange={e => setNewPromptStub(e.target.value)} className="text-xs min-h-[50px]" placeholder="e.g. clean line storyboard, monochrome, minimal shading…" />
              </div>
            )}
            {createType === 'style' && (
              <div className="flex items-center gap-2">
                <Switch checked={newIsDefault} onCheckedChange={setNewIsDefault} />
                <Label className="text-xs">Set as default style</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" className="text-xs" onClick={handleCreate} disabled={!newName.trim() || createRefSet.isPending}>
              {createRefSet.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

// ── Reference Set Card ──
function RefSetCard({
  refSet, assets, onUpdate, onDelete, onUploadImage, onDeleteAsset, getImageUrl,
}: {
  refSet: VisualReferenceSet;
  assets: VisualReferenceAsset[];
  onUpdate: (updates: Partial<VisualReferenceSet>) => void;
  onDelete: () => void;
  onUploadImage: (file: File) => void;
  onDeleteAsset: (id: string, path: string) => void;
  getImageUrl: (path: string) => Promise<string | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(refSet.name);
  const [editDesc, setEditDesc] = useState(refSet.description || '');

  const handleSave = () => {
    onUpdate({ name: editName, description: editDesc || null });
    setEditing(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUploadImage(f);
    e.target.value = '';
  };

  const icon = refSet.ref_type === 'character' ? <User className="h-3.5 w-3.5 text-primary" />
    : refSet.ref_type === 'location' ? <MapPin className="h-3.5 w-3.5 text-primary" />
    : <Palette className="h-3.5 w-3.5 text-primary" />;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            {editing ? (
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-6 w-40 text-xs" autoFocus />
            ) : (
              <CardTitle className="text-sm">{refSet.name}</CardTitle>
            )}
            {refSet.is_default && (
              <Badge variant="outline" className="text-[8px] gap-0.5">
                <Star className="h-2 w-2" />Default
              </Badge>
            )}
            {refSet.locked && (
              <Badge variant="outline" className="text-[8px] gap-0.5 border-[hsl(var(--chart-4)/0.3)] text-[hsl(var(--chart-4))]">
                <Lock className="h-2 w-2" />Locked
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onUpdate({ locked: !refSet.locked })}>
              {refSet.locked ? <Lock className="h-3 w-3 text-[hsl(var(--chart-4))]" /> : <Unlock className="h-3 w-3" />}
            </Button>
            {editing ? (
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleSave}>Save</Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditing(true)}>Edit</Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {editing ? (
          <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className="text-xs min-h-[40px]" placeholder="Description…" />
        ) : refSet.description ? (
          <p className="text-xs text-muted-foreground">{refSet.description}</p>
        ) : null}

        {refSet.ref_type === 'style' && refSet.data?.prompt_stub && (
          <div className="bg-muted/30 rounded-md p-2">
            <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Prompt stub:</p>
            <p className="text-[10px] text-foreground">{refSet.data.prompt_stub}</p>
          </div>
        )}

        {/* Reference images */}
        <div className="flex flex-wrap gap-2">
          {assets.map(asset => (
            <AssetThumb key={asset.id} asset={asset} getImageUrl={getImageUrl} onDelete={() => onDeleteAsset(asset.id, asset.storage_path)} />
          ))}
          {assets.length < 8 && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-16 h-16 rounded-md border-2 border-dashed border-border/50 flex items-center justify-center hover:border-border hover:bg-muted/30 transition-colors"
            >
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Asset Thumbnail ──
function AssetThumb({
  asset, getImageUrl, onDelete,
}: {
  asset: VisualReferenceAsset;
  getImageUrl: (path: string) => Promise<string | null>;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getImageUrl(asset.storage_path).then(setUrl);
  }, [asset.storage_path]);

  return (
    <div className="relative group w-16 h-16 rounded-md overflow-hidden border border-border">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-muted/30 flex items-center justify-center">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      )}
      <button
        onClick={onDelete}
        className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-2.5 w-2.5 text-destructive" />
      </button>
    </div>
  );
}
