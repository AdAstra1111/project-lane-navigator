import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import type { TeamVoice } from '@/hooks/useTeamVoices';

interface Props {
  voices: TeamVoice[];
  selectedVoiceId?: string | null;
  onSelect: (voice: TeamVoice | null) => void;
  onManage: () => void;
  disabled?: boolean;
}

export function TeamVoiceSelector({ voices, selectedVoiceId, onSelect, onManage, disabled }: Props) {
  const selected = voices.find(v => v.id === selectedVoiceId);

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5">
        <Users className="h-3 w-3 text-primary" />
        Team Voice
      </label>
      <div className="flex gap-2">
        <Select
          value={selectedVoiceId || '__none__'}
          onValueChange={(id) => {
            if (id === '__none__') {
              onSelect(null);
            } else {
              const voice = voices.find(v => v.id === id);
              if (voice) onSelect(voice);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Select a team voice…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-muted-foreground">
              None
            </SelectItem>
            {voices.map(v => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={onManage}
          className="text-[10px] text-primary hover:underline whitespace-nowrap"
        >
          Manage…
        </button>
      </div>

      {selected && (
        <div className="space-y-2 bg-muted/30 p-2 rounded-md">
          <p className="text-[10px] text-muted-foreground italic">
            {selected.profile_json?.summary || selected.description || 'No summary'}
          </p>
          {selected.profile_json?.do?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-medium text-primary">DO</p>
              <ul className="text-[9px] text-muted-foreground space-y-0.5">
                {selected.profile_json.do.slice(0, 4).map((d, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-primary mt-0.5">✓</span> {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selected.profile_json?.dont?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-medium text-destructive">DON'T</p>
              <ul className="text-[9px] text-muted-foreground space-y-0.5">
                {selected.profile_json.dont.slice(0, 4).map((d, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-destructive mt-0.5">✗</span> {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selected.profile_json?.signature_moves?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selected.profile_json.signature_moves.map((m, i) => (
                <Badge key={i} variant="outline" className="text-[8px]">{m}</Badge>
              ))}
            </div>
          )}
          <p className="text-[8px] text-muted-foreground">
            Updated: {new Date(selected.updated_at).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}
