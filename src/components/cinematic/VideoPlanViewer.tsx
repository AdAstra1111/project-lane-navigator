/**
 * Video Plan Viewer — List + detail view for video generation plans.
 * Includes shot table, continuity warnings, export, and "Generate Plan" CTA.
 */
import { useState } from "react";
import VideoRenderJobsViewer from "./VideoRenderJobsViewer";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2, XCircle, Download, ChevronDown, ChevronUp, AlertTriangle, Video, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { VideoGenerationPlanV1, VideoGenerationPlanRow, ContinuityWarning } from "@/videoPlans/types";
import { buildVideoGenerationPlan, type BuildPlanInput } from "@/videoPlans/planBuilder";

/* ── Generate Plan Hook ── */

function useGeneratePlan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BuildPlanInput) => {
      const plan = buildVideoGenerationPlan(input);
      const { error } = await (supabase as any)
        .from("video_generation_plans")
        .insert({
          project_id: projectId,
          document_id: input.documentId || null,
          quality_run_id: input.qualityRunId || null,
          lane: input.lane,
          plan_json: plan,
          continuity_report_json: plan.continuity,
        });
      if (error) throw error;
      return plan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["video-plans", projectId] });
      toast.success("Video plan generated");
    },
    onError: (e: any) => toast.error("Plan generation failed: " + e.message),
  });
}

/* ── Export Helper ── */

