/**
 * DnaProfileCard — Read/edit view for a single Narrative DNA profile.
 * Phase 1: supports review, inline editing, and lock.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Pencil, Save, X, Dna, AlertTriangle } from 'lucide-react';
import type { DnaProfile } from '@/hooks/useNarrativeDna';
import { useUpdateDna, useLockDna } from '@/hooks/useNarrativeDna';
import { DnaSourceMaterial } from './DnaSourceMaterial';

const SPINE_LABELS: Record<string, string> = {
  story_engine: 'Story Engine',
  pressure_system: 'Pressure System',
  central_conflict: 'Central Conflict',
  inciting_incident: 'Inciting Incident',
  resolution_type: 'Resolution Type',
  stakes_class: 'Stakes Class',
  protagonist_arc: 'Protagonist Arc',
  midpoint_reversal: 'Midpoint Reversal',
  tonal_gravity: 'Tonal Gravity',
};

const EXTENDED_LABELS: Record<string, string> = {
  escalation_architecture: 'Escalation Architecture',
  antagonist_pattern: 'Antagonist Pattern',
  thematic_spine: 'Thematic Spine',
  set_piece_grammar: 'Set-Piece Grammar',
  ending_logic: 'Ending Logic',
  power_dynamic: 'Power Dynamic',
};

function formatValue(v: string | null): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface Props {
  profile: DnaProfile;
}

export function DnaProfileCard({ profile }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const updateMutation = useUpdateDna();
  const lockMutation = useLockDna();

  const isLocked = profile.status === 'locked';
  const confidence = profile.extraction_confidence != null
    ? Math.round(profile.extraction_confidence * 100)
    : null;

  function startEdit() {
    setDraft({
      spine_json: { ...profile.spine_json },
      thematic_spine: profile.thematic_spine || '',
      escalation_architecture: profile.escalation_architecture || '',
      antagonist_pattern: profile.antagonist_pattern || '',
      set_piece_grammar: profile.set_piece_grammar || '',
      ending_logic: profile.ending_logic || '',
      power_dynamic: profile.power_dynamic || '',
      forbidden_carryovers: (profile.forbidden_carryovers || []).join(', '),
      mutable_variables: (profile.mutable_variables || []).join(', '),
      surface_expression_notes: profile.surface_expression_notes || '',
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }

  async function saveEdit() {
    const updates: Record<string, any> = {
      spine_json: draft.spine_json,
      thematic_spine: draft.thematic_spine || null,
      escalation_architecture: draft.escalation_architecture || null,
      antagonist_pattern: draft.antagonist_pattern || null,
      set_piece_grammar: draft.set_piece_grammar || null,
      ending_logic: draft.ending_logic || null,
      power_dynamic: draft.power_dynamic || null,
      forbidden_carryovers: draft.forbidden_carryovers
        ? draft.forbidden_carryovers.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [],
      mutable_variables: draft.mutable_variables
        ? draft.mutable_variables.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [],
      surface_expression_notes: draft.surface_expression_notes || null,
    };
    await updateMutation.mutateAsync({ id: profile.id, updates });
    setEditing(false);
  }

  function updateSpineAxis(axis: string, value: string) {
    setDraft(prev => ({
      ...prev,
      spine_json: { ...prev.spine_json, [axis]: value || null },
    }));
  }

  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Dna className="h-4 w-4 text-primary shrink-0" />
            <CardTitle className="text-base truncate">{profile.source_title}</CardTitle>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {confidence != null && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {confidence}% conf
              </Badge>
            )}
            <Badge
              variant={isLocked ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {isLocked ? '🔒 Locked' : profile.status}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {profile.source_type} · {(profile.source_text_length || 0).toLocaleString()} chars
        </p>
        {((profile as any).primary_engine_key || (profile as any).secondary_engine_key) && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {(profile as any).primary_engine_key && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                {formatValue((profile as any).primary_engine_key)}
              </Badge>
            )}
            {(profile as any).secondary_engine_key && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {formatValue((profile as any).secondary_engine_key)}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* Source Material */}
        <DnaSourceMaterial dnaProfileId={profile.id} isLocked={isLocked} />

        {/* Spine Axes */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Narrative Spine (9 axes)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(SPINE_LABELS).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-[11px] text-muted-foreground">{label}</span>
                {editing ? (
                  <Input
                    value={draft.spine_json?.[key] || ''}
                    onChange={e => updateSpineAxis(key, e.target.value)}
                    className="h-7 text-xs"
                  />
                ) : (
                  <span className="text-foreground text-xs font-medium">
                    {formatValue(profile.spine_json?.[key])}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Extended DNA */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Extended DNA
          </h4>
          <div className="space-y-2">
            {Object.entries(EXTENDED_LABELS).map(([key, label]) => (
              <div key={key}>
                <span className="text-[11px] text-muted-foreground">{label}</span>
                {editing ? (
                  <Input
                    value={draft[key] || ''}
                    onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                    className="h-7 text-xs mt-0.5"
                  />
                ) : (
                  <p className="text-xs text-foreground">
                    {formatValue((profile as any)[key])}
                  </p>
                )}
              </div>
            ))}

            {/* Thematic Spine (separate — it's a sentence) */}
            <div>
              <span className="text-[11px] text-muted-foreground">Thematic Spine</span>
              {editing ? (
                <Textarea
                  value={draft.thematic_spine || ''}
                  onChange={e => setDraft(prev => ({ ...prev, thematic_spine: e.target.value }))}
                  className="text-xs mt-0.5 min-h-[60px]"
                />
              ) : (
                <p className="text-xs text-foreground italic">
                  {profile.thematic_spine || '—'}
                </p>
              )}
            </div>

            {/* Emotional Cadence */}
            <div>
              <span className="text-[11px] text-muted-foreground">Emotional Cadence</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(profile.emotional_cadence || []).length > 0
                  ? profile.emotional_cadence.map((ec, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                        {formatValue(ec)}
                      </Badge>
                    ))
                  : <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </div>

            {/* World Logic Rules */}
            <div>
              <span className="text-[11px] text-muted-foreground">World Logic Rules</span>
              {(profile.world_logic_rules || []).length > 0 ? (
                <ul className="list-disc list-inside text-xs text-foreground mt-0.5 space-y-0.5">
                  {profile.world_logic_rules.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>
        </div>

        {/* Mutation Constraints */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Mutation Constraints
          </h4>
          <div className="space-y-2">
            <div>
              <span className="text-[11px] text-muted-foreground">Forbidden Carryovers</span>
              {editing ? (
                <Input
                  value={draft.forbidden_carryovers || ''}
                  onChange={e => setDraft(prev => ({ ...prev, forbidden_carryovers: e.target.value }))}
                  className="h-7 text-xs mt-0.5"
                  placeholder="comma-separated"
                />
              ) : (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {(profile.forbidden_carryovers || []).length > 0
                    ? profile.forbidden_carryovers.map((fc, i) => (
                        <Badge key={i} variant="destructive" className="text-[10px] px-1.5 py-0">
                          {fc}
                        </Badge>
                      ))
                    : <span className="text-xs text-muted-foreground">None</span>}
                </div>
              )}
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground">Mutable Variables</span>
              {editing ? (
                <Input
                  value={draft.mutable_variables || ''}
                  onChange={e => setDraft(prev => ({ ...prev, mutable_variables: e.target.value }))}
                  className="h-7 text-xs mt-0.5"
                  placeholder="comma-separated"
                />
              ) : (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {(profile.mutable_variables || []).length > 0
                    ? profile.mutable_variables.map((mv, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {mv}
                        </Badge>
                      ))
                    : <span className="text-xs text-muted-foreground">None</span>}
                </div>
              )}
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground">Surface Expression Notes</span>
              {editing ? (
                <Textarea
                  value={draft.surface_expression_notes || ''}
                  onChange={e => setDraft(prev => ({ ...prev, surface_expression_notes: e.target.value }))}
                  className="text-xs mt-0.5 min-h-[50px]"
                />
              ) : (
                <p className="text-xs text-foreground">
                  {profile.surface_expression_notes || '—'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {!isLocked && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            {editing ? (
              <>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={saveEdit}
                  disabled={updateMutation.isPending}
                >
                  <Save className="h-3 w-3" />
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={cancelEdit}
                >
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={startEdit}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs gap-1"
                  onClick={() => lockMutation.mutate(profile.id)}
                  disabled={lockMutation.isPending}
                >
                  <Lock className="h-3 w-3" />
                  {lockMutation.isPending ? 'Locking…' : 'Lock Profile'}
                </Button>
              </>
            )}
          </div>
        )}

        {isLocked && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2 border-t border-border/30">
            <Lock className="h-3 w-3" />
            Locked {profile.locked_at ? `on ${new Date(profile.locked_at).toLocaleDateString()}` : ''}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
