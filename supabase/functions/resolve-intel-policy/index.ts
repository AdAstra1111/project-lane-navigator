import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveIntelPolicy, type PolicyContext } from "../_shared/intelPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return jsonRes({ ok: true, build: "resolve-intel-policy-v1" });

  try {
    const body = await req.json().catch(() => ({}));
    const context: PolicyContext = {
      surface: body.surface,
      project_id: body.project_id,
      lane: body.lane,
      production_type: body.production_type,
      modality: body.modality,
    };

    const resolved = await resolveIntelPolicy(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      context,
    );

    return jsonRes({ ok: true, ...resolved });
  } catch (err) {
    console.error("resolve-intel-policy error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
