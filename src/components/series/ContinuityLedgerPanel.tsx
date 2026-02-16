/**
 * ContinuityLedgerPanel — Displays structured continuity data for an episode.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookOpen, Users, Link2, Eye, MessageCircle, AlertTriangle } from 'lucide-react';
import type { ContinuityLedger } from '@/hooks/useSeriesWriterV2';

interface Props {
  ledger: ContinuityLedger | null;
  contradictions?: Array<{ episode: number; issue: string; severity: string }>;
}

export function ContinuityLedgerPanel({ ledger, contradictions }: Props) {
  if (!ledger) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 text-center text-xs text-muted-foreground">
          No continuity ledger yet. Lock the episode to generate one.
        </CardContent>
      </Card>
    );
  }

  const s = ledger.summary;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 px-4 pt-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-primary" />
          Continuity Ledger — EP {String(ledger.episode_number).padStart(2, '0')}
          <Badge variant="outline" className="text-[8px] ml-auto">
            {ledger.status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-3 text-xs">
            {/* Timeline */}
            {s.timeline && (
              <div>
                <span className="text-muted-foreground font-medium uppercase text-[10px]">Timeline</span>
                <p className="text-foreground mt-0.5">
                  Day {s.timeline.day} • {s.timeline.time_of_day} • {s.timeline.location}
                </p>
              </div>
            )}

            {/* Character States */}
            {s.character_states && Object.keys(s.character_states).length > 0 && (
              <div>
                <span className="text-muted-foreground font-medium uppercase text-[10px] flex items-center gap-1">
                  <Users className="h-3 w-3" /> Characters
                </span>
                <div className="mt-1 space-y-1">
                  {Object.entries(s.character_states).map(([name, state]) => (
                    <div key={name} className="p-1.5 rounded bg-muted/30">
                      <span className="font-medium text-foreground">{name}</span>
                      <div className="text-muted-foreground mt-0.5">
                        {state.goal && <span>Goal: {state.goal}. </span>}
                        {state.emotion && <span>Emotion: {state.emotion}. </span>}
                        {state.injury && <span>Injury: {state.injury}. </span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Relationship Deltas */}
            {s.relationship_deltas && s.relationship_deltas.length > 0 && (
              <div>
                <span className="text-muted-foreground font-medium uppercase text-[10px] flex items-center gap-1">
                  <Link2 className="h-3 w-3" /> Relationship Changes
                </span>
                <div className="mt-1 space-y-1">
                  {s.relationship_deltas.map((rd, i) => (
                    <p key={i} className="text-muted-foreground">
                      <span className="text-foreground">{rd.a} ↔ {rd.b}</span>: {rd.change} — {rd.why}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Secrets */}
            {s.secrets_revealed && s.secrets_revealed.length > 0 && (
              <div>
                <span className="text-muted-foreground font-medium uppercase text-[10px] flex items-center gap-1">
                  <Eye className="h-3 w-3" /> Secrets Revealed
                </span>
                <ul className="mt-1 list-disc list-inside text-muted-foreground">
                  {s.secrets_revealed.map((sec, i) => <li key={i}>{sec}</li>)}
                </ul>
              </div>
            )}

            {/* Open Threads */}
            {s.open_threads && s.open_threads.length > 0 && (
              <div>
                <span className="text-muted-foreground font-medium uppercase text-[10px] flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" /> Open Threads
                </span>
                <ul className="mt-1 list-disc list-inside text-muted-foreground">
                  {s.open_threads.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            {/* Cliffhanger */}
            {s.cliffhanger && (
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] font-medium text-amber-400 uppercase">Cliffhanger ({s.cliffhanger.type})</span>
                <p className="text-foreground mt-0.5">{s.cliffhanger.text}</p>
              </div>
            )}

            {/* Contradictions */}
            {contradictions && contradictions.length > 0 && (
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
                <span className="text-[10px] font-medium text-red-400 uppercase flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Continuity Conflicts
                </span>
                {contradictions.map((c, i) => (
                  <p key={i} className="text-xs text-red-400/80">
                    EP{c.episode}: {c.issue} <Badge variant="outline" className="text-[8px] ml-1">{c.severity}</Badge>
                  </p>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
