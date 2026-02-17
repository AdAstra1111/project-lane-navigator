import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Inline resolver (same as resolve-qualifications) ───

const RESOLVER_VERSION = 1;
const MIN_DURATION_SECONDS = 5;

const FORMAT_DEFAULTS: Record<string, Record<string, number>> = {
  "vertical-drama":     { episode_target_duration_seconds: 60,  episode_target_duration_min_seconds: 45,  episode_target_duration_max_seconds: 90,  season_episode_count: 30 },
  "limited-series":     { episode_target_duration_seconds: 3300, episode_target_duration_min_seconds: 2700, episode_target_duration_max_seconds: 3600, season_episode_count: 8 },
  "tv-series":          { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3000, season_episode_count: 10 },
  "anim-series":        { episode_target_duration_seconds: 1320, episode_target_duration_min_seconds: 1200, episode_target_duration_max_seconds: 1500, season_episode_count: 10 },
  "documentary-series": { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3300, season_episode_count: 6 },
  "digital-series":     { episode_target_duration_seconds: 600,  episode_target_duration_min_seconds: 420,  episode_target_duration_max_seconds: 900,  season_episode_count: 10 },
  "reality":            { episode_target_duration_seconds: 2700, episode_target_duration_min_seconds: 2400, episode_target_duration_max_seconds: 3000, season_episode_count: 10 },
  "film":               { target_runtime_min_low: 85,  target_runtime_min_high: 110 },
  "anim-feature":       { target_runtime_min_low: 80,  target_runtime_min_high: 100 },
  "short-film":         { target_runtime_min_low: 5,   target_runtime_min_high: 20 },
};

const SERIES_FORMATS = new Set([
  "vertical-drama", "tv-series", "limited-series",
  "anim-series", "documentary-series", "digital-series", "reality",
]);

function normalizeFormat(format: string): string {
  return (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
}

function computeResolverHash(resolved: any): string {
  const canonical = JSON.stringify({
    d: resolved.episode_target_duration_seconds,
    dmin: resolved.episode_target_duration_min_seconds,
    dmax: resolved.episode_target_duration_max_seconds,
    c: resolved.season_episode_count,
    rl: resolved.target_runtime_min_low,
    rh: resolved.target_runtime_min_high,
    f: resolved.format,
  });
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) - hash) + canonical.charCodeAt(i);
    hash |= 0;
  }
  return `qr-${RESOLVER_VERSION}-${Math.abs(hash).toString(36)}`;
}

