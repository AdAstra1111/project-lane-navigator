/**
 * EpisodeDevNotesPanel — Displays Dev Engine development notes for an episode.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, AlertOctagon, AlertTriangle, Sparkles,
  ChevronDown, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { useState } from 'react';
import type { DevNote, DevNotesRun } from '@/hooks/useEpisodeDevValidation';

interface Props {
  run: DevNotesRun | null;
  notes: DevNote[];
  isRunning: boolean;
}

const TIER_CONFIG = {
  blocking: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Blocking Issues' },
  high_impact: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'High Impact' },
  polish: { icon: Sparkles, color: 'text-muted-foreground', bg: 'bg-muted/20', border: 'border-border/50', label: 'Polish' },
} as const;

export function EpisodeDevNotesPanel({ run, notes, isRunning }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ blocking: true, high_impact: true });

  const grouped: Record<string, DevNote[]> = { blocking: [], high_impact: [], polish: [] };
  for (const note of notes) {
    (grouped[note.tier] || grouped.polish).push(note);
  }

  const grade = run?.results_json?.overall_grade;
  const strengths = run?.results_json?.strengths || [];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Dev Engine Notes
          </CardTitle>
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {run && !isRunning && (
          <div className="flex items-center gap-2 mt-1">
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
            {run.summary && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                {run.summary}
              </span>
            )}
          </div>
        )}
      </CardHeader>

      {run && run.status === 'completed' && notes.length > 0 && (
        <CardContent className="pt-0">
          <ScrollArea className="max-h-[350px]">
            <div className="space-y-3">
              {(['blocking', 'high_impact', 'polish'] as const).map(tier => {
                const items = grouped[tier];
                if (items.length === 0) return null;
                const cfg = TIER_CONFIG[tier];
                const Icon = cfg.icon;
                const isOpen = expanded[tier] ?? false;

                return (
                  <div key={tier} className={`rounded-lg border ${cfg.border} ${cfg.bg}`}>
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-left"
                      onClick={() => setExpanded(prev => ({ ...prev, [tier]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                      <span className={`text-xs font-medium ${cfg.color}`}>
                        {cfg.label} ({items.length})
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-2 space-y-2">
                        {items.map((note, i) => (
                          <div key={i} className="bg-background/50 rounded p-2 space-y-1">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs font-medium text-foreground">{note.title}</p>
                                  <Badge variant="outline" className="text-[8px] px-1 py-0">{note.category}</Badge>
                                  {!note.canon_safe && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/30 text-amber-400">
                                      ⚠ canon risk
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{note.detail}</p>
                                {note.suggestion && (
                                  <p className="text-[10px] text-primary/80 mt-1">
                                    💡 {note.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

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
        </CardContent>
      )}

      {run && run.status === 'completed' && notes.length === 0 && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-emerald-400">No development notes</span>
          </div>
        </CardContent>
      )}

      {!run && !isRunning && (
        <CardContent className="pt-0">
          <p className="text-[10px] text-muted-foreground py-1">
            Run "Send to Dev Engine" to get development notes.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
