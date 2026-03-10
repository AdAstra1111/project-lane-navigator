/**
 * SpineAmendmentPanel — 3-step inline amendment flow for locked narrative spines.
 * Step 1: Axis list → Step 2: Proposal form → Step 3: Impact review + confirm.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, ArrowLeft, AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type InheritanceClass = 'A' | 'B' | 'S' | 'C';

interface AxisMeta {
  label: string;
  class: InheritanceClass;
  classLabel: string;
  classColor: string;
}

const AXIS_META: Record<string, AxisMeta> = {
  story_engine:      { label: 'Story Engine',       class: 'A', classLabel: 'Constitutional', classColor: 'bg-red-950 text-red-300 border-red-800' },
  protagonist_arc:   { label: 'Protagonist Arc',    class: 'A', classLabel: 'Constitutional', classColor: 'bg-red-950 text-red-300 border-red-800' },
  pressure_system:   { label: 'Pressure System',    class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800' },
  central_conflict:  { label: 'Central Conflict',   class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800' },
  resolution_type:   { label: 'Resolution Type',    class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800' },
  stakes_class:      { label: 'Stakes Class',       class: 'B', classLabel: 'Bounded',        classColor: 'bg-amber-950 text-amber-300 border-amber-800' },
  inciting_incident: { label: 'Inciting Incident',  class: 'S', classLabel: 'Scope-specific', classColor: 'bg-blue-950 text-blue-300 border-blue-800' },
  midpoint_reversal: { label: 'Midpoint Reversal',  class: 'S', classLabel: 'Scope-specific', classColor: 'bg-blue-950 text-blue-300 border-blue-800' },
  tonal_gravity:     { label: 'Tonal Gravity',      class: 'C', classLabel: 'Expressive',     classColor: 'bg-emerald-950 text-emerald-300 border-emerald-800' },
};

const CLASS_ORDER: InheritanceClass[] = ['A', 'B', 'S', 'C'];
const SORTED_AXES = Object.entries(AXIS_META).sort(
  ([, a], [, b]) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class)
);

interface UnitAtRisk {
  unit_key: string;
  status: string;
  source_doc_type: string;
  source_doc_version_id: string;
  evidence_excerpt: string | null;
}

interface ImpactResult {
  severity: string;
  warningText: string;
  floorStage: string;
  affectedDocs: string[];
  units_at_risk?: UnitAtRisk[];
  units_at_risk_count?: number;
  recommended_repair_order?: string[];
}

interface SpineAmendmentPanelProps {
  projectId: string;
  spine: Record<string, string | null>;
  onAmendmentConfirmed: () => void;
}

const SEVERITY_STYLES: Record<string, string> = {
  constitutional: 'bg-red-950 text-red-300 border-red-700',
  severe: 'bg-orange-950 text-orange-300 border-orange-700',
  'severe-moderate': 'bg-amber-950 text-amber-300 border-amber-700',
  moderate: 'bg-amber-950 text-amber-300 border-amber-700',
  light: 'bg-emerald-950 text-emerald-300 border-emerald-700',
};

export function SpineAmendmentPanel({ projectId, spine, onAmendmentConfirmed }: SpineAmendmentPanelProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedAxis, setSelectedAxis] = useState<string | null>(null);
  const [proposedValue, setProposedValue] = useState('');
  const [rationale, setRationale] = useState('');
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<ImpactResult | null>(null);

  async function handleComputeImpact() {
    if (!selectedAxis || !proposedValue.trim()) return;
    setComputing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spine-amendment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'compute_impact', projectId, axis: selectedAxis, proposed_value: proposedValue }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImpact(data);
      setStep(3);
    } catch (e: any) {
      toast.error(`Impact computation failed: ${e?.message}`);
    } finally {
      setComputing(false);
    }
  }

  async function handleConfirm() {
    if (!selectedAxis || !impact) return;
    setConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spine-amendment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'confirm_amendment', projectId, axis: selectedAxis, proposed_value: proposedValue, rationale }),
      });
      if (!res.ok) throw new Error(await res.text());
      const affectedCount = impact.affectedDocs?.length ?? 0;
      toast.success(`Spine amended — revalidation required for ${affectedCount} document${affectedCount !== 1 ? 's' : ''}`);
      onAmendmentConfirmed();
    } catch (e: any) {
      toast.error(`Amendment failed: ${e?.message}`);
    } finally {
      setConfirming(false);
    }
  }

  function resetToStep1() {
    setStep(1);
    setSelectedAxis(null);
    setProposedValue('');
    setRationale('');
    setImpact(null);
  }

  return (
    <Card className="border-white/10 bg-[hsl(225,20%,6%)]">
      <CardContent className="pt-4 space-y-3">
        {/* Step 1: Axis list */}
        {step === 1 && (
          <div className="space-y-1.5">
            <p className="text-xs text-white/50 mb-2">Select an axis to propose an amendment:</p>
            {SORTED_AXES.map(([key, meta]) => (
              <div key={key} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/5 transition-colors">
                <span className="text-xs text-white/70 flex-1 min-w-0">{meta.label}</span>
                <span className={`text-xs font-mono truncate max-w-[200px] ${spine[key] ? 'text-amber-300/80' : 'text-white/20 italic'}`}>
                  {spine[key] || '—'}
                </span>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 border ${meta.classColor} shrink-0`}>
                  {meta.classLabel}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-6 px-2 border-white/10 text-white/50 hover:text-white/80 shrink-0"
                  onClick={() => { setSelectedAxis(key); setProposedValue(spine[key] || ''); setStep(2); }}
                >
                  Propose change
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Step 2: Proposal form */}
        {step === 2 && selectedAxis && (
          <div className="space-y-3">
            <button onClick={resetToStep1} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Back to axes
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white/80">{AXIS_META[selectedAxis]?.label}</span>
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 border ${AXIS_META[selectedAxis]?.classColor}`}>
                {AXIS_META[selectedAxis]?.classLabel}
              </Badge>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Proposed value</label>
              <Input
                value={proposedValue}
                onChange={e => setProposedValue(e.target.value)}
                placeholder={`New ${AXIS_META[selectedAxis]?.label.toLowerCase()} value…`}
                className="bg-white/5 border-white/10 text-white/80 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Rationale</label>
              <Textarea
                value={rationale}
                onChange={e => setRationale(e.target.value)}
                placeholder="Why is this change necessary?"
                className="bg-white/5 border-white/10 text-white/80 text-xs min-h-[60px]"
              />
            </div>
            <Button
              size="sm"
              className="text-xs h-7 bg-amber-600 hover:bg-amber-500 text-white"
              onClick={handleComputeImpact}
              disabled={computing || !proposedValue.trim()}
            >
              {computing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Computing…</> : 'Compute Impact'}
            </Button>
          </div>
        )}

        {/* Step 3: Impact review */}
        {step === 3 && impact && selectedAxis && (
          <div className="space-y-4">
            <button onClick={() => setStep(2)} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Back to proposal
            </button>

            {/* Section A: Constitutional Severity */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-white/60">Constitutional Severity</h4>
              <Badge
                variant="outline"
                className={`text-sm px-3 py-1 border font-bold ${SEVERITY_STYLES[impact.severity?.toLowerCase()] || SEVERITY_STYLES.moderate}`}
              >
                {impact.severity}
              </Badge>
              {impact.warningText && (
                <div className="flex items-start gap-2 p-2 rounded bg-white/5 border border-white/10">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-white/60">{impact.warningText}</p>
                </div>
              )}
            </div>

            {/* Section B: Revalidation Scope */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-white/60">Documents requiring revalidation</h4>
              {impact.floorStage && (
                <p className="text-[10px] text-white/40">Floor stage: <span className="text-amber-300/80 font-mono">{impact.floorStage}</span></p>
              )}
              {impact.affectedDocs && impact.affectedDocs.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {impact.affectedDocs.map((doc, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-white/20 text-white/60">
                      {doc}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/30 italic">No approved documents affected.</p>
              )}
            </div>

            {/* Section C: Narrative Unit Impact */}
            {(impact.units_at_risk_count ?? 0) > 0 && impact.units_at_risk && (
              <div className="space-y-2">
                <p className="text-xs text-white/60">
                  <span className="text-amber-300/90 font-medium">{impact.units_at_risk_count}</span>{' '}
                  narrative evaluation{impact.units_at_risk_count !== 1 ? 's' : ''} will be invalidated
                </p>
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/60 transition-colors group">
                    <ChevronRight className="w-3 h-3 transition-transform group-data-[state=open]:rotate-90" />
                    View affected narrative evaluations
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {impact.units_at_risk.map((u, i) => {
                        const statusStyle =
                          u.status === 'aligned'
                            ? 'bg-amber-950 text-amber-300 border-amber-800'
                            : u.status === 'contradicted'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : 'bg-white/5 text-white/50 border-white/10';
                        return (
                          <div key={`${u.unit_key}-${i}`} className="p-2 rounded bg-white/[0.03] border border-white/5 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-white/60">{u.source_doc_type}</span>
                              <Badge variant="outline" className={`text-[8px] px-1.5 py-0 border ${statusStyle}`}>
                                {u.status}
                              </Badge>
                            </div>
                            {u.evidence_excerpt && (
                              <p className="text-[10px] text-white/40 italic leading-snug">"{u.evidence_excerpt}"</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            {/* Section D: Recommended Repair Order */}
            {impact.recommended_repair_order && impact.recommended_repair_order.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-white/60">Recommended Repair Order</h4>
                <ol className="list-decimal list-inside space-y-0.5">
                  {impact.recommended_repair_order.map((axis, i) => (
                    <li key={`${axis}-${i}`} className="text-[10px] text-white/70">
                      {AXIS_META[axis]?.label || axis.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ol>
                <p className="text-[9px] text-white/40 italic">
                  Repair upstream narrative causes before downstream outcomes.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-white/10 text-white/50"
                onClick={resetToStep1}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs h-7 bg-amber-600 hover:bg-amber-500 text-white"
                onClick={handleConfirm}
                disabled={confirming}
              >
                {confirming ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Confirming…</> : <><Check className="w-3 h-3 mr-1" />Confirm Amendment</>}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}