import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, Target } from "lucide-react";

interface OutcomeDelta {
  id: string;
  project_id: string;
  initial_structural_score: number | null;
  initial_commercial_score: number | null;
  initial_finance_confidence: string | null;
  initial_greenlight_verdict: string | null;
  budget_achieved: boolean | null;
  talent_attached: boolean | null;
  presales_secured: boolean | null;
  financed: boolean | null;
  festival_selection: boolean | null;
  streamer_interest: boolean | null;
  distribution_offer: boolean | null;
  recoup_achieved: boolean | null;
  finance_prediction_correct: boolean | null;
  greenlight_prediction_correct: boolean | null;
  predicted_to_actual_gap_score: number | null;
  notes: any;
  computed_at: string;
}

function useOutcomeAccuracy() {
  return useQuery({
    queryKey: ["outcome-accuracy"],
    queryFn: async () => {
      const [deltasRes, projectsRes, summaryRes] = await Promise.all([
        supabase.from("outcome_deltas").select("*").order("computed_at", { ascending: false }),
        supabase.from("projects").select("id, title, format, genres, budget_range"),
        supabase.from("outcome_accuracy_summary").select("*").single(),
      ]);
      return {
        deltas: (deltasRes.data || []) as OutcomeDelta[],
        projects: (projectsRes.data || []) as any[],
        summary: summaryRes.data as { total: number; finance_accuracy: number; greenlight_accuracy: number; avg_gap_score: number } | null,
      };
    },
  });
}

export function OutcomeAccuracyPanel() {
  const { data, isLoading } = useOutcomeAccuracy();
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [genreFilter, setGenreFilter] = useState<string>("all");

  const projectMap = useMemo(() => {
    const m = new Map<string, any>();
    (data?.projects || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [data?.projects]);

  const filteredDeltas = useMemo(() => {
    if (!data?.deltas) return [];
    return data.deltas.filter((d) => {
      const p = projectMap.get(d.project_id);
      if (!p) return false;
      if (formatFilter !== "all" && p.format !== formatFilter) return false;
      if (genreFilter !== "all") {
        const genres = p.genres || [];
        if (!genres.some((g: string) => g.toLowerCase().includes(genreFilter.toLowerCase()))) return false;
      }
      return true;
    });
  }, [data?.deltas, projectMap, formatFilter, genreFilter]);

  const financeAcc = useMemo(() => {
    if (filteredDeltas.length === 0) return null;
    const correct = filteredDeltas.filter((d) => d.finance_prediction_correct).length;
    return Math.round((correct / filteredDeltas.length) * 100);
  }, [filteredDeltas]);

  const greenlightAcc = useMemo(() => {
    if (filteredDeltas.length === 0) return null;
    const correct = filteredDeltas.filter((d) => d.greenlight_prediction_correct).length;
    return Math.round((correct / filteredDeltas.length) * 100);
  }, [filteredDeltas]);

  const biggestMisses = useMemo(() => {
    return filteredDeltas
      .filter((d) => !d.finance_prediction_correct || !d.greenlight_prediction_correct)
      .sort((a, b) => (b.predicted_to_actual_gap_score || 0) - (a.predicted_to_actual_gap_score || 0))
      .slice(0, 5);
  }, [filteredDeltas]);

  const formats = useMemo(() => {
    const set = new Set<string>();
    data?.projects?.forEach((p) => { if (p.format) set.add(p.format); });
    return Array.from(set).sort();
  }, [data?.projects]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    data?.projects?.forEach((p) => {
      (p.genres || []).forEach((g: string) => set.add(g));
    });
    return Array.from(set).sort();
  }, [data?.projects]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><div className="h-6 w-6 rounded-md bg-primary animate-pulse" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Outcome Accuracy
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Predicted vs actual outcomes across {filteredDeltas.length} project(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={formatFilter} onValueChange={setFormatFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Formats</SelectItem>
              {formats.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={genreFilter} onValueChange={setGenreFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Genre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              {genres.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Accuracy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Finance Prediction Accuracy</div>
            <div className="flex items-center gap-3">
              <span className={`text-2xl font-bold ${financeAcc !== null && financeAcc >= 65 ? "text-emerald-400" : "text-amber-400"}`}>
                {financeAcc !== null ? `${financeAcc}%` : "—"}
              </span>
              {financeAcc !== null && (
                <Progress value={financeAcc} className="flex-1 h-2" />
              )}
            </div>
            {financeAcc !== null && financeAcc < 65 && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Below 65% threshold
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Greenlight Prediction Accuracy</div>
            <div className="flex items-center gap-3">
              <span className={`text-2xl font-bold ${greenlightAcc !== null && greenlightAcc >= 65 ? "text-emerald-400" : "text-amber-400"}`}>
                {greenlightAcc !== null ? `${greenlightAcc}%` : "—"}
              </span>
              {greenlightAcc !== null && (
                <Progress value={greenlightAcc} className="flex-1 h-2" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Avg Gap Score</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-foreground">
                {data?.summary?.avg_gap_score != null ? Number(data.summary.avg_gap_score).toFixed(1) : "—"}
              </span>
              <span className="text-xs text-muted-foreground">/ 100 (lower = better)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Biggest Misses */}
      {biggestMisses.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Biggest Prediction Misses
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-center">Greenlight</TableHead>
                  <TableHead className="text-center">Finance</TableHead>
                  <TableHead className="text-center">Actual</TableHead>
                  <TableHead className="text-center">Gap</TableHead>
                  <TableHead className="text-center">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {biggestMisses.map((d) => {
                  const project = projectMap.get(d.project_id);
                  const predictedGreen = d.notes?.predicted_green;
                  const actualSuccess = d.notes?.actual_success;
                  const missType = predictedGreen && !actualSuccess
                    ? "Over-optimistic"
                    : !predictedGreen && actualSuccess
                      ? "Under-estimated"
                      : "Mixed";

                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium max-w-[180px] truncate">
                        {project?.title || "Unknown"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-xs ${predictedGreen ? "text-emerald-400 border-emerald-500/30" : "text-red-400 border-red-500/30"}`}>
                          {d.initial_greenlight_verdict || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {d.initial_finance_confidence || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {actualSuccess ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {d.predicted_to_actual_gap_score?.toFixed(0) || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-xs ${missType === "Over-optimistic" ? "text-amber-400 border-amber-500/30" : missType === "Under-estimated" ? "text-blue-400 border-blue-500/30" : "text-muted-foreground"}`}>
                          {missType === "Over-optimistic" ? <TrendingDown className="h-3 w-3 mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
                          {missType}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Deltas */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All Outcome Comparisons</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredDeltas.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">
              No outcome deltas computed yet. Record outcomes on projects to populate this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-center">Struct.</TableHead>
                    <TableHead className="text-center">Comm.</TableHead>
                    <TableHead className="text-center">Finance ✓</TableHead>
                    <TableHead className="text-center">Green ✓</TableHead>
                    <TableHead className="text-center">Gap</TableHead>
                    <TableHead className="text-center">Computed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeltas.map((d) => {
                    const project = projectMap.get(d.project_id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium max-w-[180px] truncate">
                          {project?.title || "Unknown"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {d.initial_structural_score?.toFixed(0) ?? "—"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {d.initial_commercial_score?.toFixed(0) ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {d.finance_prediction_correct ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {d.greenlight_prediction_correct ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">
                          {d.predicted_to_actual_gap_score?.toFixed(0) ?? "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {new Date(d.computed_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
