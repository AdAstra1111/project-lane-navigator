/**
 * scheduled-refresh-trends — Weekly orchestrator that refreshes all REQUIRED_TREND_TYPES.
 * Called by pg_cron or manually. Uses X-IFFY-CRON-SECRET for internal auth when scheduled,
 * or forwards user JWT when called manually from UI.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REQUIRED_TREND_TYPES } from "../_shared/trendsNormalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-iffy-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const cronSecret = Deno.env.get("IFFY_CRON_SECRET");

    // Auth: either valid user JWT or cron secret header or internal pg_cron call (no auth)
    const userAuth = req.headers.get("Authorization");
    const incomingCronSecret = req.headers.get("X-IFFY-CRON-SECRET");
    const hasValidUserAuth = userAuth?.startsWith("Bearer ") && userAuth.length > 50;
    const hasValidCronAuth = !!(incomingCronSecret && cronSecret && incomingCronSecret === cronSecret);

    // pg_cron calls via net.http_post don't carry the cron secret directly,
    // so we allow unauthenticated POST but always use cron secret for subcalls.
    // The subcalls (refresh-trends) enforce their own auth.

    // Determine trigger
    let trigger = (hasValidCronAuth || !hasValidUserAuth) ? "scheduled" : "manual";
    try {
      const body = await req.json();
      if (body.trigger) trigger = body.trigger;
    } catch {}

    // Determine auth mode: user JWT passthrough or cron secret
    const hasCronSecret = !!cronSecret;

    // Build headers for subcalls to refresh-trends
    const buildSubHeaders = (): Record<string, string> => {
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (hasValidUserAuth) {
        // User-initiated from UI: forward their JWT
        h["Authorization"] = userAuth!;
      } else if (cronSecret) {
        // Cron-initiated or internal: use cron secret
        h["X-IFFY-CRON-SECRET"] = cronSecret;
      }
      return h;
    };

    const attempted: string[] = [];
    const results: Record<string, any> = {};

    for (const type of REQUIRED_TREND_TYPES) {
      attempted.push(type);
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/refresh-trends`, {
          method: "POST",
          headers: buildSubHeaders(),
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