function resolveQualificationsCore(input: any, lockedFields: Record<string, boolean> = {}) {
  const warnings: any[] = [];
  const errors: any[] = [];

  const rawFormat = input.format_subtype
    || input.project_qualification_fields?.format
    || input.production_type
    || "film";
  const format = normalizeFormat(rawFormat);
  const isSeries = SERIES_FORMATS.has(format);
  const defaults = FORMAT_DEFAULTS[format] || {};

  const proj = input.project_qualification_fields || {};
  const overrideQuals = input.overrides?.qualifications || {};
  const gcBase = input.guardrails_config || {};
  const gcOverrides = gcBase?.overrides?.qualifications || {};

  function resolve(
    field: string,
    projectVal: any,
    overrideVal: any,
    guardrailVal: any,
    defaultVal: any,
  ): { value: any; source: string | null } {
    // If field is locked, only use project value
    if (lockedFields[field] || lockedFields[`qualifications.${field}`]) {
      if (projectVal != null && projectVal !== 0) return { value: projectVal, source: "project" };
      warnings.push({ field, message: "Field is locked but has no project value" });
    }
    if (projectVal != null && projectVal !== 0) return { value: projectVal, source: "project" };
    if (overrideVal != null && overrideVal !== 0) return { value: overrideVal, source: "overrides" };
    if (guardrailVal != null && guardrailVal !== 0) return { value: guardrailVal, source: "guardrails" };
    if (defaultVal != null) return { value: defaultVal, source: "defaults" };
    return { value: null, source: null };
  }

  const dur = resolve("episode_target_duration_seconds",
    proj.episode_target_duration_seconds, overrideQuals.episode_target_duration_seconds,
    gcOverrides.episode_target_duration_seconds, defaults.episode_target_duration_seconds);
  const durMin = resolve("episode_target_duration_min_seconds",
    proj.episode_target_duration_min_seconds, overrideQuals.episode_target_duration_min_seconds,
    gcOverrides.episode_target_duration_min_seconds, defaults.episode_target_duration_min_seconds);
  const durMax = resolve("episode_target_duration_max_seconds",
    proj.episode_target_duration_max_seconds, overrideQuals.episode_target_duration_max_seconds,
    gcOverrides.episode_target_duration_max_seconds, defaults.episode_target_duration_max_seconds);
  const cnt = resolve("season_episode_count",
    proj.season_episode_count, overrideQuals.season_episode_count,
    gcOverrides.season_episode_count, defaults.season_episode_count);
  const rtLow = resolve("target_runtime_min_low",
    proj.target_runtime_min_low, overrideQuals.target_runtime_min_low,
    gcOverrides.target_runtime_min_low, defaults.target_runtime_min_low);
  const rtHigh = resolve("target_runtime_min_high",
    proj.target_runtime_min_high, overrideQuals.target_runtime_min_high,
    gcOverrides.target_runtime_min_high, defaults.target_runtime_min_high);

  let episodeDuration = dur.value;
  let episodeCount = cnt.value;

  if (episodeDuration != null) {
    episodeDuration = Math.round(episodeDuration);
    if (episodeDuration < MIN_DURATION_SECONDS) {
      errors.push({ field: "episode_target_duration_seconds", message: `Must be >= ${MIN_DURATION_SECONDS}s, got ${episodeDuration}` });
      episodeDuration = null;
    }
  }
  if (episodeCount != null) {
    episodeCount = Math.round(episodeCount);
    if (episodeCount < 1) {
      errors.push({ field: "season_episode_count", message: `Must be >= 1, got ${episodeCount}` });
      episodeCount = null;
    }
  }

  let epDurMin = durMin.value != null ? Math.round(durMin.value) : null;
  let epDurMax = durMax.value != null ? Math.round(durMax.value) : null;
  if (epDurMin == null && epDurMax == null && episodeDuration != null) {
    epDurMin = episodeDuration;
    epDurMax = episodeDuration;
  }
  if (epDurMin != null && epDurMax == null) epDurMax = epDurMin;
  if (epDurMax != null && epDurMin == null) epDurMin = epDurMax;

  if (isSeries && episodeDuration == null && epDurMin == null) {
    errors.push({ field: "episode_target_duration_seconds", message: "Required for series format" });
  }
  if (isSeries && episodeCount == null) {
    errors.push({ field: "season_episode_count", message: "Required for series format" });
  }

  const effectiveMidpoint = (epDurMin != null && epDurMax != null) ? Math.round((epDurMin + epDurMax) / 2) : episodeDuration;
  const seasonRuntime = (effectiveMidpoint != null && episodeCount != null)
    ? effectiveMidpoint * episodeCount : null;

  if (dur.source === "defaults") warnings.push({ field: "episode_target_duration_seconds", message: "Using global default" });
  if (cnt.source === "defaults") warnings.push({ field: "season_episode_count", message: "Using global default" });

  // Check for locked field override attempts
  for (const [key, locked] of Object.entries(lockedFields)) {
    if (!locked) continue;
    const cleanKey = key.replace('qualifications.', '');
    if (overrideQuals[cleanKey] != null || gcOverrides[cleanKey] != null) {
      warnings.push({ field: cleanKey, message: "Override attempted on locked field — ignored" });
    }
  }

  const resolved = {
    episode_target_duration_seconds: episodeDuration,
    episode_target_duration_min_seconds: epDurMin,
    episode_target_duration_max_seconds: epDurMax,
    season_episode_count: episodeCount,
    season_target_runtime_seconds: seasonRuntime,
    target_runtime_min_low: rtLow.value != null ? Math.round(rtLow.value) : null,
    target_runtime_min_high: rtHigh.value != null ? Math.round(rtHigh.value) : null,
    format,
    is_series: isSeries,
  };

  return {
    resolvedQualifications: resolved,
    sources: {
      episode_target_duration_seconds: dur.source,
      season_episode_count: cnt.source,
      target_runtime_min_low: rtLow.source,
      target_runtime_min_high: rtHigh.source,
    },
    warnings,
    errors,
    resolver_version: RESOLVER_VERSION,
    resolver_hash: computeResolverHash(resolved),
  };
}

