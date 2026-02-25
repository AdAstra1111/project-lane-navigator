import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, MODELS, parseAiJson } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEED_CHAR_LIMIT = 20_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "find_candidates":
        return await handleFindCandidates(supabase, body, apiKey);
      case "lookup_comp":
        return await handleLookupComp(supabase, body, apiKey);
      case "confirm_lookup":
        return await handleConfirmLookup(supabase, body);
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

// ─── buildSeedFromProject ───────────────────────────────────────

interface SeedSource {
  doc_id: string;
  title: string;
  kind: string;
  updated_at: string;
  used_chars: number;
}

interface SeedDebugEntry {
  doc_id: string;
  kind: string;
  reason: string;
  extracted_chars: number;
}

interface SeedResult {
  seed_text: string;
  seed_sources: SeedSource[];
  fallback_reason?: string;
  debug?: { found_docs: number; tried: SeedDebugEntry[] };
}

const DOC_PRIORITY_BY_LANE: Record<string, string[]> = {
  vertical_drama: ["beats", "episode_grid", "outline", "script", "concept_brief", "idea", "notes"],
  feature_film: ["script", "outline", "treatment", "concept_brief", "idea", "notes"],
  series: ["outline", "beats", "episode_grid", "script", "concept_brief", "idea", "notes"],
  documentary: ["outline", "treatment", "concept_brief", "idea", "notes", "script"],
};

