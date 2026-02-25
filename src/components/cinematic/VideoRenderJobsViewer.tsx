/**
 * Video Render Jobs Viewer — Minimal list + detail for render jobs.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clapperboard, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { VideoRenderJobRow, VideoRenderShotRow } from "@/videoPlans/renderTypes";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  claimed: "bg-primary/20 text-primary",
  running: "bg-primary/30 text-primary",
  complete: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-destructive/20 text-destructive",
  canceled: "bg-muted text-muted-foreground line-through",
};

interface VideoRenderJobsViewerProps {
  projectId: string;
  planId?: string;
}

export default function VideoRenderJobsViewer({ projectId, planId }: VideoRenderJobsViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["video-render-jobs", projectId, planId],
    queryFn: async () => {
      let query = (supabase as any)
        .from("video_render_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (planId) query = query.eq("plan_id", planId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as VideoRenderJobRow[];
    },
    enabled: !!projectId,
  });

  const createJob = useMutation({
    mutationFn: async (targetPlanId: string) => {
      const { data, error } = await supabase.functions.invoke("create-video-render-job", {
        body: { plan_id: targetPlanId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["video-render-jobs", projectId] });
      toast.success("Render job created");
    },
    onError: (e: any) => toast.error("Failed to create render job: " + e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Clapperboard className="h-4 w-4" /> Render Jobs
          </CardTitle>
          {planId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={createJob.isPending}
              onClick={() => createJob.mutate(planId)}
            >
              {createJob.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Create Render Job
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading jobs…</div>
        ) : !jobs || jobs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No render jobs yet.{planId ? " Create one from this plan." : ""}
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="divide-y divide-border">
              {jobs.map((job) => (
                <div key={job.id}>
                  <button
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left text-xs"
                    onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                  >
                    <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[job.status] || ""}`}>
                      {job.status}
                    </Badge>
                    <span className="font-mono">attempt {job.attempt_count}</span>
                    {job.last_error && (
                      <AlertCircle className="h-3 w-3 text-destructive" />
                    )}
                    <span className="flex-1" />
                    <span className="text-muted-foreground">
                      {new Date(job.created_at).toLocaleString(undefined, {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {expandedId === job.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {expandedId === job.id && <RenderJobDetail jobId={job.id} lastError={job.last_error} />}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function RenderJobDetail({ jobId, lastError }: { jobId: string; lastError: string | null }) {
  const { data: shots, isLoading } = useQuery({
    queryKey: ["video-render-shots", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_render_shots")
        .select("*")
        .eq("job_id", jobId)
        .order("shot_index", { ascending: true });
      if (error) throw error;
      return (data || []) as VideoRenderShotRow[];
    },
  });

  return (
    <div className="px-4 pb-4 space-y-2 border-t border-border/50 bg-muted/10">
      {lastError && (
        <div className="text-[10px] text-destructive pt-2">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          {lastError}
        </div>
      )}
      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading shots…</div>
      ) : !shots || shots.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No shots in this job.</div>
      ) : (
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-[10px] border border-border rounded">
            <thead>
              <tr className="bg-muted">
                <th className="px-2 py-1 text-left font-medium">#</th>
                <th className="px-2 py-1 text-left font-medium">Status</th>
                <th className="px-2 py-1 text-left font-medium">Attempts</th>
                <th className="px-2 py-1 text-left font-medium">Type</th>
                <th className="px-2 py-1 text-left font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shots.map((shot) => (
                <tr key={shot.id} className="hover:bg-muted/30">
                  <td className="px-2 py-0.5 font-mono">{shot.shot_index}</td>
                  <td className="px-2 py-0.5">
                    <Badge className={`text-[10px] px-1 py-0 ${STATUS_COLORS[shot.status] || ""}`}>
                      {shot.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-0.5 font-mono">{shot.attempt_count}</td>
                  <td className="px-2 py-0.5">{(shot.prompt_json as any)?.shotType || "—"}</td>
                  <td className="px-2 py-0.5 max-w-[200px] truncate text-destructive">
                    {shot.last_error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
