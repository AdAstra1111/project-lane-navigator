import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Plus, Pencil, Eye } from "lucide-react";
import { ExplorerLayout } from "@/components/explorer/ExplorerLayout";
import { toast } from "sonner";

interface Policy {
  id: string;
  scope_type: string;
  scope_key: string;
  enabled: boolean;
  priority: number;
  policy: any;
  created_at: string;
}

const SCOPE_TYPES = ["global", "surface", "project", "lane", "production_type", "modality"];

export default function IntelPolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Policy> | null>(null);
  const [policyJson, setPolicyJson] = useState("");
  const [previewContext, setPreviewContext] = useState({ surface: "", project_id: "", lane: "", production_type: "", modality: "" });
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    loadPolicies();
  }, []);

  function loadPolicies() {
    supabase
      .from("intel_policies")
      .select("*")
      .order("priority", { ascending: true })
      .then(({ data }) => setPolicies((data as any[]) || []));
  }

  function openNew() {
    setEditing({ scope_type: "surface", scope_key: "", enabled: true, priority: 10 });
    setPolicyJson(JSON.stringify({
      advisory_only: true,
      modules: { trend_signals: true, convergence: true, alignment: true, alerts: true },
      thresholds: { min_signal_strength: 7, min_convergence_score: 0.72 },
      warnings: { enabled: true, severity_min: "medium", suppress_days: 7 },
      cadence: { convergence_run: "weekly", alignment_run: "manual" },
    }, null, 2));
    setEditOpen(true);
  }

  function openEdit(p: Policy) {
    setEditing(p);
    setPolicyJson(JSON.stringify(p.policy, null, 2));
    setEditOpen(true);
  }

  async function save() {
    if (!editing) return;
    let parsed: any;
    try {
      parsed = JSON.parse(policyJson);
    } catch {
      toast.error("Invalid JSON");
      return;
    }

    if (editing.id) {
      // Update: set updated_by, don't overwrite created_by
      const row = {
        scope_type: editing.scope_type,
        scope_key: editing.scope_key,
        enabled: editing.enabled,
        priority: editing.priority || 0,
        policy: parsed,
        updated_at: new Date().toISOString(),
        updated_by: (await supabase.auth.getUser()).data.user?.id || null,
      };
      const { error } = await supabase.from("intel_policies").update(row as any).eq("id", editing.id);
      if (error) { console.error("Policy update error:", error); toast.error(error.message); return; }
      toast.success("Policy updated");
    } else {
      // Insert: let DB default created_by = auth.uid()
      const row = {
        scope_type: editing.scope_type,
        scope_key: editing.scope_key,
        enabled: editing.enabled,
        priority: editing.priority || 0,
        policy: parsed,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("intel_policies").insert(row as any);
      if (error) { console.error("Policy insert error:", error); toast.error(error.message); return; }
      toast.success("Policy created");
    }
    setEditOpen(false);
    loadPolicies();
  }

  async function previewPolicy() {
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-intel-policy", {
        body: previewContext,
      });
      if (error) throw error;
      setPreviewResult(data);
    } catch (e: any) {
      toast.error(e.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <ExplorerLayout breadcrumbs={[{ label: "Intel", to: "/intel" }, { label: "Policies" }]}>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" /> Intel Policies
            </h1>
            <p className="text-sm text-muted-foreground">
              Deterministic precedence: global → surface → project → lane → type → modality.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Preview
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Policy
            </Button>
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-3 space-y-1">
          <p><strong>Examples:</strong></p>
          <p>• Disable intel on TrendsExplorer: scope_type="surface", scope_key="trends_explorer", enabled=false</p>
          <p>• Enable convergence for vertical-drama animation: scope_type="production_type" scope_key="vertical-drama" + scope_type="modality" scope_key="animation"</p>
        </div>

        {policies.map(p => (
          <Card key={p.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs">{p.scope_type}:{p.scope_key}</CardTitle>
                <Badge variant={p.enabled ? "default" : "secondary"} className="text-[9px]">
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="outline" className="text-[9px]">Priority {p.priority}</Badge>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 overflow-auto max-h-48">
                {JSON.stringify(p.policy, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}

        {policies.length === 0 && (
          <p className="text-sm text-muted-foreground">No policies configured yet.</p>
        )}

        {/* Edit/Create Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit Policy" : "New Policy"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Scope Type</Label>
                  <Select value={editing?.scope_type || "surface"} onValueChange={v => setEditing(e => e ? { ...e, scope_type: v } : e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCOPE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Scope Key</Label>
                  <Input value={editing?.scope_key || ""} onChange={e => setEditing(ed => ed ? { ...ed, scope_key: e.target.value } : ed)} placeholder="e.g. trends_explorer" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={editing?.enabled ?? true} onCheckedChange={v => setEditing(e => e ? { ...e, enabled: v } : e)} />
                  <Label className="text-xs">Enabled</Label>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Priority</Label>
                  <Input type="number" value={editing?.priority ?? 0} onChange={e => setEditing(ed => ed ? { ...ed, priority: parseInt(e.target.value) || 0 } : ed)} className="w-24" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Policy JSON</Label>
                <textarea
                  className="w-full h-48 text-[11px] font-mono bg-muted/50 border rounded p-2"
                  value={policyJson}
                  onChange={e => setPolicyJson(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Resolved Policy Preview</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(["surface", "project_id", "lane", "production_type", "modality"] as const).map(f => (
                  <div key={f}>
                    <Label className="text-[10px]">{f}</Label>
                    <Input
                      value={(previewContext as any)[f]}
                      onChange={e => setPreviewContext(c => ({ ...c, [f]: e.target.value }))}
                      placeholder={f}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" onClick={previewPolicy} disabled={previewLoading}>
                {previewLoading ? "Resolving…" : "Preview"}
              </Button>
              {previewResult && (
                <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-auto max-h-64">
                  {JSON.stringify(previewResult, null, 2)}
                </pre>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ExplorerLayout>
  );
}
