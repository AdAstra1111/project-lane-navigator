/**
 * AiShotActionPanel — Side panel for AI actions on a shot.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Sparkles, Image, Film, AlertTriangle, Loader2,
  CheckCircle2, XCircle, Wand2,
} from 'lucide-react';
import { AiReadinessBadge } from './AiReadinessBadge';
import type { AiGeneratedMedia } from '@/hooks/useAiTrailerFactory';

interface AiShotActionPanelProps {
  open: boolean;
  onClose: () => void;
  shot: any;
  media: AiGeneratedMedia[];
  onLabelReadiness: () => void;
  onGenerateFrame: () => void;
  onMotionStill: () => void;
  isLabeling: boolean;
  isGenerating: boolean;
}

export function AiShotActionPanel({
  open,
  onClose,
  shot,
  media,
  onLabelReadiness,
  onGenerateFrame,
  onMotionStill,
  isLabeling,
  isGenerating,
}: AiShotActionPanelProps) {
  const tier = shot?.ai_readiness_tier;
  const shotMedia = media.filter(m => m.shot_id === shot?.id);
  const frames = shotMedia.filter(m => m.media_type === 'storyboard_frame');
  const motionStills = shotMedia.filter(m => m.media_type === 'motion_still' || m.media_type === 'animated_panel');

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Production
            {tier && (
              <AiReadinessBadge
                tier={tier}
                confidence={shot.ai_confidence}
                maxQuality={shot.ai_max_quality}
                blockingConstraints={shot.ai_blocking_constraints}
                requiredAssets={shot.ai_required_assets}
                legalRiskFlags={shot.ai_legal_risk_flags}
                costBand={shot.ai_estimated_cost_band}
              />
            )}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4">
          <div className="space-y-4 pr-4">
            {/* Readiness */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-xs">AI Readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!tier && (
                  <p className="text-xs text-muted-foreground">Not yet analyzed. Label this shot to see AI feasibility.</p>
                )}
                <Button
                  size="sm"
                  className="w-full text-xs gap-1"
                  onClick={onLabelReadiness}
                  disabled={isLabeling}
                >
                  {isLabeling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {tier ? 'Re-analyze' : 'Analyze AI Readiness'}
                </Button>

                {shot?.ai_analysis_json?.rubric && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(shot.ai_analysis_json.rubric).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-2 h-2 rounded-full ${
                                i < (val as number) ? 'bg-primary' : 'bg-muted'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generation Actions */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-xs">Generate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1"
                  onClick={onGenerateFrame}
                  disabled={isGenerating || tier === 'D'}
                >
                  {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Image className="h-3 w-3" />}
                  {tier === 'D' ? 'Tier D — Not viable' : 'Generate Frame'}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1"
                  onClick={onMotionStill}
                  disabled={isGenerating || !tier || tier === 'C' || tier === 'D'}
                >
                  <Film className="h-3 w-3" />
                  {tier === 'C' ? 'Tier C — Previz only' : tier === 'D' ? 'Not available' : 'Generate Motion Still'}
                </Button>

                {tier === 'D' && (
                  <p className="text-[10px] text-red-400 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    This shot is not viable for AI generation. Consider rewriting.
                  </p>
                )}
                {tier === 'C' && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Limited to previz frames. Rewrite for better AI compatibility.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Generated Media */}
            {shotMedia.length > 0 && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-xs">Generated Media ({shotMedia.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {frames.map(m => (
                      <div key={m.id} className="relative rounded border border-border overflow-hidden aspect-video bg-muted">
                        {m.public_url ? (
                          <img src={m.public_url} alt="Generated frame" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground">
                            <Image className="h-4 w-4" />
                          </div>
                        )}
                        {m.selected && (
                          <div className="absolute top-1 right-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
