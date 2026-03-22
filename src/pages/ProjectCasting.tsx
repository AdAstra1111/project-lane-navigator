/**
 * ProjectCasting — Project-level AI cast mapping with identity source visibility,
 * binding freshness diagnostics, rebind/unbind actions, and impact analysis.
 */
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Users, Plus, Loader2, Trash2, CheckCircle2, ExternalLink, Link2, AlertCircle, Unlink,
  RefreshCw, AlertTriangle, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAIActors } from '@/lib/aiCast/useAICast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getActorThumbnail, getIdentityStrength, type IdentityStrength } from '@/lib/aiCast/identityStrength';
import { resolveProjectCastIdentity, type ActorIdentityAnchors, type IdentitySource } from '@/lib/aiCast/resolveActorIdentity';
import { normalizeCharacterKey } from '@/lib/aiCast/normalizeCharacterKey';
import { evaluateCastBindingFreshness, type BindingFreshness } from '@/lib/aiCast/castBindingDiagnostics';
import { evaluateCastImpact, type CastImpactResult } from '@/lib/aiCast/castImpactDiagnostics';

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
  const [showImpact, setShowImpact] = useState(false);

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

  const { data: characters } = useQuery({
    queryKey: ['project-characters', projectId],
    queryFn: async () => {
      const { data: canonChars } = await supabase
        .from('canon_facts')
        .select('subject')
        .eq('project_id', projectId!)
        .eq('fact_type', 'character')
        .eq('is_active', true);
      const canonUnique = [...new Set((canonChars || []).map((d: any) => d.subject))];
      if (canonUnique.length > 0) return canonUnique as string[];
      const { data: imageSubjects } = await supabase
        .from('project_images' as any)
        .select('subject')
        .eq('project_id', projectId!)
        .in('shot_type', ['identity_headshot', 'identity_full_body'])
        .not('subject', 'is', null) as { data: any };
      return [...new Set((imageSubjects || []).map((d: any) => d.subject).filter(Boolean))] as string[];
    },
    enabled: !!projectId,
  });

  const { data: identityMap } = useQuery({
    queryKey: ['project-identity-map', projectId],
    queryFn: async () => {
      const map = await resolveProjectCastIdentity(projectId!);
      const result: Record<string, ActorIdentityAnchors> = {};
      map.forEach((v, k) => { result[k] = v; });
      return result;
    },
    enabled: !!projectId,
  });

  // Impact diagnostics (lazy, only when requested)
  const { data: impactData, isLoading: impactLoading, refetch: refetchImpact } = useQuery({
    queryKey: ['cast-impact', projectId],
    queryFn: () => evaluateCastImpact(projectId!),
    enabled: !!projectId && showImpact,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['project-ai-cast', projectId] });
    qc.invalidateQueries({ queryKey: ['project-identity-map', projectId] });
    qc.invalidateQueries({ queryKey: ['cast-impact', projectId] });
  };

  const addMapping = useMutation({
    mutationFn: async (params: { character_key: string; ai_actor_id: string; ai_actor_version_id?: string }) => {
      const actor = actors.find((a: any) => a.id === params.ai_actor_id);
      const approvedVersionId = (actor as any)?.approved_version_id || params.ai_actor_version_id || null;
      if (!(actor as any)?.roster_ready || !approvedVersionId) {
        throw new Error('Only roster-ready actors with an approved version can be cast');
      }
      const { error } = await supabase
        .from('project_ai_cast' as any)
        .upsert({
          project_id: projectId,
          character_key: params.character_key,
          ai_actor_id: params.ai_actor_id,
          ai_actor_version_id: approvedVersionId,
        } as any, { onConflict: 'project_id,character_key' });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Cast mapping saved'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Rebind via edge function (version resolved canonically by backend RPC)
  const rebindMutation = useMutation({
    mutationFn: async (params: { characterKey: string; nextActorId: string; reason?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rebind-project-cast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          characterKey: params.characterKey,
          nextActorId: params.nextActorId,
          reason: params.reason,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        let msg = 'Rebind failed';
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      return resp.json();
    },
    onSuccess: (data) => {
      if (data.no_op) {
        toast.info('Already up to date');
      } else {
        toast.success(`${data.action === 'unbind' ? 'Unbound' : 'Rebound'} successfully`);
      }
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unbind via edge function
  const unbindMutation = useMutation({
    mutationFn: async (params: { characterKey: string; reason?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rebind-project-cast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          characterKey: params.characterKey,
          reason: params.reason,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        let msg = 'Unbind failed';
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      return resp.json();
    },
    onSuccess: () => { toast.success('Cast binding removed'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mappedKeys = new Set((mappings || []).map(m => m.character_key));
  const unmappedCharacters = (characters || []).filter(c => !mappedKeys.has(c));

  const allCharacters = useMemo(() => {
    const set = new Set<string>();
    (characters || []).forEach(c => set.add(c));
    (mappings || []).forEach(m => set.add(m.character_key));
    return [...set];
  }, [characters, mappings]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5" /> AI Casting
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Map project characters to your AI actors for consistent identity across all pipelines
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowImpact(!showImpact); if (!showImpact) refetchImpact(); }}
          >
            <Activity className="h-3.5 w-3.5" /> {showImpact ? 'Hide' : 'View'} Impact
          </Button>
          <Link to="/ai-cast">
            <Button variant="default" size="sm" className="h-8 text-xs gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> AI Actors Agency
            </Button>
          </Link>
          {projectId && (
            <Link to={`/projects/${projectId}/casting-studio`}>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Users className="h-3.5 w-3.5" /> Casting Studio
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Existing mappings */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {(mappings || []).map(m => {
            const actor = actors.find((a: any) => a.id === m.ai_actor_id);
            const thumbnail = actor ? getActorThumbnail(actor.ai_actor_versions, (actor as any).approved_version_id) : null;
            const identity = actor ? getIdentityStrength(actor.ai_actor_versions, (actor as any).approved_version_id) : null;
            const charKey = normalizeCharacterKey(m.character_key);
            const resolvedIdentity = identityMap?.[charKey];

            // Compute freshness
            const freshness = evaluateCastBindingFreshness({
              binding: { ai_actor_version_id: m.ai_actor_version_id },
              actor: actor ? {
                approved_version_id: (actor as any).approved_version_id,
                roster_ready: (actor as any).roster_ready ?? false,
              } : null,
            });

            return (
              <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/30">
                <div className="w-10 h-10 rounded-md border border-border/30 overflow-hidden shrink-0 bg-muted/10">
                  {thumbnail ? (
                    <img src={thumbnail} alt={actor?.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex items-center justify-center h-full"><Users className="h-4 w-4 text-muted-foreground/30" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{m.character_key}</span>
                    <span className="text-muted-foreground text-[10px]">→</span>
                    <span className="text-xs text-primary font-medium">{actor?.name || m.ai_actor_id.slice(0, 8)}</span>
                    <FreshnessBadge freshness={freshness} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {resolvedIdentity && <IdentitySourceTag source={resolvedIdentity.source} hasAnchors={resolvedIdentity.hasAnchors} />}
                    {identity && <IdentityStatusDot strength={identity.strength} />}
                    {actor?.status === 'active' && (
                      <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" /> Active
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {freshness === 'stale_newer_version_available' && actor && (
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
                      onClick={() => rebindMutation.mutate({
                        characterKey: m.character_key,
                        nextActorId: m.ai_actor_id,
                        reason: 'Update to latest approved version',
                      })}
                      disabled={rebindMutation.isPending}
                    >
                      <RefreshCw className="h-3 w-3" /> Update
                    </Button>
                  )}
                  <RebindButton
                    characterKey={m.character_key}
                    currentActorId={m.ai_actor_id}
                    actors={actors}
                    onRebind={(nextActorId, nextVersionId) => rebindMutation.mutate({
                      characterKey: m.character_key,
                      nextActorId,
                      nextActorVersionId: nextVersionId,
                      reason: 'Manual rebind',
                    })}
                    disabled={rebindMutation.isPending}
                  />
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    onClick={() => unbindMutation.mutate({ characterKey: m.character_key })}
                    disabled={unbindMutation.isPending}
                    title="Unbind"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            );
          })}

          {(mappings || []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">
              No characters cast yet. Assign actors to your characters below.
            </p>
          )}
        </div>
      )}

      {/* Unmapped characters */}
      {unmappedCharacters.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Uncast Characters ({unmappedCharacters.length})
          </h3>
          <div className="space-y-2">
            {unmappedCharacters.map(charKey => {
              const resolvedIdentity = identityMap?.[charKey.toLowerCase().trim()];
              return (
                <CastCharacterRow
                  key={charKey}
                  characterKey={charKey}
                  actors={actors}
                  resolvedIdentity={resolvedIdentity || null}
                  onCast={(actorId, versionId) =>
                    addMapping.mutate({ character_key: charKey, ai_actor_id: actorId, ai_actor_version_id: versionId })
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="border-t border-border/30 pt-4 space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add Character Manually</h3>
        <div className="flex gap-2">
          <Input value={newCharKey} onChange={e => setNewCharKey(e.target.value)} placeholder="Character name..." className="text-xs h-9 max-w-[200px]" />
          {newCharKey && actors.length > 0 && (
            <CastActorSelect actors={actors} onSelect={(actorId, versionId) => {
              addMapping.mutate({ character_key: newCharKey, ai_actor_id: actorId, ai_actor_version_id: versionId });
              setNewCharKey('');
            }} />
          )}
        </div>
      </div>

      {/* Impact Analysis Panel */}
      {showImpact && (
        <div className="border-t border-border/30 pt-4 space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" /> Cast Impact Analysis
          </h3>
          {impactLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : impactData ? (
            <ImpactPanel data={impactData} />
          ) : (
            <p className="text-xs text-muted-foreground">No impact data available.</p>
          )}
        </div>
      )}

      {/* Identity Diagnostics Panel */}
      {identityMap && Object.keys(identityMap).length > 0 && (
        <div className="border-t border-border/30 pt-4 space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Identity Diagnostics</h3>
          <div className="rounded-lg border border-border/30 bg-muted/5 p-3 space-y-1.5">
            {allCharacters.map(charName => {
              const key = charName.toLowerCase().trim();
              const entry = identityMap[key];
              return (
                <div key={key} className="flex items-center gap-3 text-[11px]">
                  <span className="font-medium text-foreground w-28 truncate">{charName}</span>
                  {entry ? (
                    <>
                      <IdentitySourceTag source={entry.source} hasAnchors={entry.hasAnchors} />
                      <span className="text-muted-foreground">
                        {entry.hasAnchors
                          ? `headshot=${entry.headshot ? '✓' : '✗'} body=${entry.fullBody ? '✓' : '✗'} refs=${entry.additionalRefs.length}`
                          : 'no anchors'}
                      </span>
                      {entry.aiActorId && (
                        <span className="text-muted-foreground/70 text-[9px]">actor:{entry.aiActorId.slice(0, 8)}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-destructive/70 flex items-center gap-1"><Unlink className="h-2.5 w-2.5" /> Unresolved</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Freshness Badge ─────────────────────────────────────────────────────────

function FreshnessBadge({ freshness }: { freshness: BindingFreshness }) {
  if (freshness === 'current') {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 font-medium">
        Current
      </span>
    );
  }
  if (freshness === 'stale_newer_version_available') {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/30 font-medium flex items-center gap-0.5">
        <AlertTriangle className="h-2.5 w-2.5" /> Stale
      </span>
    );
  }
  if (freshness === 'stale_roster_revoked') {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30 font-medium flex items-center gap-0.5">
        <AlertCircle className="h-2.5 w-2.5" /> Revoked
      </span>
    );
  }
  if (freshness === 'invalid_missing_version') {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30 font-medium flex items-center gap-0.5">
        <AlertCircle className="h-2.5 w-2.5" /> Invalid
      </span>
    );
  }
  return null;
}

// ── Impact Panel ────────────────────────────────────────────────────────────

function ImpactPanel({ data }: { data: CastImpactResult }) {
  if (data.total_outputs === 0) {
    return <p className="text-xs text-muted-foreground">No generation outputs with cast provenance found.</p>;
  }
  return (
    <div className="rounded-lg border border-border/30 bg-muted/5 p-3 space-y-2">
      <div className="flex items-center gap-4 text-[11px]">
        <span className="text-muted-foreground">Total tracked: <strong className="text-foreground">{data.total_outputs}</strong></span>
        <span className={cn(
          data.out_of_sync_count > 0 ? 'text-amber-700' : 'text-emerald-700'
        )}>
          Out of sync: <strong>{data.out_of_sync_count}</strong>
        </span>
      </div>
      {Object.entries(data.entries_by_character).map(([charKey, entries]) => {
        const oosCount = entries.filter(e => e.status === 'out_of_sync_with_current_cast').length;
        return (
          <div key={charKey} className="flex items-center gap-3 text-[11px]">
            <span className="font-medium text-foreground w-24 truncate">{charKey}</span>
            <span className="text-muted-foreground">{entries.length} outputs</span>
            {oosCount > 0 ? (
              <Badge variant="outline" className="text-[9px] h-4 border-amber-500/30 text-amber-700">
                {oosCount} out of sync
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/30 text-emerald-700">
                All current
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Rebind Button ───────────────────────────────────────────────────────────

function RebindButton({ characterKey, currentActorId, actors, onRebind, disabled }: {
  characterKey: string;
  currentActorId: string;
  actors: any[];
  onRebind: (actorId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rosterActors = actors.filter((a: any) =>
    (a as any).roster_ready === true && (a as any).approved_version_id && a.id !== currentActorId
  );

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1" onClick={() => setOpen(true)} disabled={disabled}>
        <RefreshCw className="h-3 w-3" /> Rebind
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Select onValueChange={(val) => {
        const actor = actors.find((a: any) => a.id === val);
        onRebind(val, (actor as any)?.approved_version_id);
        setOpen(false);
      }}>
        <SelectTrigger className="h-7 text-[10px] w-[150px]"><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {rosterActors.length > 0 ? rosterActors.map((a: any) => (
            <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
          )) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No other roster actors</div>
          )}
        </SelectContent>
      </Select>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)}>
        <span className="text-xs text-muted-foreground">✕</span>
      </Button>
    </div>
  );
}

// ── Identity Source Tag ─────────────────────────────────────────────────────

function IdentitySourceTag({ source, hasAnchors }: { source: IdentitySource; hasAnchors: boolean }) {
  const config = {
    actor_bound: {
      label: 'Actor Bound',
      icon: Link2,
      className: hasAnchors ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' : 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    },
    fallback_project_images: {
      label: 'Fallback',
      icon: AlertCircle,
      className: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    },
    unresolved: {
      label: 'Unresolved',
      icon: Unlink,
      className: 'bg-destructive/15 text-destructive border-destructive/30',
    },
  }[source];

  const Icon = config.icon;
  return (
    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1 font-medium', config.className)}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

// ── Character Row ───────────────────────────────────────────────────────────

function CastCharacterRow({ characterKey, actors, resolvedIdentity, onCast }: {
  characterKey: string;
  actors: any[];
  resolvedIdentity: ActorIdentityAnchors | null;
  onCast: (actorId: string, versionId?: string) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const rosterActors = actors.filter((a: any) => (a as any).roster_ready === true);
  const activeActors = rosterActors.length > 0
    ? rosterActors
    : actors.filter((a: any) => a.status === 'active' || a.status === 'draft');

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border/50 bg-muted/5">
      <div className="w-10 h-10 rounded-md border border-border/30 bg-muted/10 flex items-center justify-center shrink-0 overflow-hidden">
        {resolvedIdentity?.headshot ? (
          <img src={resolvedIdentity.headshot} alt={characterKey} className="w-full h-full object-cover" />
        ) : (
          <Users className="h-4 w-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-foreground">{characterKey}</span>
        <div className="flex items-center gap-2 mt-0.5">
          {resolvedIdentity ? (
            <IdentitySourceTag source={resolvedIdentity.source} hasAnchors={resolvedIdentity.hasAnchors} />
          ) : (
            <span className="text-[9px] text-muted-foreground">No identity resolved</span>
          )}
        </div>
      </div>
      {!selecting ? (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSelecting(true)}>
          <Plus className="h-3 w-3" /> Cast
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Select onValueChange={(val) => {
            const actor = actors.find((a: any) => a.id === val);
            const approvedVersionId = (actor as any)?.approved_version_id || null;
            onCast(val, approvedVersionId);
            setSelecting(false);
          }}>
            <SelectTrigger className="h-7 text-xs w-[180px]"><SelectValue placeholder="Select actor..." /></SelectTrigger>
            <SelectContent>
              {activeActors.map((a: any) => {
                const thumb = getActorThumbnail(a.ai_actor_versions, (a as any).approved_version_id);
                return (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      {thumb && <img src={thumb} className="h-4 w-4 rounded-sm object-cover" alt="" />}
                      {a.name}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelecting(false)}>
            <span className="text-xs text-muted-foreground">✕</span>
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Actor Select ────────────────────────────────────────────────────────────

function CastActorSelect({ actors, onSelect }: {
  actors: any[];
  onSelect: (actorId: string, versionId?: string) => void;
}) {
  const rosterActors = actors.filter((a: any) => (a as any).roster_ready === true && (a as any).approved_version_id);
  return (
    <Select onValueChange={(val) => {
      const actor = actors.find((a: any) => a.id === val);
      const approvedVersionId = (actor as any)?.approved_version_id || null;
      onSelect(val, approvedVersionId);
    }}>
      <SelectTrigger className="h-9 text-xs w-[200px]"><SelectValue placeholder="Select actor..." /></SelectTrigger>
      <SelectContent>
        {rosterActors.length > 0 ? rosterActors.map((a: any) => (
          <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
        )) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No roster-ready actors</div>
        )}
      </SelectContent>
    </Select>
  );
}

// ── Identity Status Dot ─────────────────────────────────────────────────────

function IdentityStatusDot({ strength }: { strength: IdentityStrength }) {
  const config = {
    strong: { label: 'Strong identity', className: 'bg-emerald-500' },
    partial: { label: 'Partial identity', className: 'bg-amber-500' },
    weak: { label: 'Weak identity', className: 'bg-destructive' },
  }[strength];
  return (
    <span className="flex items-center gap-1" title={config.label}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.className)} />
      <span className="text-[9px] text-muted-foreground">{config.label}</span>
    </span>
  );
}
