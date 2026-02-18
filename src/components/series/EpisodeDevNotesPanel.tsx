/**
 * EpisodeDevNotesPanel — Displays structured Episode Reviewer output (Sections A–E).
 * Series-aware, episode-scoped. Shows contract, beat checks, craft notes, alignment, patches.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, AlertOctagon, AlertTriangle, Sparkles,
  ChevronDown, ChevronRight, CheckCircle2, ShieldAlert,
  FileText, Zap, Target, BookOpen, Wrench, ClipboardCheck,
  XCircle, MinusCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { DevNotesRun, BeatCheck, SetupCheck, EpisodePatch } from '@/hooks/useEpisodeDevValidation';

interface Props {
  run: DevNotesRun | null;
  notes: any[];
  isRunning: boolean;
  appliedPatches?: Array<{ patch_name: string; applied_at: string; new_script_id: string }>;
  isApplyingPatch?: boolean;
  onApplyPatch?: (patch: EpisodePatch, applyMode?: 'patch' | 'rewrite') => void;
}

// ─── Section Toggle helper ──────────────────────────────────────────────────

function SectionHeader({
  icon: Icon, label, color, count, isOpen, onToggle,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 rounded-t-lg transition-colors"
      onClick={onToggle}
    >
      {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className={`text-xs font-semibold ${color}`}>{label}</span>
      {count !== undefined && (
        <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0">{count}</Badge>
      )}
    </button>
  );
}

// ─── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    PRESENT:      { cls: 'border-emerald-500/40 text-emerald-400 dark:border-emerald-500/40', icon: CheckCircle2, label: 'PRESENT' },
    PARTIAL:      { cls: 'border-amber-500/40 text-amber-400 dark:border-amber-500/40', icon: MinusCircle, label: 'PARTIAL' },
    MISSING:      { cls: 'border-destructive/40 text-destructive', icon: XCircle, label: 'MISSING' },
    NOT_REQUIRED: { cls: 'border-border text-muted-foreground', icon: MinusCircle, label: 'N/A' },
  };
  const c = cfg[status] || cfg.MISSING;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 flex items-center gap-1 ${c.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {c.label}
    </Badge>
  );
}

// ─── Section A ──────────────────────────────────────────────────────────────

function SectionAPanel({ data }: { data: DevNotesRun['results_json']['section_a'] }) {
  if (!data) return <p className="text-[10px] text-muted-foreground px-3 pb-2">No episode contract extracted.</p>;
  return (
    <div className="px-3 pb-3 space-y-2">
      {data.required_beats?.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Required Beats</p>
          <ul className="space-y-0.5">
            {data.required_beats.map((b, i) => (
              <li key={i} className="text-[10px] text-foreground flex gap-1.5">
                <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.must_plant_setups?.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wide mb-1">Must-Plant Setups</p>
          <ul className="space-y-0.5">
            {data.must_plant_setups.map((s, i) => (
              <li key={i} className="text-[10px] text-amber-300/90 flex gap-1.5">
                <span className="shrink-0">▸</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.end_state_promise && (
        <div className="bg-primary/5 border border-primary/20 rounded px-2 py-1.5">
          <p className="text-[9px] font-semibold text-primary/70 uppercase tracking-wide mb-0.5">End-State Promise</p>
          <p className="text-[10px] text-foreground">{data.end_state_promise}</p>
        </div>
      )}
    </div>
  );
}

// ─── Section B ──────────────────────────────────────────────────────────────

function BeatCheckRow({ check }: { check: BeatCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-background/40 rounded border border-border/40 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <StatusBadge status={check.status} />
        <span className="text-[10px] text-foreground flex-1 text-left truncate">{check.beat}</span>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1 border-t border-border/30">
          {check.evidence && (
            <p className="text-[9px] text-muted-foreground mt-1">
              <span className="font-medium text-foreground/60">Evidence:</span> {check.evidence}
            </p>
          )}
          {check.fix && check.status !== 'PRESENT' && (
            <p className="text-[9px] text-primary/80">
              <span className="font-medium">Fix:</span> {check.fix}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SectionBPanel({ data }: { data: DevNotesRun['results_json']['section_b'] }) {
  if (!data) return <p className="text-[10px] text-muted-foreground px-3 pb-2">No beat check data.</p>;
  const beats = data.beat_checks || [];
  const setups = data.setup_checks || [];
  const missing = beats.filter(b => b.status === 'MISSING' || b.status === 'PARTIAL').length;
  return (
    <div className="px-3 pb-3 space-y-3">
      {beats.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Beat Checks</p>
            {missing > 0 && (
              <Badge variant="outline" className="text-[9px] border-red-500/40 text-red-400">{missing} needs work</Badge>
            )}
          </div>
          <div className="space-y-1">
            {beats.map((b, i) => <BeatCheckRow key={i} check={b} />)}
          </div>
        </div>
      )}
      {setups.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Setup Checks</p>
          <div className="space-y-1">
            {setups.map((s, i) => (
              <div key={i} className="bg-background/40 rounded border border-border/40 px-2 py-1.5 flex items-start gap-2">
                <StatusBadge status={s.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-foreground">{s.setup}</p>
                  {s.fix && s.status !== 'PRESENT' && s.status !== 'NOT_REQUIRED' && (
                    <p className="text-[9px] text-primary/70 mt-0.5">💡 {s.fix}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section C ──────────────────────────────────────────────────────────────

function SectionCPanel({ data }: { data: DevNotesRun['results_json']['section_c'] }) {
  if (!data) return <p className="text-[10px] text-muted-foreground px-3 pb-2">No craft assessment.</p>;
  const items = [
    { label: 'Cold Open / Hook', value: data.cold_open_hook },
    { label: 'Act Turns / Escalation', value: data.act_turns },
    { label: 'Climax + Button', value: data.climax_button },
    { label: 'Character Turns', value: data.character_turns },
    { label: 'Pacing', value: data.pacing },
  ].filter(i => i.value);
  return (
    <div className="px-3 pb-3 space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="bg-background/40 rounded border border-border/30 px-2 py-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">{item.label}</p>
          <p className="text-[10px] text-foreground mt-0.5">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Section D ──────────────────────────────────────────────────────────────

function SectionDPanel({ data }: { data: DevNotesRun['results_json']['section_d'] }) {
  if (!data) return <p className="text-[10px] text-muted-foreground px-3 pb-2">No alignment data.</p>;
  const isOnTrack = data.season_alignment === 'on track';
  const conflicts = data.canon_conflicts || [];
  return (
    <div className="px-3 pb-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`text-[10px] ${isOnTrack ? 'border-emerald-500/40 text-emerald-400' : 'border-red-500/40 text-red-400'}`}>
          {isOnTrack ? '✓ On Track' : '⚠ Off Track'}
        </Badge>
      </div>
      {data.alignment_bullets?.length > 0 && (
        <ul className="space-y-0.5">
          {data.alignment_bullets.map((b, i) => (
            <li key={i} className="text-[10px] text-muted-foreground flex gap-1.5">
              <span className="shrink-0 text-muted-foreground/50">—</span>{b}
            </li>
          ))}
        </ul>
      )}
      {conflicts.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded px-2 py-1.5">
          <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide mb-1">Canon Conflicts</p>
          {conflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-red-300/80">
              {typeof c === 'string' ? c : `${c.issue} — ${c.evidence}`}
            </p>
          ))}
        </div>
      )}
      {data.later_pivot_notes?.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Later Pivot Notes</p>
          {data.later_pivot_notes.map((n, i) => (
            <p key={i} className="text-[10px] text-muted-foreground">{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section E (interactive with Apply) ─────────────────────────────────────

function SectionEPanel({
  data,
  appliedPatches,
  isApplyingPatch,
  onApplyPatch,
}: {
  data: DevNotesRun['results_json']['section_e'];
  appliedPatches?: Array<{ patch_name: string; applied_at: string; new_script_id: string }>;
  isApplyingPatch?: boolean;
  onApplyPatch?: (patch: EpisodePatch, applyMode?: 'patch' | 'rewrite') => void;
}) {
  const [selectedPatch, setSelectedPatch] = useState<number | null>(null);

  if (!data?.patches?.length) return <p className="text-[10px] text-muted-foreground px-3 pb-2">No patches suggested.</p>;

  const appliedNames = new Set((appliedPatches || []).map(a => a.patch_name));

  return (
    <div className="px-3 pb-3 space-y-1.5">
      {data.patches.map((p, i) => {
        const isApplied = appliedNames.has(p.name);
        const isSelected = selectedPatch === i && !isApplied;
        return (
          <div
            key={i}
            className={`rounded border px-2 py-1.5 space-y-0.5 transition-colors cursor-pointer ${
              isApplied
                ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70'
                : isSelected
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border/30 bg-background/40 hover:border-border/60'
            }`}
            onClick={() => !isApplied && setSelectedPatch(prev => prev === i ? null : i)}
          >
            <div className="flex items-center gap-1.5">
              {/* Radio indicator */}
              {!isApplied && (
                <div className={`h-3 w-3 rounded-full border-2 shrink-0 flex items-center justify-center ${
                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                }`}>
                  {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </div>
              )}
              {isApplied && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
              <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary/70 shrink-0">
                #{i + 1}
              </Badge>
              <p className="text-[10px] font-medium text-foreground flex-1">{p.name}</p>
              {isApplied && (
                <Badge variant="outline" className="text-[7px] px-1 border-emerald-500/40 text-emerald-400 shrink-0">
                  Applied
                </Badge>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground">
              <span className="font-medium text-foreground/60">Where:</span> {p.where}
            </p>
            <p className="text-[9px] text-muted-foreground">
              <span className="font-medium text-foreground/60">What:</span> {p.what}
            </p>
            <p className="text-[9px] text-primary/70">
              <span className="font-medium">Why:</span> {p.why}
            </p>
          </div>
        );
      })}

      {/* Apply Fix button — only enabled when a patch is selected */}
      {onApplyPatch && (
        <div className="flex items-center justify-between pt-2 border-t border-border/30 mt-2">
          <span className="text-[10px] text-muted-foreground">
            {selectedPatch !== null
              ? `"${data.patches[selectedPatch]?.name}" selected`
              : 'Select a patch above to apply'}
          </span>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={selectedPatch === null || isApplyingPatch}
            onClick={() => {
              if (selectedPatch !== null && data.patches[selectedPatch]) {
                onApplyPatch(data.patches[selectedPatch]);
              }
            }}
          >
            {isApplyingPatch
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Wrench className="h-3 w-3" />}
            Apply Fix
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

export function EpisodeDevNotesPanel({ run, notes, isRunning, appliedPatches, isApplyingPatch, onApplyPatch }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    a: false,
    b: true,
    c: false,
    d: false,
    e: true,
    canon_risk: true,
  });

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const grade = run?.results_json?.overall_grade;
  const strengths = run?.results_json?.strengths || [];
  const canonRiskNotes = (run?.results_json?.canon_risk_notes || []);
  const canonRiskCount = run?.results_json?.canon_risk_count || canonRiskNotes.length;
  const hasStructuredSections = !!(run?.results_json?.section_a || run?.results_json?.section_b);

  // Section B issue counts
  const beatChecks = run?.results_json?.section_b?.beat_checks || [];
  const missingBeats = beatChecks.filter(b => b.status === 'MISSING').length;
  const partialBeats = beatChecks.filter(b => b.status === 'PARTIAL').length;
  const totalIssues = missingBeats + partialBeats;

  const patches = run?.results_json?.section_e?.patches || [];

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium flex items-center gap-2 text-muted-foreground">
          <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
          Episode Script Review
        </div>
        <div className="flex items-center gap-2">
          {canonRiskCount > 0 && !isRunning && (
            <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              Canon Issues: {canonRiskCount}
            </Badge>
          )}
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Run status bar */}
      {run && !isRunning && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[9px] ${
            run.status === 'completed' ? 'border-emerald-500/30 text-emerald-400' :
            'border-destructive/30 text-destructive'
          }`}>
            {run.status === 'completed' ? '✓ Complete' : '✗ Failed'}
          </Badge>
          {grade && (
            <Badge variant="outline" className={`text-[9px] ${
              grade === 'A' ? 'border-emerald-500/30 text-emerald-400' :
              grade === 'B' ? 'border-blue-500/30 text-blue-400' :
              grade === 'C' ? 'border-amber-500/30 text-amber-400' :
              'border-red-500/30 text-red-400'
            }`}>
              Grade: {grade}
            </Badge>
          )}
          {totalIssues > 0 && (
            <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-400">
              {missingBeats > 0 && `${missingBeats} missing`}
              {missingBeats > 0 && partialBeats > 0 && ' · '}
              {partialBeats > 0 && `${partialBeats} partial`}
            </Badge>
          )}
          {run.summary && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
              {run.summary}
            </span>
          )}
        </div>
      )}

      {/* Structured sections */}
      {run && run.status === 'completed' && hasStructuredSections && (
        <ScrollArea className="h-[380px]">
          <div className="space-y-1.5">

            {/* Section A — Episode Contract */}
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5">
              <SectionHeader
                icon={Target} label="A — Episode Contract" color="text-blue-400"
                count={(run.results_json.section_a?.required_beats?.length || 0)}
                isOpen={expanded.a} onToggle={() => toggle('a')}
              />
              {expanded.a && <SectionAPanel data={run.results_json.section_a} />}
            </div>

            {/* Section B — Contract Check */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5">
              <SectionHeader
                icon={ClipboardCheck} label="B — Contract Check" color="text-amber-400"
                count={beatChecks.length}
                isOpen={expanded.b} onToggle={() => toggle('b')}
              />
              {expanded.b && <SectionBPanel data={run.results_json.section_b} />}
            </div>

            {/* Section C — Craft */}
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5">
              <SectionHeader
                icon={Sparkles} label="C — Episode Craft" color="text-violet-400"
                isOpen={expanded.c} onToggle={() => toggle('c')}
              />
              {expanded.c && <SectionCPanel data={run.results_json.section_c} />}
            </div>

            {/* Section D — Series Alignment */}
            <div className={`rounded-lg border ${canonRiskCount > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
              <SectionHeader
                icon={BookOpen} label="D — Series Alignment" color={canonRiskCount > 0 ? 'text-red-400' : 'text-emerald-400'}
                count={canonRiskCount > 0 ? canonRiskCount : undefined}
                isOpen={expanded.d} onToggle={() => toggle('d')}
              />
              {expanded.d && <SectionDPanel data={run.results_json.section_d} />}
            </div>

            {/* Section E — Patch List */}
            <div className="rounded-lg border border-primary/20 bg-primary/5">
              <SectionHeader
                icon={Wrench} label="E — Patch List" color="text-primary"
                count={patches.length}
                isOpen={expanded.e} onToggle={() => toggle('e')}
              />
              {expanded.e && <SectionEPanel data={run.results_json.section_e} appliedPatches={appliedPatches} isApplyingPatch={isApplyingPatch} onApplyPatch={onApplyPatch} />}
            </div>

            {/* Strengths */}
            {strengths.length > 0 && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <p className="text-xs font-medium text-emerald-400 mb-1">✓ Strengths</p>
                <ul className="text-[10px] text-muted-foreground list-disc list-inside space-y-0.5">
                  {strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Fallback: legacy flat notes (for old runs without structured sections) */}
      {run && run.status === 'completed' && !hasStructuredSections && notes.length > 0 && (
        <ScrollArea className="h-[280px]">
          <div className="space-y-1.5">
            {notes.map((note, i) => (
              <div key={i} className="bg-background/50 rounded border border-border/40 p-2 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-medium text-foreground">{note.title}</p>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">{note.detail}</p>
                {note.suggestion && <p className="text-[10px] text-primary/80">💡 {note.suggestion}</p>}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {run && run.status === 'completed' && !hasStructuredSections && notes.length === 0 && canonRiskCount === 0 && (
        <div className="flex items-center gap-2 py-1">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-xs text-emerald-400">No development notes</span>
        </div>
      )}

      {!run && !isRunning && (
        <p className="text-[10px] text-muted-foreground py-1">
          Run "Send to Dev Engine" to get a structured episode review.
        </p>
      )}
    </div>
  );
}
