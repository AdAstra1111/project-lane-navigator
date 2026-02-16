import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Loader2, Send } from 'lucide-react';

const DESIRED_OUTCOMES = [
  { value: 'continuity', label: 'Continuity Fix' },
  { value: 'character', label: 'Character Issue' },
  { value: 'structure', label: 'Structure Problem' },
  { value: 'dialogue', label: 'Dialogue Polish' },
  { value: 'rewrite_scenes', label: 'Rewrite Scenes' },
  { value: 'full_rewrite', label: 'Full Rewrite' },
  { value: 'other', label: 'Other' },
] as const;

const DEFAULT_CONTEXT_DOCS = [
  { key: 'blueprint', label: 'Blueprint / Season Arc' },
  { key: 'character_bible', label: 'Character Bible' },
  { key: 'episode_grid', label: 'Episode Grid' },
  { key: 'format_rules', label: 'Format Rules / Series Constraints' },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episodeNumber: number;
  episodeTitle: string;
  prefillTitle?: string;
  prefillDescription?: string;
  onSubmit: (data: {
    issueTitle: string;
    issueDescription: string;
    desiredOutcome: string;
    contextDocKeys: string[];
  }) => void;
  isSubmitting?: boolean;
}

export function EscalateToDevEngineModal({
  open, onOpenChange, episodeNumber, episodeTitle,
  prefillTitle = '', prefillDescription = '',
  onSubmit, isSubmitting,
}: Props) {
  const [issueTitle, setIssueTitle] = useState(prefillTitle);
  const [issueDescription, setIssueDescription] = useState(prefillDescription);
  const [desiredOutcome, setDesiredOutcome] = useState('other');
  const [contextDocKeys, setContextDocKeys] = useState<string[]>(
    DEFAULT_CONTEXT_DOCS.map(d => d.key)
  );

  // Reset on open
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setIssueTitle(prefillTitle);
      setIssueDescription(prefillDescription);
      setDesiredOutcome('other');
      setContextDocKeys(DEFAULT_CONTEXT_DOCS.map(d => d.key));
    }
    onOpenChange(v);
  };

  const toggleDoc = (key: string) => {
    setContextDocKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-primary" />
            Send to Dev Engine
            <Badge variant="outline" className="text-[10px] ml-1">
              EP {String(episodeNumber).padStart(2, '0')} — {episodeTitle}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Issue Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">Issue Title</Label>
            <Input
              value={issueTitle}
              onChange={e => setIssueTitle(e.target.value)}
              placeholder="e.g. Character inconsistency in Act 2"
              className="text-sm"
            />
          </div>

          {/* Issue Description */}
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={issueDescription}
              onChange={e => setIssueDescription(e.target.value)}
              placeholder="Describe the issue in detail..."
              rows={3}
              className="text-sm"
            />
          </div>

          {/* Desired Outcome */}
          <div className="space-y-1.5">
            <Label className="text-xs">Desired Outcome</Label>
            <Select value={desiredOutcome} onValueChange={setDesiredOutcome}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESIRED_OUTCOMES.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Context Docs */}
          <div className="space-y-2">
            <Label className="text-xs">Context Documents to Include</Label>
            <div className="space-y-2">
              {DEFAULT_CONTEXT_DOCS.map(doc => (
                <div key={doc.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`ctx-${doc.key}`}
                    checked={contextDocKeys.includes(doc.key)}
                    onCheckedChange={() => toggleDoc(doc.key)}
                  />
                  <label htmlFor={`ctx-${doc.key}`} className="text-xs text-foreground cursor-pointer">
                    {doc.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!issueTitle.trim() || isSubmitting}
            onClick={() => onSubmit({ issueTitle, issueDescription, desiredOutcome, contextDocKeys })}
          >
            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send to Dev Engine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
