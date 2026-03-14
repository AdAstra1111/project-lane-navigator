// ── Execution Recommendations Section ────────────────────────────────────────
// Read-only deterministic recommendation surface derived from persisted execution
// snapshots. No execution-path changes. No mutation.

function ExecutionRecommendationsSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PatchExecutionRecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchPatchExecutionRecommendations(projectId, { limit: 100 });
      if (res?.ok) setData(res);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  const recs = data?.recommendations;
  const summary = recs?.summary;

  const sevColor = (s: ExecutionRecommendation["severity"]) =>
    s === "high" ? "text-red-400 border-red-500/30" :
    s === "medium" ? "text-amber-400 border-amber-500/30" :
    "text-muted-foreground border-border/50";

  const sevDot = (s: ExecutionRecommendation["severity"]) =>
    s === "high" ? "bg-red-400" : s === "medium" ? "bg-amber-400" : "bg-muted-foreground";

  const RecCard = ({ rec }: { rec: ExecutionRecommendation }) => (
    <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-1">
      <div className="flex items-start gap-2">
        <div className={cn("mt-1 h-1.5 w-1.5 rounded-full shrink-0", sevDot(rec.severity))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-semibold text-foreground">{rec.title}</span>
            <Badge variant="outline" className={cn("text-[8px] font-mono shrink-0", sevColor(rec.severity))}>
              {rec.severity}
            </Badge>
            <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground/70 border-border/30 shrink-0">
              {rec.confidence} confidence
            </Badge>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">{rec.rationale}</p>
          {/* Evidence chips */}
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(rec.evidence).slice(0, 5).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-0.5 text-[8px] font-mono bg-muted/50 border border-border/30 rounded px-1 py-0.5 text-muted-foreground">
                {k}: <span className="text-foreground">{String(v)}</span>
              </span>
            ))}
          </div>
          {/* Suggested action */}
          <div className="mt-1 text-[9px] text-muted-foreground border-l-2 border-border/40 pl-1.5">
            <span className="font-semibold text-foreground/80">Action:</span> {rec.suggested_action}
          </div>
        </div>
      </div>
    </div>
  );

  const Bucket = ({ title, icon: Icon, items }: { title: string; icon: any; items: ExecutionRecommendation[] }) => {
    if (!items || items.length === 0) return null;
    return (
      <Collapsible defaultOpen={items.some(r => r.severity === "high")}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
            <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
            <Icon className="h-3 w-3" />
            <span className="font-semibold">{title}</span>
            <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground border-border/40 ml-1">{items.length}</Badge>
            {items.some(r => r.severity === "high") && (
              <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/30 ml-0.5">HIGH</Badge>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 pt-1.5 pl-4">
          {items.map(rec => <RecCard key={rec.recommendation_id} rec={rec} />)}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronRight className="h-3 w-3 [[data-state=open]>&]:hidden" />
          <ChevronDown className="h-3 w-3 hidden [[data-state=open]>&]:block" />
          <Lightbulb className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wider">Execution Recommendations</span>
          {summary && (
            <div className="flex items-center gap-1 ml-1">
              {summary.high_severity_count > 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/30">
                  {summary.high_severity_count} high
                </Badge>
              )}
              {summary.medium_severity_count > 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/30">
                  {summary.medium_severity_count} medium
                </Badge>
              )}
              {summary.generated_recommendations === 0 && (
                <Badge variant="outline" className="text-[8px] font-mono text-emerald-400 border-emerald-500/30">
                  healthy
                </Badge>
              )}
            </div>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {!loaded && (
          <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={load} disabled={loading}>
            {loading ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Lightbulb className="h-3 w-3 mr-1" />}
            {loading ? 'Analysing…' : 'Load Recommendations'}
          </Button>
        )}

        {loaded && !recs && (
          <div className="text-[10px] text-muted-foreground italic">No recommendation data available.</div>
        )}

        {recs && (
          <div className="space-y-3">
            {/* Summary row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] text-muted-foreground font-mono">{summary?.total_snapshots} snapshots analysed</span>
              {summary?.generated_recommendations === 0 ? (
                <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">
                  No recommendations — all metrics within thresholds
                </Badge>
              ) : (
                <>
                  {summary?.high_severity_count > 0 && <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">{summary.high_severity_count} high</Badge>}
                  {summary?.medium_severity_count > 0 && <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-500/30">{summary.medium_severity_count} medium</Badge>}
                  {summary?.low_severity_count > 0 && <Badge variant="outline" className="text-[9px] text-muted-foreground border-border/50">{summary.low_severity_count} low</Badge>}
                </>
              )}
            </div>

            {/* Top priorities */}
            <Bucket title="Top Priorities" icon={Lightbulb} items={recs.top_priorities} />

            {/* Blocker mitigations */}
            <Bucket title="Blocker Mitigations" icon={XCircle} items={recs.blocker_mitigations} />

            {/* Repair type watchlist */}
            <Bucket title="Repair Type Watchlist" icon={Wrench} items={recs.repair_type_watchlist} />

            {/* Source type watchlist */}
            <Bucket title="Source Type Watchlist" icon={FileText} items={recs.source_type_watchlist} />

            {/* Document type stability */}
            <Bucket title="Document Type Stability" icon={FileCode} items={recs.document_type_watchlist} />

            {/* Governance gaps */}
            <Bucket title="Governance Gaps" icon={Shield} items={recs.governance_gaps} />

            {/* Revalidation gaps */}
            <Bucket title="Revalidation Gaps" icon={RefreshCw} items={recs.revalidation_gaps} />

            {/* Suggested next actions */}
            <Bucket title="Suggested Next Actions" icon={ArrowRight} items={recs.suggested_next_actions} />

            {/* Empty state: no recs at all */}
            {summary?.generated_recommendations === 0 && summary.total_snapshots >= 3 && (
              <div className="flex items-center gap-1.5 text-[9px] text-emerald-400">
                <CheckCircle className="h-3 w-3" />
                All tracked metrics are within healthy thresholds across {summary.total_snapshots} snapshots.
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}