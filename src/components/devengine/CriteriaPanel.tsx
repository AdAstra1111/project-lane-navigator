import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Sparkles, Pencil, Check, X, Info, RefreshCw, ChevronDown, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CriteriaData {
  format_subtype?: string | null;
  season_episode_count?: number | null;
  // Canonical episode length keys (single source of truth)
  episode_duration_target_seconds?: number | null;
  episode_duration_min_seconds?: number | null;
  episode_duration_max_seconds?: number | null;
  episode_duration_variance_policy?: 'strict' | 'soft' | null;
  // Legacy scalar — kept for backward compat, mapped on load
  episode_target_duration_seconds?: number | null;
  target_runtime_min_low?: number | null;
  target_runtime_min_high?: number | null;
  assigned_lane?: string | null;
  budget_range?: string | null;
  tone_tags?: string[] | null;
  audience_region?: string | null;
  language?: string | null;
}

interface FieldConfidence {
  [key: string]: 'high' | 'med' | 'low' | null;
}

interface DerivedFromIdea {
  extracted_at: string;
  document_id: string;
  version_id: string;
  criteria: CriteriaData;
  field_confidence: FieldConfidence;
}

interface StaleDoc {
  documentId: string;
  doc_type: string;
  is_stale: boolean;
  diff_keys: string[];
  last_generated_at: string;
}

interface Props {
  projectId: string;
  documents: Array<{ id: string; doc_type: string; title: string }>;
  onCriteriaUpdated?: () => void;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  med: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-destructive/15 text-destructive border-destructive/30',
};

const FORMAT_OPTIONS = [
  'film', 'tv-series', 'limited-series', 'vertical-drama', 'documentary',
  'documentary-series', 'short', 'animation', 'digital-series',
];
const LANE_OPTIONS = ['prestige', 'mainstream', 'independent-film', 'genre', 'micro-budget'];
const BUDGET_OPTIONS = ['micro', 'low', 'medium', 'high', 'tent-pole'];

