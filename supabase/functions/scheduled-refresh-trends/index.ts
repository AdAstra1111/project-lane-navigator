/**
 * scheduled-refresh-trends — Batch orchestrator that refreshes ALL REQUIRED_TREND_TYPES in one run.
 * Called by pg_cron or manually. Uses X-IFFY-CRON-SECRET for internal auth when scheduled,
 * or forwards user JWT when called manually from UI.
 *
 * Global cooldown: checks the most recent successful trend_refresh_runs entry.
 * If within cooldown window, returns 429 with a single global cooldown timestamp.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REQUIRED_TREND_TYPES } from "../_shared/trendsNormalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-iffy-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COOLDOWN_HOURS: Record<string, number> = {
  manual: 6,
  backfill: 1,
  scheduled: 144,
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
    return json({ ok: true, build: "scheduled-refresh-trends-v3" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("IFFY_CRON_SECRET");

    // Auth: either valid user JWT or cron secret header
    const userAuth = req.headers.get("Authorization");
    const incomingCronSecret = req.headers.get("X-IFFY-CRON-SECRET");
    const hasValidUserAuth = userAuth?.startsWith("Bearer ") && userAuth.length > 50;
    const hasValidCronAuth = !!(incomingCronSecret && cronSecret && incomingCronSecret === cronSecret);

    // Determine trigger + override flag
    let trigger = (hasValidCronAuth || !hasValidUserAuth) ? "scheduled" : "manual";
    let overrideGlobalCooldown = false;
    try {
      const body = await req.json();
      if (body.trigger) trigger = body.trigger;
      if (body.override_global_cooldown === true) overrideGlobalCooldown = true;
    } catch {}

    // ── Admin enforcement for override ──
    const cooldownHours = COOLDOWN_HOURS[trigger] || COOLDOWN_HOURS.manual;
    const cooldownCutoff = new Date(Date.now() - cooldownHours * 3600_000).toISOString();
    const db = createClient(supabaseUrl, serviceKey);

    if (overrideGlobalCooldown) {
      // Cron cannot use override
      if (hasValidCronAuth && !hasValidUserAuth) {
        return json({ error: "FORBIDDEN_OVERRIDE", detail: "Cron auth cannot use override_global_cooldown" }, 403);
      }
      // Must be authenticated user
      if (!hasValidUserAuth || !userAuth) {
        return json({ error: "FORBIDDEN_OVERRIDE", detail: "User auth required for override" }, 403);
      }
      // Verify admin role via canonical RPC
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: userAuth } },
      });
      const { data: userData, error: authErr } = await userClient.auth.getUser(userAuth.replace("Bearer ", ""));
      if (authErr || !userData?.user) {
        return json({ error: "FORBIDDEN_OVERRIDE", detail: "Invalid user token" }, 403);
      }
      const { data: isAdmin } = await db.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      if (!isAdmin) {
        return json({ error: "FORBIDDEN_OVERRIDE", detail: "Admin role required for override_global_cooldown" }, 403);
      }
      console.log(`[scheduled-refresh-trends] override_global_cooldown=true by admin ${userData.user.id}`);
    }

    // ── Global cooldown check (skip if override) ──
    if (!overrideGlobalCooldown) {
      const requiredTypesArr = [...REQUIRED_TREND_TYPES];
      const { data: recentRuns } = await db
        .from("trend_refresh_runs")
        .select("id, created_at, completed_types")
        .eq("ok", true)
        .gte("created_at", cooldownCutoff)
        .contains("completed_types", requiredTypesArr)
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentRuns && recentRuns.length > 0) {
        const lastRunAt = recentRuns[0].created_at;
        const nextAllowed = new Date(new Date(lastRunAt).getTime() + cooldownHours * 3600_000).toISOString();
        return json({
          error: "COOLDOWN_ACTIVE",
          cooldown_scope: "global",
          last_run_at: lastRunAt,
          next_allowed_at: nextAllowed,
          cooldown_hours: cooldownHours,
          trigger,
        }, 429);
      }
    }

    // ── Batch refresh all required types ──
    const buildSubHeaders = (): Record<string, string> => {
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (hasValidUserAuth) {
        h["Authorization"] = userAuth!;
      } else if (cronSecret) {
        h["X-IFFY-CRON-SECRET"] = cronSecret;
      }
      return h;
    };

    const attempted: string[] = [];
    const results: Record<string, any> = {};
    let firstSuccessAt: string | null = null;

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
            force: true, // bypass per-call cooldown since we checked globally above
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
        if (res.ok && !firstSuccessAt) {
          firstSuccessAt = data.refreshed_at || new Date().toISOString();
        }
        console.log(`[scheduled-refresh-trends] ${type}: status=${res.status} ok=${res.ok}`);
      } catch (e: any) {
        results[type] = { ok: false, error: e.message };
        console.error(`[scheduled-refresh-trends] ${type} failed:`, e.message);
      }
    }

    const allOk = Object.values(results).every((r: any) => r.ok);
    const successCount = Object.values(results).filter((r: any) => r.ok).length;

    // ── Insert batch-anchor row if all types succeeded ──
    let lastRunAt = firstSuccessAt || new Date().toISOString();
    let nextAllowedAt = new Date(new Date(lastRunAt).getTime() + cooldownHours * 3600_000).toISOString();

    if (allOk) {
      const totalSignals = Object.values(results).reduce((s: number, r: any) => s + (r.signals_updated || 0), 0);
      const totalCast = Object.values(results).reduce((s: number, r: any) => s + (r.cast_updated || 0), 0);

      const { data: anchorRow, error: anchorErr } = await db
        .from("trend_refresh_runs")
        .insert({
          trigger,
          scope: "batch",
          requested_types: [...REQUIRED_TREND_TYPES],
          completed_types: [...REQUIRED_TREND_TYPES],
          ok: true,
          model_trends: "google/gemini-2.5-flash",
          model_grounding: "perplexity/sonar",
          recency_filter: "week",
          signals_total: totalSignals,
          cast_total: totalCast,
          citations_total: 0,
        })
        .select("id, created_at")
        .single();

      if (anchorErr) {
        console.error("[scheduled-refresh-trends] batch-anchor insert failed:", anchorErr);
      } else if (anchorRow) {
        lastRunAt = anchorRow.created_at;
        nextAllowedAt = new Date(new Date(lastRunAt).getTime() + cooldownHours * 3600_000).toISOString();
        console.log(`[scheduled-refresh-trends] batch-anchor created: id=${anchorRow.id} created_at=${lastRunAt}`);
      }
    }

    return json({
      ok: allOk,
      attempted,
      results,
      trigger,
      override_global_cooldown: overrideGlobalCooldown,
      refreshed_types_count: successCount,
      failures_count: attempted.length - successCount,
      last_run_at: lastRunAt,
      next_allowed_at: nextAllowedAt,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[scheduled-refresh-trends] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
