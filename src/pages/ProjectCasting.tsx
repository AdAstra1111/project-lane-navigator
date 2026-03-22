/**
 * ProjectCasting — Project-level AI cast mapping with identity source visibility,
 * binding freshness diagnostics, rebind/unbind actions, impact analysis,
 * and Phase 8 Cast Health governance dashboard.
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Users, Plus, Loader2, Trash2, CheckCircle2, ExternalLink, Link2, AlertCircle, Unlink,
  RefreshCw, AlertTriangle, Activity, ShieldCheck, ShieldAlert, Shield, Eye, ListChecks, XCircle,
  Play, PlayCircle, RotateCcw, Zap, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  evaluateProjectCastHealth,
  getImpactedOutputs,
  type CastGovernanceResult,
  type GovernanceSeverity,
  type GovernanceRecommendation,
  type CharacterGovernanceState,
} from '@/lib/aiCast/castGovernance';
import {
  queueCastRegenJobs, listCastRegenJobs, cancelCastRegenJob,
  processCastRegenJobs, retryCastRegenJob,
  type CastRegenJob,
} from '@/lib/aiCast/castRegenJobs';
import {
  evaluateProjectCastConsistency,
  type CastConsistencySummary,
  type OutputConsistencyResult,
  type CastConsistencyStatus,
} from '@/lib/aiCast/castConsistency';
import {
  evaluateProjectContinuity,
  type ProjectContinuitySummary,
  type CharacterContinuityResult,
} from '@/lib/aiCast/continuityDiagnostics';
import {
  evaluateProjectSceneConsistency,
  type ProjectSceneConsistencySummary,
  type SceneConsistencyResult,
  type SceneCharacterCheck,
} from '@/lib/aiCast/sceneConsistency';
import {
  buildRegenPolicy,
  type RegenPolicySummary,
  type RegenPolicyItem,
} from '@/lib/aiCast/regenPolicyEngine';
import { executeAutoRepair, type AutoRepairResult } from '@/lib/aiCast/autoRepairEngine';
import { buildProjectCastRecommendations, type ProjectCastRecommendationResult, type CharacterRecommendationResult, type ActorRecommendation } from '@/lib/aiCast/castRecommendationEngine';
import { getRosterActorsForCasting, type ActorIntelligenceProfile } from '@/lib/aiCast/actorIntelligence';
import { bindActorToProjectCharacter } from '@/lib/aiCast/projectCastBindings';
import {
  buildProjectCastPack, applyProjectCastPack,
  type ProjectCastPack, type CastPackCharacterChoice, type ApplyCastPackResult,
} from '@/lib/aiCast/castPackEngine';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { getActorThumbnail as getActorThumb } from '@/lib/aiCast/identityStrength';
import { aiCastApi } from '@/lib/aiCast/aiCastApi';
// Legacy prefill wrapper removed — canonical path is buildCharacterCastingBrief
import { buildCharacterCastingBrief, type CharacterCastingBriefResult, type CastingBrief, type CharacterContextSummary } from '@/lib/aiCast/castingBriefResolver';
import { buildCastingSpecificityProfile, getSpecificityDimensionEntries, getSearchBehaviorLabel } from '@/lib/aiCast/castingSpecificity';
import {
  createPendingActorBindContext,
  getPendingActorBindContextsForProject,
  resolvePendingActorBindContext,
  abandonPendingActorBindContext,
  type PendingActorBindContext,
} from '@/lib/aiCast/pendingBindRecovery';

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
  const [showHealth, setShowHealth] = useState(false);
  const [showRegenJobs, setShowRegenJobs] = useState(false);
  const [showConsistency, setShowConsistency] = useState(false);
  const [showContinuity, setShowContinuity] = useState(false);
  const [showSceneIntegrity, setShowSceneIntegrity] = useState(false);
  const [showRegenPolicy, setShowRegenPolicy] = useState(false);
  const [showCastLibrary, setShowCastLibrary] = useState<string | null>(null); // character key to cast
  const [showCreateActor, setShowCreateActor] = useState<string | null>(null); // character key for inline create
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showCastPack, setShowCastPack] = useState(false);
  const [castPack, setCastPack] = useState<ProjectCastPack | null>(null);
  const [packSelections, setPackSelections] = useState<Record<string, string | null>>({});

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

  // Cast Health governance (lazy)
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['cast-health', projectId],
    queryFn: () => evaluateProjectCastHealth(projectId!),
    enabled: !!projectId && showHealth,
  });

  // Regen jobs list (lazy)
  const { data: regenJobs, isLoading: regenJobsLoading, refetch: refetchRegenJobs } = useQuery({
    queryKey: ['cast-regen-jobs', projectId],
    queryFn: () => listCastRegenJobs(projectId!),
    enabled: !!projectId && showRegenJobs,
  });

  // Cast consistency verification (lazy)
  const { data: consistencyData, isLoading: consistencyLoading, refetch: refetchConsistency } = useQuery({
    queryKey: ['cast-consistency', projectId],
    queryFn: () => evaluateProjectCastConsistency(projectId!),
    enabled: !!projectId && showConsistency,
  });

  // Character continuity (lazy)
  const { data: continuityData, isLoading: continuityLoading, refetch: refetchContinuity } = useQuery({
    queryKey: ['cast-continuity', projectId],
    queryFn: () => evaluateProjectContinuity(projectId!),
    enabled: !!projectId && showContinuity,
  });

  // Scene integrity (lazy)
  const { data: sceneIntegrityData, isLoading: sceneIntegrityLoading, refetch: refetchSceneIntegrity } = useQuery({
    queryKey: ['scene-integrity', projectId],
    queryFn: () => evaluateProjectSceneConsistency(projectId!),
    enabled: !!projectId && showSceneIntegrity,
  });

  // Regen policy (lazy)
  const { data: regenPolicyData, isLoading: regenPolicyLoading, refetch: refetchRegenPolicy } = useQuery({
    queryKey: ['regen-policy', projectId],
    queryFn: () => buildRegenPolicy(projectId!),
    enabled: !!projectId && showRegenPolicy,
  });

  // Cast recommendations (lazy)
  const { data: recommendationData, isLoading: recommendationsLoading, refetch: refetchRecommendations } = useQuery({
    queryKey: ['cast-recommendations', projectId],
    queryFn: () => buildProjectCastRecommendations(projectId!),
    enabled: !!projectId && showRecommendations,
  });

  // Pending actor bind contexts (Phase 17.1 — always loaded)
  const { data: pendingBinds, refetch: refetchPendingBinds } = useQuery({
    queryKey: ['pending-actor-binds', projectId],
    queryFn: () => getPendingActorBindContextsForProject(projectId!),
    enabled: !!projectId,
  });

  // Queue all regen jobs mutation
  const queueAllRegenMutation = useMutation({
    mutationFn: async (opts?: { characterKey?: string }) => {
      return queueCastRegenJobs(projectId!, opts);
    },
    onSuccess: (result) => {
      if (result.created_count > 0) {
        toast.success(`Queued ${result.created_count} regen job(s)${result.skipped_duplicates > 0 ? `, ${result.skipped_duplicates} already queued` : ''}`);
      } else if (result.skipped_duplicates > 0) {
        toast.info(`All ${result.skipped_duplicates} job(s) already queued`);
      } else {
        toast.info('No outputs need regeneration');
      }
      refetchRegenJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cancel regen job mutation
  const cancelRegenMutation = useMutation({
    mutationFn: cancelCastRegenJob,
    onSuccess: () => { toast.success('Job cancelled'); refetchRegenJobs(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Process regen jobs mutation
  const processRegenMutation = useMutation({
    mutationFn: (limit: number) => processCastRegenJobs(limit),
    onSuccess: (result) => {
      if (result.processed === 0) {
        toast.info('No queued jobs to process');
      } else {
        const failed = result.results.filter(r => r.result === 'failed').length;
        const completed = result.results.filter(r => r.result === 'completed' || r.result === 'skipped').length;
        toast.success(`Processed ${result.processed} job(s): ${completed} completed${failed > 0 ? `, ${failed} failed` : ''}`);
      }
      refetchRegenJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Retry failed job mutation
  const retryRegenMutation = useMutation({
    mutationFn: retryCastRegenJob,
    onSuccess: (result) => {
      if (result.skipped) {
        toast.info('Retry skipped — job already queued');
      } else {
        toast.success('Retry job queued');
      }
      refetchRegenJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-repair mutation (Phase 14)
  const autoRepairMutation = useMutation({
    mutationFn: (priorities: ('high' | 'medium' | 'low')[]) =>
      executeAutoRepair(projectId!, { priorities }),
    onSuccess: (result: AutoRepairResult) => {
      if (result.created === 0 && result.skipped_duplicates === 0) {
        toast.info('No eligible items to repair');
      } else {
        toast.success(`Created ${result.created} job(s)${result.skipped_duplicates > 0 ? `, ${result.skipped_duplicates} skipped (duplicates)` : ''}`);
      }
      refetchRegenJobs();
      qc.invalidateQueries({ queryKey: ['regen-policy', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['project-ai-cast', projectId] });
    qc.invalidateQueries({ queryKey: ['project-identity-map', projectId] });
    qc.invalidateQueries({ queryKey: ['cast-impact', projectId] });
    qc.invalidateQueries({ queryKey: ['cast-health', projectId] });
    qc.invalidateQueries({ queryKey: ['cast-regen-jobs', projectId] });
    qc.invalidateQueries({ queryKey: ['cast-consistency', projectId] });
    qc.invalidateQueries({ queryKey: ['scene-integrity', projectId] });
    qc.invalidateQueries({ queryKey: ['pending-actor-binds', projectId] });
  };

  const addMapping = useMutation({
    mutationFn: async (params: { character_key: string; ai_actor_id: string; ai_actor_version_id?: string }) => {
      return bindActorToProjectCharacter(
        { projectId: projectId!, characterKey: params.character_key, actorId: params.ai_actor_id, actorVersionId: params.ai_actor_version_id },
        actors,
      );
    },
    onSuccess: () => { toast.success('Cast mapping saved'); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cast Pack mutations (Phase 16.8)
  const generatePackMutation = useMutation({
    mutationFn: () => buildProjectCastPack(projectId!),
    onSuccess: (pack) => {
      setCastPack(pack);
      const selections: Record<string, string | null> = {};
      for (const c of pack.characters) {
        selections[c.character_key] = c.selected_actor_id;
      }
      setPackSelections(selections);
      setShowCastPack(true);
      toast.success(`Cast pack generated: ${pack.characters.length} character(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyPackMutation = useMutation({
    mutationFn: (overwrite: boolean) => {
      const selections = Object.entries(packSelections).map(([character_key, actor_id]) => ({
        character_key,
        actor_id,
      }));
      return applyProjectCastPack(projectId!, selections, { overwriteExisting: overwrite });
    },
    onSuccess: (result: ApplyCastPackResult) => {
      if (result.applied === 0 && result.skipped_existing > 0) {
        toast.info(`All ${result.skipped_existing} character(s) already bound — use "Apply & Replace" to overwrite`);
      } else if (result.applied === 0) {
        toast.info('No eligible selections to apply');
      } else {
        toast.success(`Applied ${result.applied} binding(s)${result.skipped_existing > 0 ? `, skipped ${result.skipped_existing} existing` : ''}${result.skipped_invalid > 0 ? `, ${result.skipped_invalid} invalid` : ''}`);
      }
      invalidateAll();
    },
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
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowConsistency(!showConsistency); if (!showConsistency) refetchConsistency(); }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {showConsistency ? 'Hide' : ''} Consistency
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowContinuity(!showContinuity); if (!showContinuity) refetchContinuity(); }}
          >
            <Activity className="h-3.5 w-3.5" /> {showContinuity ? 'Hide' : ''} Continuity
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowSceneIntegrity(!showSceneIntegrity); if (!showSceneIntegrity) refetchSceneIntegrity(); }}
          >
            <Shield className="h-3.5 w-3.5" /> {showSceneIntegrity ? 'Hide' : ''} Scene Integrity
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowRegenPolicy(!showRegenPolicy); if (!showRegenPolicy) refetchRegenPolicy(); }}
          >
            <Eye className="h-3.5 w-3.5" /> {showRegenPolicy ? 'Hide' : ''} Regen Policy
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowRegenJobs(!showRegenJobs); if (!showRegenJobs) refetchRegenJobs(); }}
          >
            <ListChecks className="h-3.5 w-3.5" /> {showRegenJobs ? 'Hide' : ''} Regen Jobs
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowHealth(!showHealth); if (!showHealth) refetchHealth(); }}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> {showHealth ? 'Hide' : ''} Cast Health
          </Button>
          <Button
            variant="outline" size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowImpact(!showImpact); if (!showImpact) refetchImpact(); }}
          >
            <Activity className="h-3.5 w-3.5" /> {showImpact ? 'Hide' : 'View'} Impact
          </Button>
          <Button
            variant={showRecommendations ? 'default' : 'outline'} size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => { setShowRecommendations(!showRecommendations); if (!showRecommendations) refetchRecommendations(); }}
          >
            <Zap className="h-3.5 w-3.5" /> {showRecommendations ? 'Hide' : ''} Recommend Cast
           </Button>
          <Button
            variant={showCastPack ? 'default' : 'outline'} size="sm" className="h-8 text-xs gap-1.5"
            onClick={() => {
              if (!showCastPack && !castPack) {
                generatePackMutation.mutate();
              } else {
                setShowCastPack(!showCastPack);
              }
            }}
            disabled={generatePackMutation.isPending}
          >
            {generatePackMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            {showCastPack ? 'Hide' : ''} Cast Pack
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
                    onRebind={(nextActorId) => rebindMutation.mutate({
                      characterKey: m.character_key,
                      nextActorId,
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
              const resolvedIdentity = identityMap?.[normalizeCharacterKey(charKey)];
              return (
                <div key={charKey} className="flex items-center gap-2">
                  <CastCharacterRow
                    characterKey={charKey}
                    actors={actors}
                    resolvedIdentity={resolvedIdentity || null}
                    onCast={(actorId, versionId) =>
                      addMapping.mutate({ character_key: charKey, ai_actor_id: actorId, ai_actor_version_id: versionId })
                    }
                  />
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-[10px] gap-1 shrink-0"
                    onClick={() => setShowCastLibrary(charKey)}
                  >
                    <Users className="h-3 w-3" /> Library
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-[10px] gap-1 shrink-0"
                    onClick={() => setShowCreateActor(charKey)}
                  >
                    <Sparkles className="h-3 w-3" /> Create
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Created Actors — Phase 17.1 Recovery */}
      {(pendingBinds || []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            Pending Created Actors ({(pendingBinds || []).length})
          </h3>
          <div className="space-y-2">
            {(pendingBinds || []).map((pb) => {
              const actor = actors.find((a: any) => a.id === pb.actor_id);
              const isBindable = actor?.roster_ready && actor?.approved_version_id;
              const alreadyBound = (mappings || []).some(
                (m) => normalizeCharacterKey(m.character_key) === normalizeCharacterKey(pb.character_key),
              );

              return (
                <div
                  key={pb.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{pb.character_key}</span>
                      <span className="text-muted-foreground text-[10px]">→</span>
                      <span className="text-xs text-primary font-medium">
                        {actor?.name || pb.actor_id.slice(0, 8)}
                      </span>
                      {isBindable ? (
                        <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/40 text-emerald-700 bg-emerald-500/10">
                          Ready to Bind
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] h-4 border-amber-500/40 text-amber-700 bg-amber-500/10">
                          Pending Validation
                        </Badge>
                      )}
                      {alreadyBound && (
                        <Badge variant="outline" className="text-[9px] h-4 border-muted-foreground/30 text-muted-foreground">
                          Character Already Bound
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Created {new Date(pb.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isBindable && !alreadyBound && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-[10px] gap-1"
                        onClick={async () => {
                          try {
                            await bindActorToProjectCharacter(
                              {
                                projectId: projectId!,
                                characterKey: pb.character_key,
                                actorId: pb.actor_id,
                                actorVersionId: actor.approved_version_id,
                              },
                              actors,
                            );
                            await resolvePendingActorBindContext(pb.actor_id, projectId!, pb.character_key);
                            invalidateAll();
                            toast.success(`Bound ${actor?.name || 'actor'} to ${pb.character_key}`);
                          } catch (err: any) {
                            toast.error(err.message || 'Bind failed');
                          }
                        }}
                      >
                        <Link2 className="h-3 w-3" /> Bind Now
                      </Button>
                    )}
                    {isBindable && alreadyBound && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1"
                        onClick={async () => {
                          try {
                            await bindActorToProjectCharacter(
                              {
                                projectId: projectId!,
                                characterKey: pb.character_key,
                                actorId: pb.actor_id,
                                actorVersionId: actor.approved_version_id,
                              },
                              actors,
                            );
                            await resolvePendingActorBindContext(pb.actor_id, projectId!, pb.character_key);
                            invalidateAll();
                            toast.success(`Replaced binding for ${pb.character_key}`);
                          } catch (err: any) {
                            toast.error(err.message || 'Replace failed');
                          }
                        }}
                      >
                        <RefreshCw className="h-3 w-3" /> Replace
                      </Button>
                    )}
                    <Link to="/ai-cast">
                      <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1">
                        <Eye className="h-3 w-3" /> Review
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[10px] gap-1 text-muted-foreground"
                      onClick={async () => {
                        try {
                          await abandonPendingActorBindContext(pb.actor_id, projectId!, pb.character_key);
                          refetchPendingBinds();
                          toast.info('Pending bind dismissed');
                        } catch (err: any) {
                          toast.error(err.message || 'Dismiss failed');
                        }
                      }}
                    >
                      <XCircle className="h-3 w-3" /> Dismiss
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


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

      {/* Cast Health Dashboard */}
      {showHealth && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" /> Cast Health Dashboard
          </h3>
          {healthLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : healthData ? (
            <CastHealthPanel data={healthData} actors={actors} projectId={projectId!} onRebind={(charKey, actorId) =>
              rebindMutation.mutate({ characterKey: charKey, nextActorId: actorId, reason: 'Governance rebind' })
            } onQueueRegen={(charKey) => queueAllRegenMutation.mutate({ characterKey: charKey })} />
          ) : (
            <p className="text-xs text-muted-foreground">No health data available.</p>
          )}
        </div>
      )}

      {/* Regen Jobs Panel */}
      {showRegenJobs && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <ListChecks className="h-3.5 w-3.5" /> Cast Regen Jobs
            </h3>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm" variant="outline"
                className="h-7 text-[10px] gap-1"
                onClick={() => processRegenMutation.mutate(1)}
                disabled={processRegenMutation.isPending}
                title="Process one queued job"
              >
                {processRegenMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Process 1
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-7 text-[10px] gap-1"
                onClick={() => processRegenMutation.mutate(5)}
                disabled={processRegenMutation.isPending}
                title="Process up to 5 queued jobs"
              >
                {processRegenMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                Process 5
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-7 text-[10px] gap-1"
                onClick={() => queueAllRegenMutation.mutate({})}
                disabled={queueAllRegenMutation.isPending}
              >
                {queueAllRegenMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Queue All
              </Button>
              <Button
                size="sm" variant="ghost"
                className="h-7 text-[10px] gap-1"
                onClick={() => refetchRegenJobs()}
                title="Refresh"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {regenJobsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : (regenJobs || []).length > 0 ? (
            <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20">
              {(regenJobs || []).map(job => (
                <div key={job.id} className="flex items-center gap-2 px-3 py-2 flex-wrap">
                  <RegenJobStatusBadge status={job.status} errorMessage={job.error_message} />
                  <span className="text-[10px] font-medium text-foreground w-24 truncate">{job.character_key}</span>
                  <span className="text-[9px] font-mono text-muted-foreground">{job.output_id.slice(0, 12)}…</span>
                  <Badge variant="outline" className="text-[9px] h-4">{job.reason.replace(/_/g, ' ')}</Badge>
                  <span className="text-[9px] text-muted-foreground/60 ml-auto">
                    {new Date(job.created_at).toLocaleDateString()}
                  </span>
                  {job.status === 'queued' && (
                    <Button
                      size="icon" variant="ghost" className="h-5 w-5"
                      onClick={() => cancelRegenMutation.mutate(job.id)}
                      disabled={cancelRegenMutation.isPending}
                      title="Cancel"
                    >
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button
                      size="icon" variant="ghost" className="h-5 w-5"
                      onClick={() => retryRegenMutation.mutate(job.id)}
                      disabled={retryRegenMutation.isPending}
                      title="Retry"
                    >
                      <RotateCcw className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                  {job.error_message && job.status === 'failed' && (
                    <p className="w-full text-[9px] text-destructive pl-6 truncate" title={job.error_message}>
                      {job.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">No regen jobs yet.</p>
          )}
        </div>
      )}

      {/* Cast Consistency Panel */}
      {showConsistency && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" /> Cast Consistency Verification
          </h3>
          {consistencyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : consistencyData ? (
            <CastConsistencyPanel data={consistencyData} />
          ) : (
            <p className="text-xs text-muted-foreground">No consistency data available.</p>
          )}
        </div>
      )}

      {/* Character Continuity Panel */}
      {showContinuity && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" /> Character Continuity
          </h3>
          {continuityLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : continuityData ? (
            <ContinuityPanel data={continuityData} />
          ) : (
            <p className="text-xs text-muted-foreground">No continuity data available.</p>
          )}
        </div>
      )}

      {/* Scene Integrity Panel */}
      {showSceneIntegrity && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" /> Scene Integrity
          </h3>
          {sceneIntegrityLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : sceneIntegrityData ? (
            <SceneIntegrityPanel data={sceneIntegrityData} />
          ) : (
            <p className="text-xs text-muted-foreground">No scene integrity data available.</p>
          )}
        </div>
      )}

      {/* Regen Policy Panel */}
      {showRegenPolicy && (
        <div className="border-t border-border/30 pt-4 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Eye className="h-3.5 w-3.5" /> Regeneration Policy
          </h3>
          {regenPolicyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : regenPolicyData ? (
            <RegenPolicyPanel
              data={regenPolicyData}
              onRepair={(priorities) => autoRepairMutation.mutate(priorities)}
              isRepairing={autoRepairMutation.isPending}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No policy data available.</p>
          )}
        </div>
      )}

      {identityMap && Object.keys(identityMap).length > 0 && (
        <div className="border-t border-border/30 pt-4 space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Identity Diagnostics</h3>
          <div className="rounded-lg border border-border/30 bg-muted/5 p-3 space-y-1.5">
            {allCharacters.map(charName => {
              const key = normalizeCharacterKey(charName);
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
      {/* Cast Recommendations Panel (Phase 16.7) */}
      {showRecommendations && (
        <div className="space-y-3 rounded-lg border border-border/50 bg-card/20 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Cast Recommendations
            </h3>
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => refetchRecommendations()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
          {recommendationsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : !recommendationData || recommendationData.characters.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No characters found for recommendations.</p>
          ) : (
            <div className="space-y-4">
              {recommendationData.characters.map(charResult => {
                const isBound = mappedKeys.has(charResult.character_key);
                return (
                  <div key={charResult.character_key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{charResult.character_key}</span>
                      {isBound && (
                        <Badge variant="outline" className="text-[8px] h-4 text-emerald-500 border-emerald-500/30">Bound</Badge>
                      )}
                    </div>
                    {charResult.recommendations.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground pl-2">No matching roster actors found.</p>
                    ) : (
                      <div className="space-y-1 pl-2">
                        {charResult.recommendations.map((rec, idx) => (
                          <div key={rec.actor_id} className="flex items-center gap-3 p-2 rounded-md border border-border/30 bg-muted/5">
                            <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">#{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-foreground truncate">{rec.actor_name}</span>
                                <Badge variant="outline" className={cn('text-[8px] h-4', {
                                  'text-amber-400 border-amber-400/30': rec.reusability_tier === 'signature',
                                  'text-emerald-400 border-emerald-400/30': rec.reusability_tier === 'reliable',
                                  'text-sky-400 border-sky-400/30': rec.reusability_tier === 'emerging',
                                  'text-muted-foreground border-border': rec.reusability_tier === 'unvalidated',
                                })}>
                                  {rec.reusability_tier}
                                </Badge>
                                <span className="text-[10px] font-mono text-primary">{rec.match_score}pts</span>
                                {rec.quality_score != null && (
                                  <span className="text-[9px] text-muted-foreground">Q:{rec.quality_score}</span>
                                )}
                                {rec.project_count > 0 && (
                                  <span className="text-[9px] text-muted-foreground">{rec.project_count}proj</span>
                                )}
                              </div>
                              <div className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">
                                {rec.match_reasons.join(' · ')}
                              </div>
                            </div>
                            {!isBound && (
                              <Button
                                size="sm" variant="outline"
                                className="h-6 text-[10px] shrink-0"
                                onClick={() => {
                                  addMapping.mutate({
                                    character_key: charResult.character_key,
                                    ai_actor_id: rec.actor_id,
                                  });
                                }}
                                disabled={addMapping.isPending}
                              >
                                Cast
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* Cast Pack Panel (Phase 16.8) */}
      {showCastPack && castPack && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-card/20 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Cast Pack
            </h3>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => generatePackMutation.mutate()} disabled={generatePackMutation.isPending}>
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
              </Button>
            </div>
          </div>
          {/* Summary bar */}
          {(() => {
            const total = castPack.characters.length;
            const withRecs = castPack.characters.filter(c => c.recommendations.length > 0).length;
            const selected = Object.values(packSelections).filter(Boolean).length;
            const alreadyBound = castPack.characters.filter(c => mappedKeys.has(c.character_key)).length;
            const wouldApply = castPack.characters.filter(c => packSelections[c.character_key] && !mappedKeys.has(c.character_key)).length;
            const wouldSkip = castPack.characters.filter(c => packSelections[c.character_key] && mappedKeys.has(c.character_key)).length;
            return (
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground bg-muted/10 rounded-md px-3 py-2">
                <span>{total} characters</span>
                <span className="text-foreground">{withRecs} with recs</span>
                <span className="text-primary">{selected} selected</span>
                <span className="text-emerald-500">{alreadyBound} bound</span>
                <span className="text-sky-400">{wouldApply} would apply</span>
                {wouldSkip > 0 && <span className="text-amber-400">{wouldSkip} would skip (existing)</span>}
              </div>
            );
          })()}
          {/* Per-character rows */}
          <div className="space-y-2">
            {castPack.characters.map(charChoice => {
              const isBound = mappedKeys.has(charChoice.character_key);
              const currentBinding = (mappings || []).find(m => m.character_key === charChoice.character_key);
              const currentActor = currentBinding ? actors.find((a: any) => a.id === currentBinding.ai_actor_id) : null;
              const selectedActorId = packSelections[charChoice.character_key];

              return (
                <div key={charChoice.character_key} className="rounded-md border border-border/30 bg-card/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{charChoice.character_key}</span>
                      {isBound && currentActor && (
                        <Badge variant="outline" className="text-[8px] h-4 text-emerald-500 border-emerald-500/30">
                          Bound: {currentActor.name}
                        </Badge>
                      )}
                      {!isBound && (
                        <Badge variant="outline" className="text-[8px] h-4 text-muted-foreground border-border">
                          Unbound
                        </Badge>
                      )}
                    </div>
                  </div>
                  {charChoice.recommendations.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">No matching actors available.</p>
                  ) : (
                    <div className="space-y-1">
                      {charChoice.recommendations.map((rec) => {
                        const isSelected = selectedActorId === rec.actor_id;
                        return (
                          <button
                            key={rec.actor_id}
                            onClick={() => {
                              setPackSelections(prev => ({
                                ...prev,
                                [charChoice.character_key]: isSelected ? null : rec.actor_id,
                              }));
                            }}
                            className={cn(
                              'w-full flex items-center gap-3 p-2 rounded-md border text-left transition-colors',
                              isSelected
                                ? 'border-primary/50 bg-primary/5'
                                : 'border-border/20 bg-muted/5 hover:bg-muted/10'
                            )}
                          >
                            <div className={cn(
                              'w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center',
                              isSelected ? 'border-primary' : 'border-muted-foreground/30'
                            )}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-foreground truncate">{rec.actor_name}</span>
                                <Badge variant="outline" className={cn('text-[8px] h-4', {
                                  'text-amber-400 border-amber-400/30': rec.reusability_tier === 'signature',
                                  'text-emerald-400 border-emerald-400/30': rec.reusability_tier === 'reliable',
                                  'text-sky-400 border-sky-400/30': rec.reusability_tier === 'emerging',
                                  'text-muted-foreground border-border': rec.reusability_tier === 'unvalidated',
                                })}>
                                  {rec.reusability_tier}
                                </Badge>
                                <span className="text-[10px] font-mono text-primary">{rec.match_score}pts</span>
                              </div>
                              <div className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">
                                {rec.match_reasons.join(' · ')}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Apply CTAs */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            <Button
              size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => applyPackMutation.mutate(false)}
              disabled={applyPackMutation.isPending || Object.values(packSelections).filter(Boolean).length === 0}
            >
              {applyPackMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Apply Unbound Only
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => applyPackMutation.mutate(true)}
              disabled={applyPackMutation.isPending || Object.values(packSelections).filter(Boolean).length === 0}
            >
              Apply & Replace Existing
            </Button>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {Object.values(packSelections).filter(Boolean).length} selected
            </span>
          </div>
        </div>
      )}
      {/* Cast from Library Dialog */}
      <CastFromLibraryDialog
        characterKey={showCastLibrary}
        onClose={() => setShowCastLibrary(null)}
        onSelect={(actorId) => {
          if (showCastLibrary) {
            addMapping.mutate({ character_key: showCastLibrary, ai_actor_id: actorId });
            setShowCastLibrary(null);
          }
        }}
      />
      {/* Inline Create Actor Dialog — Phase 17 */}
      <InlineCreateActorDialog
        projectId={projectId!}
        characterKey={showCreateActor}
        onClose={() => setShowCreateActor(null)}
        onCreatedAndBound={(characterKey) => {
          setShowCreateActor(null);
          invalidateAll();
          toast.success(`Actor created and bound to ${characterKey}`);
        }}
        onCreatedPending={async (characterKey, actorId) => {
          setShowCreateActor(null);
          if (actorId && projectId) {
            try {
              await createPendingActorBindContext(actorId, projectId, characterKey);
            } catch { /* best effort */ }
          }
          invalidateAll();
          toast.info(`Actor created for ${characterKey} — bind when roster-ready`);
        }}
        actors={actors}
      />
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
        onRebind(val);
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

// ── Cast Health Panel ───────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<GovernanceSeverity, { label: string; icon: typeof ShieldCheck; badgeClass: string; dotClass: string }> = {
  healthy: { label: 'Healthy', icon: ShieldCheck, badgeClass: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', dotClass: 'bg-emerald-500' },
  warning: { label: 'Warning', icon: Shield, badgeClass: 'bg-amber-500/15 text-amber-700 border-amber-500/30', dotClass: 'bg-amber-500' },
  critical: { label: 'Critical', icon: ShieldAlert, badgeClass: 'bg-destructive/15 text-destructive border-destructive/30', dotClass: 'bg-destructive' },
};

const RECOMMENDATION_LABELS: Record<GovernanceRecommendation, string> = {
  no_action: 'No action needed',
  update_to_latest_version: 'Update to latest approved version',
  rebind_required: 'Rebind to a roster-ready actor',
  regenerate_outputs: 'Regenerate affected outputs',
  investigate_missing_binding: 'Investigate missing binding',
};

function CastHealthPanel({ data, actors, projectId, onRebind, onQueueRegen }: {
  data: CastGovernanceResult;
  actors: any[];
  projectId: string;
  onRebind: (charKey: string, actorId: string) => void;
  onQueueRegen?: (characterKey: string) => void;
}) {
  const OverallIcon = SEVERITY_CONFIG[data.overall_health].icon;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-card/30">
        <div className="flex items-center gap-2">
          <OverallIcon className={cn('h-5 w-5', data.overall_health === 'healthy' ? 'text-emerald-600' : data.overall_health === 'warning' ? 'text-amber-600' : 'text-destructive')} />
          <span className="text-sm font-medium text-foreground">
            {data.overall_health === 'healthy' ? 'All Clear' : data.overall_health === 'warning' ? 'Needs Attention' : 'Action Required'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground ml-auto">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {data.severity_counts.healthy} healthy</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> {data.severity_counts.warning} warning</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> {data.severity_counts.critical} critical</span>
        </div>
      </div>

      {/* Per-character rows */}
      <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20">
        {Object.values(data.characters).map((char) => (
          <CastHealthRow
            key={char.character_key}
            state={char}
            actors={actors}
            projectId={projectId}
            onRebind={onRebind}
            onQueueRegen={onQueueRegen}
          />
        ))}
        {Object.keys(data.characters).length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No characters to evaluate.</p>
        )}
      </div>
    </div>
  );
}

function CastHealthRow({ state, actors, projectId, onRebind, onQueueRegen }: {
  state: CharacterGovernanceState;
  actors: any[];
  projectId: string;
  onRebind: (charKey: string, actorId: string) => void;
  onQueueRegen?: (characterKey: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);
  const sevConfig = SEVERITY_CONFIG[state.severity];
  const SevIcon = sevConfig.icon;
  const actor = actors.find((a: any) => a.id === state.bound_actor_id);

  const { data: impactedOutputs, isLoading: outputsLoading } = useQuery({
    queryKey: ['impacted-outputs', projectId, state.character_key],
    queryFn: () => getImpactedOutputs(projectId, state.character_key),
    enabled: showOutputs,
  });

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className={cn('h-2 w-2 rounded-full shrink-0', sevConfig.dotClass)} />
        <span className="text-xs font-medium text-foreground w-28 truncate">{state.character_key}</span>
        <span className="text-[11px] text-muted-foreground truncate w-24">
          {actor?.name || (state.bound_actor_id ? state.bound_actor_id.slice(0, 8) : '—')}
        </span>
        <FreshnessBadge freshness={state.freshness} />
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5', sevConfig.badgeClass)}>
          <SevIcon className="h-2.5 w-2.5" /> {sevConfig.label}
        </span>
        {state.impact_out_of_sync > 0 && (
          <Badge variant="outline" className="text-[9px] h-4 border-amber-500/30 text-amber-700">
            {state.impact_out_of_sync} out of sync
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {state.recommendations.includes('update_to_latest_version') && state.bound_actor_id && (
            <Button
              size="sm" variant="outline"
              className="h-6 text-[10px] gap-1 border-amber-500/30 text-amber-700 hover:bg-amber-500/10"
              onClick={() => onRebind(state.character_key, state.bound_actor_id!)}
            >
              <RefreshCw className="h-2.5 w-2.5" /> Update
            </Button>
          )}
          {state.recommendations.includes('regenerate_outputs') && state.impact_out_of_sync > 0 && onQueueRegen && (
            <Button
              size="sm" variant="outline"
              className="h-6 text-[10px] gap-1"
              onClick={() => onQueueRegen(state.character_key)}
            >
              <ListChecks className="h-2.5 w-2.5" /> Queue Regen
            </Button>
          )}
          {state.impact_total > 0 && (
            <Button
              size="sm" variant="ghost"
              className="h-6 text-[10px] gap-1"
              onClick={() => setShowOutputs(!showOutputs)}
            >
              <Activity className="h-2.5 w-2.5" /> {showOutputs ? 'Hide' : 'View'} Outputs
            </Button>
          )}
          <Button
            size="icon" variant="ghost" className="h-6 w-6"
            onClick={() => setShowDetails(!showDetails)}
            title="View details"
          >
            <Eye className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Recommendations detail */}
      {showDetails && (
        <div className="ml-5 pl-3 border-l-2 border-border/30 space-y-1">
          <p className="text-[10px] text-muted-foreground"><strong>Recommendations:</strong></p>
          <ul className="list-disc list-inside text-[10px] text-muted-foreground space-y-0.5">
            {state.recommendations.map((rec) => (
              <li key={rec}>{RECOMMENDATION_LABELS[rec]}</li>
            ))}
          </ul>
          {state.impact_total > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {state.impact_total} tracked output{state.impact_total !== 1 ? 's' : ''}, {state.impact_out_of_sync} out of sync
            </p>
          )}
        </div>
      )}

      {/* Impacted outputs drill-down */}
      {showOutputs && (
        <div className="ml-5 pl-3 border-l-2 border-border/30 space-y-2">
          {outputsLoading ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Loading impacted outputs…</span>
            </div>
          ) : impactedOutputs ? (
            <>
              {impactedOutputs.out_of_sync.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-amber-700">
                    Out of Sync ({impactedOutputs.out_of_sync.length})
                  </p>
                  <div className="space-y-0.5">
                    {impactedOutputs.out_of_sync.map((entry) => (
                      <div key={entry.output_id} className="text-[9px] text-muted-foreground flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className="font-mono">{entry.output_id.slice(0, 12)}…</span>
                        <span className="text-muted-foreground/60">
                          pinned: {entry.stored_actor_version_id?.slice(0, 8) || '—'} → current: {entry.current_actor_version_id?.slice(0, 8) || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {impactedOutputs.unbound.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-destructive">
                    Unbound ({impactedOutputs.unbound.length})
                  </p>
                  <div className="space-y-0.5">
                    {impactedOutputs.unbound.map((entry) => (
                      <div key={entry.output_id} className="text-[9px] text-muted-foreground flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                        <span className="font-mono">{entry.output_id.slice(0, 12)}…</span>
                        <span className="text-muted-foreground/60">no active binding</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {impactedOutputs.out_of_sync.length === 0 && impactedOutputs.unbound.length === 0 && (
                <p className="text-[10px] text-muted-foreground">No impacted outputs.</p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">Unable to load impact data.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Regen Job Status Badge ──────────────────────────────────────────────────

const REGEN_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-muted text-muted-foreground border-border' },
  running: { label: 'Running', className: 'bg-primary/15 text-primary border-primary/30' },
  completed: { label: 'Done', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground/60 border-border/50' },
};

function RegenJobStatusBadge({ status, errorMessage }: { status: string; errorMessage?: string | null }) {
  // Show "No Changes Needed" for completed jobs that were idempotent skips
  const isNoOp = status === 'completed' && errorMessage === 'no_cast_binding';
  const displayStatus = isNoOp ? 'completed' : status;
  const config = REGEN_STATUS_CONFIG[displayStatus] || REGEN_STATUS_CONFIG.queued;
  const label = isNoOp ? 'No Change' : config.label;
  return (
    <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium', config.className)}>
      {label}
    </span>
  );
}

// ── Cast Consistency Panel ──────────────────────────────────────────────────

const CONSISTENCY_STATUS_CONFIG: Record<CastConsistencyStatus, { label: string; dotClass: string; textClass: string }> = {
  aligned: { label: 'Aligned', dotClass: 'bg-emerald-500', textClass: 'text-emerald-700' },
  misaligned: { label: 'Misaligned', dotClass: 'bg-amber-500', textClass: 'text-amber-700' },
  unbound: { label: 'Unbound', dotClass: 'bg-destructive', textClass: 'text-destructive' },
  unknown: { label: 'Unknown', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' },
};

const OVERALL_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  aligned: { label: 'Fully Aligned', icon: CheckCircle2, className: 'text-emerald-600' },
  partial: { label: 'Partially Aligned', icon: AlertTriangle, className: 'text-amber-600' },
  broken: { label: 'Not Aligned', icon: AlertCircle, className: 'text-destructive' },
};

function CastConsistencyPanel({ data }: { data: CastConsistencySummary }) {
  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const overall = OVERALL_CONFIG[data.overall_status] || OVERALL_CONFIG.aligned;
  const OverallIcon = overall.icon;

  if (data.total_results === 0) {
    return <p className="text-xs text-muted-foreground">No outputs with cast provenance found.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-card/30">
        <div className="flex items-center gap-2">
          <OverallIcon className={cn('h-5 w-5', overall.className)} />
          <span className="text-sm font-medium text-foreground">{overall.label}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground ml-auto">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {data.aligned_count} aligned
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> {data.misaligned_count} misaligned
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-destructive" /> {data.unbound_count} unbound
          </span>
          {data.unknown_count > 0 && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-muted-foreground" /> {data.unknown_count} unknown
            </span>
          )}
        </div>
      </div>

      {/* Per-character rows */}
      <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20">
        {Object.entries(data.by_character).map(([charKey, results]) => {
          const alignedCount = results.filter(r => r.status === 'aligned').length;
          const misalignedCount = results.filter(r => r.status === 'misaligned').length;
          const unboundCount = results.filter(r => r.status === 'unbound').length;
          const allAligned = misalignedCount === 0 && unboundCount === 0;
          const isExpanded = expandedChar === charKey;

          return (
            <div key={charKey} className="p-3 space-y-2">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => setExpandedChar(isExpanded ? null : charKey)}
              >
                <span className={cn('h-2 w-2 rounded-full shrink-0', allAligned ? 'bg-emerald-500' : 'bg-amber-500')} />
                <span className="text-xs font-medium text-foreground w-28 truncate">
                  {charKey || '(unknown)'}
                </span>
                <span className="text-[11px] text-muted-foreground">{results.length} outputs</span>
                {allAligned ? (
                  <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/30 text-emerald-700">
                    All aligned
                  </Badge>
                ) : (
                  <div className="flex gap-1">
                    {misalignedCount > 0 && (
                      <Badge variant="outline" className="text-[9px] h-4 border-amber-500/30 text-amber-700">
                        {misalignedCount} misaligned
                      </Badge>
                    )}
                    {unboundCount > 0 && (
                      <Badge variant="outline" className="text-[9px] h-4 border-destructive/30 text-destructive">
                        {unboundCount} unbound
                      </Badge>
                    )}
                  </div>
                )}
                {!allAligned && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">
                    Use Regen Jobs to refresh these outputs
                  </span>
                )}
                <Eye className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
              </div>

              {/* Drill-down */}
              {isExpanded && (
                <div className="ml-5 pl-3 border-l-2 border-border/30 space-y-0.5">
                  {results.map((r) => {
                    const sc = CONSISTENCY_STATUS_CONFIG[r.status];
                    return (
                      <div key={`${r.output_id}-${r.character_key}`} className="flex items-center gap-2 text-[9px] text-muted-foreground">
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sc.dotClass)} />
                        <span className="font-mono">{r.output_id.slice(0, 12)}…</span>
                        <span className={cn('font-medium', sc.textClass)}>{sc.label}</span>
                        {r.status === 'misaligned' && (
                          <span className="text-muted-foreground/60">
                            stored: {r.actual_actor_version_id?.slice(0, 8) || '—'} → expected: {r.expected_actor_version_id?.slice(0, 8) || '—'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {Object.keys(data.by_character).length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No characters with provenance data.</p>
        )}
      </div>
    </div>
  );
}

// ── Continuity Panel ────────────────────────────────────────────────────────

const CONTINUITY_STATUS_CONFIG: Record<string, { label: string; dotClass: string; textClass: string }> = {
  stable: { label: 'Stable', dotClass: 'bg-emerald-500', textClass: 'text-emerald-700' },
  mixed: { label: 'Mixed', dotClass: 'bg-amber-500', textClass: 'text-amber-700' },
  broken: { label: 'Broken', dotClass: 'bg-destructive', textClass: 'text-destructive' },
  unknown: { label: 'Unknown', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' },
};

const CONTINUITY_OVERALL_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  stable: { label: 'All Stable', icon: CheckCircle2, className: 'text-emerald-600' },
  mixed: { label: 'Drift Detected', icon: AlertTriangle, className: 'text-amber-600' },
  broken: { label: 'Continuity Broken', icon: AlertCircle, className: 'text-destructive' },
};

function ContinuityPanel({ data }: { data: ProjectContinuitySummary }) {
  const [expandedChar, setExpandedChar] = useState<string | null>(null);
  const overall = CONTINUITY_OVERALL_CONFIG[data.overall_status] || CONTINUITY_OVERALL_CONFIG.stable;
  const OverallIcon = overall.icon;

  if (data.total_characters === 0) {
    return <p className="text-xs text-muted-foreground">No characters with provenance data found.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-card/30">
        <div className="flex items-center gap-2">
          <OverallIcon className={cn('h-5 w-5', overall.className)} />
          <span className="text-sm font-medium text-foreground">{overall.label}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground ml-auto">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {data.stable_count} stable</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> {data.mixed_count} mixed</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> {data.broken_count} broken</span>
          {data.unknown_count > 0 && (
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> {data.unknown_count} unknown</span>
          )}
        </div>
      </div>

      {/* Per-character rows */}
      <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20">
        {Object.values(data.characters).map((char) => {
          const sc = CONTINUITY_STATUS_CONFIG[char.status] || CONTINUITY_STATUS_CONFIG.unknown;
          const isExpanded = expandedChar === char.character_key;

          return (
            <div key={char.character_key} className="p-3 space-y-2">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => setExpandedChar(isExpanded ? null : char.character_key)}
              >
                <span className={cn('h-2 w-2 rounded-full shrink-0', sc.dotClass)} />
                <span className="text-xs font-medium text-foreground w-28 truncate">{char.character_key}</span>
                <span className="text-[11px] text-muted-foreground">{char.outputs_checked} outputs</span>
                <Badge variant="outline" className={cn('text-[9px] h-4', sc.textClass)}>
                  {sc.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  Score: <strong className="text-foreground">{char.continuity_score}%</strong>
                </span>
                {char.dominant_actor_version_id && (
                  <span className="text-[9px] font-mono text-muted-foreground/60">
                    dom: {char.dominant_actor_version_id.slice(0, 8)}
                  </span>
                )}
                {char.drift_detected && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">
                    Use Consistency + Regen Jobs to converge
                  </span>
                )}
                <Eye className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
              </div>

              {isExpanded && (
                <div className="ml-5 pl-3 border-l-2 border-border/30 space-y-1">
                  <p className="text-[10px] text-muted-foreground">
                    <strong>{char.distinct_actor_version_ids.length}</strong> distinct version{char.distinct_actor_version_ids.length !== 1 ? 's' : ''} across {char.outputs_checked} output{char.outputs_checked !== 1 ? 's' : ''}
                  </p>
                  {char.distinct_actor_version_ids.map((vid) => (
                    <div key={vid} className="flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', vid === char.dominant_actor_version_id ? 'bg-emerald-500' : 'bg-amber-500')} />
                      <span className="font-mono">{vid.slice(0, 16)}…</span>
                      {vid === char.dominant_actor_version_id && (
                        <Badge variant="outline" className="text-[8px] h-3.5 border-emerald-500/30 text-emerald-700">dominant ({char.dominant_count})</Badge>
                      )}
                    </div>
                  ))}
                  {char.distinct_actor_version_ids.length === 0 && (
                    <p className="text-[9px] text-muted-foreground">No usable version IDs in provenance.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Scene Integrity Panel ───────────────────────────────────────────────────

const SCENE_STATUS_CONFIG: Record<string, { label: string; dotClass: string; textClass: string }> = {
  aligned: { label: 'Aligned', dotClass: 'bg-emerald-500', textClass: 'text-emerald-700' },
  partial: { label: 'Partial', dotClass: 'bg-amber-500', textClass: 'text-amber-700' },
  broken: { label: 'Broken', dotClass: 'bg-destructive', textClass: 'text-destructive' },
};

const SCENE_CHAR_STATUS_CONFIG: Record<string, { label: string; dotClass: string }> = {
  aligned: { label: 'Aligned', dotClass: 'bg-emerald-500' },
  misaligned: { label: 'Misaligned', dotClass: 'bg-amber-500' },
  unbound: { label: 'Unbound', dotClass: 'bg-destructive' },
  unknown: { label: 'Unknown', dotClass: 'bg-muted-foreground' },
};

function SceneIntegrityPanel({ data }: { data: ProjectSceneConsistencySummary }) {
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);

  if (data.total_outputs === 0) {
    return <p className="text-xs text-muted-foreground">No generation outputs found.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-[11px] flex-wrap">
        <span className="text-muted-foreground">
          Total outputs: <strong className="text-foreground">{data.total_outputs}</strong>
        </span>
        <span className="text-emerald-700">
          Aligned: <strong>{data.aligned_count}</strong>
        </span>
        <span className={data.partial_count > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
          Partial: <strong>{data.partial_count}</strong>
        </span>
        <span className={data.broken_count > 0 ? 'text-destructive' : 'text-muted-foreground'}>
          Broken: <strong>{data.broken_count}</strong>
        </span>
      </div>

      {/* Per-output rows */}
      <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20 max-h-[400px] overflow-y-auto">
        {data.outputs.map((output) => {
          const sc = SCENE_STATUS_CONFIG[output.overall_status] || SCENE_STATUS_CONFIG.broken;
          const isExpanded = expandedOutput === output.output_id;

          return (
            <div key={output.output_id}>
              <button
                className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/10 transition-colors"
                onClick={() => setExpandedOutput(isExpanded ? null : output.output_id)}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', sc.dotClass)} />
                <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                  {output.output_id.slice(0, 16)}…
                </span>
                <Badge variant="outline" className={cn('text-[9px] h-4', sc.textClass)}>
                  {sc.label}
                </Badge>
                <span className="text-[9px] text-muted-foreground">
                  {output.characters.length} char{output.characters.length !== 1 ? 's' : ''}
                </span>
              </button>

              {isExpanded && (
                <div className="px-6 pb-2 space-y-1">
                  {output.characters.map((ch, idx) => {
                    const csc = SCENE_CHAR_STATUS_CONFIG[ch.status] || SCENE_CHAR_STATUS_CONFIG.unknown;
                    return (
                      <div key={`${ch.character_key}-${idx}`} className="flex items-center gap-2 text-[10px]">
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', csc.dotClass)} />
                        <span className="font-medium text-foreground w-24 truncate">
                          {ch.character_key || '(unknown)'}
                        </span>
                        <Badge variant="outline" className="text-[8px] h-3.5">{csc.label}</Badge>
                        {ch.status === 'misaligned' && ch.actual_actor_version_id && ch.expected_actor_version_id && (
                          <span className="text-[9px] text-muted-foreground font-mono">
                            {ch.actual_actor_version_id.slice(0, 8)}… → {ch.expected_actor_version_id.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {(output.overall_status === 'partial' || output.overall_status === 'broken') && (
                    <p className="text-[9px] text-muted-foreground/70 italic pt-1">
                      Use Regen Jobs to repair this output
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Regen Policy Panel ──────────────────────────────────────────────────────

const POLICY_PRIORITY_CONFIG: Record<string, { label: string; dotClass: string; textClass: string }> = {
  high: { label: 'High', dotClass: 'bg-destructive', textClass: 'text-destructive' },
  medium: { label: 'Medium', dotClass: 'bg-amber-500', textClass: 'text-amber-700' },
  low: { label: 'Low', dotClass: 'bg-muted-foreground', textClass: 'text-muted-foreground' },
};

function RegenPolicyPanel({
  data,
  onRepair,
  isRepairing,
}: {
  data: RegenPolicySummary;
  onRepair: (priorities: ('high' | 'medium' | 'low')[]) => void;
  isRepairing: boolean;
}) {
  if (data.total_items === 0) {
    return <p className="text-xs text-muted-foreground">No regeneration recommendations — all outputs are healthy.</p>;
  }

  // Group by output_id for readability
  const grouped = new Map<string, RegenPolicyItem[]>();
  for (const item of data.items) {
    const list = grouped.get(item.output_id) || [];
    list.push(item);
    grouped.set(item.output_id, list);
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-[11px] flex-wrap">
        <span className="text-muted-foreground">
          Total: <strong className="text-foreground">{data.total_items}</strong>
        </span>
        <span className={data.high_priority > 0 ? 'text-destructive' : 'text-muted-foreground'}>
          High: <strong>{data.high_priority}</strong>
        </span>
        <span className={data.medium_priority > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
          Medium: <strong>{data.medium_priority}</strong>
        </span>
        <span className="text-muted-foreground">
          Low: <strong>{data.low_priority}</strong>
        </span>
      </div>

      {/* Auto-repair actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.high_priority > 0 && (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[11px]"
            onClick={() => onRepair(['high'])}
            disabled={isRepairing}
          >
            {isRepairing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
            Fix High Priority
          </Button>
        )}
        {(data.high_priority > 0 || data.medium_priority > 0) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => onRepair(['high', 'medium'])}
            disabled={isRepairing}
          >
            Fix High + Medium
          </Button>
        )}
        {data.total_items > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => onRepair(['high', 'medium', 'low'])}
            disabled={isRepairing}
          >
            Fix All
          </Button>
        )}
      </div>

      {/* Grouped by output */}
      <div className="rounded-lg border border-border/30 bg-muted/5 divide-y divide-border/20 max-h-[400px] overflow-y-auto">
        {[...grouped.entries()].map(([outputId, items]) => (
          <div key={outputId} className="px-3 py-2 space-y-1">
            <div className="text-[10px] font-mono text-muted-foreground">
              {outputId.slice(0, 16)}…
            </div>
            {items.map((item, idx) => {
              const pc = POLICY_PRIORITY_CONFIG[item.priority] || POLICY_PRIORITY_CONFIG.low;
              return (
                <div key={`${item.character_key}-${idx}`} className="flex items-center gap-2 text-[10px] pl-2">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', pc.dotClass)} />
                  <span className="font-medium text-foreground w-20 truncate">
                    {item.character_key || 'ALL'}
                  </span>
                  <Badge variant="outline" className={cn('text-[8px] h-3.5', pc.textClass)}>
                    {pc.label}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground truncate flex-1">
                    {item.reasons.map(r => r.replace(/_/g, ' ')).join(', ')}
                  </span>
                  <span className="text-[9px] text-muted-foreground/70 shrink-0">
                    {item.confidence}%
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cast from Library Dialog ────────────────────────────────────────────────

function CastFromLibraryDialog({
  characterKey,
  onClose,
  onSelect,
}: {
  characterKey: string | null;
  onClose: () => void;
  onSelect: (actorId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: rosterActors, isLoading } = useQuery({
    queryKey: ['roster-actors-for-casting'],
    queryFn: getRosterActorsForCasting,
    enabled: !!characterKey,
  });

  const filtered = useMemo(() => {
    if (!rosterActors) return [];
    if (!search) return rosterActors;
    const q = search.toLowerCase();
    return rosterActors.filter(a =>
      a.actor_name.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [rosterActors, search]);

  const tierConfig: Record<string, { label: string; className: string }> = {
    signature: { label: 'Signature', className: 'text-amber-400 border-amber-400/30' },
    reliable: { label: 'Reliable', className: 'text-emerald-400 border-emerald-400/30' },
    emerging: { label: 'Emerging', className: 'text-sky-400 border-sky-400/30' },
    unvalidated: { label: 'Unvalidated', className: 'text-muted-foreground border-border' },
  };

  return (
    <Dialog open={!!characterKey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Cast from Library — <span className="text-primary">{characterKey}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input placeholder="Search roster actors..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No roster-ready actors found.</p>
          ) : (
            filtered.map(actor => (
              <button
                key={actor.actor_id}
                onClick={() => onSelect(actor.actor_id)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border/30 bg-card/30 hover:bg-muted/20 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded bg-muted/10 shrink-0 overflow-hidden border border-border/20">
                  <Users className="h-4 w-4 text-muted-foreground/30 m-auto mt-2" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{actor.actor_name}</span>
                    <Badge variant="outline" className={cn('text-[8px] h-4', tierConfig[actor.reusability_tier]?.className)}>
                      {tierConfig[actor.reusability_tier]?.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {actor.quality_score != null && <span>Q: {actor.quality_score}</span>}
                    <span>{actor.project_count} project{actor.project_count !== 1 ? 's' : ''}</span>
                    {actor.tags.length > 0 && <span className="truncate">{actor.tags.slice(0, 2).join(', ')}</span>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline Create Actor Dialog — Phase 17 + 17.2 (Casting Brief Separation) ─

function InlineCreateActorDialog({
  projectId, characterKey, onClose, onCreatedAndBound, onCreatedPending, actors,
}: {
  projectId: string;
  characterKey: string | null;
  onClose: () => void;
  onCreatedAndBound: (characterKey: string) => void;
  onCreatedPending: (characterKey: string, actorId: string) => void;
  actors: any[];
}) {
  const [briefResult, setBriefResult] = useState<CharacterCastingBriefResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');

  // Load casting brief when character key changes
  useEffect(() => {
    if (!characterKey || !projectId) {
      setBriefResult(null);
      return;
    }
    setLoading(true);
    buildCharacterCastingBrief(projectId, characterKey).then(result => {
      setBriefResult(result);
      // Populate editable fields from casting brief only
      setName(result.brief.suggested_actor_name);
      setDescription(result.brief.actor_description);
      setTagsStr(result.brief.actor_tags.join(', '));
      setNegativePrompt(result.brief.negative_exclusions.join(', '));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [characterKey, projectId]);

  const handleCreate = async () => {
    if (!characterKey || !name.trim()) return;
    setCreating(true);
    try {
      const actorResult = await aiCastApi.createActor({
        name: name.trim(),
        description,
        negative_prompt: negativePrompt,
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      });
      const actorId = actorResult.actor.id;

      await aiCastApi.createVersion(actorId, {
        invariants: [`Created from project character: ${characterKey}`],
      });

      const actorData = await aiCastApi.getActor(actorId);
      const actor = actorData?.actor;

      if (actor?.roster_ready && actor?.approved_version_id) {
        await bindActorToProjectCharacter(
          { projectId, characterKey, actorId, actorVersionId: actor.approved_version_id },
          [...actors, actor],
        );
        onCreatedAndBound(characterKey);
      } else {
        onCreatedPending(characterKey, actorId);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create actor');
    } finally {
      setCreating(false);
    }
  };

  const context = briefResult?.context;
  const brief = briefResult?.brief;

  return (
    <Dialog open={!!characterKey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Create Actor for {characterKey}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Story context is shown for reference only. Actor criteria describe the performer's physical appearance — not their character arc.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Section 1 — Character Context (read-only, quarantined from actor criteria) */}
            {context && (
              <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1.5">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Character Context <span className="font-normal opacity-60">— story reference only</span>
                </h4>
                <p className="text-xs font-medium text-foreground">{context.display_name}</p>
                {context.role_in_story && (
                  <p className="text-[11px] text-muted-foreground">{context.role_in_story}</p>
                )}
                {context.canon_notes.length > 0 && (
                  <ul className="space-y-0.5 mt-1">
                    {context.canon_notes.slice(0, 5).map((note, i) => (
                      <li key={i} className="text-[10px] text-muted-foreground/80 pl-2 border-l border-border/30">
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Section 2 — Suggested Actor Criteria (editable) */}
            <div className="space-y-3">
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Actor Criteria <span className="font-normal opacity-60">— physical appearance &amp; presence</span>
              </h4>

              {/* Source quality notice */}
              {brief && brief.prefill_quality === 'source_thin' && (
                <Alert variant="default" className="py-2 px-3">
                  <AlertDescription className="text-[10px] text-muted-foreground">
                    Limited appearance data found in project documents. Current prefill is based on available canon/context only. You can manually enrich the fields below.
                  </AlertDescription>
                </Alert>
              )}
              {brief && brief.prefill_quality === 'source_partial' && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Some appearance details were inferred from context. Review and adjust as needed.
                </p>
              )}

              {/* Brief metadata badges */}
              {brief && (
                <div className="flex flex-wrap gap-1">
                  {(brief.actor_criteria_highlights || brief.appearance_markers || []).slice(0, 6).map((m, i) => (
                    <Badge key={i} variant="secondary" className="text-[9px] h-4">{m}</Badge>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Actor Name</label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Hana Kimura"
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Description (visual identity only)</label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="A young woman in her early 20s, elegant and poised..."
                  className="text-xs min-h-[80px]"
                />
                <p className="text-[9px] text-muted-foreground/60">
                  Describe physical appearance, build, and presence only. Do not include story, personality, or plot details — these belong in Character Context above.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Negative Prompt</label>
                <Input
                  value={negativePrompt}
                  onChange={e => setNegativePrompt(e.target.value)}
                  placeholder="celebrity, real person, cartoon..."
                  className="text-xs h-9"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
                <Input
                  value={tagsStr}
                  onChange={e => setTagsStr(e.target.value)}
                  placeholder="lead, elegant, young_adult"
                  className="text-xs h-9"
                />
              </div>
            </div>

            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="w-full h-9 text-xs"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Create Actor
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              After creation, validate and promote the actor to make it bindable.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
