import { describe, it, expect } from "vitest";
import {
  computeBundleId,
  bundleFileName,
  qualityHistoryCSV,
  buildManifest,
  buildReadme,
  stableJsonString,
  sha256Hex,
  type QualityRunRow,
  type ManifestEntry,
} from "@/videoRender/bundleUtils";

describe("computeBundleId", () => {
  it("is deterministic for same inputs", () => {
    const a = computeBundleId("run-1", { lane: "feature_film" }, { plan_id: "p1" });
    const b = computeBundleId("run-1", { lane: "feature_film" }, { plan_id: "p1" });
    expect(a).toBe(b);
    expect(a.length).toBe(8);
  });

  it("differs for different inputs", () => {
    const a = computeBundleId("run-1", {}, {});
    const b = computeBundleId("run-2", {}, {});
    expect(a).not.toBe(b);
  });
});

describe("bundleFileName", () => {
  it("produces stable deterministic name", () => {
    const name = bundleFileName("My Project!", "abc12345-6789", new Date("2026-02-25T12:30:00.000Z"));
    expect(name).toBe("IFFY_DemoBundle_my_project__abc12345_20260225123000Z.zip");
  });

  it("is deterministic", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(bundleFileName("Test", "id-123", d)).toBe(bundleFileName("Test", "id-123", d));
  });
});

describe("qualityHistoryCSV", () => {
  const rows: QualityRunRow[] = [
    { created_at: "2026-01-02T00:00:00Z", run_source: "trailer", lane: "feature_film", final_pass: true, final_score: 85, hard_failures: [], diagnostic_flags: ["WARN"], adapter_mode: "standard", strictness_mode: "standard" },
    { created_at: "2026-01-03T00:00:00Z", run_source: "video_render", lane: null, final_pass: false, final_score: 40, hard_failures: ["RENDER_SHOT_FAILED"], diagnostic_flags: [], adapter_mode: null, strictness_mode: "strict" },
    { created_at: "2026-01-01T00:00:00Z", run_source: "manual", lane: "docs", final_pass: true, final_score: 90, hard_failures: [], diagnostic_flags: [], adapter_mode: "auto", strictness_mode: "standard" },
  ];

  it("outputs correct headers", () => {
    const csv = qualityHistoryCSV(rows);
    const header = csv.split("\n")[0];
    expect(header).toBe("created_at,run_source,lane,pass,final_score,hard_failures_count,diagnostics_count,adapter_mode,strictness_mode");
  });

  it("orders by created_at DESC", () => {
    const csv = qualityHistoryCSV(rows);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("2026-01-03");
    expect(lines[2]).toContain("2026-01-02");
    expect(lines[3]).toContain("2026-01-01");
  });

  it("is deterministic", () => {
    expect(qualityHistoryCSV(rows)).toBe(qualityHistoryCSV(rows));
  });

  it("handles empty array", () => {
    const csv = qualityHistoryCSV([]);
    expect(csv.split("\n").length).toBe(1); // header only
  });
});

describe("buildManifest", () => {
  const entries: ManifestEntry[] = [
    { filename: "quality_history.csv", type: "csv", source_ids: {}, checksum: "abc", created_at: "t" },
    { filename: "quality_run.json", type: "json", source_ids: {}, checksum: "def", created_at: "t" },
  ];

  it("sorts files in fixed order", () => {
    const m = buildManifest("bid", "now", entries);
    expect(m.files[0].filename).toBe("quality_run.json");
    expect(m.files[1].filename).toBe("quality_history.csv");
  });

  it("includes bundle_id", () => {
    const m = buildManifest("test-id", "now", []);
    expect(m.bundle_id).toBe("test-id");
  });
});

describe("buildReadme", () => {
  it("includes bundle id and file listing", () => {
    const m = buildManifest("abc", "2026-01-01", [
      { filename: "quality_run.json", type: "json", source_ids: {}, checksum: "x", created_at: "t" },
    ]);
    const readme = buildReadme(m);
    expect(readme).toContain("abc");
    expect(readme).toContain("quality_run.json");
    expect(readme).toContain("deterministically");
  });
});

describe("sha256Hex", () => {
  it("produces deterministic 64-char hex", async () => {
    const data = new TextEncoder().encode("hello world");
    const hash = await sha256Hex(data);
    expect(hash.length).toBe(64);
    expect(hash).toBe(await sha256Hex(data));
  });
});

describe("stableJsonString", () => {
  it("pretty-prints with 2 spaces", () => {
    const result = stableJsonString({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });
});
