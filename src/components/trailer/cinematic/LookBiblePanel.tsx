/**
 * Look Bible Panel — editor + summary pills for visual style constraints
 */
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Palette, Lock, ChevronDown, Save, Loader2, X, Plus, Eye } from 'lucide-react';
import { useLookBible, useLookBibleMutation } from '@/lib/trailerPipeline/lookBibleHooks';
import type { LookBible } from '@/lib/trailerPipeline/lookBibleApi';

interface LookBiblePanelProps {
  projectId: string;
  scopeRefId?: string;
}

export function LookBibleSummaryPills({ projectId, scopeRefId }: LookBiblePanelProps) {
  const { data: lb } = useLookBible(projectId, scopeRefId);
  if (!lb) return null;

  const pills: string[] = [];
  if (lb.palette) pills.push(lb.palette);
  if (lb.lighting_style) pills.push(lb.lighting_style);
  if (lb.contrast) pills.push(lb.contrast);
  if (lb.camera_language) pills.push(lb.camera_language);
  if (lb.grain) pills.push(lb.grain);
  if (lb.color_grade) pills.push(lb.color_grade);
  if (pills.length === 0 && !lb.avoid_list?.length) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Palette className="h-3 w-3 text-muted-foreground" />
      {lb.is_locked && <Lock className="h-2.5 w-2.5 text-amber-400" />}
      {pills.slice(0, 4).map((p, i) => (
        <Badge key={i} variant="outline" className="text-[8px] px-1.5 py-0 font-normal border-violet-500/30 text-violet-300">
          {p.length > 30 ? p.slice(0, 30) + '…' : p}
        </Badge>
      ))}
      {lb.avoid_list && lb.avoid_list.length > 0 && (
        <Badge variant="outline" className="text-[8px] px-1.5 py-0 font-normal border-destructive/30 text-destructive">
          avoid: {lb.avoid_list.slice(0, 3).join(', ')}{lb.avoid_list.length > 3 ? '…' : ''}
        </Badge>
      )}
    </div>
  );
}

export function LookBiblePanel({ projectId, scopeRefId }: LookBiblePanelProps) {
  const { data: lb, isLoading } = useLookBible(projectId, scopeRefId);
  const mutation = useLookBibleMutation(projectId);
  const [open, setOpen] = useState(false);

  const [palette, setPalette] = useState('');
  const [lightingStyle, setLightingStyle] = useState('');
  const [contrast, setContrast] = useState('');
  const [cameraLanguage, setCameraLanguage] = useState('');
  const [grain, setGrain] = useState('');
  const [colorGrade, setColorGrade] = useState('');
  const [referenceNotes, setReferenceNotes] = useState('');
  const [avoidList, setAvoidList] = useState<string[]>([]);
  const [customDirectives, setCustomDirectives] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [newAvoid, setNewAvoid] = useState('');

  // Sync state from loaded data
  useEffect(() => {
    if (lb) {
      setPalette(lb.palette || '');
      setLightingStyle(lb.lighting_style || '');
      setContrast(lb.contrast || '');
      setCameraLanguage(lb.camera_language || '');
      setGrain(lb.grain || '');
      setColorGrade(lb.color_grade || '');
      setReferenceNotes(lb.reference_assets_notes || '');
      setAvoidList(lb.avoid_list || []);
      setCustomDirectives(lb.custom_directives || '');
      setIsLocked(lb.is_locked || false);
    }
  }, [lb]);

  const handleSave = () => {
    mutation.mutate({
      id: lb?.id,
      project_id: projectId,
      scope: scopeRefId ? 'trailer_run' : 'project',
      scope_ref_id: scopeRefId || undefined,
      palette: palette || undefined,
      lighting_style: lightingStyle || undefined,
      contrast: contrast || undefined,
      camera_language: cameraLanguage || undefined,
      grain: grain || undefined,
      color_grade: colorGrade || undefined,
      reference_assets_notes: referenceNotes || undefined,
      avoid_list: avoidList.length > 0 ? avoidList : undefined,
      custom_directives: customDirectives || undefined,
      is_locked: isLocked,
    });
  };

  const addAvoidItem = () => {
    const item = newAvoid.trim();
    if (item && !avoidList.includes(item)) {
      setAvoidList([...avoidList, item]);
      setNewAvoid('');
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1.5 w-full justify-between">
          <span className="flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5" /> Look Bible
            {isLocked && <Lock className="h-2.5 w-2.5 text-amber-400" />}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Visual Style Constraints
              </span>
              <div className="flex items-center gap-2">
                <Label className="text-[9px] text-muted-foreground uppercase">Lock</Label>
                <Switch checked={isLocked} onCheckedChange={setIsLocked} />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Palette</Label>
                    <Input className="h-7 text-[11px]" placeholder="cool cyan shadows, tungsten practicals" value={palette} onChange={e => setPalette(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Lighting Style</Label>
                    <Input className="h-7 text-[11px]" placeholder="low-key chiaroscuro, warm practicals" value={lightingStyle} onChange={e => setLightingStyle(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Contrast</Label>
                    <Input className="h-7 text-[11px]" placeholder="high contrast, deep blacks" value={contrast} onChange={e => setContrast(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Camera Language</Label>
                    <Input className="h-7 text-[11px]" placeholder="shallow DOF, anamorphic" value={cameraLanguage} onChange={e => setCameraLanguage(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Grain / Texture</Label>
                    <Input className="h-7 text-[11px]" placeholder="35mm grain, subtle noise" value={grain} onChange={e => setGrain(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Color Grade</Label>
                    <Input className="h-7 text-[11px]" placeholder="desaturated cool tones" value={colorGrade} onChange={e => setColorGrade(e.target.value)} />
                  </div>
                </div>

                <Separator />

                {/* Avoid List */}
                <div>
                  <Label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5 block">Avoid List (hard negatives)</Label>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {avoidList.map((item, i) => (
                      <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0.5 border-destructive/40 text-destructive gap-1">
                        {item}
                        <button onClick={() => setAvoidList(avoidList.filter((_, j) => j !== i))}>
                          <X className="h-2 w-2" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input className="h-7 text-[11px] flex-1" placeholder="e.g. neon, lens flare, dutch angle" value={newAvoid} onChange={e => setNewAvoid(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAvoidItem()} />
                    <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={addAvoidItem}>
                      <Plus className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Reference Assets Notes</Label>
                    <Textarea className="text-[11px] min-h-[50px]" placeholder="Links or descriptions of reference images/videos…" value={referenceNotes} onChange={e => setReferenceNotes(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[9px] text-muted-foreground uppercase tracking-wider">Custom Directives</Label>
                    <Textarea className="text-[11px] min-h-[50px]" placeholder="Additional style directions for AI generation…" value={customDirectives} onChange={e => setCustomDirectives(e.target.value)} />
                  </div>
                </div>

                <Button size="sm" onClick={handleSave} disabled={mutation.isPending} className="gap-1.5">
                  {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save Look Bible
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