async function callDevEngine(action: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

export function CriteriaPanel({ projectId, documents, onCriteriaUpdated }: Props) {
  const [criteria, setCriteria] = useState<CriteriaData>({});
  const [fieldConfidence, setFieldConfidence] = useState<FieldConfidence>({});
  const [derivedFrom, setDerivedFrom] = useState<DerivedFromIdea | null>(null);
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [notesForUser, setNotesForUser] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editCriteria, setEditCriteria] = useState<CriteriaData>({});

  // Rebase state
  const [staleDocs, setStaleDocs] = useState<StaleDoc[]>([]);
  const [isCheckingRebase, setIsCheckingRebase] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [rebasePlan, setRebasePlan] = useState<any>(null);
  const [rebaseOpen, setRebaseOpen] = useState(false);

  useEffect(() => { loadCriteria(); }, [projectId]);

  async function loadCriteria() {
    const { data } = await (supabase as any).from('projects')
      .select('guardrails_config, assigned_lane, budget_range, format, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, development_behavior')
      .eq('id', projectId).single();
    if (!data) return;

    const gc = data.guardrails_config || {};
    const quals = gc?.overrides?.qualifications || {};
    const derived = gc?.derived_from_idea || null;

    // Canonical keys — prefer new keys, fall back to legacy scalar for compat
    const legacyScalar = quals.episode_target_duration_seconds || data.episode_target_duration_seconds || null;
    const canonMin = quals.episode_duration_min_seconds || data.episode_target_duration_min_seconds || legacyScalar || null;
    const canonMax = quals.episode_duration_max_seconds || data.episode_target_duration_max_seconds || legacyScalar || null;
    const canonTarget = quals.episode_duration_target_seconds || legacyScalar || (canonMin && canonMax ? Math.round((canonMin + canonMax) / 2) : null);

    const merged: CriteriaData = {
      format_subtype: quals.format_subtype || (data.format?.toLowerCase().replace(/_/g, '-')) || null,
      season_episode_count: quals.season_episode_count || data.season_episode_count || null,
      episode_duration_target_seconds: canonTarget,
      episode_duration_min_seconds: canonMin,
      episode_duration_max_seconds: canonMax,
      episode_duration_variance_policy: quals.episode_duration_variance_policy || 'soft',
      // legacy field preserved for downstream compat
      episode_target_duration_seconds: legacyScalar,
      target_runtime_min_low: quals.target_runtime_min_low || null,
      target_runtime_min_high: quals.target_runtime_min_high || null,
      assigned_lane: data.assigned_lane || quals.assigned_lane || null,
      budget_range: data.budget_range || quals.budget_range || null,
      tone_tags: quals.tone_tags || null,
      audience_region: quals.audience_region || null,
      language: quals.language || null,
    };
    setCriteria(merged);
    setEditCriteria(merged);
    if (derived) {
      setDerivedFrom(derived);
      setFieldConfidence(derived.field_confidence || {});
    }
  }

  async function handleExtract() {
    const ideaDoc = documents.find(d => d.doc_type === 'idea');
    if (!ideaDoc) { toast.error('No idea document found'); return; }

    const { data: versions } = await (supabase as any).from('project_document_versions')
      .select('id').eq('document_id', ideaDoc.id)
      .order('version_number', { ascending: false }).limit(1);
    const versionId = versions?.[0]?.id;
    if (!versionId) { toast.error('No version found for idea document'); return; }

    setIsExtracting(true);
    try {
      const result = await callDevEngine('extract-criteria', { projectId, documentId: ideaDoc.id, versionId });
      setCriteria(result.criteria || {});
      setEditCriteria(result.criteria || {});
      setFieldConfidence(result.field_confidence || {});
      setMissingRequired(result.missing_required || []);
      setNotesForUser(result.notes_for_user || []);
      setDerivedFrom({
        extracted_at: new Date().toISOString(),
        document_id: ideaDoc.id,
        version_id: versionId,
        criteria: result.criteria,
        field_confidence: result.field_confidence,
      });
      toast.success('Criteria extracted from idea');
      onCriteriaUpdated?.();
      await loadCriteria();
      // Auto-run rebase check after criteria change
      handleRebaseCheck();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleSaveEdit() {
    try {
      const { data: proj } = await (supabase as any).from('projects')
        .select('guardrails_config').eq('id', projectId).single();
      const gc = proj?.guardrails_config || {};
      gc.overrides = gc.overrides || {};

      // Merge canonical keys into guardrails qualifications
      const existingQuals = gc.overrides.qualifications || {};
      const durMin = editCriteria.episode_duration_min_seconds ?? null;
      const durMax = editCriteria.episode_duration_max_seconds ?? null;
      const durTarget = editCriteria.episode_duration_target_seconds ?? null;
      const legacyScalar = durTarget || (durMin && durMax ? Math.round((durMin + durMax) / 2) : durMin || durMax || null);

      const newQuals = {
        ...existingQuals,
        ...editCriteria,
        episode_duration_target_seconds: durTarget,
        episode_duration_min_seconds: durMin,
        episode_duration_max_seconds: durMax,
        episode_duration_variance_policy: editCriteria.episode_duration_variance_policy || 'soft',
        // legacy scalar — keep in sync
        episode_target_duration_seconds: legacyScalar,
      };
      gc.overrides.qualifications = newQuals;

      const updates: Record<string, any> = { guardrails_config: gc };
      // Mirror to DB columns (legacy support for downstream consumers)
      if (legacyScalar) updates.episode_target_duration_seconds = legacyScalar;
      if (durMin) updates.episode_target_duration_min_seconds = durMin;
      if (durMax) updates.episode_target_duration_max_seconds = durMax;
      if (editCriteria.season_episode_count) updates.season_episode_count = editCriteria.season_episode_count;
      if (editCriteria.assigned_lane) updates.assigned_lane = editCriteria.assigned_lane;
      if (editCriteria.budget_range) updates.budget_range = editCriteria.budget_range;
      if (editCriteria.format_subtype) {
        const fmtMap: Record<string, string> = {
          'vertical-drama': 'vertical_drama', 'tv-series': 'tv_series',
          'limited-series': 'limited_series', 'documentary-series': 'documentary_series',
        };
        updates.format = fmtMap[editCriteria.format_subtype] || editCriteria.format_subtype;
      }

      await (supabase as any).from('projects').update(updates).eq('id', projectId);
      setCriteria(editCriteria);
      setIsEditing(false);
      toast.success('Criteria saved');
      onCriteriaUpdated?.();
      handleRebaseCheck();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const handleRebaseCheck = useCallback(async () => {
    setIsCheckingRebase(true);
    try {
      const result = await callDevEngine('rebase-check', { projectId });
      const stale = (result.docs || []).filter((d: any) => d.is_stale);
      setStaleDocs(stale);
      if (stale.length > 0) setRebaseOpen(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsCheckingRebase(false);
    }
  }, [projectId]);

  const handleRebaseRegenerate = async (fromStage: string, toStage: string, strategy: string) => {
    setIsRegenerating(true);
    try {
      // First get plan
      const plan = await callDevEngine('rebase-regenerate', {
        projectId, from_stage: fromStage, to_stage: toStage, strategy, require_approval: true,
      });
      setRebasePlan(plan);

      // Auto-execute if user confirms
      const result = await callDevEngine('rebase-regenerate', {
        projectId, from_stage: fromStage, to_stage: toStage, strategy, require_approval: false,
      });
      toast.success(`Regenerated ${(result.results || []).filter((r: any) => r.regenerated).length} stages`);
      onCriteriaUpdated?.();
      setStaleDocs([]);
      setRebasePlan(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsRegenerating(false);
    }
  };

  const hasIdeaDoc = documents.some(d => d.doc_type === 'idea');

  function renderField(label: string, field: string, value: any) {
    const conf = fieldConfidence[field];
    return (
      <div key={field} className="flex items-center justify-between gap-2 py-1">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-foreground">{value ?? '—'}</span>
          {conf && (
            <Badge variant="outline" className={`text-[7px] px-1 py-0 ${CONFIDENCE_COLORS[conf] || ''}`}>
              {conf}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" id="criteria-panel">
      <Card>
        <CardHeader className="py-2 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Info className="h-3 w-3" /> Variables / Criteria
            </CardTitle>
            <div className="flex items-center gap-1">
              {hasIdeaDoc && (
                <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={handleExtract} disabled={isExtracting}>
                  {isExtracting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                  Extract from Idea
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={handleRebaseCheck} disabled={isCheckingRebase}>
                {isCheckingRebase ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                Check Staleness
              </Button>
              {!isEditing ? (
                <Button size="sm" variant="ghost" className="h-6 text-[9px] gap-1" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-2.5 w-2.5" /> Edit
                </Button>
              ) : (
                <div className="flex gap-0.5">
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleSaveEdit}>
                    <Check className="h-3 w-3 text-emerald-400" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setIsEditing(false); setEditCriteria(criteria); }}>
                    <X className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {derivedFrom && (
            <div className="text-[9px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
              Derived from idea · {new Date(derivedFrom.extracted_at).toLocaleDateString()}
            </div>
          )}

          {isEditing ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[9px]">Format</Label>
                <Select value={editCriteria.format_subtype || ''} onValueChange={(v) => setEditCriteria(prev => ({ ...prev, format_subtype: v }))}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{FORMAT_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px]">Lane</Label>
                <Select value={editCriteria.assigned_lane || ''} onValueChange={(v) => setEditCriteria(prev => ({ ...prev, assigned_lane: v }))}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{LANE_OPTIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px]">Budget</Label>
                <Select value={editCriteria.budget_range || ''} onValueChange={(v) => setEditCriteria(prev => ({ ...prev, budget_range: v }))}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{BUDGET_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* ─── Episode Length (canonical) ─── */}
              <div className="col-span-2">
                <Label className="text-[9px] font-semibold">Episode Length (canonical — single source of truth)</Label>
                <div className="grid grid-cols-3 gap-1 mt-0.5">
                  <div>
                    <Label className="text-[8px] text-muted-foreground">Min (s)</Label>
                    <Input type="number" className="h-7 text-[10px]" min={5}
                      value={editCriteria.episode_duration_min_seconds ?? ''}
                      onChange={(e) => {
                        const v = Number(e.target.value) || null;
                        setEditCriteria(prev => ({
                          ...prev,
                          episode_duration_min_seconds: v,
                          episode_target_duration_seconds: v && prev.episode_duration_max_seconds
                            ? Math.round((v + prev.episode_duration_max_seconds) / 2)
                            : v,
                        }));
                      }} />
                  </div>
                  <div>
                    <Label className="text-[8px] text-muted-foreground">Max (s)</Label>
                    <Input type="number" className="h-7 text-[10px]" min={5}
                      value={editCriteria.episode_duration_max_seconds ?? ''}
                      onChange={(e) => {
                        const v = Number(e.target.value) || null;
                        setEditCriteria(prev => ({
                          ...prev,
                          episode_duration_max_seconds: v,
                          episode_target_duration_seconds: prev.episode_duration_min_seconds && v
                            ? Math.round((prev.episode_duration_min_seconds + v) / 2)
                            : v,
                        }));
                      }} />
                  </div>
                  <div>
                    <Label className="text-[8px] text-muted-foreground">Target (s)</Label>
                    <Input type="number" className="h-7 text-[10px]" min={5}
                      value={editCriteria.episode_duration_target_seconds ?? ''}
                      onChange={(e) => setEditCriteria(prev => ({ ...prev, episode_duration_target_seconds: Number(e.target.value) || null }))} />
                  </div>
                </div>
                <div className="mt-1">
                  <Label className="text-[8px] text-muted-foreground">Variance Policy</Label>
                  <Select
                    value={editCriteria.episode_duration_variance_policy || 'soft'}
                    onValueChange={(v) => setEditCriteria(prev => ({ ...prev, episode_duration_variance_policy: v as 'strict' | 'soft' }))}
                  >
                    <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="soft">soft — 10% tolerance allowed</SelectItem>
                      <SelectItem value="strict">strict — must be within range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-[9px]">Episodes/Season</Label>
                <Input type="number" className="h-7 text-[10px]"
                  value={editCriteria.season_episode_count || ''}
                  onChange={(e) => setEditCriteria(prev => ({ ...prev, season_episode_count: Number(e.target.value) || null }))} />
              </div>
              <div>
                <Label className="text-[9px]">Runtime (min)</Label>
                <div className="flex gap-1">
                  <Input type="number" className="h-7 text-[10px] w-16" placeholder="Low"
                    value={editCriteria.target_runtime_min_low || ''}
                    onChange={(e) => setEditCriteria(prev => ({ ...prev, target_runtime_min_low: Number(e.target.value) || null }))} />
                  <Input type="number" className="h-7 text-[10px] w-16" placeholder="High"
                    value={editCriteria.target_runtime_min_high || ''}
                    onChange={(e) => setEditCriteria(prev => ({ ...prev, target_runtime_min_high: Number(e.target.value) || null }))} />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {renderField('Format', 'format_subtype', criteria.format_subtype)}
              {renderField('Lane', 'assigned_lane', criteria.assigned_lane)}
              {renderField('Budget', 'budget_range', criteria.budget_range)}
              {/* Canonical episode length display */}
              {(criteria.episode_duration_min_seconds || criteria.episode_duration_max_seconds) ? (
                renderField('Episode Length',
                  'episode_duration_min_seconds',
                  `${criteria.episode_duration_min_seconds ?? '?'}–${criteria.episode_duration_max_seconds ?? '?'}s` +
                  (criteria.episode_duration_target_seconds ? ` (target: ${criteria.episode_duration_target_seconds}s)` : '') +
                  (criteria.episode_duration_variance_policy === 'strict' ? ' [strict]' : '')
                )
              ) : renderField('Episode Duration', 'episode_target_duration_seconds', criteria.episode_target_duration_seconds ? `${criteria.episode_target_duration_seconds}s` : null)}
              {renderField('Episodes/Season', 'season_episode_count', criteria.season_episode_count)}
              {renderField('Runtime', 'target_runtime_min_low', criteria.target_runtime_min_low && criteria.target_runtime_min_high ? `${criteria.target_runtime_min_low}–${criteria.target_runtime_min_high} min` : null)}
              {criteria.tone_tags?.length ? renderField('Tone', 'tone_tags', criteria.tone_tags.join(', ')) : null}
            </div>
          )}

          {missingRequired.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 space-y-0.5">
              <span className="text-[9px] font-semibold text-amber-400">Missing required fields:</span>
              {missingRequired.map((f) => (
                <p key={f} className="text-[9px] text-amber-400/80">• {f.replace(/_/g, ' ')}</p>
              ))}
            </div>
          )}

          {notesForUser.length > 0 && (
            <div className="space-y-0.5">
              {notesForUser.map((n, i) => (
                <p key={i} className="text-[8px] text-muted-foreground">• {n}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ REBASE / STALENESS PANEL ═══ */}
      {staleDocs.length > 0 && (
        <Card className="border-amber-500/30">
          <Collapsible open={rebaseOpen} onOpenChange={setRebaseOpen}>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="py-2 px-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Stale Documents ({staleDocs.length})
                  </CardTitle>
                  <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${rebaseOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="px-3 pb-3 space-y-2">
                <p className="text-[9px] text-muted-foreground">
                  These documents were generated with different criteria and may need regeneration.
                </p>
                <div className="space-y-1">
                  {staleDocs.map((sd) => (
                    <div key={sd.documentId} className="flex items-center justify-between py-1 px-2 rounded bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[8px] px-1 py-0">{sd.doc_type}</Badge>
                        <span className="text-[9px] text-muted-foreground">
                          Differs: {sd.diff_keys.map(k => k.replace(/_/g, ' ')).join(', ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" className="h-7 text-[10px] gap-1" disabled={isRegenerating}
                    onClick={() => {
                      const stages = staleDocs.map(d => d.doc_type);
                      const first = stages[0];
                      const last = stages[stages.length - 1];
                      handleRebaseRegenerate(first, last, 'regenerate_from_source');
                    }}>
                    {isRegenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Regenerate chain
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" disabled={isRegenerating}
                    onClick={() => {
                      const stages = staleDocs.map(d => d.doc_type);
                      const first = stages[0];
                      const last = stages[stages.length - 1];
                      handleRebaseRegenerate(first, last, 'regenerate_each_stage');
                    }}>
                    {isRegenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Regenerate each stage
                  </Button>
                </div>

                {rebasePlan && (
                  <div className="text-[9px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 mt-1">
                    Plan: {rebasePlan.estimated_steps} stage(s) · Strategy: {rebasePlan.strategy} · No overwrites
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}
    </div>
  );
}
