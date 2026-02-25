import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { RuleConflict, OverridePatch } from '@/lib/rulesets/types';

interface Props {
  projectId: string;
  lane: string;
  userId: string;
  conflicts: RuleConflict[];
  onResolved?: () => void;
}

/** Generate an override patch from a conflict resolution choice */
function conflictToPatch(conflict: RuleConflict, choice: 'honor_comps' | 'honor_overrides'): OverridePatch | null {
  if (choice === 'honor_comps') return null; // comps are already in the profile — no override needed

  // Create a patch that pins the expected value
  const pathMap: Record<string, string> = {
    pacing: '/pacing_profile/beats_per_minute/target',
    stakes_ladder: '/stakes_ladder/no_global_before_pct',
    twist_budget: '/budgets/twist_cap',
    dialogue_style: '/dialogue_rules/subtext_ratio_target',
    texture_realism: '/texture_rules/money_time_institution_required',
    antagonism_model: '/antagonism_model/primary',
    forbidden_moves: '/forbidden_moves',
  };

  const path = pathMap[conflict.dimension];
  if (!path) return null;

  let value: unknown;
  try {
    value = JSON.parse(conflict.expected_value);
  } catch {
    value = conflict.expected_value;
  }

  return { op: 'replace', path, value };
}

export function ConflictsPanel({ projectId, lane, userId, conflicts, onResolved }: Props) {
  if (!conflicts || conflicts.length === 0) return null;

  const applyRecommended = async () => {
    const patches: OverridePatch[] = [];
    for (const c of conflicts) {
      // default: honor_overrides for hard, honor_comps for info/warn
      const choice = c.severity === 'hard' ? 'honor_overrides' : 'honor_comps';
      const patch = conflictToPatch(c, choice);
      if (patch) patches.push(patch);
    }

    if (patches.length === 0) {
      toast.info('No overrides needed — comps honored');
      onResolved?.();
      return;
    }

    try {
      await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'apply_override',
          project_id: projectId,
          lane,
          user_id: userId,
          scope: 'project_default',
          patch: patches,
        },
      });
      toast.success(`Applied ${patches.length} override(s)`);
      onResolved?.();
    } catch (err: any) {
      toast.error('Failed to apply: ' + err.message);
    }
  };

  const honorAllOverrides = async () => {
    const patches: OverridePatch[] = [];
    for (const c of conflicts) {
      const patch = conflictToPatch(c, 'honor_overrides');
      if (patch) patches.push(patch);
    }

    if (patches.length === 0) return;
    try {
      await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'apply_override',
          project_id: projectId,
          lane,
          user_id: userId,
          scope: 'project_default',
          patch: patches,
        },
      });
      toast.success('All overrides applied');
      onResolved?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const hard = conflicts.filter(c => c.severity === 'hard');
  const warn = conflicts.filter(c => c.severity === 'warn');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        <span className="font-medium">
          {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''}
        </span>
        {hard.length > 0 && <Badge variant="destructive" className="text-[8px]">{hard.length} hard</Badge>}
        {warn.length > 0 && <Badge variant="outline" className="text-[8px]">{warn.length} warn</Badge>}
      </div>

      <div className="space-y-1.5">
        {conflicts.map((c, i) => (
          <div
            key={c.id || i}
            className={`p-2 rounded-md border text-[10px] ${
              c.severity === 'hard' ? 'border-destructive/50 bg-destructive/5' : 'border-border/50'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Badge variant={c.severity === 'hard' ? 'destructive' : 'outline'} className="text-[8px]">
                {c.severity}
              </Badge>
              <Badge variant="secondary" className="text-[8px]">{c.dimension}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{c.message}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="default" onClick={applyRecommended} className="h-7 text-[10px] gap-1">
          <Zap className="h-3 w-3" /> Apply Recommended
        </Button>
        <Button size="sm" variant="outline" onClick={honorAllOverrides} className="h-7 text-[10px]">
          Honor My Overrides
        </Button>
      </div>
    </div>
  );
}
