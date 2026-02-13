/**
 * Treatment vs Script Comparison Panel
 * Side-by-side view comparing treatment documents against the current script.
 */

import { useState } from 'react';
import { GitCompareArrows, FileText, ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProjectDocument } from '@/lib/types';

interface TreatmentComparePanelProps {
  documents: ProjectDocument[];
  scriptText: string | null;
  currentScriptLabel?: string;
}

export function TreatmentComparePanel({ documents, scriptText, currentScriptLabel }: TreatmentComparePanelProps) {
  const treatments = documents.filter(d => d.doc_type === 'treatment' && d.extracted_text);
  const [selectedId, setSelectedId] = useState<string>(treatments[0]?.id || '');
  const [expanded, setExpanded] = useState(false);

  if (treatments.length === 0) return null;
  if (!scriptText) return null;

  const selectedTreatment = treatments.find(t => t.id === selectedId);
  const treatmentText = selectedTreatment?.extracted_text || '';

  // Simple stats
  const scriptWords = scriptText.split(/\s+/).length;
  const treatmentWords = treatmentText.split(/\s+/).length;

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Treatment vs Script</h4>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="gap-1 text-xs"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>

      {/* Treatment selector */}
      {treatments.length > 1 && (
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full mb-3 h-8 text-xs">
            <SelectValue placeholder="Select treatment" />
          </SelectTrigger>
          <SelectContent>
            {treatments.map(t => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                {t.file_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <ScrollText className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-xs font-medium text-muted-foreground">Treatment</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{selectedTreatment?.file_name}</p>
          <p className="text-xs text-muted-foreground">{treatmentWords.toLocaleString()} words</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs font-medium text-muted-foreground">Script</span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{currentScriptLabel || 'Current Draft'}</p>
          <p className="text-xs text-muted-foreground">{scriptWords.toLocaleString()} words</p>
        </div>
      </div>

      {/* Ratio badge */}
      <div className="flex items-center gap-2 mb-4">
        <Badge variant="outline" className="text-xs">
          Treatment is {treatmentWords < scriptWords
            ? `${Math.round((treatmentWords / scriptWords) * 100)}% of script length`
            : `${Math.round((treatmentWords / scriptWords) * 100)}% of script length`}
        </Badge>
      </div>

      {/* Side-by-side comparison */}
      {expanded && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-purple-500/10 px-3 py-1.5 border-b border-border/40">
              <span className="text-xs font-medium text-purple-400">Treatment</span>
            </div>
            <ScrollArea className="h-[400px]">
              <pre className="p-3 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {treatmentText.slice(0, 15000)}
                {treatmentText.length > 15000 && '\n\n[...truncated for display]'}
              </pre>
            </ScrollArea>
          </div>
          <div className="border border-border/40 rounded-lg overflow-hidden">
            <div className="bg-blue-500/10 px-3 py-1.5 border-b border-border/40">
              <span className="text-xs font-medium text-blue-400">Script</span>
            </div>
            <ScrollArea className="h-[400px]">
              <pre className="p-3 text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {scriptText.slice(0, 15000)}
                {scriptText.length > 15000 && '\n\n[...truncated for display]'}
              </pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