async function buildSeedFromProject(supabase: any, projectId: string, lane: string, apiKey: string): Promise<SeedResult> {
  const debugTried: SeedDebugEntry[] = [];

  // 1. Load all project_documents with both text columns
  const { data: projDocs } = await supabase
    .from("project_documents")
    .select("id, title, file_name, doc_type, extracted_text, plaintext, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(30);

  const allDocs = projDocs || [];

  if (allDocs.length === 0) {
    return { seed_text: "", seed_sources: [], fallback_reason: "no_docs", debug: { found_docs: 0, tried: [] } };
  }

  // 2. For each doc, resolve best available text (plaintext > extracted_text > version plaintext)
  const docsWithResolvedText: any[] = [];

  for (const doc of allDocs) {
    // Try plaintext first (dev-engine docs like Idea store content here)
    let text = (doc.plaintext || "").trim();
    let textSource = "plaintext";

    // Fall back to extracted_text (uploaded PDF/file docs)
    if (text.length < 50 && doc.extracted_text) {
      text = (doc.extracted_text || "").trim();
      textSource = "extracted_text";
    }

    // If still empty, try latest version's plaintext
    if (text.length < 50) {
      const { data: versions } = await supabase
        .from("project_document_versions")
        .select("id, plaintext, version_number")
        .eq("document_id", doc.id)
        .order("version_number", { ascending: false })
        .limit(1);

      if (versions?.[0]?.plaintext && versions[0].plaintext.trim().length > 0) {
        text = versions[0].plaintext.trim();
        textSource = "version_plaintext";
      }
    }

    const displayTitle = doc.title || doc.display_name || doc.file_name || "Untitled";

    if (text.length < 50) {
      debugTried.push({ doc_id: doc.id, kind: doc.doc_type || "unknown", reason: `only ${text.length} chars from ${textSource}`, extracted_chars: text.length });
      continue;
    }

    docsWithResolvedText.push({ ...doc, resolvedText: text, displayTitle });
    debugTried.push({ doc_id: doc.id, kind: doc.doc_type || "unknown", reason: "ok", extracted_chars: text.length });
  }

  // 3. Sort by lane priority
  const priority = DOC_PRIORITY_BY_LANE[lane] || DOC_PRIORITY_BY_LANE.feature_film;
  docsWithResolvedText.sort((a: any, b: any) => {
    const aIdx = priority.indexOf(a.doc_type) >= 0 ? priority.indexOf(a.doc_type) : 99;
    const bIdx = priority.indexOf(b.doc_type) >= 0 ? priority.indexOf(b.doc_type) : 99;
    return aIdx - bIdx;
  });

  // 4. Pick up to 3 docs, respecting char limit
  const selectedDocs: any[] = [];
  let totalChars = 0;

  for (const doc of docsWithResolvedText) {
    if (selectedDocs.length >= 3) break;
    const text = doc.resolvedText;
    const available = Math.min(text.length, SEED_CHAR_LIMIT - totalChars);
    if (available < 50) break;
    selectedDocs.push({ ...doc, trimmedText: text.substring(0, available) });
    totalChars += available;
  }

  if (selectedDocs.length === 0) {
    const reasons = debugTried.map(d => `${d.kind}(${d.extracted_chars}ch): ${d.reason}`).join("; ");
    return {
      seed_text: "", seed_sources: [],
      fallback_reason: `no_usable_text — found ${allDocs.length} doc(s) but none had ≥50 chars. Details: ${reasons}`,
      debug: { found_docs: allDocs.length, tried: debugTried },
    };
  }

  const seed_sources: SeedSource[] = selectedDocs.map((d: any) => ({
    doc_id: d.id,
    title: d.displayTitle || d.title || "Untitled",
    kind: d.doc_type || "other",
    updated_at: d.updated_at || "",
    used_chars: d.trimmedText.length,
  }));

  // 5. Build seed summary via LLM (1 small call)
  const combinedText = selectedDocs.map((d: any) =>
    `--- ${d.displayTitle || d.title || "Document"} (${d.doc_type || "unknown"}) ---\n${d.trimmedText}`
  ).join("\n\n");

  try {
    const result = await callLLM({
      apiKey,
      model: MODELS.FAST,
      system: `You are a script analyst. Given project documents, produce a concise seed summary (600-1200 words) that captures:
- Genre + tone tags
- Premise in 2-3 lines
- Protagonist / goal / obstacle
- Setting + world texture
- Stakes (personal/social/systemic)
- Hooks (do NOT name comparable titles)
Return ONLY the summary text, no JSON, no formatting headers.`,
      user: combinedText.substring(0, 18000),
      temperature: 0.3,
      maxTokens: 2000,
    });
    return { seed_text: result.content || "", seed_sources, debug: { found_docs: allDocs.length, tried: debugTried } };
  } catch (e) {
    console.error("Seed summary LLM error:", e);
    return {
      seed_text: combinedText.substring(0, 3000),
      seed_sources,
      fallback_reason: "llm_summary_failed",
      debug: { found_docs: allDocs.length, tried: debugTried },
    };
  }
}

// ─── find_candidates ────────────────────────────────────────────

async function handleFindCandidates(supabase: any, body: any, apiKey: string) {
  const {
    project_id, lane, filters = {}, user_id,
    use_project_docs = true, seed_override = null, seed_text: legacySeed = {},
    include_films = false, include_series = true, include_vertical = true,
  } = body;
  if (!project_id || !lane || !user_id) {
    return jsonResp({ error: "project_id, lane, user_id required" }, 400);
  }

  let seedText = "";
  let seedSources: SeedSource[] = [];
  let fallbackReason: string | undefined;
  let seedDebug: any = undefined;

  // 1. Determine seed
  if (seed_override && typeof seed_override === "string" && seed_override.trim().length > 0) {
    seedText = seed_override.trim();
  } else if (use_project_docs) {
    const seedResult = await buildSeedFromProject(supabase, project_id, lane, apiKey);
    seedText = seedResult.seed_text;
    seedSources = seedResult.seed_sources;
    fallbackReason = seedResult.fallback_reason;
    seedDebug = seedResult.debug;
  } else if (legacySeed?.logline || legacySeed?.premise) {
    seedText = [legacySeed.logline, legacySeed.premise, legacySeed.themes].filter(Boolean).join("\n");
  }

  if (!seedText || seedText.trim().length < 20) {
    return jsonResp({
      candidates: [],
      buckets: { vertical: [], series: [], film: [] },
      seed_sources: seedSources,
      fallback_reason: fallbackReason || "no_seed_available",
      debug: seedDebug,
      message: "No usable seed found. Upload a script/outline, run Analysis, or provide a seed manually.",
    });
  }

  // 2. Build format-aware prompt
  const prompt = buildCandidatePrompt(lane, filters, seedText, { include_films, include_series, include_vertical });

  // Format-specific system instructions
  const formatInstructions = lane === "vertical_drama"
    ? `CRITICAL: This project is a VERTICAL DRAMA (short-form, 120-180 second episodes).
You MUST prioritize:
1. At least 4-6 short-form vertical drama titles (format="vertical") — TikTok/Reels/Shorts dramas, vertical web series, short-form digital dramas.
2. 3-4 format-adjacent series (format="series") — K-dramas, YA series, romcom series with similar tone/mechanics.
${include_films ? '3. 2-3 films (format="film") with similar tone/premise — clearly labeled as film comps.' : 'Do NOT include any films unless explicitly asked.'}
Each item MUST have a "format_bucket" field: "vertical" (primary), "series" (format-adjacent), or "film" (optional).
Each item MUST have a "why_this_comp" field explaining why it fits this vertical drama project.`
    : `Return a mix of titles appropriate for lane "${lane}".
Each item MUST have a "format_bucket" field: "vertical", "series", or "film".
Each item MUST have a "why_this_comp" field explaining why it fits.`;

  const result = await callLLM({
    apiKey,
    model: MODELS.FAST,
    system: `You are a film/TV comparables analyst. Given project info, suggest 12 comparable titles.
${formatInstructions}
Return ONLY a JSON array of objects with: title, year, format (film|series|vertical|other), format_bucket (vertical|series|film), region, genres (string[]), rationale (1-2 sentences), why_this_comp (1 sentence), confidence (0-1).
No commentary outside the JSON array.`,
    user: prompt,
    temperature: 0.7,
    maxTokens: 4000,
  });

  let candidates: any[];
  try {
    const parsed = parseAiJson(result.content, { handler: "find_candidates", model: MODELS.FAST });
    candidates = Array.isArray(parsed) ? parsed : (parsed?.candidates || []);
  } catch (e) {
    console.error("find_candidates parse error:", e);
    candidates = [];
  }

  // Normalize format_bucket
  candidates = candidates.map((c: any) => {
    let bucket = (c.format_bucket || c.format || "film").toLowerCase();
    if (bucket === "vertical_drama" || bucket === "short-form" || bucket === "vertical") bucket = "vertical";
    else if (bucket === "series" || bucket === "tv" || bucket === "streaming") bucket = "series";
    else bucket = "film";
    return { ...c, format_bucket: bucket };
  });

  // Filter out excluded formats for vertical_drama
  if (lane === "vertical_drama") {
    if (!include_films) {
      candidates = candidates.filter((c: any) => c.format_bucket !== "film");
    }
    if (!include_series) {
      candidates = candidates.filter((c: any) => c.format_bucket !== "series");
    }
  }

  // 3. Persist
  const queryMeta = { filters, seed_sources: seedSources, use_project_docs, has_seed_override: !!seed_override, include_films, include_series };
  const rows = candidates.slice(0, 20).map((c: any) => ({
    project_id,
    lane,
    query: { ...queryMeta, format_bucket: c.format_bucket, why_this_comp: c.why_this_comp },
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

  // 4. Fetch back with ids
  const { data } = await supabase
    .from("comparable_candidates")
    .select("*")
    .eq("project_id", project_id)
    .eq("lane", lane)
    .order("created_at", { ascending: false })
    .limit(20);

  // 5. Bucket the results
  const allCandidates = data || [];
  const buckets = {
    vertical: allCandidates.filter((c: any) => (c.query?.format_bucket || inferBucket(c.format)) === "vertical"),
    series: allCandidates.filter((c: any) => (c.query?.format_bucket || inferBucket(c.format)) === "series"),
    film: allCandidates.filter((c: any) => (c.query?.format_bucket || inferBucket(c.format)) === "film"),
  };

  return jsonResp({
    candidates: allCandidates,
    buckets,
    seed_sources: seedSources,
    seed_text_preview: seedText.substring(0, 500),
    fallback_reason: fallbackReason,
    debug: seedDebug,
  });
}

function inferBucket(format: string): string {
  const f = (format || "").toLowerCase();
  if (f === "vertical" || f === "vertical_drama" || f === "short-form") return "vertical";
  if (f === "series" || f === "tv" || f === "streaming") return "series";
  return "film";
}

function buildCandidatePrompt(lane: string, filters: any, seedText: string, formatPrefs?: { include_films?: boolean; include_series?: boolean; include_vertical?: boolean }): string {
  const parts = [`Lane: ${lane}`];
  if (lane === "vertical_drama") {
    parts.push("Format: VERTICAL DRAMA (short-form, 120-180s episodes, mobile-first)");
    parts.push("IMPORTANT: Prioritize vertical/short-form dramas. Series comps are secondary. Films are lowest priority.");
  }
  parts.push(`\nProject Seed:\n${seedText}`);
  if (filters.genres?.length) parts.push(`Genre filter: ${filters.genres.join(", ")}`);
  if (filters.region) parts.push(`Region: ${filters.region}`);
  if (filters.years) parts.push(`Years: ${filters.years}`);
  if (filters.format) parts.push(`Format: ${filters.format}`);
  if (formatPrefs) {
    const included = [];
    if (formatPrefs.include_vertical) included.push("vertical");
    if (formatPrefs.include_series) included.push("series");
    if (formatPrefs.include_films) included.push("film");
    parts.push(`Allowed formats: ${included.join(", ")}`);
  }
  return parts.join("\n");
}

// ─── lookup_comp ────────────────────────────────────────────────

async function handleLookupComp(_supabase: any, body: any, apiKey: string) {
  const { query, lane, format_hint, region_hint } = body;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return jsonResp({ error: "query is required (comp title to lookup)" }, 400);
  }

  const hints = [
    `User is looking up: "${query.trim()}"`,
    lane ? `Lane context: ${lane}` : "",
    format_hint ? `Format hint: ${format_hint}` : "",
    region_hint ? `Region hint: ${region_hint}` : "",
  ].filter(Boolean).join("\n");

  const result = await callLLM({
    apiKey,
    model: MODELS.FAST,
    system: `You are a film/TV metadata expert. Given a comp title query, return 3-6 likely matches.
Return ONLY a JSON array of objects with: title (string), year (number|null), format (film|series|vertical|other), region (string|null), genres (string[]), confidence (0-1), rationale (1 sentence explaining what this title is).
If the query is ambiguous (e.g. multiple films with same name), return all relevant matches with different years.
No commentary outside the JSON array.`,
    user: hints,
    temperature: 0.3,
    maxTokens: 2000,
  });

  let matches: any[];
  try {
    const parsed = parseAiJson(result.content, { handler: "lookup_comp", model: MODELS.FAST });
    matches = Array.isArray(parsed) ? parsed : (parsed?.matches || []);
  } catch (e) {
    console.error("lookup_comp parse error:", e);
    matches = [];
  }

  return jsonResp({ query: query.trim(), matches });
}

// ─── confirm_lookup ─────────────────────────────────────────────

async function handleConfirmLookup(supabase: any, body: any) {
  const { project_id, lane, user_id, match } = body;
  if (!project_id || !lane || !user_id || !match) {
    return jsonResp({ error: "project_id, lane, user_id, match required" }, 400);
  }

  const { data, error } = await supabase
    .from("comparable_candidates")
    .insert({
      project_id,
      lane,
      query: { source: "user_requested_lookup", lookup_query: match.lookup_query || match.title, user_validated: true },
      title: match.title || "Unknown",
      year: match.year || null,
      format: match.format || "film",
      region: match.region || null,
      genres: match.genres || [],
      rationale: match.rationale || "User-validated comparable",
      confidence: match.confidence || 1.0,
      source_urls: match.source_urls || [],
      created_by: user_id,
    })
    .select()
    .single();

  if (error) return jsonResp({ error: error.message }, 500);
  return jsonResp({ candidate: data });
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

  const { data: influencers } = await supabase
    .from("comparable_influencers")
    .select("*, comparable_candidates(*)")
    .eq("project_id", project_id)
    .eq("lane", lane);

  const profile = buildDerivedProfile(lane, influencers || []);
  const conflicts = detectProfileConflicts(profile, lane);
  const summary = generateSummary(profile);

  await supabase
    .from("engine_profiles")
    .update({ is_active: false })
    .eq("project_id", project_id)
    .eq("lane", lane)
    .eq("is_active", true);

  const { data: inserted, error } = await supabase
    .from("engine_profiles")
    .insert({
      project_id, lane,
      name: "Derived from comps",
      derived_from_influencers: (influencers || []).map((i: any) => ({
        id: i.id, candidate_id: i.candidate_id,
        title: i.comparable_candidates?.title, weight: i.influencer_weight,
        dimensions: i.influence_dimensions,
      })),
      rules: profile, rules_summary: summary, conflicts,
      created_by: user_id, is_active: true,
    })
    .select().single();

  if (error) return jsonResp({ error: error.message }, 500);
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
    .insert({ project_id, lane, scope, target_run_id: target_run_id || null, patch, patch_summary: patchSummary, created_by: user_id })
    .select().single();

  if (error) return jsonResp({ error: error.message }, 500);
  return jsonResp({ override: data });
}

// ─── resolve_rules_for_run ──────────────────────────────────────

async function handleResolveRules(supabase: any, body: any) {
  const { project_id, lane, run_id, run_type, engine_profile_id, user_id } = body;
  if (!project_id || !lane || !run_id || !run_type || !user_id) {
    return jsonResp({ error: "project_id, lane, run_id, run_type, user_id required" }, 400);
  }

  let profileRules: any = null;
  let profileId = engine_profile_id || null;
  if (profileId) {
    const { data } = await supabase.from("engine_profiles").select("rules").eq("id", profileId).single();
    if (data) profileRules = data.rules;
  } else {
    const { data } = await supabase.from("engine_profiles").select("id, rules")
      .eq("project_id", project_id).eq("lane", lane).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) { profileRules = data.rules; profileId = data.id; }
  }

  const defaults = getDefaultProfile(lane);
  let resolved = profileRules || defaults;

  const { data: projectOverrides } = await supabase.from("engine_overrides").select("patch")
    .eq("project_id", project_id).eq("lane", lane).eq("scope", "project_default")
    .order("created_at", { ascending: true });

  const overrideIds: string[] = [];
  if (projectOverrides) {
    for (const o of projectOverrides) { resolved = applyPatches(resolved, o.patch); overrideIds.push(o.id); }
  }

  const { data: runOverrides } = await supabase.from("engine_overrides").select("id, patch")
    .eq("project_id", project_id).eq("lane", lane).eq("scope", "run").eq("target_run_id", run_id)
    .order("created_at", { ascending: true });

  if (runOverrides) {
    for (const o of runOverrides) { resolved = applyPatches(resolved, o.patch); overrideIds.push(o.id); }
  }

  const summary = generateSummary(resolved);

  const { data: ruleset, error } = await supabase.from("story_rulesets")
    .insert({ project_id, lane, run_type, run_id, engine_profile_id: profileId, override_ids: overrideIds, resolved_rules: resolved, resolved_summary: summary, created_by: user_id })
    .select().single();

  if (error) return jsonResp({ error: error.message }, 500);
  return jsonResp({ ruleset });
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    year: i.comparable_candidates?.year, format: i.comparable_candidates?.format || "film",
    weight: i.influencer_weight, dimensions: i.influence_dimensions || [],
  }));

  const allAvoid = new Set<string>();
  for (const inf of influencers) { for (const tag of (inf.avoid_tags || [])) allAvoid.add(tag); }
  for (const tag of allAvoid) { if (!profile.forbidden_moves.includes(tag)) profile.forbidden_moves.push(tag); }

  let totalWeight = 0;
  const dimW: Record<string, number> = {};
  for (const inf of influencers) {
    for (const dim of (inf.influence_dimensions || [])) { dimW[dim] = (dimW[dim] || 0) + (inf.influencer_weight || 1); }
    totalWeight += inf.influencer_weight || 1;
  }
  if (totalWeight > 0) {
    if (dimW.pacing) {
      const s = Math.min(1, dimW.pacing / totalWeight);
      profile.pacing_profile.beats_per_minute.target = Math.min(profile.pacing_profile.beats_per_minute.max, Math.round(profile.pacing_profile.beats_per_minute.target + s));
    }
    if (dimW.twist_budget && dimW.twist_budget / totalWeight > 0.6) { profile.budgets.twist_cap = Math.min(3, profile.budgets.twist_cap + 1); }
    if (dimW.stakes_ladder) { if (dimW.stakes_ladder / totalWeight > 0.5 && !profile.stakes_ladder.early_allowed.includes("social")) profile.stakes_ladder.early_allowed.push("social"); }
    if (dimW.dialogue_style) { profile.dialogue_rules.subtext_ratio_target = Math.min(0.8, profile.dialogue_rules.subtext_ratio_target + Math.min(1, dimW.dialogue_style / totalWeight) * 0.1); }
  }
  return profile;
}

