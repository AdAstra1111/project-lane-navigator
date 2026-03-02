import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Zap, RefreshCw, Database } from "lucide-react";
import { ExplorerLayout } from "@/components/explorer/ExplorerLayout";
import { toast } from "sonner";

interface Alignment {
  id: string;
  created_at: string;
  alignment_score: number;
  opportunity_score: number;
  risk_score: number;
  contrarian_score: number;
  lane_fit_scores: any;
  buyer_fit_scores: any;
  format_fit_scores: any;
}

export default function IntelAlignment() {
  const { id: projectId } = useParams<{ id: string }>();
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (projectId) loadAlignment();
  }, [projectId]);

  async function loadAlignment() {
    if (!projectId) return;
    const { data } = await supabase
      .from("project_intel_alignment")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setAlignment(data as any);
  }

  const [embedLoading, setEmbedLoading] = useState(false);

  async function generateProjectVectors() {
    if (!projectId) return;
    setEmbedLoading(true);
    toast.info("Generating project embeddings…");
    try {
      const { data, error } = await supabase.functions.invoke("embed-project-vectors", {
        body: { project_id: projectId, trigger: "manual" },
      });
      if (error) throw error;
      toast.success(`Vectors created: ${data?.created_count || 0}, skipped: ${data?.skipped_count || 0}`);
      // Auto-compute alignment after generating vectors
      await compute();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setEmbedLoading(false);
    }
  }

  async function compute() {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("compute-project-intel-alignment", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      toast.success(`Alignment computed: ${data?.alignment_score ?? 0}`);
      loadAlignment();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  const scoreBar = (label: string, value: number, color: string) => (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );

  return (
    <ExplorerLayout breadcrumbs={[{ label: "Intel", to: "/intel" }, { label: "Alignment" }]}>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" /> Project Intel Alignment
          </h1>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={generateProjectVectors} disabled={embedLoading}>
              <Database className={`h-3.5 w-3.5 mr-1 ${embedLoading ? "animate-spin" : ""}`} />
              {embedLoading ? "Embedding…" : "Generate Vectors"}
            </Button>
            <Button size="sm" onClick={compute} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Computing…" : "Compute Alignment"}
            </Button>
          </div>
        </div>

        {!alignment ? (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                No alignment data yet. Generate project vectors first, then compute alignment.
              </p>
              <div className="flex gap-2 justify-center">
                <Button size="sm" variant="outline" onClick={generateProjectVectors} disabled={embedLoading}>
                  <Database className="h-3.5 w-3.5 mr-1" /> Generate Project Vectors
                </Button>
                <Button size="sm" onClick={compute} disabled={loading}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Compute Alignment
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Alignment", value: alignment.alignment_score, color: "bg-primary" },
                { label: "Opportunity", value: alignment.opportunity_score, color: "bg-emerald-500" },
                { label: "Risk", value: alignment.risk_score, color: "bg-destructive" },
                { label: "Contrarian", value: alignment.contrarian_score, color: "bg-violet-500" },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="py-4 px-4">
                    {scoreBar(s.label, s.value, s.color)}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Lane fit */}
            {alignment.lane_fit_scores && Object.keys(alignment.lane_fit_scores).length > 0 && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs">Lane Fit Scores</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  {Object.entries(alignment.lane_fit_scores).map(([key, val]) => (
                    <div key={key}>{scoreBar(key, val as number, "bg-primary/70")}</div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Buyer fit */}
            {alignment.buyer_fit_scores && Object.keys(alignment.buyer_fit_scores).length > 0 && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-xs">Buyer Fit Scores</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  {Object.entries(alignment.buyer_fit_scores).map(([key, val]) => (
                    <div key={key}>{scoreBar(key, val as number, "bg-emerald-500/70")}</div>
                  ))}
                </CardContent>
              </Card>
            )}

            <p className="text-[10px] text-muted-foreground text-right">
              Advisory only • Computed {new Date(alignment.created_at).toLocaleString()}
            </p>
          </>
        )}
      </div>
    </ExplorerLayout>
  );
}
