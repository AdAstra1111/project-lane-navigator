import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Shield, BarChart3, AlertTriangle, ChevronRight, Zap, Database } from "lucide-react";
import { ExplorerLayout } from "@/components/explorer/ExplorerLayout";
import { toast } from "sonner";
import { useState as useStateHook } from "react";

interface IntelRun {
  id: string;
  created_at: string;
  engine_name: string;
  trigger: string;
  ok: boolean;
  stats: any;
}

interface IntelEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: string;
  payload: any;
  status: string;
}

export default function IntelDashboard() {
  const navigate = useNavigate();
  const [recentRuns, setRecentRuns] = useState<IntelRun[]>([]);
  const [openEvents, setOpenEvents] = useState<IntelEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [runsRes, eventsRes] = await Promise.all([
      supabase.from("intel_runs").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("intel_events").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(20),
    ]);
    setRecentRuns((runsRes.data as any[]) || []);
    setOpenEvents((eventsRes.data as any[]) || []);
    setLoading(false);
  }

  const [backfillLoading, setBackfillLoading] = useStateHook(false);

  async function triggerConvergence() {
    toast.info("Computing convergence alerts…");
    try {
      const { data, error } = await supabase.functions.invoke("compute-convergence-alerts", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      toast.success(`Convergence: ${data?.events_created || 0} events created`);
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
  }

  async function backfillSignalEmbeddings() {
    setBackfillLoading(true);
    toast.info("Backfilling signal embeddings…");
    try {
      const { data, error } = await supabase.functions.invoke("embed-trend-signal-vectors", {
        body: { only_missing: true, limit: 10, trigger: "manual_backfill" },
      });
      if (error) throw error;
      toast.success(`Signals embedded: ${data?.processed || 0}, skipped: ${data?.skipped || 0}`);
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setBackfillLoading(false);
    }
  }

  const severityColor = (s: string) => {
    if (s === "high") return "bg-destructive/20 text-destructive border-destructive/30";
    if (s === "medium") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-muted/20 text-muted-foreground";
  };

  return (
    <ExplorerLayout breadcrumbs={[{ label: "Intel", to: "/intel" }, { label: "Dashboard" }]}>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              Strategic Intel
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Advisory-only intelligence layer — balanced mode</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/intel/policies")}>
              <Shield className="h-3.5 w-3.5 mr-1" /> Policies
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/intel/events")}>
              <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Events
            </Button>
            <Button variant="outline" size="sm" onClick={backfillSignalEmbeddings} disabled={backfillLoading}>
              <Database className="h-3.5 w-3.5 mr-1" /> {backfillLoading ? "Embedding…" : "Backfill Signal Vectors"}
            </Button>
            <Button size="sm" onClick={triggerConvergence}>
              <Activity className="h-3.5 w-3.5 mr-1" /> Run Convergence
            </Button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Recent Runs
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-display font-bold">{recentRuns.length}</p>
              <p className="text-[10px] text-muted-foreground">Last 10 engine invocations</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Open Events
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-display font-bold">{openEvents.length}</p>
              <p className="text-[10px] text-muted-foreground">Unresolved intel events</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-display font-bold">
                {recentRuns.length > 0
                  ? Math.round((recentRuns.filter(r => r.ok).length / recentRuns.length) * 100)
                  : 0}%
              </p>
              <p className="text-[10px] text-muted-foreground">Engine success rate</p>
            </CardContent>
          </Card>
        </div>

        {/* Open events */}
        {openEvents.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs">Open Alerts</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              {openEvents.slice(0, 8).map(evt => (
                <div key={evt.id} className="flex items-center gap-3 text-xs">
                  <Badge variant="outline" className={`text-[9px] ${severityColor(evt.severity)}`}>
                    {evt.severity}
                  </Badge>
                  <span className="text-muted-foreground">{evt.event_type}</span>
                  <span className="font-medium text-foreground truncate flex-1">
                    {evt.payload?.signal_name || evt.payload?.message || "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(evt.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Recent runs */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs">Recent Engine Runs</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No runs yet. Trigger a convergence analysis to start.</p>
            ) : (
              recentRuns.map(run => (
                <div key={run.id} className="flex items-center gap-3 text-xs">
                  <Badge variant={run.ok ? "default" : "destructive"} className="text-[9px]">
                    {run.ok ? "OK" : "FAIL"}
                  </Badge>
                  <span className="font-medium text-foreground">{run.engine_name}</span>
                  <Badge variant="outline" className="text-[9px]">{run.trigger}</Badge>
                  <span className="text-muted-foreground flex-1">{(run as any).scope || "—"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </ExplorerLayout>
  );
}
