/**
 * GenerateSeedPackModal — UI for generating a deterministic seed pack.
 * Triggered explicitly by user. Never auto-runs.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sprout, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultLane?: string;
  onSuccess?: () => void;
}

const LANE_OPTIONS = [
  { value: 'feature_film', label: 'Feature Film' },
  { value: 'series', label: 'Series' },
  { value: 'vertical_drama', label: 'Vertical Drama' },
  { value: 'documentary', label: 'Documentary' },
];

export function GenerateSeedPackModal({ open, onOpenChange, projectId, defaultLane, onSuccess }: Props) {
  const [pitch, setPitch] = useState('');
  const [lane, setLane] = useState(defaultLane || 'feature_film');
  const [targetPlatform, setTargetPlatform] = useState('');
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    if (!pitch.trim()) {
      toast({ title: 'Pitch required', description: 'Enter your project pitch to generate a seed pack.', variant: 'destructive' });
      return;
    }

    setStatus('generating');
    setErrorMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('generate-seed-pack', {
        body: {
          projectId,
          pitch: pitch.trim(),
          lane,
          targetPlatform: targetPlatform.trim() || null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setStatus('success');
      toast({ title: 'Seed Pack generated', description: `${data.documents?.length || 0} documents created.` });
      onSuccess?.();

      // Auto-close after brief delay
      setTimeout(() => {
        onOpenChange(false);
        setStatus('idle');
        setPitch('');
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const handleClose = (v: boolean) => {
    if (status === 'generating') return; // prevent close during generation
    onOpenChange(v);
    if (!v) {
      setStatus('idle');
      setErrorMsg('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-primary" />
            Generate Seed Pack
          </DialogTitle>
          <DialogDescription>
            Create structured scaffold documents from your pitch. This will not overwrite any existing user-authored documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="seed-pitch">Project Pitch</Label>
            <Textarea
              id="seed-pitch"
              placeholder="Describe your project concept, story, and vision..."
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              rows={5}
              disabled={status === 'generating'}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Lane</Label>
              <Select value={lane} onValueChange={setLane} disabled={status === 'generating'}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seed-platform">Target Platform <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="seed-platform"
                placeholder="e.g. Netflix, HBO"
                value={targetPlatform}
                onChange={(e) => setTargetPlatform(e.target.value)}
                disabled={status === 'generating'}
              />
            </div>
          </div>

          {/* Status feedback */}
          {status === 'generating' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-lg bg-muted/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating seed pack — this may take a moment...
            </div>
          )}
          {status === 'success' && (
            <div className="flex items-center gap-2 text-sm text-emerald-500 p-3 rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4" />
              Seed pack generated successfully.
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              {errorMsg || 'Generation failed. Please try again.'}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={status === 'generating'}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={status === 'generating' || !pitch.trim()} className="gap-1.5">
            {status === 'generating' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sprout className="h-3.5 w-3.5" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
