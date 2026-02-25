import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, extractJSON } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "find_candidates":
        return await handleFindCandidates(supabase, body);
      case "set_influencers":
        return await handleSetInfluencers(supabase, body);
      case "build_engine_profile":
        return await handleBuildEngineProfile(supabase, body);
      case "apply_override":
        return await handleApplyOverride(supabase, body);
      case "resolve_rules_for_run":
        return await handleResolveRules(supabase, body);
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    console.error("comps-engine error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── find_candidates ────────────────────────────────────────────

async function handleFindCandidates(supabase: any, body: any) {
  const { project_id, lane, filters = {}, seed_text = {}, user_id } = body;
  if (!project_id || !lane || !user_id) {
    return jsonResp({ error: "project_id, lane, user_id required" }, 400);
  }

  const prompt = buildCandidatePrompt(lane, filters, seed_text);
  const result = await callLLM({
    apiKey: "lovable-ai",
    model: MODELS.FAST,
    system: `You are a film/TV comparables analyst. Given project info, suggest 12 comparable titles.
Return ONLY a JSON array of objects with: title, year, format (film|series|vertical|other), region, genres (string[]), rationale (1-2 sentences), confidence (0-1).
No commentary outside the JSON array.`,
    user: prompt,
    temperature: 0.7,
    maxTokens: 4000,
  });

  let candidates: any[];
  try {
    candidates = JSON.parse(extractJSON(result.content));
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    candidates = [];
  }

  // Persist
  const rows = candidates.slice(0, 20).map((c: any) => ({
    project_id,
    lane,
    query: { filters, seed_text },
    title: c.title || "Unknown",
    year: c.year || null,
    format: c.format || "film",
    region: c.region || null,
    genres: c.genres || [],
    rationale: c.rationale || "",
    confidence: c.confidence || 0,
    source_urls: [],
    created_by: user_id,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("comparable_candidates").insert(rows);
    if (error) console.error("Insert candidates error:", error);
  }

  // Fetch back with ids
  const { data } = await supabase
    .from("comparable_candidates")
    .select("*")
    .eq("project_id", project_id)
    .eq("lane", lane)
    .order("created_at", { ascending: false })
    .limit(20);

  return jsonResp({ candidates: data || [] });
}

function buildCandidatePrompt(lane: string, filters: any, seed: any): string {
  const parts = [`Lane: ${lane}`];
  if (seed.logline) parts.push(`Logline: ${seed.logline}`);
  if (seed.premise) parts.push(`Premise: ${seed.premise}`);
  if (seed.themes) parts.push(`Themes: ${seed.themes}`);
  if (filters.genres?.length) parts.push(`Genre filter: ${filters.genres.join(", ")}`);
  if (filters.region) parts.push(`Region: ${filters.region}`);
  if (filters.years) parts.push(`Years: ${filters.years}`);
  if (filters.format) parts.push(`Format: ${filters.format}`);
  return parts.join("\n");
}

// ─── set_influencers ────────────────────────────────────────────

async function handleSetInfluencers(supabase: any, body: any) {
  const { project_id, lane, influencer_selections, user_id } = body;
  if (!project_id || !lane || !user_id || !Array.isArray(influencer_selections)) {
    return jsonResp({ error: "project_id, lane, user_id, influencer_selections required" }, 400);
  }

  for (const sel of influencer_selections) {
    const { error } = await supabase.from("comparable_influencers").upsert(
      {
        project_id,
        lane,
        candidate_id: sel.candidate_id,
        influencer_weight: sel.weight ?? 1.0,
        influence_dimensions: sel.dimensions ?? ["pacing", "stakes_ladder"],
        emulate_tags: sel.emulate_tags ?? [],
        avoid_tags: sel.avoid_tags ?? [],
        created_by: user_id,
      },
      { onConflict: "project_id,lane,candidate_id" }
    );
    if (error) console.error("Upsert influencer error:", error);
  }

  const { data } = await supabase
    .from("comparable_influencers")
    .select("*, comparable_candidates(*)")
    .eq("project_id", project_id)
    .eq("lane", lane);

  return jsonResp({ influencers: data || [] });
}

// ─── build_engine_profile ───────────────────────────────────────

async function handleBuildEngineProfile(supabase: any, body: any) {
  const { project_id, lane, user_id } = body;
  if (!project_id || !lane || !user_id) {
    return jsonResp({ error: "project_id, lane, user_id required" }, 400);
  }

  // Load influencers
  const { data: influencers } = await supabase
    .from("comparable_influencers")
    .select("*, comparable_candidates(*)")
    .eq("project_id", project_id)
    .eq("lane", lane);

  // Build default profile
  const profile = buildDerivedProfile(lane, influencers || []);
  const conflicts = detectProfileConflicts(profile, lane);
  const summary = generateSummary(profile);

  // Deactivate old profiles
  await supabase
    .from("engine_profiles")
    .update({ is_active: false })
    .eq("project_id", project_id)
    .eq("lane", lane)
    .eq("is_active", true);

  // Insert new
  const { data: inserted, error } = await supabase
    .from("engine_profiles")
    .insert({
      project_id,
      lane,
      name: "Derived from comps",
      derived_from_influencers: (influencers || []).map((i: any) => ({
        id: i.id,
        candidate_id: i.candidate_id,
        title: i.comparable_candidates?.title,
        weight: i.influencer_weight,
        dimensions: i.influence_dimensions,
      })),
      rules: profile,
      rules_summary: summary,
      conflicts,
      created_by: user_id,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return jsonResp({ error: error.message }, 500);
  }

  return jsonResp({ profile: inserted });
}

// ─── apply_override ─────────────────────────────────────────────

async function handleApplyOverride(supabase: any, body: any) {
  const { project_id, lane, scope, target_run_id, patch, user_id } = body;
  if (!project_id || !lane || !scope || !patch || !user_id) {
    return jsonResp({ error: "project_id, lane, scope, patch, user_id required" }, 400);
  }

  const patchSummary = Array.isArray(patch)
    ? patch.map((p: any) => `${p.op} ${p.path} = ${JSON.stringify(p.value)}`).join("; ")
    : "Custom override";

  const { data, error } = await supabase
    .from("engine_overrides")
    .insert({
      project_id,
      lane,
      scope,
      target_run_id: target_run_id || null,
      patch,
      patch_summary: patchSummary,
      created_by: user_id,
    })
    .select()
    .single();

  if (error) return jsonResp({ error: error.message }, 500);
  return jsonResp({ override: data });
}

// ─── resolve_rules_for_run ──────────────────────────────────────

async function handleResolveRules(supabase: any, body: any) {
  const { project_id, lane, run_id, run_type, engine_profile_id, user_id } = body;
  if (!project_id || !lane || !run_id || !run_type || !user_id) {
    return jsonResp({ error: "project_id, lane, run_id, run_type, user_id required" }, 400);
  }

  // 1. Load engine profile (specified or active)
  let profileRules: any = null;
  let profileId = engine_profile_id || null;
  if (profileId) {
    const { data } = await supabase.from("engine_profiles").select("rules").eq("id", profileId).single();
    if (data) profileRules = data.rules;
  } else {
    const { data } = await supabase
      .from("engine_profiles")
      .select("id, rules")
      .eq("project_id", project_id)
      .eq("lane", lane)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      profileRules = data.rules;
      profileId = data.id;
    }
  }

  // 2. Start with lane defaults if no profile
  const defaults = getDefaultProfile(lane);
  let resolved = profileRules || defaults;

  // 3. Apply project_default overrides
  const { data: projectOverrides } = await supabase
    .from("engine_overrides")
    .select("patch")
    .eq("project_id", project_id)
    .eq("lane", lane)
    .eq("scope", "project_default")
    .order("created_at", { ascending: true });

  const overrideIds: string[] = [];
  if (projectOverrides) {
    for (const o of projectOverrides) {
      resolved = applyPatches(resolved, o.patch);
      overrideIds.push(o.id);
    }
  }

  // 4. Apply run-only overrides
  const { data: runOverrides } = await supabase
    .from("engine_overrides")
    .select("id, patch")
    .eq("project_id", project_id)
    .eq("lane", lane)
    .eq("scope", "run")
    .eq("target_run_id", run_id)
    .order("created_at", { ascending: true });

  if (runOverrides) {
    for (const o of runOverrides) {
      resolved = applyPatches(resolved, o.patch);
      overrideIds.push(o.id);
    }
  }

  // 5. Generate summary
  const summary = generateSummary(resolved);

  // 6. Persist story_rulesets
  const { data: ruleset, error } = await supabase
    .from("story_rulesets")
    .insert({
      project_id,
      lane,
      run_type,
      run_id,
      engine_profile_id: profileId,
      override_ids: overrideIds,
      resolved_rules: resolved,
      resolved_summary: summary,
      created_by: user_id,
    })
    .select()
    .single();

  if (error) return jsonResp({ error: error.message }, 500);
  return jsonResp({ ruleset });
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getDefaultProfile(lane: string): any {
  const base = {
    version: "1.0", lane,
    comps: { influencers: [], tags: [] },
    engine: { story_engine: "pressure_cooker", causal_grammar: "accumulation", conflict_mode: "moral_trap" },
    pacing_profile: { beats_per_minute: { min: 2, target: 3, max: 5 }, cliffhanger_rate: { target: 0.5, max: 0.7 }, quiet_beats_min: 3, subtext_scenes_min: 4, meaning_shifts_min_per_act: 1 },
    stakes_ladder: { early_allowed: ["personal"], no_global_before_pct: 0.20, late_allowed: ["systemic"], notes: "Personal stakes only until final 20%" },
    budgets: { drama_budget: 2, twist_cap: 1, big_reveal_cap: 1, plot_thread_cap: 3, core_character_cap: 5, faction_cap: 1, coincidence_cap: 1 },
    dialogue_rules: { subtext_ratio_target: 0.55, monologue_max_lines: 6, no_speeches: true, absolute_words_penalty: true },
    texture_rules: { money_time_institution_required: true, cost_of_action_required: true, admin_violence_preferred: true },
    antagonism_model: { primary: "system", legitimacy_required: true, no_omnipotence: true },
    forbidden_moves: ["secret_organization", "omniscient_surveillance", "sniper_assassination", "helicopter_extraction", "villain_monologue", "everything_is_connected"],
    signature_devices: ["meaning_shift_instead_of_twist", "leverage_over_violence", "polite_threats", "status_choreography"],
    gate_thresholds: { melodrama_max: 0.50, similarity_max: 0.60, complexity_threads_max: 3, complexity_factions_max: 1, complexity_core_chars_max: 5 },
  };

  if (lane === "vertical_drama") {
    return { ...base, engine: { ...base.engine, conflict_mode: "status_reputation" },
      pacing_profile: { ...base.pacing_profile, cliffhanger_rate: { target: 0.9, max: 1.0 }, quiet_beats_min: 1, subtext_scenes_min: 2 },
      stakes_ladder: { early_allowed: ["personal", "social"], no_global_before_pct: 0.25, late_allowed: ["systemic"], notes: "Allow personal/social early; NO global before final 25%" },
      budgets: { ...base.budgets, drama_budget: 3, twist_cap: 2, big_reveal_cap: 1, core_character_cap: 6, faction_cap: 2 },
      gate_thresholds: { melodrama_max: 0.62, similarity_max: 0.70, complexity_threads_max: 3, complexity_factions_max: 2, complexity_core_chars_max: 6 },
    };
  }
  if (lane === "series") {
    return { ...base, engine: { ...base.engine, conflict_mode: "family_obligation" },
      pacing_profile: { ...base.pacing_profile, quiet_beats_min: 2, subtext_scenes_min: 3 },
      budgets: { ...base.budgets, drama_budget: 2, twist_cap: 1 },
      gate_thresholds: { melodrama_max: 0.35, similarity_max: 0.65, complexity_threads_max: 3, complexity_factions_max: 2, complexity_core_chars_max: 5 },
    };
  }
  if (lane === "documentary") {
    return { ...base,
      engine: { story_engine: "slow_burn_investigation", causal_grammar: "accumulation", conflict_mode: "legal_procedural" },
      pacing_profile: { ...base.pacing_profile, quiet_beats_min: 3, subtext_scenes_min: 2 },
      budgets: { ...base.budgets, drama_budget: 1, twist_cap: 0, big_reveal_cap: 0, faction_cap: 1 },
      gate_thresholds: { melodrama_max: 0.15, similarity_max: 0.70, complexity_threads_max: 3, complexity_factions_max: 1, complexity_core_chars_max: 5 },
    };
  }
  return base;
}

function buildDerivedProfile(lane: string, influencers: any[]): any {
  const profile = getDefaultProfile(lane);
  if (!influencers.length) return profile;

  profile.comps.influencers = influencers.map((i: any) => ({
    title: i.comparable_candidates?.title || "Unknown",
    year: i.comparable_candidates?.year,
    format: i.comparable_candidates?.format || "film",
    weight: i.influencer_weight,
    dimensions: i.influence_dimensions || [],
  }));

  const allAvoid = new Set<string>();
  for (const inf of influencers) {
    for (const tag of (inf.avoid_tags || [])) {
      allAvoid.add(tag);
    }
  }
  for (const tag of allAvoid) {
    if (!profile.forbidden_moves.includes(tag)) profile.forbidden_moves.push(tag);
  }

  // Heuristic adjustments based on dimension weights
  let totalWeight = 0;
  const dimW: Record<string, number> = {};
  for (const inf of influencers) {
    for (const dim of (inf.influence_dimensions || [])) {
      dimW[dim] = (dimW[dim] || 0) + (inf.influencer_weight || 1);
    }
    totalWeight += inf.influencer_weight || 1;
  }
  if (totalWeight > 0) {
    if (dimW.pacing) {
      const s = Math.min(1, dimW.pacing / totalWeight);
      profile.pacing_profile.beats_per_minute.target = Math.min(
        profile.pacing_profile.beats_per_minute.max,
        Math.round(profile.pacing_profile.beats_per_minute.target + s)
      );
    }
    if (dimW.twist_budget && dimW.twist_budget / totalWeight > 0.6) {
      profile.budgets.twist_cap = Math.min(3, profile.budgets.twist_cap + 1);
    }
    if (dimW.stakes_ladder) {
      const s = Math.min(1, dimW.stakes_ladder / totalWeight);
      if (s > 0.5 && !profile.stakes_ladder.early_allowed.includes("social")) {
        profile.stakes_ladder.early_allowed.push("social");
      }
    }
    if (dimW.dialogue_style) {
      const s = Math.min(1, dimW.dialogue_style / totalWeight);
      profile.dialogue_rules.subtext_ratio_target = Math.min(0.8, profile.dialogue_rules.subtext_ratio_target + s * 0.1);
    }
  }

  return profile;
}

function detectProfileConflicts(profile: any, lane: string): any[] {
  const defaults = getDefaultProfile(lane);
  const conflicts: any[] = [];

  if (profile.budgets.twist_cap > defaults.budgets.twist_cap + 1) {
    conflicts.push({
      id: "twist_vs_restraint", severity: "warn", dimension: "twist_budget",
      message: `Twist cap (${profile.budgets.twist_cap}) exceeds lane default (${defaults.budgets.twist_cap}).`,
      inferred_value: String(profile.budgets.twist_cap), expected_value: String(defaults.budgets.twist_cap),
      suggested_actions: ["honor_comps", "honor_overrides"],
    });
  }

  if (profile.stakes_ladder.no_global_before_pct < defaults.stakes_ladder.no_global_before_pct - 0.05) {
    conflicts.push({
      id: "early_global_stakes", severity: "warn", dimension: "stakes_ladder",
      message: `Global stakes earlier (${Math.round(profile.stakes_ladder.no_global_before_pct * 100)}%) than default (${Math.round(defaults.stakes_ladder.no_global_before_pct * 100)}%).`,
      inferred_value: String(profile.stakes_ladder.no_global_before_pct), expected_value: String(defaults.stakes_ladder.no_global_before_pct),
      suggested_actions: ["honor_overrides", "blend"],
    });
  }

  for (const move of defaults.forbidden_moves) {
    if (!profile.forbidden_moves.includes(move)) {
      conflicts.push({
        id: `missing_forbidden_${move}`, severity: "hard", dimension: "forbidden_moves",
        message: `Default forbidden move "${move}" not in derived profile.`,
        inferred_value: "allowed", expected_value: "forbidden",
        suggested_actions: ["honor_overrides"],
      });
    }
  }

  return conflicts;
}

function generateSummary(profile: any): string {
  const lines = [
    `Lane: ${profile.lane}`,
    `Engine: ${profile.engine?.story_engine} / ${profile.engine?.causal_grammar} / ${profile.engine?.conflict_mode}`,
    `Drama: ${profile.budgets?.drama_budget}, Twists: ${profile.budgets?.twist_cap}, Reveals: ${profile.budgets?.big_reveal_cap}`,
    `Chars: max ${profile.budgets?.core_character_cap}, Threads: max ${profile.budgets?.plot_thread_cap}`,
    `Quiet beats: min ${profile.pacing_profile?.quiet_beats_min}, Subtext: min ${profile.pacing_profile?.subtext_scenes_min}`,
    `Stakes: ${(profile.stakes_ladder?.early_allowed || []).join("/")} early; no global before ${Math.round((profile.stakes_ladder?.no_global_before_pct || 0.2) * 100)}%`,
  ];
  if (profile.comps?.influencers?.length) {
    lines.push(`Comps: ${profile.comps.influencers.map((i: any) => i.title).join(", ")}`);
  }
  return lines.join("\n");
}

function applyPatches(obj: any, patches: any): any {
  const result = JSON.parse(JSON.stringify(obj));
  if (!Array.isArray(patches)) return result;
  for (const p of patches) {
    const parts = (p.path || "").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let target = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) target[parts[i]] = {};
      target = target[parts[i]];
    }
    if (p.op === "remove") {
      delete target[parts[parts.length - 1]];
    } else {
      target[parts[parts.length - 1]] = p.value;
    }
  }
  return result;
}
