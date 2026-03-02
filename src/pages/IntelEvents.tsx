import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle } from "lucide-react";
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

export default function IntelEvents() {
  const [events, setEvents] = useState<IntelEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

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
  }

  const severityColor = (s: string) => {
    if (s === "high") return "bg-destructive/20 text-destructive border-destructive/30";
    if (s === "medium") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-muted/20 text-muted-foreground";
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
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
                className="text-xs"
              >
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
              <Card key={evt.id}>
                <CardContent className="px-4 py-3 flex items-center gap-3">
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${severityColor(evt.severity)}`}>
                    {evt.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{evt.event_type}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {evt.payload?.signal_name || evt.payload?.message || evt.event_fingerprint}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{evt.status}</Badge>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(evt.created_at).toLocaleDateString()}
                  </span>
                  {evt.status === "open" && (
                    <Button size="sm" variant="ghost" onClick={() => resolveEvent(evt.id)}>
                      <CheckCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ExplorerLayout>
  );
}