function downloadJson(plan: VideoGenerationPlanV1, filename: string) {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Main Component ── */

interface VideoPlanViewerProps {
  projectId: string;
  /** If provided, shows a "Generate Plan" CTA using these units */
  qualityRunUnits?: { intent: string; energy: number; id?: string }[];
  qualityRunId?: string;
  lane?: string;
}

export default function VideoPlanViewer({ projectId, qualityRunUnits, qualityRunId, lane }: VideoPlanViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const generatePlan = useGeneratePlan(projectId);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["video-plans", projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_generation_plans")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as VideoGenerationPlanRow[];
    },
    enabled: !!projectId,
  });

  const handleGenerate = () => {
    if (!qualityRunUnits || qualityRunUnits.length === 0) return;
    generatePlan.mutate({
      projectId,
      qualityRunId,
      lane: lane || "unknown",
      units: qualityRunUnits,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Video className="h-4 w-4" /> Video Generation Plans
          </CardTitle>
          {qualityRunUnits && qualityRunUnits.length > 0 && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generatePlan.isPending}
              className="h-7 text-xs"
            >
              {generatePlan.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Generate Video Plan
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading plans…</div>
        ) : !plans || plans.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No video plans yet. Generate one from a passed quality run.
          </div>
        ) : (
          <ScrollArea className="max-h-[500px]">
            <div className="divide-y divide-border">
              {plans.map((row) => {
                const plan = row.plan_json as VideoGenerationPlanV1;
                const warnCount = (row.continuity_report_json as any)?.warnings?.length || 0;
                return (
                  <div key={row.id}>
                    <button
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left text-xs"
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{row.lane}</Badge>
                      <span className="font-mono">{plan.pacing?.totalShots || "?"} shots</span>
                      {warnCount > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {warnCount} warn{warnCount > 1 ? "s" : ""}
                        </Badge>
                      )}
                      <span className="flex-1" />
                      <span className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                      {expandedId === row.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>

                    {expandedId === row.id && (
                      <div className="space-y-3">
                        <PlanDetail plan={plan} />
                        <div className="px-4 pb-4">
                          <VideoRenderJobsViewer projectId={projectId} planId={row.id} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Plan Detail ── */

function PlanDetail({ plan }: { plan: VideoGenerationPlanV1 }) {
  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border/50 bg-muted/10">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 pt-3 text-xs">
        <div>
          <span className="text-muted-foreground">Total shots: </span>
          <span className="font-mono font-medium">{plan.pacing.totalShots}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Avg duration: </span>
          <span className="font-mono">{plan.pacing.avgShotLengthSec.toFixed(1)}s</span>
        </div>
        <div>
          <span className="text-muted-foreground">Units: </span>
          <span className="font-mono">{plan.units.length}</span>
        </div>
      </div>

      {/* Energy curve sparkline */}
      {plan.pacing.energyCurve.length >= 2 && (
        <div className="rounded-md border border-border bg-background p-2">
          <p className="text-[10px] text-muted-foreground mb-1">Energy Curve</p>
          <EnergyCurveSvg curve={plan.pacing.energyCurve} />
        </div>
      )}

      {/* Shot table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border border-border rounded">
          <thead>
            <tr className="bg-muted">
              <th className="px-2 py-1 text-left font-medium">#</th>
              <th className="px-2 py-1 text-left font-medium">Unit</th>
              <th className="px-2 py-1 text-left font-medium">Type</th>
              <th className="px-2 py-1 text-left font-medium">Move</th>
              <th className="px-2 py-1 text-right font-medium">Lens</th>
              <th className="px-2 py-1 text-right font-medium">Dur</th>
              <th className="px-2 py-1 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plan.shotPlan.map((shot) => (
              <tr key={shot.shotIndex} className="hover:bg-muted/30">
                <td className="px-2 py-0.5 font-mono">{shot.shotIndex}</td>
                <td className="px-2 py-0.5 font-mono">{shot.unitIndex}</td>
                <td className="px-2 py-0.5">{shot.shotType}</td>
                <td className="px-2 py-0.5">{shot.cameraMove}</td>
                <td className="px-2 py-0.5 text-right font-mono">{shot.lensMm}mm</td>
                <td className="px-2 py-0.5 text-right font-mono">{shot.durationSec}s</td>
                <td className="px-2 py-0.5 max-w-[200px] truncate">{shot.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Continuity warnings */}
      {plan.continuity.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
            Continuity Warnings ({plan.continuity.warnings.length})
          </p>
          {plan.continuity.warnings.map((w, i) => (
            <div key={i} className="text-[10px] text-muted-foreground pl-4">
              <Badge variant={w.severity === "warn" ? "destructive" : "outline"} className="text-[10px] px-1 py-0 mr-1">
                {w.rule}
              </Badge>
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Continuity rules */}
      <div className="flex flex-wrap gap-1">
        {plan.continuity.rules.map((r) => (
          <div key={r.rule} className="flex items-center gap-0.5 text-[10px]">
            {r.passed ? (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            ) : (
              <XCircle className="h-3 w-3 text-destructive" />
            )}
            <span>{r.rule}</span>
          </div>
        ))}
      </div>

      {/* Export */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => downloadJson(plan, `video-plan-${plan.metadata.lane}-${Date.now()}.json`)}
      >
        <Download className="h-3 w-3 mr-1" /> Export JSON
      </Button>
    </div>
  );
}

/* ── Energy Curve SVG ── */

function EnergyCurveSvg({ curve }: { curve: number[] }) {
  const w = 280;
  const h = 32;
  const pad = 2;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;

  const points = curve.map((v, i) => ({
    x: pad + (i / Math.max(curve.length - 1, 1)) * (w - pad * 2),
    y: h - pad - ((v - min) / range) * (h - pad * 2),
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="hsl(var(--primary))" />
      ))}
    </svg>
  );
}

/* ── Generate Plan CTA (standalone, for use in quality run detail) ── */

export function GenerateVideoPlanButton({
  projectId,
  qualityRunId,
  lane,
  units,
}: {
  projectId: string;
  qualityRunId: string;
  lane: string;
  units: { intent: string; energy: number }[];
}) {
  const generatePlan = useGeneratePlan(projectId);

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      disabled={generatePlan.isPending || units.length === 0}
      onClick={() =>
        generatePlan.mutate({ projectId, qualityRunId, lane, units })
      }
    >
      {generatePlan.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Video className="h-3 w-3 mr-1" />}
      Generate Video Plan
    </Button>
  );
}
