/**
 * Auto Assembly Panel — trigger auto-assemble and review decisions
 */
import { useState } from 'react';
import { Wand2, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAssemblerMutations } from '@/lib/trailerPipeline/assemblerHooks';

interface AutoAssemblyPanelProps {
  projectId: string;
  blueprintId?: string;
  scriptRunId?: string;
  rhythmRunId?: string;
  onCutCreated?: (cutId: string) => void;
}

export function AutoAssemblyPanel({ projectId, blueprintId, scriptRunId, rhythmRunId, onCutCreated }: AutoAssemblyPanelProps) {
  const { autoAssembleCut } = useAssemblerMutations(projectId);
  const [strategy, setStrategy] = useState('best_scores');
  const [decisions, setDecisions] = useState<any>(null);
  const [showDecisions, setShowDecisions] = useState(false);
  const [showPicks, setShowPicks] = useState(true);
  const [showTrims, setShowTrims] = useState(false);

  const handleAutoAssemble = () => {
    autoAssembleCut.mutate(
      { blueprintId, scriptRunId, rhythmRunId, strategy },
      {
        onSuccess: (data) => {
          setDecisions(data);
          setShowDecisions(true);
          if (data.cutId && onCutCreated) onCutCreated(data.cutId);
        },
      }
    );
  };

  const pickedClips = decisions?.decisions?.picked_clips || [];
  const trims = decisions?.decisions?.trims || [];
  const textCards = decisions?.decisions?.text_cards || [];
  const alignment = decisions?.decisions?.alignment || {};

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          Auto Assembly Intelligence
          <Badge variant="outline" className="text-[9px] ml-auto">v1</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Controls */}
        <div className="flex items-center gap-2">
          <Select value={strategy} onValueChange={setStrategy}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="best_scores">Best Scores</SelectItem>
              <SelectItem value="motion_forward">Motion Forward</SelectItem>
              <SelectItem value="dialogue_forward">Dialogue Forward</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleAutoAssemble}
            disabled={autoAssembleCut.isPending}
            className="text-xs gap-1.5"
          >
            <Wand2 className="h-3 w-3" />
            {autoAssembleCut.isPending ? 'Assembling…' : 'Auto Assemble Cut'}
          </Button>
        </div>

        {/* Results summary */}
        {decisions && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary" className="text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                {decisions.pickedCount} picked
              </Badge>
              {decisions.missingCount > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {decisions.missingCount} missing
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {decisions.appliedSilenceWindows} silence windows
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant={alignment.twist_hit_aligned ? 'secondary' : 'outline'} className="text-[10px]">
                      Twist {alignment.twist_hit_aligned ? '✓' : '✗'}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    {alignment.twist_hit_aligned ? 'Twist hit aligned to marker' : 'Twist hit not aligned'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant={alignment.drop_aligned ? 'secondary' : 'outline'} className="text-[10px]">
                      Drop {alignment.drop_aligned ? '✓' : '✗'}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    {alignment.drop_aligned ? 'Crescendo drop aligned' : 'Drop marker not aligned'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Decision details */}
            <Collapsible open={showDecisions} onOpenChange={setShowDecisions}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs w-full justify-between">
                  Auto Decisions
                  {showDecisions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-[280px] mt-2">
                  <div className="space-y-3 pr-3">
                    {/* Picked clips */}
                    <Collapsible open={showPicks} onOpenChange={setShowPicks}>
                      <CollapsibleTrigger className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 w-full">
                        Clip Picks ({pickedClips.length})
                        {showPicks ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-1">
                        {pickedClips.map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded bg-muted/50">
                            <span className="font-mono text-muted-foreground w-6">#{p.beat_index}</span>
                            {p.clip_id ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3 w-3 text-destructive shrink-0" />
                            )}
                            <span className="truncate flex-1">{p.reason}</span>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Trims */}
                    <Collapsible open={showTrims} onOpenChange={setShowTrims}>
                      <CollapsibleTrigger className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 w-full">
                        Trim Decisions ({trims.length})
                        {showTrims ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-1">
                        {trims.map((t: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded bg-muted/50">
                            <span className="font-mono text-muted-foreground w-6">#{t.beat_index}</span>
                            <span className="font-mono">{t.in_ms}→{t.out_ms}ms</span>
                            <span className="truncate flex-1 text-muted-foreground">{t.reason}</span>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Text cards */}
                    {textCards.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-1">Text Cards ({textCards.length})</p>
                        {textCards.map((tc: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded bg-muted/50">
                            <span className="font-mono text-muted-foreground w-6">#{tc.beat_index}</span>
                            <span className="truncate">"{tc.text}"</span>
                            <span className="text-muted-foreground ml-auto">{tc.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3 inline mr-1" />
          Locked beats are preserved. All decisions are non-destructive and overridable.
        </p>
      </CardContent>
    </Card>
  );
}