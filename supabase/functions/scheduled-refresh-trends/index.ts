/**
 * scheduled-refresh-trends — Weekly orchestrator that refreshes all REQUIRED_TREND_TYPES.
 * Called by pg_cron or manually. Iterates each type and calls refresh-trends with trigger="scheduled".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REQUIRED_TREND_TYPES } from "../_shared/trendsNormalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Ping
  if (req.method === "GET") {
    return json({ ok: true, build: "scheduled-refresh-trends-v1" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Accept optional trigger override (default "scheduled")
    let trigger = "scheduled";
    try {
      const body = await req.json();
      if (body.trigger) trigger = body.trigger;
    } catch {}

    // Use service role bearer for the sub-calls (scheduled = no user session)
    const authHeader = req.headers.get("Authorization") || `Bearer ${serviceKey}`;

    const attempted: string[] = [];
    const results: Record<string, any> = {};

    for (const type of REQUIRED_TREND_TYPES) {
      attempted.push(type);
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/refresh-trends`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            production_type: type,
            scope: "one",
            trigger,
          }),
        });
        const data = await res.json();
        results[type] = {
          ok: res.ok,
          status: res.status,
          signals_updated: data.signals_updated,
          cast_updated: data.cast_updated,
          error: data.error || undefined,
          run_id: data.run_id || undefined,
        };
        console.log(`[scheduled-refresh-trends] ${type}: status=${res.status} ok=${res.ok}`);
      } catch (e: any) {
        results[type] = { ok: false, error: e.message };
        console.error(`[scheduled-refresh-trends] ${type} failed:`, e.message);
      }
    }

    const allOk = Object.values(results).every((r: any) => r.ok);

    return json({
      ok: allOk,
      attempted,
      results,
      trigger,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[scheduled-refresh-trends] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
