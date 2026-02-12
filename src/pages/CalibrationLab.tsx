import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/Header";
import { PageTransition } from "@/components/PageTransition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, CheckCircle2, XCircle, HelpCircle, AlertTriangle } from "lucide-react";

type Classification = "True Positive" | "True Negative" | "False Positive" | "False Negative" | "Inconclusive";

interface CalibrationRow {
  projectId: string;
  title: string;
  internalTier: string;
  internalConfidence: number;
  initialViability: number;
  currentViability: number;
  structuralStrength: number;
  budgetFeasibility: number;
  packagingLeverage: number;
  financed: boolean;
  streamerInterest: boolean;
  optioned: boolean;
  festivalSelection: boolean;
  classification: Classification;
}

function classify(viability: number, hasPositiveOutcome: boolean): Classification {
  const high = viability >= 70;
  const low = viability < 60;
  if (high && hasPositiveOutcome) return "True Positive";
  if (low && !hasPositiveOutcome) return "True Negative";
  if (high && !hasPositiveOutcome) return "False Positive";
  if (low && hasPositiveOutcome) return "False Negative";
  return "Inconclusive";
}

const classColors: Record<Classification, string> = {
  "True Positive": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "True Negative": "bg-muted text-muted-foreground border-border",
  "False Positive": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "False Negative": "bg-red-500/15 text-red-400 border-red-500/30",
  "Inconclusive": "bg-muted text-muted-foreground border-border",
};

const classIcons: Record<Classification, React.ReactNode> = {
  "True Positive": <CheckCircle2 className="h-3.5 w-3.5" />,
  "True Negative": <XCircle className="h-3.5 w-3.5" />,
  "False Positive": <AlertTriangle className="h-3.5 w-3.5" />,
  "False Negative": <ShieldAlert className="h-3.5 w-3.5" />,
  "Inconclusive": <HelpCircle className="h-3.5 w-3.5" />,
};

function useIsParadoxHouseMember() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["paradox-house-member", user?.id],
    queryFn: async () => {
      if (!user) return false;
      // Check if user owns a company named "Paradox House" or is a member of one
      const { data: owned } = await supabase
        .from("production_companies")
        .select("id")
        .eq("user_id", user.id)
        .ilike("name", "%paradox house%");
      if (owned && owned.length > 0) return true;

      const { data: memberships } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", user.id);
      if (!memberships?.length) return false;

      const companyIds = memberships.map((m: any) => m.company_id);
      const { data: companies } = await supabase
        .from("production_companies")
        .select("id")
        .in("id", companyIds)
        .ilike("name", "%paradox house%");
      return (companies && companies.length > 0) || false;
    },
    enabled: !!user,
  });
}

function useCalibrationData() {
  return useQuery({
    queryKey: ["calibration-lab-data"],
    queryFn: async () => {
      const [projectsRes, baselinesRes, outcomesRes] = await Promise.all([
        supabase.from("projects").select("id, title, viability_score, viability_breakdown").order("title"),
        supabase.from("project_baselines").select("*"),
        supabase.from("project_outcomes").select("*"),
      ]);
      return {
        projects: (projectsRes.data || []) as any[],
        baselines: (baselinesRes.data || []) as any[],
        outcomes: (outcomesRes.data || []) as any[],
      };
    },
  });
}

