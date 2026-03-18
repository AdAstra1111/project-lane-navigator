/**
 * PlateauDiagnosisPanel — Structured diagnosis UI for plateaued Auto-Run jobs.
 * Shows cause classification, confidence, evidence, and actionable recommendations.
 */
import { CAUSE_LABELS, RECOMMENDATION_LABELS } from '@/lib/plateauDiagnosis';
import type { PlateauDiagnosisRow } from '@/hooks/usePlateauDiagnosis';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Target, Microscope, ArrowRight, Shield, Fingerprint,
  Lightbulb, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useState } from 'react';

interface PlateauDiagnosisPanelProps {
  diagnosis: PlateauDiagnosisRow;
  onForceAdvance?: () => void;
  onStop?: () => void;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-muted/30 text-muted-foreground border-border/50',
};

const CAUSE_SEVERITY: Record<string, 'critical' | 'warning' | 'info'> = {
  seed_limited: 'critical',
  weak_hook: 'critical',
  weak_conflict_engine: 'critical',
  escalation_architecture_weak: 'critical',
  blueprint_mismatch: 'warning',
  dna_mismatch: 'warning',
  canon_scaffold_weak: 'warning',
  rewrite_exhausted: 'warning',
  weak_lane_fit: 'info',
  weak_market_heat: 'info',
  weak_feasibility: 'info',
  unknown: 'info',
};

const SEVERITY_STYLES = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-border/50 bg-muted/10',
};

export function PlateauDiagnosisPanel({ diagnosis, onForceAdvance, onStop }: PlateauDiagnosisPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const rec = diagnosis.recommendation_bundle;
  const severity = CAUSE_SEVERITY[diagnosis.primary_cause] || 'info';
  const causeLabel = (CAUSE_LABELS as Record<string, string>)[diagnosis.primary_cause] || diagnosis.primary_cause;
  const recLabel = rec?.recommendation_type
    ? ((RECOMMENDATION_LABELS as Record<string, string>)[rec.recommendation_type] || rec.short_label || rec.recommendation_type)
    : 'No recommendation';

  const ciGap = diagnosis.target_ci - (diagnosis.best_ci_seen ?? diagnosis.final_ci ?? 0);

  return (
    <div className={`rounded-lg border p-3 space-y-2.5 ${SEVERITY_STYLES[severity]}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Microscope className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <div className="text-xs font-semibold text-foreground">Plateau Diagnosis</div>
            <div className="text-[10px] text-muted-foreground">
              {diagnosis.diagnosis_version} · {new Date(diagnosis.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CONFIDENCE_COLORS[diagnosis.confidence]}`}>
          {diagnosis.confidence} confidence
        </Badge>
      </div>

      {/* Primary Cause */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className={`h-3.5 w-3.5 ${severity === 'critical' ? 'text-red-400' : severity === 'warning' ? 'text-amber-400' : 'text-muted-foreground'}`} />
          <span className="text-xs font-medium text-foreground">{causeLabel}</span>
          {diagnosis.seed_limited && (
            <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">Seed Limited</Badge>
          )}
          {diagnosis.rewriteable && !diagnosis.seed_limited && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-emerald-400 border-emerald-500/30">Rewriteable</Badge>
          )}
        </div>
        {diagnosis.secondary_causes?.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-5">
            {diagnosis.secondary_causes.map((c: string) => (
              <Badge key={c} variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground border-border/40">
                {(CAUSE_LABELS as Record<string, string>)[c] || c}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* CI Metrics */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded bg-muted/20 p-1.5 text-center">
          <div className="text-muted-foreground">Best CI</div>
          <div className="font-mono font-semibold text-foreground">{diagnosis.best_ci_seen ?? diagnosis.final_ci ?? '?'}</div>
        </div>
        <div className="rounded bg-muted/20 p-1.5 text-center">
          <div className="text-muted-foreground">Target</div>
          <div className="font-mono font-semibold text-foreground">{diagnosis.target_ci}</div>
        </div>
        <div className="rounded bg-muted/20 p-1.5 text-center">
          <div className="text-muted-foreground">Gap</div>
          <div className={`font-mono font-semibold ${ciGap > 10 ? 'text-red-400' : ciGap > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {ciGap > 0 ? `−${ciGap}` : '✓'}
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded bg-primary/5 border border-primary/20 p-2 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">{recLabel}</span>
        </div>
        {rec?.rationale && (
          <div className="text-[10px] text-muted-foreground leading-relaxed">{rec.rationale}</div>
        )}
        {rec?.recommended_mutations?.length > 0 && (
          <ul className="space-y-0.5 pl-5">
            {rec.recommended_mutations.map((m: string, i: number) => (
              <li key={i} className="text-[10px] text-muted-foreground/80 list-disc">{m}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Lineage */}
      {(diagnosis.source_blueprint_id || diagnosis.source_dna_profile_id) && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {diagnosis.source_blueprint_id && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Shield className="h-3 w-3" />
              <span>Blueprint linked</span>
            </div>
          )}
          {diagnosis.source_dna_profile_id && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Fingerprint className="h-3 w-3" />
              <span>DNA linked</span>
            </div>
          )}
        </div>
      )}

      {/* Evidence (collapsible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Hide' : 'Show'} evidence ({diagnosis.evidence_summary?.length || 0} signals)
      </button>
      {expanded && diagnosis.evidence_summary?.length > 0 && (
        <div className="rounded bg-muted/10 p-2 space-y-0.5">
          {diagnosis.evidence_summary.map((e: string, i: number) => (
            <div key={i} className="text-[10px] text-muted-foreground font-mono">{e}</div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {diagnosis.seed_limited && rec?.recommendation_type === 'regenerate_devseed' && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2 border-primary/40 text-primary hover:bg-primary/10"
            disabled
            title="DevSeed regeneration — coming soon"
          >
            <ArrowRight className="h-2.5 w-2.5 mr-1" />
            Create Stronger DevSeed
          </Button>
        )}
        {onForceAdvance && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
            onClick={onForceAdvance}
          >
            <ArrowRight className="h-2.5 w-2.5 mr-1" />
            Force Advance Stage
          </Button>
        )}
        {onStop && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2 border-border/50 text-muted-foreground hover:bg-muted/30"
            onClick={onStop}
          >
            <X className="h-2.5 w-2.5 mr-1" />
            Stop Run
          </Button>
        )}
      </div>
    </div>
  );
}
