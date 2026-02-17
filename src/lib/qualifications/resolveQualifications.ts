/**
 * Canonical Qualification Resolver — single source of truth.
 *
 * Resolution precedence (ONLY allowed):
 *   1. project explicit values
 *   2. overrides.qualifications (most specific match wins)
 *   3. guardrails_config base
 *   4. global defaults (FORMAT_DEFAULTS below)
 *
 * Used by: dev-engine-v2, auto-run, promotion intelligence, resolve-qualifications edge fn.
 */

// ─── Constants ───

export const RESOLVER_VERSION = 1;

export const MIN_DURATION_SECONDS = 5;

export const FORMAT_DEFAULTS: Record<string, {
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

export const SERIES_FORMATS = new Set([
  "vertical-drama", "tv-series", "limited-series",
  "anim-series", "documentary-series", "digital-series", "reality",
]);

// ─── Normalization ───

export function normalizeFormat(format: string): string {
  return (format || "film").toLowerCase().replace(/[_ ]+/g, "-");
}

// ─── Types ───

export interface QualificationInput {
  project_id?: string;
  production_type?: string;
  format_subtype?: string;
  pipeline_stage?: string;

  /** Direct project column values */
  project_qualification_fields?: {
    episode_target_duration_seconds?: number | null;
    episode_target_duration_min_seconds?: number | null;
    episode_target_duration_max_seconds?: number | null;
    season_episode_count?: number | null;
    target_runtime_min_low?: number | null;
    target_runtime_min_high?: number | null;
    format?: string | null;
  };

  /** Full guardrails_config JSON from project */
  guardrails_config?: Record<string, any> | null;

  /** Explicit overrides — highest specificity */
  overrides?: {
    qualifications?: Record<string, any>;
  };

  /** Locked fields from decision commit pipeline */
  locked_fields?: Record<string, boolean> | null;
}

export interface ResolvedQualifications {
  episode_target_duration_seconds: number | null;
  episode_target_duration_min_seconds: number | null;
  episode_target_duration_max_seconds: number | null;
  season_episode_count: number | null;
  season_target_runtime_seconds: number | null;
  target_runtime_min_low: number | null;
  target_runtime_min_high: number | null;
  format: string;
  is_series: boolean;
}

export type SourceTag = "project" | "overrides" | "guardrails" | "defaults";

export interface QualificationSource {
  episode_target_duration_seconds: SourceTag | null;
  season_episode_count: SourceTag | null;
  target_runtime_min_low: SourceTag | null;
  target_runtime_min_high: SourceTag | null;
}

export interface QualificationWarning {
  field: string;
  message: string;
}

export interface QualificationError {
  field: string;
  message: string;
}

export interface ResolveResult {
  resolvedQualifications: ResolvedQualifications;
  sources: QualificationSource;
  warnings: QualificationWarning[];
  errors: QualificationError[];
  resolver_version: number;
  resolver_hash: string;
}

// ─── Stable hash (deterministic for identical input) ───

export function computeResolverHash(resolved: ResolvedQualifications): string {
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

// ─── Core resolver ───

export function resolveQualifications(input: QualificationInput): ResolveResult {
  const warnings: QualificationWarning[] = [];
  const errors: QualificationError[] = [];

  // Determine format
  const rawFormat = input.format_subtype
    || input.project_qualification_fields?.format
    || input.production_type
    || "film";
  const format = normalizeFormat(rawFormat);
  const isSeries = SERIES_FORMATS.has(format);
  const defaults = FORMAT_DEFAULTS[format] || {};

  // Gather layers (precedence 1→4)
  const proj = input.project_qualification_fields || {};
  const overrideQuals = input.overrides?.qualifications || {};
  const gcBase = input.guardrails_config || {};
  const gcOverrides = gcBase?.overrides?.qualifications || {};

  const lockedFields = input.locked_fields || {};

  // Resolve helper: project → overrides → guardrails → defaults
  // Locked fields only use project value
  function resolve<T>(
    field: string,
    projectVal: T | null | undefined,
    overrideVal: T | null | undefined,
    guardrailVal: T | null | undefined,
    defaultVal: T | null | undefined,
  ): { value: T | null; source: SourceTag | null } {
    if (lockedFields[field] || lockedFields[`qualifications.${field}`]) {
      if (projectVal != null && projectVal !== 0) return { value: projectVal as T, source: "project" };
      warnings.push({ field, message: "Locked field has no project value — falling through" });
    }
    if (projectVal != null && projectVal !== 0) return { value: projectVal as T, source: "project" };
    if (overrideVal != null && overrideVal !== 0) return { value: overrideVal as T, source: "overrides" };
    if (guardrailVal != null && guardrailVal !== 0) return { value: guardrailVal as T, source: "guardrails" };
    if (defaultVal != null) return { value: defaultVal as T, source: "defaults" };
    return { value: null, source: null };
  }

  // Warn about override attempts on locked fields
  for (const [key, locked] of Object.entries(lockedFields)) {
    if (!locked) continue;
    const cleanKey = key.replace('qualifications.', '');
    if (overrideQuals[cleanKey] != null || gcOverrides[cleanKey] != null) {
      warnings.push({ field: cleanKey, message: "Override attempted on locked field — ignored" });
    }
  }

  // Episode duration (legacy scalar)
  const dur = resolve<number>(
    "episode_target_duration_seconds",
    proj.episode_target_duration_seconds,
    overrideQuals.episode_target_duration_seconds,
    gcOverrides.episode_target_duration_seconds,
    defaults.episode_target_duration_seconds,
  );

  // Episode duration range (min/max)
  const durMin = resolve<number>(
    "episode_target_duration_min_seconds",
    proj.episode_target_duration_min_seconds,
    overrideQuals.episode_target_duration_min_seconds,
    gcOverrides.episode_target_duration_min_seconds,
    defaults.episode_target_duration_min_seconds,
  );
  const durMax = resolve<number>(
    "episode_target_duration_max_seconds",
    proj.episode_target_duration_max_seconds,
    overrideQuals.episode_target_duration_max_seconds,
    gcOverrides.episode_target_duration_max_seconds,
    defaults.episode_target_duration_max_seconds,
  );

  // Season episode count
  const cnt = resolve<number>(
    "season_episode_count",
    proj.season_episode_count,
    overrideQuals.season_episode_count,
    gcOverrides.season_episode_count,
    defaults.season_episode_count,
  );

  // Runtime
  const rtLow = resolve<number>(
    "target_runtime_min_low",
    proj.target_runtime_min_low,
    overrideQuals.target_runtime_min_low,
    gcOverrides.target_runtime_min_low,
    defaults.target_runtime_min_low,
  );
  const rtHigh = resolve<number>(
    "target_runtime_min_high",
    proj.target_runtime_min_high,
    overrideQuals.target_runtime_min_high,
    gcOverrides.target_runtime_min_high,
    defaults.target_runtime_min_high,
  );

  // ─── Validate + normalize ───

  let episodeDuration = dur.value;
  let episodeCount = cnt.value;

  // Normalize: coerce to int
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

  // Resolve episode duration min/max range
  let epDurMin = durMin.value != null ? Math.round(durMin.value) : null;
  let epDurMax = durMax.value != null ? Math.round(durMax.value) : null;

  // Fallback: if min/max not set but scalar exists, use scalar for both
  if (epDurMin == null && epDurMax == null && episodeDuration != null) {
    epDurMin = episodeDuration;
    epDurMax = episodeDuration;
  }
  // Normalize: if only one side set, mirror the other
  if (epDurMin != null && epDurMax == null) epDurMax = epDurMin;
  if (epDurMax != null && epDurMin == null) epDurMin = epDurMax;

  // Validate range
  if (epDurMin != null && epDurMin < MIN_DURATION_SECONDS) {
    errors.push({ field: "episode_target_duration_min_seconds", message: `Must be >= ${MIN_DURATION_SECONDS}s, got ${epDurMin}` });
    epDurMin = null;
  }
  if (epDurMax != null && epDurMax < MIN_DURATION_SECONDS) {
    errors.push({ field: "episode_target_duration_max_seconds", message: `Must be >= ${MIN_DURATION_SECONDS}s, got ${epDurMax}` });
    epDurMax = null;
  }
  if (epDurMin != null && epDurMax != null && epDurMin > epDurMax) {
    errors.push({ field: "episode_target_duration_min_seconds", message: `Min (${epDurMin}) must be <= max (${epDurMax})` });
  }

  // Missing required for series
  if (isSeries) {
    if (episodeDuration == null && epDurMin == null) {
      errors.push({ field: "episode_target_duration_seconds", message: "Required for series format" });
    }
    if (episodeCount == null) {
      errors.push({ field: "season_episode_count", message: "Required for series format" });
    }
  }

  // Derive season_target_runtime_seconds using midpoint of range
  const effectiveMidpoint = (epDurMin != null && epDurMax != null) ? Math.round((epDurMin + epDurMax) / 2) : episodeDuration;
  const seasonRuntime = (effectiveMidpoint != null && episodeCount != null)
    ? effectiveMidpoint * episodeCount
    : null;

  // Warnings for defaulted values
  if (dur.source === "defaults") warnings.push({ field: "episode_target_duration_seconds", message: "Using global default" });
  if (cnt.source === "defaults") warnings.push({ field: "season_episode_count", message: "Using global default" });
  if (rtLow.source === "defaults") warnings.push({ field: "target_runtime_min_low", message: "Using global default" });

  const resolved: ResolvedQualifications = {
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
    errors: errors.filter(e => {
      // Only report missing errors if no value resolved at all
      if (e.message === "Required for series format") {
        const field = e.field as keyof ResolvedQualifications;
        return resolved[field] == null;
      }
      return true;
    }),
    resolver_version: RESOLVER_VERSION,
    resolver_hash: computeResolverHash(resolved),
  };
}
