import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle, ExternalLink, ChevronRight } from "lucide-react";
import { ExplorerLayout } from "@/components/explorer/ExplorerLayout";
import { toast } from "sonner";

interface IntelEvent {
  id: string;
  created_at: string;
  event_type: string;
  severity: string;
  event_fingerprint: string;
  payload: any;
  status: string;
  surface: string | null;
}

interface EventLink {
  id: string;
  signal_id: string | null;
  cast_id: string | null;
  meta: any;
  signal?: { name: string; strength: number; velocity: string; category: string; source_citations: any } | null;
}

export default function IntelEvents() {
  const [events, setEvents] = useState<IntelEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [selected, setSelected] = useState<IntelEvent | null>(null);
  const [links, setLinks] = useState<EventLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [filter]);

  async function loadEvents() {
    let q = supabase.from("intel_events").select("*").order("created_at", { ascending: false }).limit(50);
    if (filter === "open") q = q.eq("status", "open");
    if (filter === "resolved") q = q.eq("status", "resolved");
    const { data } = await q;
    setEvents((data as any[]) || []);
  }

  async function resolveEvent(id: string) {
    const { error } = await supabase.from("intel_events").update({ status: "resolved" } as any).eq("id", id);
    if (error) { toast.error("Failed to resolve"); return; }
    toast.success("Event resolved");
    loadEvents();
    if (selected?.id === id) setSelected(s => s ? { ...s, status: "resolved" } : null);
  }

  async function openDetail(evt: IntelEvent) {
    setSelected(evt);
    setLinksLoading(true);
    setLinks([]);

    // Load event links with joined signal data
    const { data: linkRows } = await supabase
      .from("intel_event_links")
      .select("id, signal_id, cast_id, meta")
      .eq("event_id", evt.id);

    if (linkRows && linkRows.length > 0) {
      const signalIds = (linkRows as any[]).map(l => l.signal_id).filter(Boolean);
      let signalMap: Record<string, any> = {};
      if (signalIds.length > 0) {
        const { data: sigs } = await supabase
          .from("trend_signals")
          .select("id, name, strength, velocity, category, source_citations")
          .in("id", signalIds);
        if (sigs) {
          for (const s of sigs) signalMap[s.id] = s;
        }
      }
      setLinks((linkRows as any[]).map(l => ({
        ...l,
        signal: l.signal_id ? signalMap[l.signal_id] || null : null,
      })));
    }
    setLinksLoading(false);
  }

  const severityColor = (s: string) => {
    if (s === "high") return "bg-destructive/20 text-destructive border-destructive/30";
    if (s === "medium") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-muted/20 text-muted-foreground";
  };

  // Extract citations from event payload or linked signals
  const getCitations = (): Array<{ url: string; title?: string }> => {
    const cits: Array<{ url: string; title?: string }> = [];
    const seen = new Set<string>();
    // From payload
    if (selected?.payload?.citations) {
      for (const c of selected.payload.citations) {
        if (c?.url && !seen.has(c.url)) { cits.push(c); seen.add(c.url); }
      }
    }
    // From linked signals
    for (const link of links) {
      if (link.signal?.source_citations && Array.isArray(link.signal.source_citations)) {
        for (const c of link.signal.source_citations) {
          if (c?.url && !seen.has(c.url)) { cits.push(c); seen.add(c.url); }
        }
      }
    }
    return cits.slice(0, 12);
  };

  return (
    <ExplorerLayout breadcrumbs={[{ label: "Intel", to: "/intel" }, { label: "Events" }]}>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-primary" /> Intel Events
          </h1>
          <div className="flex gap-1">
            {(["all", "open", "resolved"] as const).map(f => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className="text-xs">
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events found.</p>
        ) : (
          <div className="space-y-2">
            {events.map(evt => (
              <Card key={evt.id} className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => openDetail(evt)}>
                <CardContent className="px-4 py-3 flex items-center gap-3">
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${severityColor(evt.severity)}`}>
                    {evt.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{evt.event_type}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {evt.payload?.explanation || evt.payload?.signal_name || evt.payload?.convergence_key || evt.event_fingerprint}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{evt.status}</Badge>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(evt.created_at).toLocaleDateString()}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Deep Dive Detail Dialog */}
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                {selected?.event_type}
                <Badge variant="outline" className={`text-[9px] ${severityColor(selected?.severity || "")}`}>
                  {selected?.severity}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            {selected && (
              <div className="space-y-4">
                {/* Payload fields */}
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Payload</p>
                  {selected.payload?.explanation && (
                    <p className="text-xs text-foreground mb-2">{selected.payload.explanation}</p>
                  )}
                  {selected.payload?.convergence_key_scoped && (
                    <p className="text-[10px] text-muted-foreground font-mono">{selected.payload.convergence_key_scoped}</p>
                  )}
                  {!selected.payload?.convergence_key_scoped && selected.payload?.convergence_key && (
                    <p className="text-[10px] text-muted-foreground font-mono">{selected.payload.convergence_key}</p>
                  )}
                  {selected.payload?.score != null && (
                    <p className="text-xs">Score: <span className="font-bold">{selected.payload.score}</span></p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selected.payload?.format && <Badge variant="outline" className="text-[9px]">{selected.payload.format}</Badge>}
                    {selected.payload?.modality && <Badge variant="outline" className="text-[9px]">{selected.payload.modality}</Badge>}
                    {selected.payload?.style_tag && <Badge variant="outline" className="text-[9px]">{selected.payload.style_tag}</Badge>}
                    {selected.payload?.narrative_tag && <Badge variant="outline" className="text-[9px]">{selected.payload.narrative_tag}</Badge>}
                    {selected.payload?.scope_production_type && selected.payload.scope_production_type !== '*' && (
                      <Badge variant="outline" className="text-[9px] border-primary/30">scope:{selected.payload.scope_production_type}</Badge>
                    )}
                    {selected.payload?.scope_modality && selected.payload.scope_modality !== '*' && (
                      <Badge variant="outline" className="text-[9px] border-primary/30">scope:{selected.payload.scope_modality}</Badge>
                    )}
                  </div>
                </div>

                {/* Contributing Signals */}
                {links.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">Contributing Signals</p>
                    <div className="space-y-1">
                      {links.map(l => (
                        <div key={l.id} className="text-xs flex items-center gap-2 bg-muted/30 rounded px-2 py-1">
                          <span className="font-medium text-foreground">{l.signal?.name || l.signal_id || "—"}</span>
                          {l.signal && (
                            <>
                              <Badge variant="outline" className="text-[9px]">str:{l.signal.strength}</Badge>
                              <Badge variant="outline" className="text-[9px]">{l.signal.velocity}</Badge>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {linksLoading && <p className="text-[10px] text-muted-foreground">Loading linked signals…</p>}

                {/* Citations */}
                {getCitations().length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">Source Citations</p>
                    <div className="space-y-1">
                      {getCitations().map((c, i) => (
                        <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-primary hover:underline flex items-center gap-1 truncate">
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {c.title || c.url}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {selected.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => resolveEvent(selected.id)}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Resolve
                    </Button>
                  )}
                </div>

                {/* Raw payload */}
                <details className="text-[10px]">
                  <summary className="text-muted-foreground cursor-pointer">Raw payload</summary>
                  <pre className="bg-muted/50 rounded p-2 mt-1 overflow-auto max-h-48">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ExplorerLayout>
  );
}
