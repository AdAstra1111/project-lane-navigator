/**
 * Video Render Jobs Viewer — List + detail with video preview, polling,
 * shot locking, selective regen, and per-shot notes.
 */
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Clapperboard, ChevronDown, ChevronUp, Loader2, AlertCircle, Play, RefreshCw,
  CheckCircle2, XCircle, Lock, Unlock, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import type { VideoRenderJobRow, VideoRenderShotRow } from "@/videoPlans/renderTypes";
import { compilePromptDelta } from "@/videoRender/noteDeltas";
import RoughCutPlayer from "./RoughCutPlayer";

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

  const hasRunning = jobs?.some(j => j.status === "running" || j.status === "claimed");

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["video-render-jobs", projectId, planId] });
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const qc = useQueryClient();

  const { data: jobRow } = useQuery({
    queryKey: ["video-render-job-detail", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_render_jobs")
        .select("plan_id")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data as { plan_id: string };
    },
  });

  const { data: shots, isLoading } = useQuery({
    queryKey: ["video-render-shots", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_render_shots")
        .select("*")
        .eq("job_id", jobId)
        .order("shot_index", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: 10_000,
  });

  const completeCount = shots?.filter(s => s.status === "complete").length || 0;
  const errorCount = shots?.filter(s => s.status === "error").length || 0;
  const totalCount = shots?.length || 0;

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!shots) return;
    if (selected.size === shots.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(shots.map((s: any) => s.id)));
    }
  }, [shots, selected.size]);

  const lockMutation = useMutation({
    mutationFn: async ({ ids, lock }: { ids: string[]; lock: boolean }) => {
      const { error } = await (supabase as any)
        .from("video_render_shots")
        .update({ is_locked: lock, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { lock }) => {
      qc.invalidateQueries({ queryKey: ["video-render-shots", jobId] });
      toast.success(lock ? "Shot(s) locked" : "Shot(s) unlocked");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const regenMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!shots) return { reset: 0, skipped: 0 };
      const unlocked = shots.filter((s: any) => ids.includes(s.id) && !s.is_locked);
      const skipped = ids.length - unlocked.length;
      if (unlocked.length === 0) return { reset: 0, skipped };
      const { error } = await (supabase as any)
        .from("video_render_shots")
        .update({ status: "queued", artifact_json: {}, last_error: null, updated_at: new Date().toISOString() })
        .in("id", unlocked.map((s: any) => s.id));
      if (error) throw error;
      return { reset: unlocked.length, skipped };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["video-render-shots", jobId] });
      if (data && data.reset > 0) toast.success(`${data.reset} shot(s) queued for regen`);
      if (data && data.skipped > 0) toast.info(`${data.skipped} locked shot(s) skipped`);
      if (data && data.reset === 0 && data.skipped > 0) toast.info("All selected shots are locked");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ shotId, notes }: { shotId: string; notes: string }) => {
      const shot = shots?.find((s: any) => s.id === shotId);
      const delta = compilePromptDelta({
        notes,
        shotType: shot?.prompt_json?.shotType,
        cameraMove: shot?.prompt_json?.cameraMove,
      });
      const { error } = await (supabase as any)
        .from("video_render_shots")
        .update({ notes, prompt_delta_json: delta, updated_at: new Date().toISOString() })
        .eq("id", shotId);
      if (error) throw error;
      return delta;
    },
    onSuccess: (delta) => {
      qc.invalidateQueries({ queryKey: ["video-render-shots", jobId] });
      setEditingNote(null);
      if (delta.warnings?.length > 0) {
        toast.info(`Note saved with ${delta.warnings.length} warning(s)`);
      } else {
        toast.success("Note saved");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedArr = Array.from(selected);

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

      {/* Bulk actions */}
      {shots && shots.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={toggleSelectAll}>
            {selected.size === shots.length ? "Deselect All" : "Select All"}
          </Button>
          {selected.size > 0 && (
            <>
              <Button
                variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                disabled={lockMutation.isPending}
                onClick={() => lockMutation.mutate({ ids: selectedArr, lock: true })}
              >
                <Lock className="h-2.5 w-2.5" /> Lock
              </Button>
              <Button
                variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                disabled={lockMutation.isPending}
                onClick={() => lockMutation.mutate({ ids: selectedArr, lock: false })}
              >
                <Unlock className="h-2.5 w-2.5" /> Unlock
              </Button>
              <Button
                variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                disabled={regenMutation.isPending}
                onClick={() => regenMutation.mutate(selectedArr)}
              >
                <RefreshCw className="h-2.5 w-2.5" /> Regen Selected
              </Button>
              <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading shots…</div>
      ) : !shots || shots.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No shots in this job.</div>
      ) : (
        <div className="space-y-1">
          {shots.map((shot: any) => {
            const artifact = shot.artifact_json as any;
            const prompt = shot.prompt_json as any;
            const hasVideo = shot.status === "complete" && artifact?.publicUrl;
            const isLocked = shot.is_locked;
            const deltaWarnings = (shot.prompt_delta_json as any)?.warnings || [];

            return (
              <div key={shot.id} className={`border rounded p-2 text-[10px] ${isLocked ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Checkbox
                    checked={selected.has(shot.id)}
                    onCheckedChange={() => toggleSelect(shot.id)}
                    className="h-3 w-3"
                  />
                  <span className="font-mono font-medium">#{shot.shot_index}</span>
                  {isLocked && <Lock className="h-3 w-3 text-primary" />}
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
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0"
                    onClick={() => {
                      setEditingNote(editingNote === shot.id ? null : shot.id);
                      setNoteText(shot.notes || "");
                    }}
                  >
                    <MessageSquare className="h-3 w-3" />
                  </Button>
                  <span className="text-muted-foreground">{prompt?.shotType || "—"}</span>
                </div>

                {/* Notes editor */}
                {editingNote === shot.id && (
                  <div className="mt-1 mb-1 space-y-1">
                    <textarea
                      className="w-full border border-border rounded px-2 py-1 text-[10px] bg-background resize-none"
                      rows={2}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="e.g. brighter, slower, more handheld…"
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm" className="h-5 text-[9px] px-2"
                        disabled={saveNoteMutation.isPending}
                        onClick={() => saveNoteMutation.mutate({ shotId: shot.id, notes: noteText })}
                      >
                        Save Note
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 text-[9px] px-2" onClick={() => setEditingNote(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Show existing note */}
                {shot.notes && editingNote !== shot.id && (
                  <div className="text-muted-foreground italic mb-1">💬 {shot.notes}</div>
                )}

                {/* Delta warnings */}
                {deltaWarnings.length > 0 && (
                  <div className="mb-1">
                    {deltaWarnings.map((w: string, i: number) => (
                      <div key={i} className="flex items-start gap-1 text-yellow-600 dark:text-yellow-400">
                        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

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

      {/* Rough Cut Player */}
      {jobRow?.plan_id && (
        <div className="mt-3">
          <RoughCutPlayer
            projectId={projectId}
            jobId={jobId}
            planId={jobRow.plan_id}
            allShotsComplete={completeCount > 0 && completeCount === totalCount}
          />
        </div>
      )}
    </div>
  );
}
