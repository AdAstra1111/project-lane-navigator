/**
 * GenerateShotListModal — Modal for generating a shot list from a script document.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Loader2 } from 'lucide-react';
import { useShotList } from '@/hooks/useShotList';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  sourceDocumentId: string;
  sourceVersionId: string;
  docType?: string;
  episodeNumber?: number;
  isVerticalDrama?: boolean;
}

export function GenerateShotListModal({
  open, onOpenChange, projectId,
  sourceDocumentId, sourceVersionId,
  docType, episodeNumber, isVerticalDrama,
}: Props) {
  const navigate = useNavigate();
  const { generate } = useShotList(projectId);
  const [name, setName] = useState('');
  const [scopeMode, setScopeMode] = useState<'full' | 'scene_range'>('full');
  const [fromScene, setFromScene] = useState('1');
  const [toScene, setToScene] = useState('10');

  const defaultName = episodeNumber
    ? `Shot List — EP ${episodeNumber}`
    : docType === 'season_master_script'
    ? 'Shot List — Master Script'
    : 'Shot List';

  const handleGenerate = async () => {
    const scope = scopeMode === 'scene_range'
      ? { mode: 'scene_range', from_scene: fromScene, to_scene: toScene }
      : { mode: 'full' };

    const result = await generate.mutateAsync({
      sourceDocumentId,
      sourceVersionId,
      episodeNumber,
      scope,
      name: name || defaultName,
      isVerticalDrama,
    });

    onOpenChange(false);
    navigate(`/projects/${projectId}/shot-list?list=${result.shot_list_id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Generate Shot List
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-8 text-xs"
              placeholder={defaultName}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Scope</Label>
            <Select value={scopeMode} onValueChange={v => setScopeMode(v as any)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full" className="text-xs">Full script</SelectItem>
                <SelectItem value="scene_range" className="text-xs">Scene range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scopeMode === 'scene_range' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">From scene</Label>
                <Input value={fromScene} onChange={e => setFromScene(e.target.value)} className="h-7 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">To scene</Label>
                <Input value={toScene} onChange={e => setToScene(e.target.value)} className="h-7 text-xs" />
              </div>
            </div>
          )}

          <Button className="w-full gap-2" onClick={handleGenerate} disabled={generate.isPending}>
            {generate.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
            ) : (
              <><Camera className="h-4 w-4" />Generate Shot List</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
