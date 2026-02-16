/**
 * RetconPanel — Manages retcon events: create, analyze impact, propose patches.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, Loader2, RefreshCw, Plus, Zap } from 'lucide-react';
import type { RetconEvent } from '@/hooks/useSeriesWriterV2';

interface Props {
  events: RetconEvent[];
  onCreateEvent: (changeSummary: string) => void;
  onAnalyze: (eventId: string) => void;
  onPropose: (eventId: string, episodeNumbers: number[]) => void;
  isAnalyzing: boolean;
  isProposing: boolean;
}

export function RetconPanel({ events, onCreateEvent, onAnalyze, onPropose, isAnalyzing, isProposing }: Props) {
  const [newSummary, setNewSummary] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = () => {
    if (!newSummary.trim()) return;
    onCreateEvent(newSummary.trim());
    setNewSummary('');
    setShowCreate(false);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 px-4 pt-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-primary" />
          Retcon Assistant
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 ml-auto"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus className="h-3 w-3" /> New Change
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {showCreate && (
          <div className="space-y-2 p-2 rounded-lg bg-muted/30 border border-border/50">
            <Textarea
              placeholder="Describe the core change (e.g., 'Changed LENA's motivation from revenge to redemption in character bible')"
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              className="text-xs min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={!newSummary.trim()}>
                Create Retcon Event
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {events.length === 0 && !showCreate && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No retcon events. Use this when you change a core doc mid-season.
          </p>
        )}

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {events.map(event => (
              <div key={event.id} className="p-2.5 rounded-lg border border-border/50 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-foreground leading-relaxed flex-1">{event.change_summary}</p>
                  <Badge variant="outline" className={`text-[8px] shrink-0 ${
                    event.status === 'patches_ready' ? 'border-emerald-500/30 text-emerald-400' :
                    event.status === 'analyzed' ? 'border-amber-500/30 text-amber-400' :
                    'border-border text-muted-foreground'
                  }`}>
                    {event.status}
                  </Badge>
                </div>

                {/* Impact heatmap */}
                {event.impact_analysis?.impacted_episodes?.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">Impacted Episodes:</span>
                    <div className="flex flex-wrap gap-1">
                      {event.impact_analysis.impacted_episodes.map((imp: any) => (
                        <Badge key={imp.episode_number} variant="outline" className={`text-[9px] ${
                          imp.severity === 'high' ? 'border-red-500/30 text-red-400 bg-red-500/10' :
                          imp.severity === 'medium' ? 'border-orange-500/30 text-orange-400 bg-orange-500/10' :
                          'border-amber-500/30 text-amber-400 bg-amber-500/10'
                        }`}>
                          EP{imp.episode_number} — {imp.reason?.slice(0, 40)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-1.5">
                  {event.status === 'pending' && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => onAnalyze(event.id)} disabled={isAnalyzing}>
                      {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                      Analyze Impact
                    </Button>
                  )}
                  {event.status === 'analyzed' && event.impact_analysis?.impacted_episodes?.length > 0 && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => {
                      const eps = event.impact_analysis.impacted_episodes.map((e: any) => e.episode_number);
                      onPropose(event.id, eps);
                    }} disabled={isProposing}>
                      {isProposing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Propose Patches
                    </Button>
                  )}
                </div>

                {/* Patch suggestions */}
                {event.patch_suggestions?.length > 0 && (
                  <div className="space-y-1 border-t border-border/30 pt-2 mt-2">
                    <span className="text-[10px] text-muted-foreground uppercase">Patches</span>
                    {event.patch_suggestions.map((p: any, i: number) => (
                      <div key={i} className="text-xs p-1.5 rounded bg-muted/20">
                        <span className="font-medium text-foreground">EP{p.episode_number}:</span>{' '}
                        <span className="text-muted-foreground">{p.summary}</span>
                        <Badge variant="outline" className="text-[8px] ml-1">{p.risk_level}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