// ─── Helper: apply field_path patch ───

function applyFieldPatch(obj: Record<string, any>, fieldPath: string, value: any): Record<string, any> {
  const result = { ...obj };
  // field_path like "qualifications.season_episode_count" or "season_episode_count"
  const parts = fieldPath.replace(/^qualifications\./, '').split('.');
  if (parts.length === 1) {
    result[parts[0]] = value;
  } else {
    let cursor: any = result;
    for (let i = 0; i < parts.length - 1; i++) {
      cursor[parts[i]] = { ...(cursor[parts[i]] || {}) };
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return result;
}

// ─── Edge function handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { decision_id } = body;
    if (!decision_id) {
      return new Response(JSON.stringify({ error: "decision_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch decision
    const { data: decision, error: decErr } = await supabase
      .from("project_decisions")
      .select("*")
      .eq("id", decision_id)
      .single();

    if (decErr || !decision) {
      return new Response(JSON.stringify({ error: "Decision not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (decision.status === 'confirmed') {
      return new Response(JSON.stringify({ error: "Decision already confirmed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Confirm the decision
    await supabase.from("project_decisions").update({
      status: "confirmed",
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    }).eq("id", decision_id);

    // 3. Fetch project
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("format, episode_target_duration_seconds, season_episode_count, guardrails_config, qualifications, locked_fields")
      .eq("id", decision.project_id)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Apply patch to qualifications
    const currentQuals = (project as any).qualifications || {};
    const newValue = decision.new_value;
    // new_value is JSONB — could be raw value or wrapped
    const patchValue = typeof newValue === 'object' && newValue !== null && 'value' in newValue
      ? newValue.value : newValue;
    const patchedQuals = applyFieldPatch(currentQuals, decision.field_path, patchValue);

    // 5. Auto-lock the field
    const lockedFields = { ...((project as any).locked_fields || {}) };
    lockedFields[decision.field_path] = true;

    // 6. Also update the project column if it's a direct column field
    const directColumnFields = ['episode_target_duration_seconds', 'season_episode_count'];
    const cleanField = decision.field_path.replace(/^qualifications\./, '');
    const projectUpdate: Record<string, any> = {
      qualifications: patchedQuals,
      locked_fields: lockedFields,
    };
    if (directColumnFields.includes(cleanField) && patchValue != null) {
      projectUpdate[cleanField] = patchValue;
    }

    await supabase.from("projects").update(projectUpdate).eq("id", decision.project_id);

    // 7. Re-resolve qualifications
    const gc = (project as any).guardrails_config || {};
    const resolverInput = {
      project_id: decision.project_id,
      format_subtype: normalizeFormat((project as any).format || "film"),
      project_qualification_fields: {
        episode_target_duration_seconds: projectUpdate.episode_target_duration_seconds ?? (project as any).episode_target_duration_seconds,
        season_episode_count: projectUpdate.season_episode_count ?? (project as any).season_episode_count,
        format: (project as any).format,
        ...patchedQuals,
      },
      guardrails_config: gc,
      overrides: { qualifications: gc?.overrides?.qualifications || {} },
    };

    const result = resolveQualificationsCore(resolverInput, lockedFields);

    // 8. Persist resolved qualifications
    await supabase.from("projects").update({
      resolved_qualifications: result.resolvedQualifications,
      resolved_qualifications_hash: result.resolver_hash,
      resolved_qualifications_version: result.resolver_version,
    }).eq("id", decision.project_id);

    // 9. Update decision with applied status
    await supabase.from("project_decisions").update({
      applied_to_metadata_at: new Date().toISOString(),
      resulting_resolver_hash: result.resolver_hash,
    }).eq("id", decision_id);

    return new Response(JSON.stringify({
      success: true,
      decision_id,
      resolved: result.resolvedQualifications,
      resolver_hash: result.resolver_hash,
      warnings: result.warnings,
      errors: result.errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
