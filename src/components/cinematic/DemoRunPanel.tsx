/**
 * Demo Run Panel — One-button investor demo pipeline.
 * Shows deterministic progress, step status, artifact links, and bundle download.
 */
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Play, RotateCcw, Plus, CheckCircle2, XCircle, Loader2, ExternalLink, Clock,
  Download, Package,
} from "lucide-react";
import { toast } from "sonner";
import {
  stepProgress, STEP_LABELS, DEMO_STEPS,
  type DemoStep, type DemoStatus, type DemoLinks, type DemoLogEntry,
} from "@/videoRender/demoStateMachine";

interface DemoRunPanelProps {
  projectId: string;
  documentId?: string;
  lane?: string;
}

interface DemoRunRow {
  id: string;
  project_id: string;
  document_id: string | null;
  lane: string;
  status: DemoStatus;
  step: DemoStep;
  settings_json: Record<string, unknown>;
  links_json: DemoLinks;
  log_json: DemoLogEntry[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/20 text-primary",
  complete: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-destructive/20 text-destructive",
  canceled: "bg-muted text-muted-foreground line-through",
};

export default function DemoRunPanel({ projectId, documentId, lane = "feature_film" }: DemoRunPanelProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const qc = useQueryClient();

  // Fetch recent demo runs
  const { data: runs } = useQuery({
    queryKey: ["demo-runs", projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("demo_runs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as DemoRunRow[];
    },
    enabled: !!projectId,
  });

  // Auto-select most recent run
  useEffect(() => {
    if (runs && runs.length > 0 && !activeRunId) {
      setActiveRunId(runs[0].id);
    }
  }, [runs, activeRunId]);

  const activeRun = runs?.find(r => r.id === activeRunId);

  // Poll active run if running
  const isRunning = activeRun?.status === "running";
  useEffect(() => {
    if (!isRunning || !activeRunId) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["demo-runs", projectId] });
      // Auto-advance
      supabase.functions.invoke("run-demo-pipeline", {
        body: { project_id: projectId, action: "advance", demo_run_id: activeRunId },
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [isRunning, activeRunId, projectId, qc]);

  // Create new demo run
  const createRun = useMutation({
    mutationFn: async (forceNew: boolean) => {
      const { data, error } = await supabase.functions.invoke("run-demo-pipeline", {
        body: {
          project_id: projectId,
          document_id: documentId || null,
          settings_json: { lane },
          force_new: forceNew,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      setActiveRunId(data.demo_run_id);
      qc.invalidateQueries({ queryKey: ["demo-runs", projectId] });
      toast.success(data.reused ? "Resuming existing demo run" : "Demo pipeline started");
    },
    onError: (e: any) => toast.error("Failed to start demo: " + e.message),
  });

  const progress = activeRun ? stepProgress(activeRun.step, activeRun.status) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Play className="h-4 w-4" /> Demo Pipeline
            {isRunning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={createRun.isPending || isRunning}
              onClick={() => createRun.mutate(false)}
            >
              {createRun.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run Full Demo
            </Button>
            {activeRun?.status === "complete" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                disabled={createRun.isPending}
                onClick={() => createRun.mutate(false)}
              >
                <RotateCcw className="h-3 w-3" /> Replay
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1"
              disabled={createRun.isPending}
              onClick={() => createRun.mutate(true)}
            >
              <Plus className="h-3 w-3" /> New
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!activeRun ? (
          <p className="text-sm text-muted-foreground">
            No demo runs yet. Click "Run Full Demo" to start the pipeline.
          </p>
        ) : (
          <>
            {/* Status + progress */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[activeRun.status] || ""}`}>
                  {activeRun.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Step: <span className="font-medium">{STEP_LABELS[activeRun.step] || activeRun.step}</span>
                </span>
                <span className="text-xs font-mono text-muted-foreground ml-auto">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>

            {/* Error */}
            {activeRun.last_error && (
              <div className="text-xs text-destructive flex items-start gap-1">
                <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{activeRun.last_error}</span>
              </div>
            )}

            {/* Step indicators */}
            <div className="flex gap-1 flex-wrap">
              {DEMO_STEPS.filter(s => s !== "complete").map((step) => {
                const stepIdx = DEMO_STEPS.indexOf(step);
                const currentIdx = DEMO_STEPS.indexOf(activeRun.step);
                const isDone = stepIdx < currentIdx || activeRun.status === "complete";
                const isCurrent = step === activeRun.step && activeRun.status === "running";
                const isError = step === activeRun.step && activeRun.status === "error";

                return (
                  <div
                    key={step}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border ${
                      isDone ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400" :
                      isCurrent ? "border-primary/40 bg-primary/10 text-primary" :
                      isError ? "border-destructive/40 bg-destructive/10 text-destructive" :
                      "border-border text-muted-foreground"
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                     isCurrent ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
                     isError ? <XCircle className="h-2.5 w-2.5" /> :
                     <Clock className="h-2.5 w-2.5" />}
                    {STEP_LABELS[step]}
                  </div>
                );
              })}
            </div>

            {/* Artifact links */}
            <ArtifactLinks links={activeRun.links_json} projectId={projectId} />

            {/* Demo Bundle Download */}
            {activeRun.status === "complete" && (
              <DemoBundleSection projectId={projectId} demoRunId={activeRun.id} />
            )}

            {/* Log */}
            {activeRun.log_json && activeRun.log_json.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground font-medium">Pipeline Log</p>
                <div className="max-h-32 overflow-auto text-[10px] font-mono bg-muted/30 rounded border border-border p-2 space-y-0.5">
                  {(activeRun.log_json as DemoLogEntry[]).map((entry, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {new Date(entry.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="text-primary">[{entry.step}]</span>
                      <span>{entry.action}</span>
                      {entry.detail && <span className="text-muted-foreground">— {entry.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Run selector */}
            {runs && runs.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground">Runs:</span>
                {runs.slice(0, 5).map((r) => (
                  <Button
                    key={r.id}
                    variant={r.id === activeRunId ? "default" : "ghost"}
                    size="sm"
                    className="h-5 text-[9px] px-1.5"
                    onClick={() => setActiveRunId(r.id)}
                  >
                    {r.status === "complete" ? "✓" : r.status === "error" ? "✗" : "…"}{" "}
                    {new Date(r.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactLinks({ links, projectId }: { links: DemoLinks; projectId: string }) {
  if (!links || Object.keys(links).length === 0) return null;

  const items: Array<{ label: string; id?: string }> = [
    { label: "Quality Run", id: links.quality_run_id },
    { label: "Video Plan", id: links.plan_id },
    { label: "Render Job", id: links.job_id },
    { label: "Rough Cut", id: links.rough_cut_id },
    { label: "Render QA", id: links.render_quality_run_id },
  ].filter(i => i.id);

  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground font-medium">Artifacts</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge
            key={item.label}
            variant="outline"
            className="text-[10px] px-1.5 py-0 gap-1 cursor-pointer hover:bg-muted/50"
          >
            <ExternalLink className="h-2.5 w-2.5" />
            {item.label}
            <span className="font-mono text-muted-foreground">{item.id?.slice(0, 6)}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function DemoBundleSection({ projectId, demoRunId }: { projectId: string; demoRunId: string }) {
  const [loading, setLoading] = useState(false);

  // Fetch existing bundles for this run
  const { data: bundles } = useQuery({
    queryKey: ["demo-bundles", demoRunId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("demo_bundles")
        .select("*")
        .eq("demo_run_id", demoRunId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-demo-bundle", {
        body: { project_id: projectId, demo_run_id: demoRunId },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
        toast.success(data.reused ? "Bundle ready (cached)" : "Demo bundle generated");
      }
    } catch (e: any) {
      toast.error("Bundle export failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
          <Package className="h-3 w-3" /> Demo Bundle
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1"
          disabled={loading}
          onClick={handleDownload}
        >
          {loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Download className="h-2.5 w-2.5" />}
          Download ZIP
        </Button>
      </div>
      {bundles && bundles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bundles.map((b: any) => (
            <Badge
              key={b.id}
              variant="outline"
              className="text-[9px] px-1.5 py-0 gap-1 cursor-pointer hover:bg-muted/50"
              onClick={async () => {
                const { data } = await supabase.storage.from("exports").createSignedUrl(b.storage_path, 3600);
                if (data?.signedUrl) window.open(data.signedUrl, "_blank");
              }}
            >
              <Download className="h-2 w-2" />
              {b.bundle_id.slice(0, 6)}
              <span className="text-muted-foreground">
                {new Date(b.created_at).toLocaleDateString()}
              </span>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
