import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Mic } from 'lucide-react';
import { getVoiceOptionsForLane } from '@/lib/writingVoices/select';
import type { WritingVoicePreset } from '@/lib/writingVoices/types';

interface Props {
  lane: string;
  selectedVoiceId?: string | null;
  onSelect: (voice: WritingVoicePreset) => void;
  disabled?: boolean;
}

export function WritingVoiceSelector({ lane, selectedVoiceId, onSelect, disabled }: Props) {
  const options = getVoiceOptionsForLane(lane);
  if (!options.length) return null;

  const selected = options.find(o => o.id === selectedVoiceId);

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5">
        <Mic className="h-3 w-3 text-primary" />
        Writing Voice
      </label>
      <Select
        value={selectedVoiceId || ''}
        onValueChange={(id) => {
          const voice = options.find(o => o.id === id);
          if (voice) onSelect(voice);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select a writing voice…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(v => (
            <SelectItem key={v.id} value={v.id} className="text-xs">
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && (
        <div className="space-y-2 bg-muted/30 p-2 rounded-md">
          <p className="text-[10px] text-muted-foreground italic">{selected.summary}</p>
          <div className="space-y-1">
            <p className="text-[9px] font-medium text-primary">DO</p>
            <ul className="text-[9px] text-muted-foreground space-y-0.5">
              {selected.do.map((d, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-primary mt-0.5">✓</span> {d}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-medium text-destructive">DON'T</p>
            <ul className="text-[9px] text-muted-foreground space-y-0.5">
              {selected.dont.map((d, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-destructive mt-0.5">✗</span> {d}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(selected.knobs).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[8px]">
                {k.replace(/_/g, ' ')}: {v}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