export default function CalibrationLab() {
  const { data: isMember, isLoading: memberLoading } = useIsParadoxHouseMember();
  const { data, isLoading } = useCalibrationData();

  const rows = useMemo<CalibrationRow[]>(() => {
    if (!data) return [];
    const { projects, baselines, outcomes } = data;
    const baselineMap = new Map(baselines.map((b: any) => [b.project_id, b]));
    const outcomeMap = new Map(outcomes.map((o: any) => [o.project_id, o]));

    return projects
      .filter((p: any) => baselineMap.has(p.id))
      .map((p: any) => {
        const bl = baselineMap.get(p.id);
        const oc = outcomeMap.get(p.id);
        const vb = p.viability_breakdown as any;
        const currentViability = p.viability_score ?? 0;
        const hasPositiveOutcome = oc
          ? (oc.financed || oc.streamer_interest || oc.optioned || oc.festival_selection)
          : false;

        return {
          projectId: p.id,
          title: p.title || "Untitled",
          internalTier: bl?.internal_commercial_tier || "–",
          internalConfidence: bl?.internal_confidence ?? 0,
          initialViability: currentViability, // will refine when we track initial separately
          currentViability,
          structuralStrength: vb?.structural_strength ?? 0,
          budgetFeasibility: vb?.budget_feasibility ?? 0,
          packagingLeverage: vb?.packaging_leverage ?? 0,
          financed: oc?.financed ?? false,
          streamerInterest: oc?.streamer_interest ?? false,
          optioned: oc?.optioned ?? false,
          festivalSelection: oc?.festival_selection ?? false,
          classification: classify(currentViability, hasPositiveOutcome),
        };
      });
  }, [data]);

  const counts = useMemo(() => {
    const c = { tp: 0, tn: 0, fp: 0, fn: 0, inc: 0 };
    rows.forEach((r) => {
      if (r.classification === "True Positive") c.tp++;
      else if (r.classification === "True Negative") c.tn++;
      else if (r.classification === "False Positive") c.fp++;
      else if (r.classification === "False Negative") c.fn++;
      else c.inc++;
    });
    return c;
  }, [rows]);

  const correlationPct = useMemo(() => {
    const highViability = rows.filter((r) => r.currentViability >= 70);
    if (highViability.length === 0) return null;
    const withMovement = highViability.filter(
      (r) => r.classification === "True Positive"
    ).length;
    return Math.round((withMovement / highViability.length) * 100);
  }, [rows]);

  if (memberLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-md bg-primary animate-pulse" />
      </div>
    );
  }

  if (!isMember) {
    return (
      <PageTransition>
        <Header />
        <main className="container mx-auto px-4 py-16 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Access Restricted</h1>
          <p className="text-muted-foreground">This page is only available to Paradox House team members.</p>
        </main>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Calibration Lab</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare IFFY viability predictions against real-world outcomes.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "True Positives", count: counts.tp, color: "text-emerald-400" },
            { label: "True Negatives", count: counts.tn, color: "text-muted-foreground" },
            { label: "False Positives", count: counts.fp, color: "text-amber-400" },
            { label: "False Negatives", count: counts.fn, color: "text-red-400" },
            { label: "Inconclusive", count: counts.inc, color: "text-muted-foreground" },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 text-center">
                <div className={`text-3xl font-bold ${s.color}`}>{s.count}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Correlation indicator */}
        {correlationPct !== null && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">
                  High viability projects with positive movement
                </p>
                <Progress value={correlationPct} className="h-2" />
              </div>
              <span className="text-xl font-bold text-foreground">{correlationPct}%</span>
            </CardContent>
          </Card>
        )}

        {/* Data Table */}
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Project Calibration Data</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm p-6 text-center">
                No projects with baselines recorded yet. Add baselines from the project detail page.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-center">Tier</TableHead>
                      <TableHead className="text-center">Conf.</TableHead>
                      <TableHead className="text-center">Viability</TableHead>
                      <TableHead className="text-center">Struct.</TableHead>
                      <TableHead className="text-center">Budget</TableHead>
                      <TableHead className="text-center">Pkg.</TableHead>
                      <TableHead className="text-center">Fin.</TableHead>
                      <TableHead className="text-center">Stream.</TableHead>
                      <TableHead className="text-center">Opt.</TableHead>
                      <TableHead className="text-center">Fest.</TableHead>
                      <TableHead className="text-center">Classification</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.projectId}>
                        <TableCell className="font-medium max-w-[180px] truncate">{r.title}</TableCell>
                        <TableCell className="text-center">{r.internalTier}</TableCell>
                        <TableCell className="text-center">{r.internalConfidence}/10</TableCell>
                        <TableCell className="text-center font-mono">{r.currentViability}</TableCell>
                        <TableCell className="text-center font-mono">{r.structuralStrength}</TableCell>
                        <TableCell className="text-center font-mono">{r.budgetFeasibility}</TableCell>
                        <TableCell className="text-center font-mono">{r.packagingLeverage}</TableCell>
                        <TableCell className="text-center">{r.financed ? "✓" : "–"}</TableCell>
                        <TableCell className="text-center">{r.streamerInterest ? "✓" : "–"}</TableCell>
                        <TableCell className="text-center">{r.optioned ? "✓" : "–"}</TableCell>
                        <TableCell className="text-center">{r.festivalSelection ? "✓" : "–"}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`gap-1 ${classColors[r.classification]}`}>
                            {classIcons[r.classification]}
                            {r.classification}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </PageTransition>
  );
}
