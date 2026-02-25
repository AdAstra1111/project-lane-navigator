/**
 * ChangePlanPanel — Displays a structured Change Plan for review, editing, and confirmation.
 */
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Loader2, CheckCircle2, AlertTriangle, ArrowLeft, Zap, FileEdit,
  Shield, Target, Info,
} from 'lucide-react';
import type { ChangePlan, ChangePlanChange, ChangePlanRow } from '@/lib/types/writers-room';

interface ChangePlanPanelProps {
  planRow: ChangePlanRow;
  onConfirm: (planId: string, editedPlan: ChangePlan) => void;
  onApply: (planId: string) => void;
  onRevise: (planSummary: string) => void;
  onBack: () => void;
  isConfirming: boolean;
  isApplying: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  dialogue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  action: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  character: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  plot: 'bg-red-500/10 text-red-400 border-red-500/20',
  structure: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  tone: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  setup_payoff: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  world: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  other: 'bg-muted text-muted-foreground border-border',
};

const SCOPE_LABELS: Record<string, string> = {
  micro: '🔬 Micro',
  scene: '🎬 Scene',
  sequence: '📜 Sequence',
  act: '🏛️ Act',
  global: '🌍 Global',
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  applied: { label: 'Applied', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  superseded: { label: 'Superseded', className: 'bg-muted text-muted-foreground border-border' },
};

export function ChangePlanPanel({
  planRow, onConfirm, onApply, onRevise, onBack, isConfirming, isApplying,
}: ChangePlanPanelProps) {
  const [editedPlan, setEditedPlan] = useState<ChangePlan>(planRow.plan);
  const status = planRow.status;

  useEffect(() => {
    setEditedPlan(planRow.plan);
  }, [planRow.id]);

  function toggleChange(idx: number) {
    const updated = { ...editedPlan };
    updated.changes = [...updated.changes];
    updated.changes[idx] = { ...updated.changes[idx], enabled: !updated.changes[idx].enabled };
    setEditedPlan(updated);
  }

  function updateChangeField(idx: number, field: keyof ChangePlanChange, value: string) {
    const updated = { ...editedPlan };
    updated.changes = [...updated.changes];
    updated.changes[idx] = { ...updated.changes[idx], [field]: value };
    setEditedPlan(updated);
  }

  function handleConfirm() {
    onConfirm(planRow.id, editedPlan);
  }

  function handleRevise() {
    const summary = `Previous plan direction: ${editedPlan.direction_summary}\nEnabled changes: ${editedPlan.changes.filter(c => c.enabled !== false).map(c => c.title).join(', ')}`;
    onRevise(summary);
  }

  const enabledCount = editedPlan.changes.filter(c => c.enabled !== false).length;
  const totalCount = editedPlan.changes.length;
  const statusBadge = STATUS_BADGES[status] || STATUS_BADGES.draft;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onBack}>
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <FileEdit className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Change Plan</span>
            <Badge variant="outline" className={`text-[9px] px-1.5 ${statusBadge.className}`}>
              {statusBadge.label}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {enabledCount}/{totalCount} changes enabled
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-4">
          {/* Direction summary */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Direction Summary
            </label>
            <Textarea
              value={editedPlan.direction_summary || ''}
              onChange={(e) => setEditedPlan({ ...editedPlan, direction_summary: e.target.value })}
              className="mt-1 text-xs min-h-[60px] resize-none"
              disabled={status === 'applied'}
            />
          </div>

          <Separator />

          {/* Changes list */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Atomic Changes ({enabledCount} active)
              </span>
            </div>
            <div className="space-y-2">
              {editedPlan.changes.map((change, idx) => (
                <div
                  key={change.id || idx}
                  className={`rounded-lg border p-3 space-y-2 transition-opacity ${
                    change.enabled === false ? 'opacity-40 border-border/20' : 'border-border/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Switch
                      checked={change.enabled !== false}
                      onCheckedChange={() => toggleChange(idx)}
                      className="mt-0.5 scale-75"
                      disabled={status === 'applied'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Input
                          value={change.title}
                          onChange={(e) => updateChangeField(idx, 'title', e.target.value)}
                          className="h-6 text-xs font-medium flex-1 min-w-[120px]"
                          disabled={status === 'applied'}
                        />
                        <Badge variant="outline" className={`text-[7px] px-1 py-0 shrink-0 ${TYPE_COLORS[change.type] || TYPE_COLORS.other}`}>
                          {change.type}
                        </Badge>
                        <span className="text-[8px] text-muted-foreground shrink-0">
                          {SCOPE_LABELS[change.scope] || change.scope}
                        </span>
                      </div>

                      {/* Target info */}
                      {change.target?.scene_numbers?.length ? (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {change.target.scene_numbers.map(sn => (
                            <Badge key={sn} variant="outline" className="text-[7px] px-1 py-0">
                              Sc. {sn}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {/* Instructions */}
                      <Textarea
                        value={change.instructions}
                        onChange={(e) => updateChangeField(idx, 'instructions', e.target.value)}
                        className="mt-1.5 text-[10px] min-h-[32px] resize-none"
                        placeholder="Instructions..."
                        disabled={status === 'applied'}
                      />

                      {/* Rationale */}
                      <p className="text-[9px] text-muted-foreground mt-1 italic">{change.rationale}</p>

                      {/* Flags */}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {change.risk_flags?.map((f, i) => (
                          <Badge key={`r${i}`} variant="outline" className="text-[7px] px-1 py-0 border-destructive/30 text-destructive">
                            <AlertTriangle className="h-2 w-2 mr-0.5" />{f}
                          </Badge>
                        ))}
                        {change.cost_flags?.map((f, i) => (
                          <Badge key={`c${i}`} variant="outline" className="text-[7px] px-1 py-0 border-amber-500/30 text-amber-400">
                            {f}
                          </Badge>
                        ))}
                      </div>

                      {/* Acceptance criteria */}
                      {change.acceptance_criteria?.length ? (
                        <div className="mt-1.5">
                          <span className="text-[8px] font-medium text-muted-foreground">Acceptance:</span>
                          <ul className="list-disc pl-3 text-[9px] text-muted-foreground mt-0.5">
                            {change.acceptance_criteria.map((c, i) => <li key={i}>{c}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Impacts */}
          {editedPlan.impacts?.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Info className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Impacts
                  </span>
                </div>
                <div className="space-y-1">
                  {editedPlan.impacts.map((imp, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0">{imp.area}</Badge>
                      <span className="text-muted-foreground">{imp.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Rewrite payload summary */}
          {editedPlan.rewrite_payload && (
            <>
              <Separator />
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <div className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  <span className="font-medium">Rewrite: {editedPlan.rewrite_payload.mode}</span>
                  <span>• {editedPlan.rewrite_payload.patch_strategy}</span>
                </div>
                {editedPlan.rewrite_payload.target_scene_numbers?.length ? (
                  <span>Target scenes: {editedPlan.rewrite_payload.target_scene_numbers.join(', ')}</span>
                ) : null}
              </div>
            </>
          )}

          {/* Verification checklist */}
          {editedPlan.verification?.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Verification Checks
                  </span>
                </div>
                <ul className="list-disc pl-4 text-[9px] text-muted-foreground space-y-0.5">
                  {editedPlan.verification.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
            </>
          )}

          {/* Rollback support indicator */}
          {editedPlan.rollback_supported && (
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <Shield className="h-3 w-3 text-emerald-500" />
              <span>Rollback supported — changes can be undone from History tab</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Action bar */}
      <div className="px-4 py-3 border-t border-border/40 space-y-2">
        {status === 'draft' && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={handleRevise}>
              Revise in chat
            </Button>
            <Button size="sm" className="flex-1 text-xs h-8 gap-1" onClick={handleConfirm} disabled={isConfirming || enabledCount === 0}>
              {isConfirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirm plan
            </Button>
          </div>
        )}
        {status === 'confirmed' && (
          <Button size="sm" className="w-full text-xs h-8 gap-1" onClick={() => onApply(planRow.id)} disabled={isApplying}>
            {isApplying ? <><Loader2 className="h-3 w-3 animate-spin" /> Applying...</> : <><Zap className="h-3 w-3" /> Apply confirmed plan</>}
          </Button>
        )}
        {status === 'applied' && (
          <div className="flex items-center gap-2 justify-center text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Plan applied successfully
          </div>
        )}
      </div>
    </div>
  );
}