function detectProfileConflicts(profile: any, lane: string): any[] {
  const defaults = getDefaultProfile(lane);
  const conflicts: any[] = [];
  if (profile.budgets.twist_cap > defaults.budgets.twist_cap + 1) {
    conflicts.push({ id: "twist_vs_restraint", severity: "warn", dimension: "twist_budget", message: `Twist cap (${profile.budgets.twist_cap}) exceeds lane default (${defaults.budgets.twist_cap}).`, inferred_value: String(profile.budgets.twist_cap), expected_value: String(defaults.budgets.twist_cap), suggested_actions: ["honor_comps", "honor_overrides"] });
  }
  if (profile.stakes_ladder.no_global_before_pct < defaults.stakes_ladder.no_global_before_pct - 0.05) {
    conflicts.push({ id: "early_global_stakes", severity: "warn", dimension: "stakes_ladder", message: `Global stakes earlier (${Math.round(profile.stakes_ladder.no_global_before_pct * 100)}%) than default (${Math.round(defaults.stakes_ladder.no_global_before_pct * 100)}%).`, inferred_value: String(profile.stakes_ladder.no_global_before_pct), expected_value: String(defaults.stakes_ladder.no_global_before_pct), suggested_actions: ["honor_overrides", "blend"] });
  }
  for (const move of defaults.forbidden_moves) {
    if (!profile.forbidden_moves.includes(move)) {
      conflicts.push({ id: `missing_forbidden_${move}`, severity: "hard", dimension: "forbidden_moves", message: `Default forbidden move "${move}" not in derived profile.`, inferred_value: "allowed", expected_value: "forbidden", suggested_actions: ["honor_overrides"] });
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
    for (let i = 0; i < parts.length - 1; i++) { if (target[parts[i]] === undefined) target[parts[i]] = {}; target = target[parts[i]]; }
    if (p.op === "remove") { delete target[parts[parts.length - 1]]; } else { target[parts[parts.length - 1]] = p.value; }
  }
  return result;
}
