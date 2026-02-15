import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Unlock, Check, X, Plus, Loader2, Hash, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useDecisionCommit, type ProjectDecision } from '@/hooks/useDecisionCommit';

interface Props {
  projectId: string;
}

const QUAL_FIELDS = [
  { key: 'episode_target_duration_seconds', label: 'Episode Duration (s)' },
  { key: 'season_episode_count', label: 'Season Episodes' },
  { key: 'target_runtime_min_low', label: 'Runtime Low (min)' },
  { key: 'target_runtime_min_high', label: 'Runtime High (min)' },
];

export function CanonicalQualificationsPanel({ projectId }: Props) {
  const { decisions, projectMeta, conflicts, propose, confirm, reject, toggleLock } = useDecisionCommit(projectId);
  const [proposingField, setProposingField] = useState<string | null>(null);
  const [proposeValue, setProposeValue] = useState('');

  const resolved = projectMeta?.resolved_qualifications || {};
  const locked = projectMeta?.locked_fields || {};
  const hash = projectMeta?.resolved_qualifications_hash;
  const version = projectMeta?.resolved_qualifications_version;

  const pendingDecisions = decisions.filter(d => d.status === 'proposed' && d.field_path);
  const confirmedDecisions = decisions.filter(d => d.status === 'confirmed' && d.field_path);

  const handlePropose = (fieldKey: string) => {
    const numVal = Number(proposeValue);
    if (!proposeValue || isNaN(numVal)) return;
    propose.mutate({
      fieldPath: `qualifications.${fieldKey}`,
      newValue: numVal,
    });
    setProposingField(null);
    setProposeValue('');
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-primary" />
          Canonical Qualifications
          {hash && (
            <Badge variant="outline" className="text-[8px] ml-auto font-mono gap-0.5">
              <Hash className="h-2.5 w-2.5" /> {hash}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Resolved values */}
        <div className="space-y-1">
          {QUAL_FIELDS.map(({ key, label }) => {
            const val = resolved[key];
            const isLocked = locked[key] || locked[`qualifications.${key}`];
            const fieldConflict = conflicts?.find(c => c?.decision.field_path.includes(key));

            return (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    onClick={() => toggleLock.mutate(`qualifications.${key}`)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title={isLocked ? 'Unlock field' : 'Lock field'}
                  >
                    {isLocked ? <Lock className="h-3 w-3 text-amber-500" /> : <Unlock className="h-3 w-3" />}
                  </button>
                  <span className="text-muted-foreground truncate">{label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {fieldConflict && (
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                  )}
                  <span className="font-mono text-foreground">{val ?? '—'}</span>
                  {proposingField === key ? (
                    <div className="flex items-center gap-0.5">
                      <Input
                        type="number"
                        className="h-5 w-14 text-[10px]"
                        value={proposeValue}
                        onChange={e => setProposeValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handlePropose(key)}
                        autoFocus
                      />
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => handlePropose(key)}>
                        <Check className="h-3 w-3 text-primary" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setProposingField(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => {
                      setProposingField(key);
                      setProposeValue(val?.toString() || '');
                    }}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {resolved.format && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            Format: <Badge variant="outline" className="text-[9px]">{resolved.format}</Badge>
            {resolved.is_series && <Badge variant="outline" className="text-[9px] bg-primary/10">Series</Badge>}
          </div>
        )}

        {version && (
          <div className="text-[9px] text-muted-foreground">
            Resolver v{version}
          </div>
        )}

        {/* Pending decisions */}
        {pendingDecisions.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border/50">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase">Pending Decisions</p>
            {pendingDecisions.map(d => (
              <DecisionRow key={d.id} decision={d} onConfirm={() => confirm.mutate(d.id)}
                onReject={() => reject.mutate(d.id)} isConfirming={confirm.isPending} />
            ))}
          </div>
        )}

        {/* Confirmed / Applied */}
        {confirmedDecisions.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border/50">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase">Confirmed</p>
            {confirmedDecisions.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{d.field_path.replace('qualifications.', '')}</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono">{JSON.stringify(typeof d.new_value === 'object' && d.new_value?.value != null ? d.new_value.value : d.new_value)}</span>
                  {d.applied_to_metadata_at ? (
                    <Badge variant="outline" className="text-[8px] bg-primary/10 text-primary gap-0.5">
                      <Check className="h-2 w-2" /> Applied
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[8px]">Pending apply</Badge>
                  )}
                  {d.resulting_resolver_hash && (
                    <span className="text-[8px] font-mono text-muted-foreground">{d.resulting_resolver_hash}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Conflicts */}
        {conflicts && conflicts.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-destructive/30">
            <p className="text-[9px] font-semibold text-destructive uppercase flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Conflicts
            </p>
            {conflicts.map((c, i) => c && (
              <div key={i} className="p-1.5 rounded bg-destructive/5 text-[10px] space-y-0.5">
                <div className="flex justify-between">
                  <span>{c.decision.field_path.replace('qualifications.', '')}</span>
                  <span className="text-muted-foreground">
                    Current: <strong>{JSON.stringify(c.currentValue)}</strong> → Proposed: <strong>{JSON.stringify(c.proposedValue)}</strong>
                  </span>
                </div>
                <div className="flex gap-1 justify-end">
                  {c.isLocked ? (
                    <>
                      <Button variant="outline" size="sm" className="h-5 text-[9px]"
                        onClick={() => toggleLock.mutate(c.decision.field_path)}>
                        Unlock Field
                      </Button>
                      <Button variant="outline" size="sm" className="h-5 text-[9px]"
                        onClick={() => reject.mutate(c.decision.id)}>
                        Keep Confirmed
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" className="h-5 text-[9px]"
                        onClick={() => confirm.mutate(c.decision.id)}>
                        Propose Change
                      </Button>
                      <Button variant="outline" size="sm" className="h-5 text-[9px]"
                        onClick={() => reject.mutate(c.decision.id)}>
                        Keep Current
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionRow({ decision, onConfirm, onReject, isConfirming }: {
  decision: ProjectDecision; onConfirm: () => void; onReject: () => void; isConfirming: boolean;
}) {
  const val = typeof decision.new_value === 'object' && decision.new_value?.value != null
    ? decision.new_value.value : decision.new_value;
  return (
    <div className="flex items-center justify-between p-1.5 rounded bg-muted/30 text-[10px]">
      <div>
        <span className="text-muted-foreground">{decision.field_path.replace('qualifications.', '')}</span>
        <span className="ml-1 font-mono">→ {JSON.stringify(val)}</span>
      </div>
      <div className="flex gap-0.5">
        <Button variant="default" size="sm" className="h-5 text-[9px] gap-0.5"
          onClick={onConfirm} disabled={isConfirming}>
          {isConfirming ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
          Confirm & Apply
        </Button>
        <Button variant="ghost" size="sm" className="h-5 text-[9px]" onClick={onReject}>
          <X className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}
