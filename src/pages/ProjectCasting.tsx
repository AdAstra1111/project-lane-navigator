/**
 * ProjectCasting — Project-level AI cast mapping.
 * Maps project characters to user's AI actors.
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Users, Plus, Loader2, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAIActors, useCastContext } from '@/lib/aiCast/useAICast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CastMapping {
  id: string;
  project_id: string;
  character_key: string;
  ai_actor_id: string;
  ai_actor_version_id: string | null;
  wardrobe_pack: string | null;
  notes: string | null;
}

export default function ProjectCasting() {
  const { id: projectId } = useParams<{ id: string }>();
  const { data: actorsData } = useAIActors();
  const actors = actorsData?.actors || [];
  const qc = useQueryClient();

  const [newCharKey, setNewCharKey] = useState('');

  // Fetch cast mappings directly (typed tables not available yet, use .from with any)
  const { data: mappings, isLoading } = useQuery({
    queryKey: ['project-ai-cast', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_ai_cast' as any)
        .select('*')
        .eq('project_id', projectId!) as { data: any; error: any };
      if (error) throw error;
      return (data || []) as CastMapping[];
    },
    enabled: !!projectId,
  });

  // Fetch characters from canon_facts
  const { data: characters } = useQuery({
    queryKey: ['project-characters', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('canon_facts')
        .select('subject')
        .eq('project_id', projectId!)
        .eq('fact_type', 'character')
        .eq('is_active', true);
      const unique = [...new Set((data || []).map((d: any) => d.subject))];
      return unique as string[];
    },
    enabled: !!projectId,
  });

  const addMapping = useMutation({
    mutationFn: async (params: { character_key: string; ai_actor_id: string; ai_actor_version_id?: string }) => {
      const { error } = await supabase
        .from('project_ai_cast' as any)
        .upsert({
          project_id: projectId,
          character_key: params.character_key,
          ai_actor_id: params.ai_actor_id,
          ai_actor_version_id: params.ai_actor_version_id || null,
        } as any, { onConflict: 'project_id,character_key' });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Cast mapping saved'); qc.invalidateQueries({ queryKey: ['project-ai-cast', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_ai_cast' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Mapping removed'); qc.invalidateQueries({ queryKey: ['project-ai-cast', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Characters not yet mapped
  const mappedKeys = new Set((mappings || []).map(m => m.character_key));
  const unmappedCharacters = (characters || []).filter(c => !mappedKeys.has(c));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5" /> AI Casting
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Map project characters to your AI actors for consistent identity across pipelines</p>
      </div>

      {/* Existing mappings */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {(mappings || []).map(m => {
            const actor = actors.find((a: any) => a.id === m.ai_actor_id);
            return (
              <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/30">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{m.character_key}</span>
                  <span className="text-muted-foreground text-[10px] mx-2">→</span>
                  <span className="text-xs text-primary">{actor?.name || m.ai_actor_id.slice(0, 8)}</span>
                  {actor?.status === 'active' && <CheckCircle2 className="inline h-3 w-3 ml-1 text-primary" />}
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeMapping.mutate(m.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            );
          })}

          {(mappings || []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">No characters cast yet.</p>
          )}
        </div>
      )}

      {/* Suggested characters from canon */}
      {unmappedCharacters.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Detected Characters</h3>
          <div className="flex flex-wrap gap-2">
            {unmappedCharacters.map(charKey => (
              <CastCharacterChip
                key={charKey}
                characterKey={charKey}
                actors={actors}
                onCast={(actorId, versionId) => addMapping.mutate({ character_key: charKey, ai_actor_id: actorId, ai_actor_version_id: versionId })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="border-t border-border/30 pt-4 space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add Character Manually</h3>
        <div className="flex gap-2">
          <Input value={newCharKey} onChange={e => setNewCharKey(e.target.value)} placeholder="Character name..." className="text-xs h-9 max-w-[200px]" />
          {newCharKey && actors.length > 0 && (
            <CastActorSelect
              actors={actors}
              onSelect={(actorId, versionId) => {
                addMapping.mutate({ character_key: newCharKey, ai_actor_id: actorId, ai_actor_version_id: versionId });
                setNewCharKey('');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CastCharacterChip({ characterKey, actors, onCast }: {
  characterKey: string;
  actors: any[];
  onCast: (actorId: string, versionId?: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-full border border-border/50 bg-muted/10 text-xs text-foreground hover:bg-muted/30 transition-colors flex items-center gap-1.5"
      >
        <Plus className="h-3 w-3" /> {characterKey}
      </button>
      {open && actors.length > 0 && (
        <div className="absolute z-20 mt-1 left-0 bg-card border border-border rounded-lg shadow-lg p-1 min-w-[180px]">
          {actors.filter((a: any) => a.status === 'active' || a.status === 'draft').map((a: any) => {
            const approvedVer = a.ai_actor_versions?.find((v: any) => v.is_approved);
            return (
              <button
                key={a.id}
                onClick={() => { onCast(a.id, approvedVer?.id); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/30 rounded flex items-center gap-2"
              >
                <span className="truncate">{a.name}</span>
                {approvedVer && <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CastActorSelect({ actors, onSelect }: {
  actors: any[];
  onSelect: (actorId: string, versionId?: string) => void;
}) {
  return (
    <Select onValueChange={(val) => {
      const actor = actors.find((a: any) => a.id === val);
      const approvedVer = actor?.ai_actor_versions?.find((v: any) => v.is_approved);
      onSelect(val, approvedVer?.id);
    }}>
      <SelectTrigger className="h-9 text-xs w-[200px]"><SelectValue placeholder="Select actor..." /></SelectTrigger>
      <SelectContent>
        {actors.map((a: any) => (
          <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
