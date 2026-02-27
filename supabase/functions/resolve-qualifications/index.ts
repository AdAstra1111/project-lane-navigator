import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Inline resolver (mirrors src/lib/qualifications/resolveQualifications.ts exactly) ───

const RESOLVER_VERSION = 1;
const MIN_DURATION_SECONDS = 5;

const FORMAT_DEFAULTS: Record<string, {
  episode_target_duration_seconds?: number;
  episode_target_duration_min_seconds?: number;
  episode_target_duration_max_seconds?: number;
  season_episode_count?: number;
  target_runtime_min_low?: number;
  target_runtime_min_high?: number;
}> = {
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

function resolveQualificationsCore(input: any) {
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

  // Resolve episode duration range
  let epDurMin = durMin.value != null ? Math.round(durMin.value) : null;
  let epDurMax = durMax.value != null ? Math.round(durMax.value) : null;
  if (epDurMin == null && epDurMax == null && episodeDuration != null) {
    epDurMin = episodeDuration;
    epDurMax = episodeDuration;
  }
  if (epDurMin != null && epDurMax == null) epDurMax = epDurMin;
  if (epDurMax != null && epDurMin == null) epDurMin = epDurMax;
  if (epDurMin != null && epDurMin < MIN_DURATION_SECONDS) { epDurMin = null; }
  if (epDurMax != null && epDurMax < MIN_DURATION_SECONDS) { epDurMax = null; }
  if (epDurMin != null && epDurMax != null && epDurMin > epDurMax) {
    errors.push({ field: "episode_target_duration_min_seconds", message: `Min (${epDurMin}) must be <= max (${epDurMax})` });
  }

  if (isSeries && episodeDuration == null && epDurMin == null && defaults.episode_target_duration_seconds == null) {
    errors.push({ field: "episode_target_duration_seconds", message: "Required for series format" });
  }
  if (isSeries && episodeCount == null && defaults.season_episode_count == null) {
    errors.push({ field: "season_episode_count", message: "Required for series format" });
  }

  const effectiveMidpoint = (epDurMin != null && epDurMax != null) ? Math.round((epDurMin + epDurMax) / 2) : episodeDuration;
  const seasonRuntime = (effectiveMidpoint != null && episodeCount != null)
    ? effectiveMidpoint * episodeCount : null;

  if (dur.source === "defaults") warnings.push({ field: "episode_target_duration_seconds", message: "Using global default" });
  if (cnt.source === "defaults") warnings.push({ field: "season_episode_count", message: "Using global default" });

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

    // Decode JWT claims locally — avoids session lookup failures for ES256 tokens
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payloadB64 = token.split(".")[1];
      if (!payloadB64) throw new Error("bad token");
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.sub) throw new Error("no sub");
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
      userId = payload.sub;
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service client for DB operations
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { projectId } = body;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch project data
    console.log("[resolve-qualifications] fetching project", { projectId, userId });
    const { data: project, error: projErr } = await supabase.from("projects")
      .select("format, episode_target_duration_seconds, episode_target_duration_min_seconds, episode_target_duration_max_seconds, season_episode_count, guardrails_config, resolved_qualifications_hash")
      .eq("id", projectId).single();

    if (projErr || !project) {
      console.error("[resolve-qualifications] project lookup failed", { projectId, error: projErr?.message, code: projErr?.code, details: projErr?.details });
      return new Response(JSON.stringify({ error: "Project not found", detail: projErr?.message || "no rows", code: projErr?.code }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gc = project.guardrails_config || {};

    // Build input for resolver
    const resolverInput = {
      project_id: projectId,
      format_subtype: normalizeFormat(project.format || "film"),
      project_qualification_fields: {
        episode_target_duration_seconds: project.episode_target_duration_seconds,
        episode_target_duration_min_seconds: (project as any).episode_target_duration_min_seconds,
        episode_target_duration_max_seconds: (project as any).episode_target_duration_max_seconds,
        season_episode_count: project.season_episode_count,
        format: project.format,
      },
      guardrails_config: gc,
      overrides: {
        qualifications: gc?.overrides?.qualifications || {},
      },
    };

    const result = resolveQualificationsCore(resolverInput);

    // Persist resolved qualifications
    const updatePayload: Record<string, any> = {
      resolved_qualifications: result.resolvedQualifications,
      resolved_qualifications_hash: result.resolver_hash,
      resolved_qualifications_version: result.resolver_version,
    };

    // Also persist-on-resolve: write defaults back to guardrails_config if from defaults
    const sources = result.sources;
    const needsPersist = (
      (sources.episode_target_duration_seconds === "defaults" && result.resolvedQualifications.episode_target_duration_seconds != null) ||
      (sources.season_episode_count === "defaults" && result.resolvedQualifications.season_episode_count != null)
    );

    if (needsPersist) {
      const newGc = { ...gc };
      newGc.overrides = newGc.overrides || {};
      newGc.overrides.qualifications = { ...(newGc.overrides.qualifications || {}) };
      if (sources.episode_target_duration_seconds === "defaults") {
        newGc.overrides.qualifications.episode_target_duration_seconds = result.resolvedQualifications.episode_target_duration_seconds;
      }
      if (sources.season_episode_count === "defaults") {
        newGc.overrides.qualifications.season_episode_count = result.resolvedQualifications.season_episode_count;
      }
      updatePayload.guardrails_config = newGc;

      if (sources.episode_target_duration_seconds === "defaults" && result.resolvedQualifications.episode_target_duration_seconds != null) {
        updatePayload.episode_target_duration_seconds = result.resolvedQualifications.episode_target_duration_seconds;
      }
    }

    await supabase.from("projects").update(updatePayload).eq("id", projectId);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
