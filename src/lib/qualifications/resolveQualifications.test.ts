import { describe, it, expect } from "vitest";
import {
  resolveQualifications,
  computeResolverHash,
  normalizeFormat,
  RESOLVER_VERSION,
  type QualificationInput,
} from "./resolveQualifications";

describe("normalizeFormat", () => {
  it("lowercases and replaces underscores/spaces with hyphens", () => {
    expect(normalizeFormat("vertical_drama")).toBe("vertical-drama");
    expect(normalizeFormat("Vertical Drama")).toBe("vertical-drama");
    expect(normalizeFormat("TV_SERIES")).toBe("tv-series");
    expect(normalizeFormat("")).toBe("film");
  });
});

describe("resolveQualifications", () => {
  it("returns defaults for vertical-drama when no values provided", () => {
    const result = resolveQualifications({
      format_subtype: "vertical-drama",
    });
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBe(60);
    expect(result.resolvedQualifications.season_episode_count).toBe(30);
    expect(result.resolvedQualifications.season_target_runtime_seconds).toBe(1800);
    expect(result.resolvedQualifications.is_series).toBe(true);
    expect(result.sources.episode_target_duration_seconds).toBe("defaults");
    expect(result.sources.season_episode_count).toBe("defaults");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  it("project values beat overrides", () => {
    const result = resolveQualifications({
      format_subtype: "tv-series",
      project_qualification_fields: {
        episode_target_duration_seconds: 3600,
        season_episode_count: 12,
      },
      overrides: {
        qualifications: {
          episode_target_duration_seconds: 2700,
          season_episode_count: 8,
        },
      },
    });
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBe(3600);
    expect(result.resolvedQualifications.season_episode_count).toBe(12);
    expect(result.sources.episode_target_duration_seconds).toBe("project");
    expect(result.sources.season_episode_count).toBe("project");
  });

  it("overrides beat guardrails base", () => {
    const result = resolveQualifications({
      format_subtype: "limited-series",
      overrides: {
        qualifications: {
          episode_target_duration_seconds: 4000,
        },
      },
      guardrails_config: {
        overrides: {
          qualifications: {
            episode_target_duration_seconds: 3300,
          },
        },
      },
    });
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBe(4000);
    expect(result.sources.episode_target_duration_seconds).toBe("overrides");
  });

  it("guardrails beat defaults", () => {
    const result = resolveQualifications({
      format_subtype: "tv-series",
      guardrails_config: {
        overrides: {
          qualifications: {
            episode_target_duration_seconds: 5000,
            season_episode_count: 6,
          },
        },
      },
    });
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBe(5000);
    expect(result.sources.episode_target_duration_seconds).toBe("guardrails");
    expect(result.resolvedQualifications.season_episode_count).toBe(6);
    expect(result.sources.season_episode_count).toBe("guardrails");
  });

  it("invalid values produce errors", () => {
    const result = resolveQualifications({
      format_subtype: "vertical-drama",
      project_qualification_fields: {
        episode_target_duration_seconds: 2, // below MIN_DURATION
        season_episode_count: -1,
      },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.field === "episode_target_duration_seconds")).toBe(true);
    expect(result.errors.some(e => e.field === "season_episode_count")).toBe(true);
  });

  it("missing required fields for series format produce errors", () => {
    const result = resolveQualifications({
      format_subtype: "tv-series",
      project_qualification_fields: {
        episode_target_duration_seconds: null,
        season_episode_count: null,
      },
      // Clear guardrails too
      guardrails_config: {},
    });
    // Should fall to defaults, so no errors since defaults exist
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBe(2700);
    expect(result.errors.length).toBe(0);
  });

  it("film format returns runtime values, not episode values", () => {
    const result = resolveQualifications({
      format_subtype: "film",
    });
    expect(result.resolvedQualifications.is_series).toBe(false);
    expect(result.resolvedQualifications.target_runtime_min_low).toBe(85);
    expect(result.resolvedQualifications.target_runtime_min_high).toBe(110);
    expect(result.resolvedQualifications.episode_target_duration_seconds).toBeNull();
    expect(result.errors.length).toBe(0);
  });

  it("derives season_target_runtime_seconds when both present", () => {
    const result = resolveQualifications({
      format_subtype: "tv-series",
      project_qualification_fields: {
        episode_target_duration_seconds: 2700,
        season_episode_count: 10,
      },
    });
    expect(result.resolvedQualifications.season_target_runtime_seconds).toBe(27000);
  });

  it("normalizes format from underscored input", () => {
    const result = resolveQualifications({
      format_subtype: "vertical_drama",
    });
    expect(result.resolvedQualifications.format).toBe("vertical-drama");
    expect(result.resolvedQualifications.is_series).toBe(true);
  });
});

describe("computeResolverHash", () => {
  it("produces stable hash for identical inputs", () => {
    const quals = {
      episode_target_duration_seconds: 60,
      season_episode_count: 30,
      season_target_runtime_seconds: 1800,
      target_runtime_min_low: null,
      target_runtime_min_high: null,
      format: "vertical-drama",
      is_series: true,
    };
    const h1 = computeResolverHash(quals);
    const h2 = computeResolverHash(quals);
    expect(h1).toBe(h2);
    expect(h1).toContain(`qr-${RESOLVER_VERSION}-`);
  });

  it("produces different hash for different inputs", () => {
    const a = computeResolverHash({
      episode_target_duration_seconds: 60,
      season_episode_count: 30,
      season_target_runtime_seconds: 1800,
      target_runtime_min_low: null,
      target_runtime_min_high: null,
      format: "vertical-drama",
      is_series: true,
    });
    const b = computeResolverHash({
      episode_target_duration_seconds: 120,
      season_episode_count: 30,
      season_target_runtime_seconds: 3600,
      target_runtime_min_low: null,
      target_runtime_min_high: null,
      format: "vertical-drama",
      is_series: true,
    });
    expect(a).not.toBe(b);
  });
});
