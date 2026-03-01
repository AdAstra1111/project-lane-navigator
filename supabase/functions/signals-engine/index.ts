import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Scoring helpers (mirrors src/lib/signal-scoring.ts for server) ──

function scoreObservation(rawMetrics: Record<string, any>, extractionConfidence: number, observedAt: string | null, saturationProxy: number) {
  const views = rawMetrics.views || rawMetrics.count || 0;
  const strength = views > 0 ? Math.min(1, Math.log10(views + 1) / 7) : 0.3;
  const velocity = rawMetrics.growth_rate ?? rawMetrics.delta ?? 0.3;
  const daysSince = observedAt ? (Date.now() - new Date(observedAt).getTime()) / (1000 * 60 * 60 * 24) : 30;
  const freshness = Math.exp(-daysSince / 30);
  return {
    strength: Math.min(1, Math.max(0, strength)),
    velocity: Math.min(1, Math.max(0, velocity)),
    freshness: Math.min(1, Math.max(0, freshness)),
    confidence: Math.min(1, Math.max(0, extractionConfidence)),
    saturation: Math.min(1, Math.max(0, saturationProxy)),
  };
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  let intersection = 0;
  for (const item of setA) { if (setB.has(item)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function getFormatBucket(format: string | undefined | null): string {
  const f = (format || '').toLowerCase().replace(/_/g, '-');
  if (f === 'vertical-drama') return 'vertical_drama';
  if (['documentary', 'documentary-series', 'hybrid-documentary'].includes(f)) return 'documentary';
  return 'film';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await anonClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const body = await req.json();
    const { action } = body;

    // ══════════════════════════════════════════════
    // ACTION: recompute-signals
    // Clusters observations and updates trend_signals scoring
    // ══════════════════════════════════════════════
    if (action === "recompute-signals") {
      const days = body.days || 90;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // 1) Fetch recent observations
      const { data: observations, error: obsErr } = await supabase
        .from("trend_observations")
        .select("id, observed_at, source_type, source_name, source_url, raw_metrics, extraction_confidence, format_hint, tags")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(500);
      if (obsErr) throw obsErr;
      if (!observations || observations.length === 0) {
        return new Response(JSON.stringify({ message: "No observations to process", clusters_updated: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2) Fetch active trend_signals to update
      const { data: signals } = await supabase
        .from("trend_signals")
        .select("id, name, genre_tags, tone_tags, format_tags, lane_relevance, format_applicability, production_type")
        .eq("status", "active");

      // 3) For each signal, find observations whose tags overlap (Jaccard >= 0.35)
      let clustersUpdated = 0;
      for (const signal of (signals || [])) {
        const signalTags = [
          ...(signal.genre_tags || []),
          ...(signal.tone_tags || []),
          ...(signal.format_tags || []),
          ...(signal.lane_relevance || []),
        ].map((t: string) => t.toLowerCase());

        const matched: any[] = [];
        for (const obs of observations) {
          const obsTags = Array.isArray(obs.tags) ? obs.tags.map((t: string) => t.toLowerCase()) : [];
          const jaccard = jaccardSimilarity(signalTags, obsTags);
          // Also check format_hint compatibility
          const formatOk = !obs.format_hint || getFormatBucket(obs.format_hint) === getFormatBucket(signal.production_type);
          if (jaccard >= 0.35 && formatOk) {
            matched.push(obs);
          }
        }

        if (matched.length === 0) continue;

        // Count clusters with same tags in recent period for saturation
        const tagSet = new Set(signalTags);
        let satCount = 0;
        for (const s of (signals || [])) {
          if (s.id === signal.id) continue;
          const sTags = [...(s.genre_tags || []), ...(s.tone_tags || [])].map((t: string) => t.toLowerCase());
          const overlap = sTags.filter(t => tagSet.has(t)).length;
          if (overlap >= 2) satCount++;
        }
        const satProxy = Math.min(1, satCount / Math.max(1, (signals || []).length) * 2);

        // Score each matched observation
        const obsScores = matched.map(obs => scoreObservation(
          obs.raw_metrics || {},
          obs.extraction_confidence || 0.6,
          obs.observed_at,
          satProxy,
        ));

        // Compute cluster scoring
        const avg = (key: string) => obsScores.reduce((s, o) => s + (o as any)[key], 0) / obsScores.length;
        const strength = avg("strength");
        const velocity = avg("velocity");
        const freshness = Math.max(...obsScores.map(o => o.freshness));
        const confidence = avg("confidence");
        const saturation = avg("saturation");
        const total = Math.max(0, strength * velocity * freshness * confidence - saturation * 0.25);

        const clusterScoring = {
          strength: Math.round(strength * 100) / 100,
          velocity: Math.round(velocity * 100) / 100,
          freshness: Math.round(freshness * 100) / 100,
          confidence: Math.round(confidence * 100) / 100,
          saturation: Math.round(saturation * 100) / 100,
          total: Math.round(total * 100) / 100,
        };

        const sourcesUsed = matched.map(o => ({ id: o.id, url: o.source_url, source: o.source_name }));

        // Determine format_applicability from matched observations
        const formatHints = new Set(matched.map(o => getFormatBucket(o.format_hint)).filter(Boolean));
        if (formatHints.size === 0) formatHints.add("film");
        const formatApplicability = [...formatHints];

        // Update signal row
        await supabase.from("trend_signals").update({
          cluster_scoring: clusterScoring,
          sources_used: sourcesUsed,
          format_applicability: formatApplicability,
          last_updated_at: new Date().toISOString(),
        }).eq("id", signal.id);

        // Link observations to this signal
        const obsIds = matched.map(o => o.id);
        await supabase.from("trend_observations").update({ cluster_id: signal.id }).in("id", obsIds);

        clustersUpdated++;
      }

      return new Response(JSON.stringify({ success: true, clusters_updated: clustersUpdated, observations_processed: observations.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ACTION: match-project
    // Extracts features, matches signals, upserts matches
    // ══════════════════════════════════════════════
    if (action === "match-project") {
      const { projectId } = body;
      if (!projectId) throw new Error("projectId required");

      // 1) Fetch project
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id, title, genres, tone, format, budget_range, target_audience, comparable_titles, assigned_lane")
        .eq("id", projectId)
        .single();
      if (pErr || !project) throw new Error("Project not found");

      // 2) Extract features
      const features: string[] = [];
      for (const g of (project.genres || [])) {
        // Split compound genre strings like "Romance / Contemporary / Culinary"
        const parts = g.split(/\s*[\/,;]+\s*/).map((p: string) => p.trim().toLowerCase()).filter(Boolean);
        features.push(...parts);
      }
      if (project.tone) {
        const toneParts = project.tone.split(/[\s,\/;]+/).map((t: string) => t.trim().toLowerCase()).filter(Boolean);
        features.push(...toneParts);
      }
      if (project.format) features.push(project.format.toLowerCase().replace(/_/g, '-'));
      if (project.budget_range) features.push(project.budget_range.toLowerCase());
      if (project.target_audience) features.push(...project.target_audience.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 3));
      if (project.comparable_titles) {
        const comps = project.comparable_titles.split(/[,;]+/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
        features.push(...comps);
      }
      if (project.assigned_lane) features.push(project.assigned_lane.toLowerCase());

      // Try to get latest doc text for additional features
      const STOP_WORDS = new Set(["the","and","that","this","with","from","their","they","have","been","were","will","would","could","should","into","about","than","them","then","when","what","which","your","each","make","like","just","over","such","some","only","also","more","very","most","much","many","well","here","there","both","still"]);
      try {
        const { data: docs } = await supabase.from("project_documents")
          .select("id, doc_type").eq("project_id", projectId).in("doc_type", ["concept_brief", "idea", "blueprint"]).limit(3);
        for (const doc of (docs || [])) {
          const { data: ver } = await supabase.from("project_document_versions")
            .select("plaintext").eq("document_id", doc.id).order("version_number", { ascending: false }).limit(1).single();
          if (ver?.plaintext) {
            const words = ver.plaintext.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3 && !STOP_WORDS.has(w));
            const freq: Record<string, number> = {};
            for (const w of words) freq[w] = (freq[w] || 0) + 1;
            const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
            features.push(...sorted.map(([w]) => w));
          }
        }
      } catch { /* non-fatal */ }

      // Remove stop words from all features
      const uniqueFeatures = [...new Set(features)].filter(f => !STOP_WORDS.has(f));

      // Save features — MERGE into existing project_features to preserve production_modality and other keys
      const { data: existingProj } = await supabase.from("projects").select("project_features").eq("id", projectId).single();
      const existingFeatures = (existingProj?.project_features && typeof existingProj.project_features === 'object' && !Array.isArray(existingProj.project_features))
        ? existingProj.project_features as Record<string, unknown>
        : {};
      const mergedFeatures = { ...existingFeatures, signal_tags: uniqueFeatures };
      await supabase.from("projects").update({ project_features: mergedFeatures as any }).eq("id", projectId);

      // 3) Fetch active signals
      const formatBucket = getFormatBucket(project.format);
      const { data: signals } = await supabase
        .from("trend_signals")
        .select("id, name, category, genre_tags, tone_tags, format_tags, lane_relevance, format_applicability, strength, velocity, saturation_risk, explanation, cluster_scoring, sources_used, example_titles")
        .eq("status", "active");

      // 4) Compute matches
      const matches: any[] = [];
      for (const signal of (signals || [])) {
        const applicability = (signal.format_applicability || []) as string[];
        if (applicability.length > 0 && !applicability.some((f: string) => f === formatBucket)) continue;

        const signalTags = [
          ...(signal.genre_tags || []),
          ...(signal.tone_tags || []),
          ...(signal.format_tags || []),
          ...(signal.lane_relevance || []),
          signal.category,
        ].map((t: string) => t.toLowerCase());

        // Use hybrid: Jaccard + tag recall (% of signal tags found in features)
        const featureSet = new Set(uniqueFeatures);
        const matchedSignalTags = signalTags.filter((t: string) => featureSet.has(t));
        const tagRecall = signalTags.length > 0 ? matchedSignalTags.length / signalTags.length : 0;
        const jaccard = jaccardSimilarity(uniqueFeatures, signalTags);
        // Weighted: 60% recall, 40% jaccard — recall is more meaningful when feature sets differ in size
        const similarity = tagRecall * 0.6 + jaccard * 0.4;

        const exampleTitles = ((signal.example_titles || []) as string[]);
        const compBoost = exampleTitles.some((t: string) =>
          uniqueFeatures.some(f => f.includes(t.toLowerCase()) || t.toLowerCase().includes(f))
        ) ? 0.1 : 0;

        const relevanceScore = Math.min(1, similarity + compBoost);
        if (relevanceScore < 0.03) continue;

        const clusterScoring = signal.cluster_scoring as any;
        const total = clusterScoring?.total ?? (signal.strength / 10);
        const impactScore = total * relevanceScore;
        const matchedTags = signalTags.filter((t: string) => uniqueFeatures.includes(t));

        matches.push({
          project_id: projectId,
          cluster_id: signal.id,
          relevance_score: Math.round(relevanceScore * 100) / 100,
          impact_score: Math.round(impactScore * 100) / 100,
          rationale: {
            project_features: uniqueFeatures,
            matched_tags: matchedTags,
            explanation: `${signal.name}: ${matchedTags.length} tag overlap (Jaccard ${(jaccard * 100).toFixed(0)}%)`,
            sources_used: ((signal.sources_used || []) as any[]).slice(0, 5),
          },
        });
      }

      matches.sort((a, b) => b.impact_score - a.impact_score);
      const topMatches = matches.slice(0, 20);

      // 5) Bulk upsert
      if (topMatches.length > 0) {
        const { error: upsertErr } = await supabase
          .from("project_signal_matches")
          .upsert(topMatches, { onConflict: "project_id,cluster_id" });
        if (upsertErr) console.error("Upsert error:", upsertErr);
      }

      // 6) Delete stale matches
      const matchedClusterIds = topMatches.map(m => m.cluster_id);
      if (matchedClusterIds.length > 0) {
        const { data: existing } = await supabase
          .from("project_signal_matches")
          .select("id, cluster_id")
          .eq("project_id", projectId);
        const staleIds = (existing || []).filter(e => !matchedClusterIds.includes(e.cluster_id)).map(e => e.id);
        if (staleIds.length > 0) {
          await supabase.from("project_signal_matches").delete().in("id", staleIds);
        }
      } else {
        // No matches — clear all
        await supabase.from("project_signal_matches").delete().eq("project_id", projectId);
      }

      return new Response(JSON.stringify({ success: true, matchCount: topMatches.length, features: uniqueFeatures }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ACTION: upsert-fact-ledger
    // Parses claims and upserts doc_fact_ledger_items
    // ══════════════════════════════════════════════
    if (action === "upsert-fact-ledger") {
      const { projectId, claims } = body;
      if (!projectId || !Array.isArray(claims)) throw new Error("projectId and claims[] required");

      let created = 0;
      for (const claim of claims) {
        const claimText = typeof claim === "string" ? claim : claim.claim;
        if (!claimText) continue;

        const { data: existing } = await supabase
          .from("doc_fact_ledger_items")
          .select("id")
          .eq("project_id", projectId)
          .eq("claim", claimText)
          .limit(1);

        if (existing && existing.length > 0) {
          if (claim.evidence_type || claim.evidence_link) {
            await supabase.from("doc_fact_ledger_items").update({
              ...(claim.evidence_type ? { evidence_type: claim.evidence_type } : {}),
              ...(claim.evidence_link ? { evidence_link: claim.evidence_link } : {}),
              ...(claim.status ? { status: claim.status } : {}),
            }).eq("id", existing[0].id);
          }
        } else {
          await supabase.from("doc_fact_ledger_items").insert({
            project_id: projectId,
            user_id: userId,
            claim: claimText,
            evidence_type: claim.evidence_type || "unknown",
            evidence_link: claim.evidence_link || null,
            status: claim.status || "needs_check",
          });
          created++;
        }
      }

      return new Response(JSON.stringify({ success: true, claims_processed: claims.length, ledger_items_created: created }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ══════════════════════════════════════════════
    // ACTION: self-test
    // Automated verification harness for signals system
    // ══════════════════════════════════════════════
    if (action === "self-test") {
      const { projectId } = body;
      const results: { test: string; status: "PASS" | "FAIL" | "SKIP"; detail: string }[] = [];

      // E1) Schema presence
      try {
        const { data: ts, error: tsErr } = await supabase.from("trend_signals").select("id").limit(1);
        const { data: to, error: toErr } = await supabase.from("trend_observations").select("id").limit(1);
        const { data: psm, error: psmErr } = await supabase.from("project_signal_matches").select("id").limit(1);
        results.push({
          test: "E1-schema",
          status: (!tsErr && !toErr && !psmErr) ? "PASS" : "FAIL",
          detail: `trend_signals: ${tsErr ? "MISSING" : "OK"}, trend_observations: ${toErr ? "MISSING" : "OK"}, project_signal_matches: ${psmErr ? "MISSING" : "OK"}`,
        });
      } catch (e) {
        results.push({ test: "E1-schema", status: "FAIL", detail: String(e) });
      }

      // E2) Matching check
      if (projectId) {
        try {
          const { data: matches, error: mErr } = await supabase
            .from("project_signal_matches")
            .select("id, cluster_id, impact_score, relevance_score")
            .eq("project_id", projectId);
          const count = matches?.length || 0;
          results.push({
            test: "E2-matching",
            status: count > 0 ? "PASS" : "FAIL",
            detail: `${count} matches for project ${projectId}. ${count === 0 ? "Remediation: run match-project action first, or ensure trend_signals has data and project has features." : `Top score: ${matches?.[0]?.impact_score}`}`,
          });
        } catch (e) {
          results.push({ test: "E2-matching", status: "FAIL", detail: String(e) });
        }

        // E3) Project signals_apply columns
        try {
          const { data: proj } = await supabase.from("projects")
            .select("signals_apply, signals_influence, project_features")
            .eq("id", projectId).single();
          const apply = (proj as any)?.signals_apply;
          const influence = (proj as any)?.signals_influence;
          const features = (proj as any)?.project_features;
          results.push({
            test: "E3-project-config",
            status: apply && influence != null ? "PASS" : "FAIL",
            detail: `signals_apply=${JSON.stringify(apply)}, signals_influence=${influence}, features_count=${Array.isArray(features) ? features.length : 0}`,
          });
        } catch (e) {
          results.push({ test: "E3-project-config", status: "FAIL", detail: String(e) });
        }
      } else {
        results.push({ test: "E2-matching", status: "SKIP", detail: "No projectId provided" });
        results.push({ test: "E3-project-config", status: "SKIP", detail: "No projectId provided" });
      }

      // E4) Trend signals exist
      try {
        const { data: signals, error } = await supabase.from("trend_signals")
          .select("id, name, cluster_scoring")
          .order("created_at", { ascending: false })
          .limit(5);
        const withScoring = (signals || []).filter((s: any) => s.cluster_scoring?.total != null);
        results.push({
          test: "E4-signals-scored",
          status: (signals?.length || 0) > 0 ? "PASS" : "FAIL",
          detail: `${signals?.length || 0} signals total, ${withScoring.length} with cluster_scoring.total`,
        });
      } catch (e) {
        results.push({ test: "E4-signals-scored", status: "FAIL", detail: String(e) });
      }

      // E5) Observations exist
      try {
        const { count } = await supabase.from("trend_observations").select("id", { count: "exact", head: true });
        results.push({
          test: "E5-observations",
          status: (count || 0) > 0 ? "PASS" : "FAIL",
          detail: `${count || 0} observations in DB`,
        });
      } catch (e) {
        results.push({ test: "E5-observations", status: "FAIL", detail: String(e) });
      }

      // E6) Doc fact ledger table exists
      try {
        const { error } = await supabase.from("doc_fact_ledger_items").select("id").limit(1);
        results.push({
          test: "E6-doc-fact-ledger",
          status: !error ? "PASS" : "FAIL",
          detail: error ? `Table error: ${error.message}` : "OK",
        });
      } catch (e) {
        results.push({ test: "E6-doc-fact-ledger", status: "FAIL", detail: String(e) });
      }

      const allPassed = results.every(r => r.status !== "FAIL");
      return new Response(JSON.stringify({ overall: allPassed ? "PASS" : "FAIL", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("signals-engine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
