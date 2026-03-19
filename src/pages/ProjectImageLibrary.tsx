/**
 * ProjectImageLibrary — Browsable repository of all project images.
 * Shows every generated image (active, variant, historical) with filtering.
 */
import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Image, Filter, Star, StarOff, Loader2, Expand, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProjectImages } from '@/hooks/useProjectImages';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, ProjectImageRole } from '@/lib/images/types';

const ROLE_LABELS: Record<string, string> = {
  poster_primary: 'Poster (Primary)',
  poster_variant: 'Poster Variant',
  character_primary: 'Character (Primary)',
  character_variant: 'Character Variant',
  world_establishing: 'World — Establishing',
  world_detail: 'World — Detail',
  visual_reference: 'Visual Reference',
  lookbook_cover: 'Look Book Cover',
  marketing_variant: 'Marketing Variant',
};

const STRATEGY_LABELS: Record<string, string> = {
  character: 'Character Focus',
  world: 'World / Environment',
  conflict: 'Conflict / Action',
  prestige: 'Symbolic / Prestige',
  commercial: 'Commercial / High-Concept',
  genre: 'Genre Pure',
};

export default function ProjectImageLibrary() {
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<ProjectImage | null>(null);

  // Fetch ALL images (not just active)
  const { data: allImages = [], isLoading } = useProjectImages(projectId, {
    activeOnly: false,
  });

  const filtered = useMemo(() => {
    let imgs = allImages;
    if (roleFilter !== 'all') imgs = imgs.filter(i => i.role === roleFilter);
    if (strategyFilter !== 'all') imgs = imgs.filter(i => i.strategy_key === strategyFilter);
    if (!showInactive) imgs = imgs.filter(i => i.is_active);
    return imgs;
  }, [allImages, roleFilter, strategyFilter, showInactive]);

  // Derive available filters from data
  const availableRoles = useMemo(() => [...new Set(allImages.map(i => i.role))], [allImages]);
  const availableStrategies = useMemo(
    () => [...new Set(allImages.map(i => i.strategy_key).filter(Boolean))] as string[],
    [allImages],
  );

  const handleSetPrimary = async (image: ProjectImage) => {
    if (!projectId) return;
    try {
      // Deactivate existing primaries for same role
      await (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('role', image.role);

      await (supabase as any)
        .from('project_images')
        .update({ is_primary: true, is_active: true })
        .eq('id', image.id);

      // If it's a poster, also sync project_posters active state
      if (image.source_poster_id && (image.role === 'poster_primary' || image.role === 'poster_variant')) {
        await (supabase as any)
          .from('project_posters')
          .update({ is_active: false })
          .eq('project_id', projectId);
        await (supabase as any)
          .from('project_posters')
          .update({ is_active: true })
          .eq('id', image.source_poster_id);
        // Promote to poster_primary role
        await (supabase as any)
          .from('project_images')
          .update({ role: 'poster_primary' })
          .eq('id', image.id);
      }

      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      qc.invalidateQueries({ queryKey: ['project-posters', projectId] });
      toast.success('Set as primary');
    } catch (e: any) {
      toast.error(e.message || 'Failed to set primary');
    }
  };

  const handleDelete = async (image: ProjectImage) => {
    if (!projectId || !confirm('Delete this image permanently?')) return;
    try {
      // Delete storage
      await supabase.storage.from(image.storage_bucket || 'project-posters').remove([image.storage_path]);
      // Delete record
      await (supabase as any).from('project_images').delete().eq('id', image.id);
      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      toast.success('Image deleted');
      if (lightboxImage?.id === image.id) setLightboxImage(null);
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header + Filters */}
      <div className="px-4 py-3 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Image Library</h2>
            <Badge variant="secondary" className="text-xs">{allImages.length} images</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {availableRoles.map(r => (
                <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {availableStrategies.length > 0 && (
            <Select value={strategyFilter} onValueChange={setStrategyFilter}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="All strategies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All strategies</SelectItem>
                {availableStrategies.map(s => (
                  <SelectItem key={s} value={s}>{STRATEGY_LABELS[s] || s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={showInactive ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowInactive(!showInactive)}
          >
            {showInactive ? 'Showing all' : 'Active only'}
          </Button>
        </div>
      </div>

      {/* Gallery Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Image className="h-7 w-7 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            No images yet. Generate posters or visual assets to populate the library.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(img => (
              <Card
                key={img.id}
                className={cn(
                  'group relative overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/40',
                  !img.is_active && 'opacity-60',
                  img.is_primary && 'ring-2 ring-primary',
                )}
                onClick={() => setLightboxImage(img)}
              >
                <div className="aspect-[2/3] bg-muted relative">
                  {img.signedUrl ? (
                    <img
                      src={img.signedUrl}
                      alt={`${img.role} — ${img.strategy_key || 'image'}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}

                  {/* Badges overlay */}
                  <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                    {img.is_primary && (
                      <Badge className="text-[10px] bg-primary/90 text-primary-foreground px-1.5 py-0">
                        <Star className="h-2.5 w-2.5 mr-0.5" /> Primary
                      </Badge>
                    )}
                    {img.strategy_key && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {STRATEGY_LABELS[img.strategy_key] || img.strategy_key}
                      </Badge>
                    )}
                  </div>

                  {/* Actions on hover */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-end">
                    <span className="text-[10px] text-white/80">{ROLE_LABELS[img.role] || img.role}</span>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-white hover:bg-white/20"
                        onClick={(e) => { e.stopPropagation(); setLightboxImage(img); }}
                      >
                        <Expand className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox Dialog */}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-black/95 border-border">
          <DialogTitle className="sr-only">Image detail</DialogTitle>
          {lightboxImage && (
            <div className="flex flex-col h-full">
              <div className="flex-1 flex items-center justify-center p-4 min-h-0">
                {lightboxImage.signedUrl ? (
                  <img
                    src={lightboxImage.signedUrl}
                    alt="Full size"
                    className="max-w-full max-h-[70vh] object-contain rounded"
                  />
                ) : (
                  <p className="text-muted-foreground">Image unavailable</p>
                )}
              </div>

              <div className="p-4 bg-card border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{ROLE_LABELS[lightboxImage.role] || lightboxImage.role}</Badge>
                    {lightboxImage.strategy_key && (
                      <Badge variant="secondary">{STRATEGY_LABELS[lightboxImage.strategy_key] || lightboxImage.strategy_key}</Badge>
                    )}
                    {lightboxImage.is_primary && (
                      <Badge className="bg-primary text-primary-foreground"><Star className="h-3 w-3 mr-1" /> Primary</Badge>
                    )}
                    {!lightboxImage.is_active && (
                      <Badge variant="destructive" className="text-xs">Inactive</Badge>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!lightboxImage.is_primary && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={() => { handleSetPrimary(lightboxImage); setLightboxImage(null); }}
                      >
                        <Star className="h-3 w-3" /> Set as Primary
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1.5 text-xs"
                      onClick={() => handleDelete(lightboxImage)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </div>

                {/* Generation metadata */}
                {(lightboxImage.model || lightboxImage.style_mode) && (
                  <div className="flex flex-wrap gap-1.5">
                    {lightboxImage.style_mode && (
                      <Badge variant="outline" className="text-[10px]">
                        {lightboxImage.style_mode.replace(/_/g, ' ')}
                      </Badge>
                    )}
                    {lightboxImage.model && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {lightboxImage.model.split('/').pop()}
                      </Badge>
                    )}
                    {lightboxImage.provider && (
                      <Badge variant="outline" className="text-[10px]">
                        {lightboxImage.provider}
                      </Badge>
                    )}
                  </div>
                )}

                {lightboxImage.prompt_used && (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                      View prompt
                    </summary>
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto bg-muted/50 p-2 rounded text-[11px]">
                      {lightboxImage.prompt_used}
                    </p>
                  </details>
                )}

                {lightboxImage.generation_config && Object.keys(lightboxImage.generation_config).length > 0 && (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                      View generation config
                    </summary>
                    <pre className="mt-1 text-muted-foreground max-h-32 overflow-y-auto bg-muted/50 p-2 rounded text-[11px]">
                      {JSON.stringify(lightboxImage.generation_config, null, 2)}
                    </pre>
                  </details>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Created {new Date(lightboxImage.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
