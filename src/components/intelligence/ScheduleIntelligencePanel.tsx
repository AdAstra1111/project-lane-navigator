import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Brain, Loader2, AlertTriangle, Clock, MapPin, Users, Moon, Sun,
  ChevronDown, ChevronRight, BarChart3, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useProjectScenes, useShootDays, useSceneSchedule } from '@/hooks/useProductionSchedule';

interface ScheduleIntelligenceResult {
  estimated_shoot_days: number;
  estimated_pages_per_day: number;
  confidence: number;
  overtime_risk: 'low' | 'medium' | 'high';
  overtime_factors: string[];
  cast_clustering: { actor: string; scene_count: number; consecutive_possible: boolean; hold_days_estimate: number }[];
  location_groups: { location: string; scene_count: number; total_pages: number; suggested_days: number }[];
  night_shoot_count: number;
  ext_ratio: number;
  scheduling_flags: string[];
  suggested_block_structure: string;
  reasoning: string;
}

interface Props {
  projectId: string;
  format?: string;
  genres?: string[];
  budgetRange?: string;
}

const RISK_COLORS = {
  low: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  medium: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  high: 'text-red-400 bg-red-500/15 border-red-500/30',
};

export function ScheduleIntelligencePanel({ projectId, format, genres, budgetRange }: Props) {
  const { scenes } = useProjectScenes(projectId);
  const { shootDays } = useShootDays(projectId);
  const { schedule } = useSceneSchedule(projectId);
  const [result, setResult] = useState<ScheduleIntelligenceResult | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('overview');

  const analyze = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('schedule-intelligence', {
        body: {
          scenes: scenes.map(s => ({
            scene_number: s.scene_number,
            heading: s.heading,
            int_ext: s.int_ext,
            time_of_day: s.time_of_day,
            page_count: s.page_count,
            cast_members: s.cast_members,
            location: s.location,
          })),
          shootDays: shootDays.map(d => ({ id: d.id, shoot_date: d.shoot_date, day_number: d.day_number })),
          schedule: schedule.map(s => ({ scene_id: s.scene_id, shoot_day_id: s.shoot_day_id })),
          format,
          genres,
          budgetRange,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ScheduleIntelligenceResult;
    },
    onSuccess: (data) => setResult(data),
  });

  if (scenes.length === 0) {
    return (
      <Card className="p-4 border-dashed border-2 border-border/50 bg-card/30 text-center">
        <Brain className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Extract scenes from your script first to unlock Schedule Intelligence.</p>
      </Card>
    );
  }

  const toggle = (key: string) => setExpandedSection(prev => prev === key ? null : key);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Schedule Intelligence</h4>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending}
          className="text-xs"
        >
          {analyze.isPending ? (
            <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Analyzing…</>
          ) : result ? (
            <><Zap className="h-3 w-3 mr-1.5" /> Re-analyze</>
          ) : (
            <><Zap className="h-3 w-3 mr-1.5" /> Analyze Schedule</>
          )}
        </Button>
      </div>

      {analyze.isError && (
        <p className="text-xs text-red-400">{(analyze.error as Error).message}</p>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          {/* Overview stats */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Est. Days', value: result.estimated_shoot_days },
              { label: 'Pages/Day', value: result.estimated_pages_per_day?.toFixed(1) },
              { label: 'Night Scenes', value: result.night_shoot_count },
              { label: 'Ext. %', value: `${Math.round((result.ext_ratio || 0) * 100)}%` },
            ].map(s => (
              <div key={s.label} className="bg-muted/30 rounded-lg px-2 py-1.5">
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Overtime risk */}
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Overtime Risk:</span>
            <Badge className={`text-[10px] px-1.5 py-0 border ${RISK_COLORS[result.overtime_risk] || RISK_COLORS.medium}`}>
              {result.overtime_risk?.toUpperCase()}
            </Badge>
          </div>

          {/* Suggested block structure */}
          {result.suggested_block_structure && (
            <div className="bg-primary/5 rounded-lg px-3 py-2 border border-primary/20">
              <p className="text-xs text-muted-foreground mb-0.5">Suggested Structure</p>
              <p className="text-sm text-foreground">{result.suggested_block_structure}</p>
            </div>
          )}

          {/* Scheduling flags */}
          {result.scheduling_flags?.length > 0 && (
            <div className="space-y-1">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground" onClick={() => toggle('flags')}>
                {expandedSection === 'flags' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Scheduling Flags ({result.scheduling_flags.length})
              </button>
              {expandedSection === 'flags' && (
                <div className="space-y-1 pl-4">
                  {result.scheduling_flags.map((flag, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                      <span className="text-foreground">{flag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Overtime factors */}
          {result.overtime_factors?.length > 0 && (
            <div className="space-y-1">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground" onClick={() => toggle('overtime')}>
                {expandedSection === 'overtime' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Overtime Factors ({result.overtime_factors.length})
              </button>
              {expandedSection === 'overtime' && (
                <div className="space-y-1 pl-4">
                  {result.overtime_factors.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Clock className="h-3 w-3 text-red-400 shrink-0" />
                      <span className="text-foreground">{f}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cast clustering */}
          {result.cast_clustering?.length > 0 && (
            <div className="space-y-1">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground" onClick={() => toggle('cast')}>
                {expandedSection === 'cast' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Cast Clustering ({result.cast_clustering.length})
              </button>
              {expandedSection === 'cast' && (
                <div className="space-y-1 pl-4">
                  {result.cast_clustering.slice(0, 10).map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2 py-1">
                      <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-foreground flex-1">{c.actor}</span>
                      <span className="text-muted-foreground">{c.scene_count} scenes</span>
                      <span className="text-muted-foreground">~{c.hold_days_estimate}d hold</span>
                      {c.consecutive_possible && <Badge className="text-[9px] px-1 py-0 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">blockable</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Location groups */}
          {result.location_groups?.length > 0 && (
            <div className="space-y-1">
              <button className="flex items-center gap-1.5 text-xs text-muted-foreground" onClick={() => toggle('locations')}>
                {expandedSection === 'locations' ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Location Groups ({result.location_groups.length})
              </button>
              {expandedSection === 'locations' && (
                <div className="space-y-1 pl-4">
                  {result.location_groups.slice(0, 15).map((l, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2 py-1">
                      <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-foreground flex-1 truncate">{l.location}</span>
                      <span className="text-muted-foreground">{l.scene_count} sc</span>
                      <span className="text-muted-foreground">{l.total_pages}pg</span>
                      <span className="text-primary font-medium">{l.suggested_days}d</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reasoning */}
          {result.reasoning && (
            <p className="text-xs text-muted-foreground italic mt-1">{result.reasoning}</p>
          )}

          {/* Confidence */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <BarChart3 className="h-3 w-3" />
            Confidence: {Math.round((result.confidence || 0) * 100)}%
          </div>
        </motion.div>
      )}
    </div>
  );
}
