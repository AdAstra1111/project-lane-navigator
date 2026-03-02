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
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().split("T")[0]; // YYYY-MM-DD Monday
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return jsonRes({ ok: true, build: "compute-convergence-alerts-v2" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await sbUser.auth.getUser();
    if (!user) return jsonRes({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));

    // Resolve policy
    const resolved = await resolveIntelPolicy(supabaseUrl, serviceKey, {
      surface: "convergence",
      project_id: body.project_id,
      production_type: body.production_type,
    });

    if (!resolved.enabled) return jsonRes({ ok: true, skipped: true, reason: "policy_disabled" });
    const policy = resolved.policy;

    if (!policy.modules.convergence) {
      return jsonRes({ ok: true, skipped: true, reason: "convergence_module_disabled" });
    }

    // Create run
    const { data: run } = await sb
      .from("intel_runs")
      .insert({
        engine_name: "convergence-alerts-v2",
        trigger: body.trigger || "manual",
        scope: body.project_id ? "project" : "global",
        requested_filters: body,
        ok: false,
      })
      .select("id")
      .single();

    if (!run) return jsonRes({ error: "Failed to create run" }, 500);

    // Load active signals with taxonomy fields
    const { data: signals } = await sb
      .from("trend_signals")
      .select("id, name, strength, velocity, saturation_risk, category, genre_tags, tone_tags, format_tags, production_type, dimension, modality, style_tags, narrative_tags, signal_tags, source_citations")
      .eq("status", "active")
      .gte("strength", policy.thresholds.min_signal_strength);

    const weekBucket = getWeekBucket();
    const suppressDays = policy.warnings.suppress_days || 7;
    const suppressCutoff = new Date(Date.now() - suppressDays * 86400_000).toISOString();
    const minConvergenceScore = policy.thresholds.min_convergence_score || 0.72;
    const minPersistenceWeeks = policy.thresholds.min_convergence_persistence_weeks || 2;

    // Partition signals by dimension
    const allSignals = signals || [];
    
    const formatSignals = allSignals.filter(s =>
      s.dimension === "format" || s.dimension === "market_behavior" ||
      (s.format_tags || []).some((t: string) => t.includes("vertical") || t.includes("drama")) ||
      s.production_type === "vertical-drama"
    );
    const visualSignals = allSignals.filter(s =>
      s.dimension === "visual_style" ||
      (s.style_tags && s.style_tags.length > 0) ||
      (s.modality && s.modality !== "live_action")
    );
    const narrativeSignals = allSignals.filter(s =>
      s.dimension === "narrative" ||
      (s.narrative_tags && s.narrative_tags.length > 0)
    );

    // Weight constants
    const wF = 0.4, wV = 0.3, wN = 0.3;

    interface ConvergenceCandidate {
      key: string;
      score: number;
      format_scope: string;
      modality: string;
      style_tag: string;
      narrative_tag: string;
      signal_ids: string[];
      signal_names: string[];
      citations: any[];
    }

    const candidates: ConvergenceCandidate[] = [];

    // Generate composite candidates by cross-dimension pairing
    for (const fSig of formatSignals) {
      const formatScope = fSig.production_type || "film";
      
      for (const vSig of visualSignals) {
        const mod = vSig.modality || (vSig.style_tags?.length > 0 ? "animation" : "live_action");
        const styleTags = vSig.style_tags?.length > 0 ? vSig.style_tags : ["general"];
        
        for (const styleTag of styleTags) {
          for (const nSig of narrativeSignals) {
            const narrTags = nSig.narrative_tags?.length > 0 ? nSig.narrative_tags : (nSig.genre_tags || []).slice(0, 2);
            if (narrTags.length === 0) continue;

            for (const narrTag of narrTags) {
              const fStr = (fSig.strength || 0) / 10;
              const vStr = (vSig.strength || 0) / 10;
              const nStr = (nSig.strength || 0) / 10;

              let rawScore = (wF * fStr + wV * vStr + wN * nStr);

              // Velocity boosts
              const velBoost = (s: any) => s.velocity === "Rising" ? 1.1 : s.velocity === "Declining" ? 0.85 : 1.0;
              rawScore *= (velBoost(fSig) + velBoost(vSig) + velBoost(nSig)) / 3;

              // Saturation penalty
              const satPen = (s: any) => s.saturation_risk === "High" ? 0.85 : s.saturation_risk === "Medium" ? 0.93 : 1.0;
              rawScore *= (satPen(fSig) + satPen(vSig) + satPen(nSig)) / 3;

              const key = `format:${formatScope}|modality:${mod}|style:${styleTag}|narrative:${narrTag}`;

              // Collect citations
              const allCitations: any[] = [];
              for (const sig of [fSig, vSig, nSig]) {
                if (sig.source_citations && Array.isArray(sig.source_citations)) {
                  for (const c of sig.source_citations) {
                    if (c?.url && allCitations.length < 10) allCitations.push(c);
                  }
                }
              }

              candidates.push({
                key,
                score: Math.round(rawScore * 100) / 100,
                format_scope: formatScope,
                modality: mod,
                style_tag: styleTag,
                narrative_tag: narrTag,
                signal_ids: [fSig.id, vSig.id, nSig.id].filter(Boolean),
                signal_names: [fSig.name, vSig.name, nSig.name].filter(Boolean),
                citations: allCitations,
              });
            }
          }
        }
      }
    }

    // Deduplicate: keep highest score per key
    const bestByKey = new Map<string, ConvergenceCandidate>();
    for (const c of candidates) {
      const existing = bestByKey.get(c.key);
      if (!existing || c.score > existing.score) {
        bestByKey.set(c.key, c);
      }
    }

    // Upsert into intel_convergence_state
    let candidatesPersisted = 0;
    for (const [key, c] of bestByKey) {
      const { data: existing } = await sb
        .from("intel_convergence_state")
        .select("id, observations, contributing_signal_ids, contributing_signal_names, contributing_citations")
        .eq("key", key)
        .eq("week_bucket", weekBucket)
        .maybeSingle();

      if (existing) {
        const mergedIds = [...new Set([...(existing.contributing_signal_ids || []), ...c.signal_ids])];
        const mergedNames = [...new Set([...(existing.contributing_signal_names || []), ...c.signal_names])];
        const mergedCitations = [...(existing.contributing_citations || []), ...c.citations].slice(0, 10);
        
        await sb.from("intel_convergence_state").update({
          score: Math.max(existing.observations > 0 ? c.score : 0, c.score),
          observations: (existing.observations || 0) + 1,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          contributing_signal_ids: mergedIds,
          contributing_signal_names: mergedNames,
          contributing_citations: mergedCitations,
        }).eq("id", existing.id);
      } else {
        await sb.from("intel_convergence_state").insert({
          key,
          week_bucket: weekBucket,
          score: c.score,
          observations: 1,
          contributing_signal_ids: c.signal_ids,
          contributing_signal_names: c.signal_names,
          contributing_citations: c.citations,
        });
      }
      candidatesPersisted++;
    }

    // Alert emission: check persistence across weeks
    let eventsCreated = 0;
    const alertsCreated = 0;

    for (const [key, c] of bestByKey) {
      if (c.score < minConvergenceScore) continue;

      // Count distinct weeks this key has appeared
      const { count: weekCount } = await sb
        .from("intel_convergence_state")
        .select("id", { count: "exact", head: true })
        .eq("key", key);

      if ((weekCount || 0) < minPersistenceWeeks) continue;

      // Severity
      const severity = c.score >= (minConvergenceScore + 0.1) ? "high" : "medium";
      if (policy.warnings.severity_min === "high" && severity === "medium") continue;

      // Fingerprint check
      const fingerprint = hashFingerprint(["cross_convergence", key, weekBucket]);

      const { data: existingEvt } = await sb
        .from("intel_events")
        .select("id")
        .eq("event_fingerprint", fingerprint)
        .gte("created_at", suppressCutoff)
        .limit(1);

      if (existingEvt && existingEvt.length > 0) continue;

      // Insert event
      const explanation = `Cross-dimension convergence detected: ${c.format_scope} format + ${c.modality} modality + ${c.style_tag} style + ${c.narrative_tag} narrative. Score: ${c.score}. Based on ${c.signal_names.join(", ")}.`;

      const { data: evt } = await sb
        .from("intel_events")
        .insert({
          event_type: "cross_convergence",
          severity,
          event_fingerprint: fingerprint,
          payload: {
            convergence_key: key,
            format: c.format_scope,
            modality: c.modality,
            style_tag: c.style_tag,
            narrative_tag: c.narrative_tag,
            score: c.score,
            contributing_signal_ids: c.signal_ids,
            citations: c.citations,
            explanation,
          },
          status: "open",
          project_id: body.project_id || null,
          surface: "convergence",
        })
        .select("id")
        .single();

      if (evt) {
        eventsCreated++;

        // Insert event links for each contributing signal
        const linkRows = c.signal_ids.map(sid => ({
          event_id: evt.id,
          signal_id: sid,
          meta: { role: "contributor", score: c.score },
        }));
        await sb.from("intel_event_links").insert(linkRows);

        // Create alert
        await sb.from("intel_alerts").insert({
          event_id: evt.id,
          surface: "dashboard",
          status: "new",
        });
      }
    }

    // Mark run ok
    await sb.from("intel_runs").update({
      ok: true,
      stats: {
        signals_evaluated: allSignals.length,
        candidates_evaluated: candidates.length,
        candidates_persisted: candidatesPersisted,
        events_created: eventsCreated,
        week_bucket: weekBucket,
        used_policy_sources: resolved.sources,
      },
    }).eq("id", run.id);

    return jsonRes({
      ok: true,
      advisory_only: true,
      run_id: run.id,
      candidates_evaluated: candidates.length,
      candidates_persisted: candidatesPersisted,
      events_created: eventsCreated,
      top_candidates: [...bestByKey.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(c => ({ key: c.key, score: c.score, signals: c.signal_names })),
      used_policy_sources: resolved.sources,
    });
  } catch (err) {
    console.error("compute-convergence-alerts error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
