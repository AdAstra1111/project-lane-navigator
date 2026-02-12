import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LANE_LABELS, type MonetisationLane } from '@/lib/types';
import type { PitchIdea } from '@/hooks/usePitchIdeas';

interface Props {
  idea: PitchIdea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromote: (params: { title: string; budgetBand: string; lane: string }) => Promise<void>;
  promoting: boolean;
}

const BUDGET_BANDS = ['Micro (<$500K)', 'Low ($500K–$2M)', 'Mid ($2M–$10M)', 'Mid-High ($10M–$25M)', 'High ($25M–$50M)', 'Studio ($50M+)'];

export function PromoteToProjectDialog({ idea, open, onOpenChange, onPromote, promoting }: Props) {
  const [title, setTitle] = useState(idea.title);
  const [budgetBand, setBudgetBand] = useState(idea.budget_band || '');
  const [lane, setLane] = useState(idea.recommended_lane || '');

  const handlePromote = async () => {
    await onPromote({ title, budgetBand, lane });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Promote to Project
          </DialogTitle>
          <DialogDescription>
            Create a full project from this locked concept. All expansion documents and scores will be attached.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Production type (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Production Type</Label>
            <Badge variant="secondary" className="text-sm">{idea.production_type}</Badge>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="promote-title">Project Title</Label>
            <Input
              id="promote-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
            />
          </div>

          {/* Budget Band */}
          <div className="space-y-1.5">
            <Label>Budget Band</Label>
            <Select value={budgetBand} onValueChange={setBudgetBand}>
              <SelectTrigger>
                <SelectValue placeholder="Select budget band" />
              </SelectTrigger>
              <SelectContent>
                {BUDGET_BANDS.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Monetisation Lane */}
          <div className="space-y-1.5">
            <Label>Monetisation Lane</Label>
            <Select value={lane} onValueChange={setLane}>
              <SelectTrigger>
                <SelectValue placeholder="Select lane" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Concept Lock info */}
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p>• Genre: <span className="text-foreground">{idea.genre}</span></p>
            <p>• Lane Confidence: <span className="text-foreground">{idea.lane_confidence}%</span></p>
            <p>• Comps: <span className="text-foreground">{idea.comps?.join(', ') || 'None'}</span></p>
            <p>• Lock Version: <span className="text-foreground">v{(idea as any).concept_lock_version || 1}</span></p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={promoting}>
            Cancel
          </Button>
          <Button onClick={handlePromote} disabled={promoting || !title.trim()} className="gap-1.5">
            {promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
