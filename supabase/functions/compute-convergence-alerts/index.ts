import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIntelPolicy } from "../_shared/intelPolicy.ts";

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

function hashFingerprint(parts: string[]): string {
  // Simple deterministic fingerprint
  const str = parts.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getWeekBucket(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7);
  return `${year}-W${week}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return jsonRes({ ok: true, build: "compute-convergence-alerts-v1" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await sbUser.auth.getUser();
    if (!user) return jsonRes({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // Resolve policy
    const resolved = await resolveIntelPolicy(supabaseUrl, serviceKey, {
      surface: "convergence",
      project_id: body.project_id,
    });

    if (!resolved.enabled) return jsonRes({ ok: true, skipped: true, reason: "policy_disabled" });

    const policy = resolved.policy;

    // Create run
    const { data: run } = await sb
      .from("intel_runs")
      .insert({
        engine_name: "convergence-alerts",
        trigger: body.trigger || "manual",
        scope: body.project_id ? "project" : "global",
        requested_filters: body,
        ok: false,
      })
      .select("id")
      .single();

    if (!run) return jsonRes({ error: "Failed to create run" }, 500);

    // Load active signals with strength >= threshold
    const { data: signals } = await sb
      .from("trend_signals")
      .select("id, name, strength, velocity, saturation_risk, category, genre_tags, tone_tags")
      .eq("status", "active")
      .gte("strength", policy.thresholds.min_signal_strength);

    const weekBucket = getWeekBucket();
    const suppressCutoff = new Date(Date.now() - policy.warnings.suppress_days * 86400_000).toISOString();
    let eventsCreated = 0;
    let alertsCreated = 0;

    for (const signal of (signals || [])) {
      // Determine severity
      const normalizedStrength = (signal.strength || 0) / 10;
      const severity = normalizedStrength >= (policy.thresholds.min_convergence_score + 0.1)
        ? "high"
        : normalizedStrength >= policy.thresholds.min_convergence_score
          ? "medium"
          : null;

      if (!severity) continue;

      // Skip if below severity_min
      if (policy.warnings.severity_min === "high" && severity === "medium") continue;

      // Fingerprint = event_type + tags + week
      const tagSet = [...(signal.genre_tags || []), ...(signal.tone_tags || [])].sort().join(",");
      const fingerprint = hashFingerprint(["convergence_heat", tagSet, weekBucket]);

      // Check suppression
      const { data: existing } = await sb
        .from("intel_events")
        .select("id")
        .eq("event_fingerprint", fingerprint)
        .gte("created_at", suppressCutoff)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Insert event
      const { data: evt } = await sb
        .from("intel_events")
        .insert({
          event_type: "convergence_heat",
          severity,
          event_fingerprint: fingerprint,
          payload: {
            signal_id: signal.id,
            signal_name: signal.name,
            strength: signal.strength,
            velocity: signal.velocity,
            category: signal.category,
            saturation_risk: signal.saturation_risk,
          },
          status: "open",
          project_id: body.project_id || null,
          surface: "convergence",
        })
        .select("id")
        .single();

      if (evt) {
        eventsCreated++;

        // Create alert for dashboard surface
        await sb.from("intel_alerts").insert({
          event_id: evt.id,
          surface: "dashboard",
          status: "new",
        });
        alertsCreated++;
      }
    }

    // Mark run ok
    await sb.from("intel_runs").update({
      ok: true,
      stats: {
        signals_evaluated: signals?.length || 0,
        events_created: eventsCreated,
        alerts_created: alertsCreated,
        week_bucket: weekBucket,
      },
    }).eq("id", run.id);

    return jsonRes({
      ok: true,
      advisory_only: true,
      run_id: run.id,
      events_created: eventsCreated,
      alerts_created: alertsCreated,
      signals_evaluated: signals?.length || 0,
    });
  } catch (err) {
    console.error("compute-convergence-alerts error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
