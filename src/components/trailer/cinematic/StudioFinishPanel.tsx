/**
 * Studio Finish Panel — Finishing profiles, render variants, social exports
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Film, Download, Monitor, Smartphone, Square, RectangleHorizontal, Paintbrush, Sparkles } from 'lucide-react';
import { useFinishingProfiles, useRenderVariants, useStudioFinishMutations } from '@/lib/trailerPipeline/studioFinishHooks';
import { useTrailerCuts } from '@/lib/trailerPipeline/assemblerHooks';

interface StudioFinishPanelProps {
  projectId: string;
  scriptRunId?: string;
}

const VARIANT_ICONS: Record<string, any> = {
  master_16x9: Monitor,
  social_9x16: Smartphone,
  feed_4x5: RectangleHorizontal,
  square_1x1: Square,
};

const VARIANT_LABELS: Record<string, string> = {
  master_16x9: 'Master 16:9 (1920×1080)',
  social_9x16: 'Stories/Reels 9:16 (1080×1920)',
  feed_4x5: 'Instagram Feed 4:5 (1080×1350)',
  square_1x1: 'Square 1:1 (1080×1080)',
};

export function StudioFinishPanel({ projectId, scriptRunId }: StudioFinishPanelProps) {
  const { data: profilesData } = useFinishingProfiles(projectId);
  const { data: cutsData } = useTrailerCuts(projectId, undefined);
  const [selectedCutId, setSelectedCutId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [selectedVariants, setSelectedVariants] = useState<string[]>(['master_16x9']);

  // Custom finish settings
  const [grain, setGrain] = useState(0.05);
  const [contrast, setContrast] = useState(0.1);
  const [saturation, setSaturation] = useState(0);
  const [sharpen, setSharpen] = useState(0.3);
  const [letterbox, setLetterbox] = useState(true);
  const [colorConsistency, setColorConsistency] = useState(true);
  const [colorStrength, setColorStrength] = useState(0.6);

  const { data: variantsData } = useRenderVariants(projectId, selectedCutId);
  const { createRenderVariants } = useStudioFinishMutations(projectId);

  const profiles = profilesData?.profiles || [];
  const cuts = cutsData?.cuts || [];
  const variants = variantsData?.variants || [];

  // Auto-select first cut
  if (cuts.length > 0 && !selectedCutId) {
    setSelectedCutId(cuts[0].id);
  }

  const handleRender = (variantKeys: string[]) => {
    if (!selectedCutId) return;
    createRenderVariants.mutate({
      cutId: selectedCutId,
      finishingProfileId: selectedProfileId,
      variantKeys,
    });
  };

  const toggleVariant = (key: string) => {
    setSelectedVariants(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Paintbrush className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Studio Finish</h2>
        <Badge variant="outline" className="text-[10px]">v1</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Settings */}
        <div className="space-y-4">
          {/* Cut Selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Select Cut</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedCutId || ''} onValueChange={setSelectedCutId}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose a cut to finish" />
                </SelectTrigger>
                <SelectContent>
                  {cuts.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title || c.id.slice(0, 8)} · {c.status} · {Math.round((c.duration_ms || 0) / 1000)}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Profile Selector */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Finishing Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selectedProfileId || ''} onValueChange={(v) => {
                setSelectedProfileId(v);
                const p = profiles.find((p: any) => p.id === v);
                if (p) {
                  setGrain(p.grain_amount || 0);
                  setContrast(p.contrast_boost || 0);
                  setSaturation(p.saturation_boost || 0);
                  setSharpen(p.sharpen_amount || 0);
                  setLetterbox(p.letterbox_enabled || false);
                  setColorConsistency(p.color_consistency_enabled ?? true);
                  setColorStrength(p.color_consistency_strength ?? 0.6);
                }
              }}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.is_preset && <span className="text-muted-foreground">(Preset)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sliders */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Film Grain</Label>
                  <span className="text-[10px] text-muted-foreground">{grain.toFixed(2)}</span>
                </div>
                <Slider value={[grain]} onValueChange={([v]) => setGrain(v)} min={0} max={0.3} step={0.01} />

                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Contrast</Label>
                  <span className="text-[10px] text-muted-foreground">{contrast.toFixed(2)}</span>
                </div>
                <Slider value={[contrast]} onValueChange={([v]) => setContrast(v)} min={-0.3} max={0.5} step={0.01} />

                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Saturation</Label>
                  <span className="text-[10px] text-muted-foreground">{saturation.toFixed(2)}</span>
                </div>
                <Slider value={[saturation]} onValueChange={([v]) => setSaturation(v)} min={-0.3} max={0.3} step={0.01} />

                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Sharpen</Label>
                  <span className="text-[10px] text-muted-foreground">{sharpen.toFixed(2)}</span>
                </div>
                <Slider value={[sharpen]} onValueChange={([v]) => setSharpen(v)} min={0} max={1} step={0.05} />
              </div>

              {/* Toggles */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Letterbox (2.39:1)</Label>
                  <Switch checked={letterbox} onCheckedChange={setLetterbox} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Color Consistency</Label>
                  <Switch checked={colorConsistency} onCheckedChange={setColorConsistency} />
                </div>
                {colorConsistency && (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px]">Consistency Strength</Label>
                      <span className="text-[10px] text-muted-foreground">{colorStrength.toFixed(1)}</span>
                    </div>
                    <Slider value={[colorStrength]} onValueChange={([v]) => setColorStrength(v)} min={0} max={1} step={0.1} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Variants + Render */}
        <div className="space-y-4">
          {/* Variant Selection */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Export Variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(VARIANT_LABELS).map(([key, label]) => {
                const Icon = VARIANT_ICONS[key] || Film;
                const selected = selectedVariants.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleVariant(key)}
                    className={`w-full flex items-center gap-2 p-2 rounded-md border text-xs transition-colors ${
                      selected
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  className="flex-1 text-xs"
                  disabled={!selectedCutId || selectedVariants.length === 0 || createRenderVariants.isPending}
                  onClick={() => handleRender(selectedVariants)}
                >
                  {createRenderVariants.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-3 w-3 mr-1" />
                  )}
                  Render {selectedVariants.length > 1 ? 'Social Pack' : 'Master'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => handleRender(['master_16x9'])}
                  disabled={!selectedCutId || createRenderVariants.isPending}
                >
                  Master Only
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Render Variants List */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rendered Variants</CardTitle>
            </CardHeader>
            <CardContent>
              {variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">No renders yet. Select a cut and render above.</p>
              ) : (
                <div className="space-y-2">
                  {variants.map((v: any) => {
                    const Icon = VARIANT_ICONS[v.variant_key] || Film;
                    const statusColor = v.status === 'complete' ? 'text-green-500' : v.status === 'error' ? 'text-destructive' : 'text-muted-foreground';
                    return (
                      <div key={v.id} className="flex items-center gap-2 p-2 border border-border rounded-md">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {VARIANT_LABELS[v.variant_key] || v.variant_key}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {v.width}×{v.height} · {v.frame_rate}fps
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-[9px] ${statusColor}`}>
                          {v.status}
                        </Badge>
                        {v.public_url && (
                          <a href={v.public_url} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <Download className="h-3 w-3" />
                            </Button>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
