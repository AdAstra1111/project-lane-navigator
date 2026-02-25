/**
 * Video Render Jobs Viewer — List + detail with video preview and polling.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clapperboard, ChevronDown, ChevronUp, Loader2, AlertCircle, Play, RefreshCw,
  CheckCircle2, XCircle,
} from "lucide-react";
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

  // Auto-poll running jobs every 10s
  const hasRunning = jobs?.some(j => j.status === "running" || j.status === "claimed");

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["video-render-jobs", projectId, planId] });
      // Also trigger poll action
      supabase.functions.invoke("process-video-render-job", {
        body: { project_id: projectId, action: "poll" },
      }).catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [hasRunning, projectId, planId, qc]);

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

  const processJob = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("process-video-render-job", {
        body: { project_id: projectId, action: "submit" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["video-render-jobs", projectId] });
      if (data?.submitted > 0) {
        toast.success(`Submitted ${data.submitted} shot(s) for rendering`);
      } else if (data?.message === "No queued jobs") {
        toast.info("No queued jobs to process");
      }
    },
    onError: (e: any) => toast.error("Processing failed: " + e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Clapperboard className="h-4 w-4" /> Render Jobs
            {hasRunning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {jobs && jobs.some(j => j.status === "queued") && (
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={processJob.isPending}
                onClick={() => processJob.mutate()}
              >
                {processJob.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Start Render
              </Button>
            )}
            {planId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={createJob.isPending}
                onClick={() => createJob.mutate(planId)}
              >
                {createJob.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Create Job
              </Button>
            )}
          </div>
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
          <ScrollArea className="max-h-[500px]">
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
                    <span className="font-mono">×{job.attempt_count}</span>
                    {job.last_error && <AlertCircle className="h-3 w-3 text-destructive" />}
                    <span className="flex-1" />
                    <span className="text-muted-foreground">
                      {new Date(job.created_at).toLocaleString(undefined, {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {expandedId === job.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {expandedId === job.id && (
                    <RenderJobDetail jobId={job.id} lastError={job.last_error} projectId={projectId} />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function RenderJobDetail({ jobId, lastError, projectId }: { jobId: string; lastError: string | null; projectId: string }) {
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
    refetchInterval: 10_000, // poll while viewing
  });

  const completeCount = shots?.filter(s => s.status === "complete").length || 0;
  const errorCount = shots?.filter(s => s.status === "error").length || 0;
  const totalCount = shots?.length || 0;

  return (
    <div className="px-4 pb-4 space-y-2 border-t border-border/50 bg-muted/10">
      {/* Job summary */}
      <div className="flex items-center gap-4 pt-2 text-[10px]">
        <span className="text-muted-foreground">
          Total: <span className="font-mono font-medium">{totalCount}</span>
        </span>
        {completeCount > 0 && (
          <span className="flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="font-mono">{completeCount}</span>
          </span>
        )}
        {errorCount > 0 && (
          <span className="flex items-center gap-0.5">
            <XCircle className="h-3 w-3 text-destructive" />
            <span className="font-mono">{errorCount}</span>
          </span>
        )}
      </div>

      {lastError && (
        <div className="text-[10px] text-destructive">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          {lastError}
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading shots…</div>
      ) : !shots || shots.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No shots in this job.</div>
      ) : (
        <div className="space-y-1">
          {shots.map((shot) => {
            const artifact = shot.artifact_json as any;
            const prompt = shot.prompt_json as any;
            const hasVideo = shot.status === "complete" && artifact?.publicUrl;

            return (
              <div key={shot.id} className="border border-border rounded p-2 text-[10px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-medium">#{shot.shot_index}</span>
                  <Badge className={`text-[10px] px-1 py-0 ${STATUS_COLORS[shot.status] || ""}`}>
                    {shot.status}
                  </Badge>
                  <span className="font-mono text-muted-foreground">×{shot.attempt_count}</span>
                  {prompt?.providerJobId && (
                    <span className="text-muted-foreground truncate max-w-[120px]" title={prompt.providerJobId}>
                      {prompt.providerJobId.split("/").pop()?.slice(0, 12)}…
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-muted-foreground">{prompt?.shotType || "—"}</span>
                </div>

                {shot.last_error && (
                  <div className="text-destructive truncate mb-1">{shot.last_error}</div>
                )}

                {hasVideo && (
                  <video
                    src={artifact.publicUrl}
                    controls
                    preload="metadata"
                    className="w-full max-w-[320px] rounded border border-border mt-1"
                    style={{ maxHeight: "180px" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
