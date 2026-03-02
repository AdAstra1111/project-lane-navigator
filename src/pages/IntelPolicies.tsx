import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";
import { ExplorerLayout } from "@/components/explorer/ExplorerLayout";

interface Policy {
  id: string;
  scope_type: string;
  scope_key: string;
  enabled: boolean;
  priority: number;
  policy: any;
  created_at: string;
}

export default function IntelPolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);

  useEffect(() => {
    supabase
      .from("intel_policies")
      .select("*")
      .order("priority", { ascending: true })
      .then(({ data }) => setPolicies((data as any[]) || []));
  }, []);

  return (
    <ExplorerLayout breadcrumbs={[{ label: "Intel", to: "/intel" }, { label: "Policies" }]}>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Intel Policies
        </h1>
        <p className="text-sm text-muted-foreground">
          Hierarchical policy chain: global → surface → project → lane → type → modality.
          Higher priority overrides lower.
        </p>

        {policies.map(p => (
          <Card key={p.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs">{p.scope_type}:{p.scope_key}</CardTitle>
                <Badge variant={p.enabled ? "default" : "secondary"} className="text-[9px]">
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="outline" className="text-[9px]">Priority {p.priority}</Badge>
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
      </div>
    </ExplorerLayout>
  );
}
