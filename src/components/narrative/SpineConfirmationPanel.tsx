/**
 * SpineConfirmationPanel — surfaces the AI-inferred Narrative Spine after DevSeed
 * and allows the user to review, edit, and confirm it before it locks at CB approval.
 *
 * Spec: docs/narrative-spine-v1.md
 * Lifecycle: provisional → confirmed (this panel) → locked (CB approval, auto-run)
 */
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Lock, Pencil, Check, Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { SpineAmendmentPanel } from './SpineAmendmentPanel';

// ── Types (mirrors _shared/narrativeSpine.ts) ──

interface NarrativeSpine {
  story_engine: string | null;
  pressure_system: string | null;
  central_conflict: string | null;
  inciting_incident: string | null;
  resolution_type: string | null;
  stakes_class: string | null;
  protagonist_arc: string | null;
  midpoint_reversal: string | null;
  tonal_gravity: string | null;
}

type SpineLifecycleState = 'none' | 'provisional' | 'confirmed' | 'locked' | 'locked_amended';
type InheritanceClass = 'A' | 'B' | 'S' | 'C';

interface AxisMeta {
  label: string;
  class: InheritanceClass;
  description: string;
  classLabel: string;
  classColor: string;
}

const AXIS_META: Record<keyof NarrativeSpine, AxisMeta> = {
  story_engine:      { label: 'Story Engine',       class: 'A', classLabel: 'Constitutional', classColor: 'bg-red-950 text-red-300 border-red-800',     description: 'The dominant narrative mechanism — what drives the story forward.' },
  protagonist_arc:   { label: 'Protagonist Arc',    class: 'A', classLabel: 'Constitutional', classColor: 'bg-red-950 text-red-300 border-red-800',     description: 'The internal transformation journey of the central protagonist.' },
  pressure_system:   { label: 'Pressure System',    class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800', description: 'The causal grammar of the conflict — how pressure is applied.' },
  central_conflict:  { label: 'Central Conflict',   class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800', description: 'The dominant constitutional conflict topology of the project.' },
  resolution_type:   { label: 'Resolution Type',    class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800', description: 'The constitutional end-state promise — how the story resolves.' },
  stakes_class:      { label: 'Stakes Class',       class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800', description: 'The emotional register of what is at risk.' },
  inciting_incident: { label: 'Inciting Incident',  class: 'S', classLabel: 'Scope-specific', classColor: 'bg-blue-950 text-blue-300 border-blue-800',   description: 'The structural trigger category that begins the narrative engine.' },
  midpoint_reversal: { label: 'Midpoint Reversal',  class: 'S', classLabel: 'Scope-specific', classColor: 'bg-blue-950 text-blue-300 border-blue-800',   description: 'The structural pivot type at the story midpoint.' },
  tonal_gravity:     { label: 'Tonal Gravity',      class: 'C', classLabel: 'Expressive',     classColor: 'bg-emerald-950 text-emerald-300 border-emerald-800', description: 'The gravitational emotional register — tone the story inhabits.' },
};

const SPINE_AXES = Object.keys(AXIS_META) as (keyof NarrativeSpine)[];

const CLASS_LEGEND: Record<InheritanceClass, { label: string; color: string; tooltip: string }> = {
  A: { label: 'Constitutional', color: 'text-red-400',     tooltip: 'Strict inheritance — almost never changes once locked.' },
  B: { label: 'Bounded',        color: 'text-amber-400',   tooltip: 'Bounded modulation — can vary within a coherent envelope.' },
  S: { label: 'Scope-specific', color: 'text-blue-400',    tooltip: 'Each scope level (project/season/episode) defines its own value.' },
  C: { label: 'Expressive',     color: 'text-emerald-400', tooltip: 'Expressive modulation — varies freely, monitored for cumulative drift.' },
};

// ── Amendment history entry ──
interface AmendmentEntry {
  id: string;
  axis: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

// ── Hook ──

function useNarrativeSpine(projectId: string | undefined) {
  const [spine, setSpine] = useState<NarrativeSpine | null>(null);
  const [state, setState] = useState<SpineLifecycleState>('none');
  const [entryId, setEntryId] = useState<string | null>(null);
  const [amendments, setAmendments] = useState<AmendmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [{ data: project }, { data: decisions }] = await Promise.all([
          supabase.from('projects').select('narrative_spine_json').eq('id', projectId).single(),
          supabase.from('decision_ledger')
            .select('id, locked, status, meta, decision_value, created_at')
            .eq('project_id', projectId)
            .eq('decision_key', 'narrative_spine')
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        const s: NarrativeSpine | null = (project as any)?.narrative_spine_json ?? null;
        setSpine(s);

        if (!s) { setState('none'); setEntryId(null); setAmendments([]); setLoading(false); return; }

        const entries = (decisions as any[]) ?? [];
        const activeEntry = entries.find(d => d.status === 'active' && d.locked === true);
        const pendingEntry = entries.find(d => d.status === 'pending_lock' && d.locked === false);
        const superseded = entries.filter(d => d.status === 'superseded');

        if (!activeEntry && !pendingEntry) { setState('provisional'); setEntryId(null); }
        else if (pendingEntry && !activeEntry) { setState('confirmed'); setEntryId(pendingEntry.id); }
        else if (activeEntry && superseded.length > 0) { setState('locked_amended'); setEntryId(activeEntry.id); }
        else if (activeEntry) { setState('locked'); setEntryId(activeEntry.id); }
        else { setState('provisional'); setEntryId(null); }

        // Build amendment history from superseded entries
        const amendmentHistory: AmendmentEntry[] = superseded.map((d: any) => {
          const amends = d.meta?.amends;
          return {
            id: d.id,
            axis: amends?.axis || 'unknown',
            old_value: amends?.old_value ?? null,
            new_value: amends?.new_value ?? null,
            created_at: d.created_at,
          };
        }).filter((a: AmendmentEntry) => a.axis !== 'unknown');
        setAmendments(amendmentHistory);

      } catch (e) {
        console.warn('[SpineConfirmationPanel] load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  return { spine, state, entryId, amendments, loading, reload: () => setReloadKey(k => k + 1) };
}

// ── Component ──

interface Props {
  projectId: string;
  userId: string;
  className?: string;
}

export function SpineConfirmationPanel({ projectId, userId, className = '' }: Props) {
  const { spine, state, amendments, loading, reload } = useNarrativeSpine(projectId);
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<NarrativeSpine | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showAmendment, setShowAmendment] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const lsKey = `spine_panel_dismissed:${projectId}`;

  useEffect(() => {
    setDismissed(localStorage.getItem(lsKey) === 'true');
  }, [lsKey]);

  useEffect(() => {
    if (spine && !draft) setDraft({ ...spine });
  }, [spine]);

  if (loading || !spine || dismissed) return null;
  if (state === 'none') return null;

  const axesSet = SPINE_AXES.filter(a => spine[a]).length;
  const isConfirmable = state === 'provisional';
  const isLocked = state === 'locked' || state === 'locked_amended';

  async function handleConfirm() {
    if (!draft || !projectId || !userId) return;
    setSaving(true);
    try {
      const { error: projErr } = await supabase
        .from('projects')
        .update({ narrative_spine_json: draft } as any)
        .eq('id', projectId);
      if (projErr) throw projErr;

      const { data: existing } = await supabase
        .from('decision_ledger')
        .select('id')
        .eq('project_id', projectId)
        .eq('decision_key', 'narrative_spine')
        .eq('status', 'pending_lock')
        .single();

      if (existing?.id) {
        await supabase.from('decision_ledger').update({
          decision_value: draft as any,
          meta: { confirmed_by: userId, confirmed_at: new Date().toISOString(), amends: null, amendment_severity: null, axes_set: axesSet },
        } as any).eq('id', existing.id);
      } else {
        await (supabase.from('decision_ledger') as any).insert({
          project_id: projectId,
          decision_key: 'narrative_spine',
          title: 'Narrative Spine (Provisional)',
          decision_text: 'Narrative spine confirmed by user — awaiting Concept Brief approval to lock.',
          source: 'user_confirmation',
          decision_value: draft,
          status: 'pending_lock',
          locked: false,
          meta: { confirmed_by: userId, confirmed_at: new Date().toISOString(), amends: null, amendment_severity: null, axes_set: axesSet },
        });
      }

      setEditMode(false);
      toast.success('Narrative Spine confirmed — will lock when Concept Brief is approved.');
      setTimeout(reload, 500);
    } catch (e: any) {
      toast.error(`Failed to confirm spine: ${e?.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleDismiss() {
    localStorage.setItem(lsKey, 'true');
    setDismissed(true);
  }

  const stateLabel = {
    provisional: 'Awaiting confirmation',
    confirmed: 'Confirmed — locks at CB approval',
    locked: 'Constitutionally locked',
    locked_amended: 'Locked (amended)',
    none: '',
  }[state];

  const stateDot = {
    provisional: 'bg-amber-400',
    confirmed: 'bg-blue-400',
    locked: 'bg-emerald-400',
    locked_amended: 'bg-violet-400',
    none: 'bg-gray-500',
  }[state];

  return (
    <div className={`rounded-xl border border-white/10 bg-[hsl(225,20%,7%)] overflow-hidden ${className}`}>
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          {isLocked ? (
            <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span className="text-sm font-medium text-white/90">Narrative Spine</span>
          <span className={`w-1.5 h-1.5 rounded-full ${stateDot}`} />
          {isLocked && (
            state === 'locked_amended' ? (
              <Badge variant="outline" className="text-[10px] border-violet-500/50 text-violet-400 bg-violet-500/10">
                ⚖ Amended
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-amber-600 text-amber-400 bg-amber-950/40">
                🔒 Locked
              </Badge>
            )
          )}
          {!isLocked && <span className="text-xs text-white/50">{stateLabel}</span>}
          <span className="text-xs text-white/30">({axesSet}/9 axes)</span>
        </div>
        <div className="flex items-center gap-2">
          {isConfirmable && (
            <Badge variant="outline" className="text-[10px] border-amber-600 text-amber-400 bg-amber-950/40">
              Confirm to lock
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
          {/* Locked subtitle */}
          {isLocked && (
            <p className="text-xs text-white/40">Constitutionally active — all documents generated within this spine</p>
          )}

          {/* Description for provisional */}
          {state === 'provisional' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/30 border border-amber-800/40">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200/80">
                This spine was inferred from your DevSeed. Review and confirm it — once your Concept Brief is approved it becomes constitutionally locked and can only be changed via amendment.
              </p>
            </div>
          )}

          {/* Class legend */}
          <div className="flex flex-wrap gap-2 text-[10px]">
            {(Object.entries(CLASS_LEGEND) as [InheritanceClass, typeof CLASS_LEGEND['A']][]).map(([cls, info]) => (
              <span key={cls} className={`${info.color} opacity-70`} title={info.tooltip}>
                {cls}: {info.label}
              </span>
            ))}
          </div>

          {/* Axes */}
          <div className="space-y-2">
            {SPINE_AXES.map((axis) => {
              const meta = AXIS_META[axis];
              const value = editMode && !isLocked ? (draft?.[axis] ?? '') : (spine[axis] ?? '');
              return (
                <div key={axis} className="flex items-start gap-3 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-white/70">{meta.label}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 border ${meta.classColor}`}
                      >
                        {meta.classLabel}
                      </Badge>
                    </div>
                    {!isLocked && <p className="text-[10px] text-white/35 mb-1">{meta.description}</p>}
                    {editMode && !isLocked ? (
                      <input
                        type="text"
                        value={draft?.[axis] ?? ''}
                        onChange={e => setDraft(prev => prev ? { ...prev, [axis]: e.target.value || null } : prev)}
                        className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white/80 focus:outline-none focus:border-amber-500/50"
                        placeholder={`Enter ${meta.label.toLowerCase()}…`}
                      />
                    ) : (
                      <span className={`text-xs font-mono ${value ? 'text-amber-300/90' : 'text-white/20 italic'}`}>
                        {value || '—'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions: provisional/confirmed */}
          {!isLocked && (
            <div className="flex items-center gap-2 pt-1">
              {isConfirmable && !editMode && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 border-white/10 text-white/60 hover:text-white/80"
                    onClick={() => setEditMode(true)}
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit axes
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs h-7 bg-amber-600 hover:bg-amber-500 text-white"
                    onClick={handleConfirm}
                    disabled={saving}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    {saving ? 'Confirming…' : 'Confirm Narrative Spine'}
                  </Button>
                </>
              )}
              {editMode && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 border-white/10 text-white/60"
                    onClick={() => { setEditMode(false); setDraft(spine ? { ...spine } : null); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs h-7 bg-amber-600 hover:bg-amber-500 text-white"
                    onClick={handleConfirm}
                    disabled={saving}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    {saving ? 'Saving…' : 'Save & Confirm'}
                  </Button>
                </>
              )}
              {state === 'confirmed' && !editMode && (
                <span className="text-xs text-blue-400">
                  ✓ Confirmed — will lock when Concept Brief is approved
                </span>
              )}
            </div>
          )}

          {/* Locked state actions */}
          {isLocked && (
            <div className="space-y-3 pt-1">
              {/* Amendment history (locked_amended only) */}
              {state === 'locked_amended' && amendments.length > 0 && (
                <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                  <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <ChevronDown className={`w-3 h-3 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                    Amendment History ({amendments.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-2">
                    {amendments.map((a) => (
                      <div key={a.id} className="rounded border border-white/10 bg-white/5 p-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-white/70">
                            {AXIS_META[a.axis as keyof NarrativeSpine]?.label || a.axis}
                          </span>
                          <span className="text-[10px] text-white/30">
                            {new Date(a.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/50">
                          <span className="text-red-400/70 line-through">{a.old_value || '—'}</span>
                          <span className="mx-1.5 text-white/30">→</span>
                          <span className="text-emerald-400/80">{a.new_value || '—'}</span>
                        </div>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Propose amendment button */}
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-amber-600/40 text-amber-400 hover:bg-amber-950/40"
                onClick={() => setShowAmendment(!showAmendment)}
              >
                <Pencil className="w-3 h-3 mr-1" />
                {showAmendment ? 'Hide Amendment' : 'Propose Amendment'}
              </Button>

              {/* Inline amendment panel */}
              {showAmendment && (
                <SpineAmendmentPanel
                  projectId={projectId}
                  spine={spine as unknown as Record<string, string | null>}
                  onAmendmentConfirmed={() => {
                    setShowAmendment(false);
                    reload();
                  }}
                />
              )}
            </div>
          )}

          {/* Dismiss when provisional */}
          {state === 'provisional' && (
            <button
              onClick={handleDismiss}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
            >
              Dismiss panel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
