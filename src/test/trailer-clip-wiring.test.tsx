/**
 * Trailer Clip Pipeline — Real Wiring Tests
 * Tests import PRODUCTION modules (not copied logic) with mocked DB/network to prove:
 * 1) Stale recovery query shape matches handleProcessQueue
 * 2) Enqueue uses upsert with onConflict: "idempotency_key"
 * 3) Clip sorting uses the canonical comparator
 * 4) Download uses public_url and correct filename
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { recoverStaleRunningJobs, computeStaleThresholdIso, STALE_THRESHOLD_MS } from "@/lib/trailerPipeline/clipJobRecovery";
import { buildUpsertOptions, upsertClipJobs } from "@/lib/trailerPipeline/clipEnqueue";
import { clipCandidateComparator, sortClips } from "@/lib/trailerPipeline/clipSorting";
import { buildClipFilename, getDownloadUrl } from "@/lib/trailerPipeline/clipDownload";

// ─── 1) Stale Recovery — uses production recoverStaleRunningJobs ───

describe("Stale recovery (production recoverStaleRunningJobs)", () => {
  function buildMockDb() {
    const selectFn = vi.fn().mockReturnValue({ data: [{ id: "stale-1" }] });
    const ltFn = vi.fn().mockReturnValue({ select: selectFn });
    const eqStatusFn = vi.fn().mockReturnValue({ lt: ltFn });
    const eqBlueprintFn = vi.fn().mockReturnValue({ eq: eqStatusFn });
    const eqProjectFn = vi.fn().mockReturnValue({ eq: eqBlueprintFn });
    const updateFn = vi.fn().mockReturnValue({ eq: eqProjectFn });
    const fromFn = vi.fn().mockReturnValue({ update: updateFn });

    return {
      db: { from: fromFn },
      mocks: { fromFn, updateFn, eqProjectFn, eqBlueprintFn, eqStatusFn, ltFn, selectFn },
    };
  }

  it("calls .from('trailer_clip_jobs')", async () => {
    const { db, mocks } = buildMockDb();
    await recoverStaleRunningJobs(db, "proj-1", "bp-1");
    expect(mocks.fromFn).toHaveBeenCalledWith("trailer_clip_jobs");
  });

  it("calls .update with correct payload", async () => {
    const { db, mocks } = buildMockDb();
    await recoverStaleRunningJobs(db, "proj-1", "bp-1");
    expect(mocks.updateFn).toHaveBeenCalledWith({
      status: "queued",
      claimed_at: null,
      error: "Auto-recovered from stale running state",
    });
  });

  it("filters by project_id, blueprint_id, status='running'", async () => {
    const { db, mocks } = buildMockDb();
    await recoverStaleRunningJobs(db, "proj-1", "bp-1");
    expect(mocks.eqProjectFn).toHaveBeenCalledWith("project_id", "proj-1");
    expect(mocks.eqBlueprintFn).toHaveBeenCalledWith("blueprint_id", "bp-1");
    expect(mocks.eqStatusFn).toHaveBeenCalledWith("status", "running");
  });

  it("uses lt('claimed_at', <ISO timestamp>) with 15-min threshold", async () => {
    const { db, mocks } = buildMockDb();
    const fixedNow = new Date("2026-02-25T12:00:00Z").getTime();
    await recoverStaleRunningJobs(db, "proj-1", "bp-1", fixedNow);
    const expectedThreshold = computeStaleThresholdIso(fixedNow);
    expect(mocks.ltFn).toHaveBeenCalledWith("claimed_at", expectedThreshold);
  });

  it("targets ONLY status='running'", async () => {
    const { db, mocks } = buildMockDb();
    await recoverStaleRunningJobs(db, "proj-1", "bp-1");
    const statusArg = mocks.eqStatusFn.mock.calls[0][1];
    expect(statusArg).toBe("running");
    expect(statusArg).not.toBe("polling");
    expect(statusArg).not.toBe("queued");
  });

  it("STALE_THRESHOLD_MS is 15 minutes", () => {
    expect(STALE_THRESHOLD_MS).toBe(15 * 60 * 1000);
  });

  it("computeStaleThresholdIso returns correct ISO string", () => {
    const fixedNow = new Date("2026-02-25T12:00:00Z").getTime();
    const result = computeStaleThresholdIso(fixedNow);
    expect(result).toBe(new Date(fixedNow - 15 * 60 * 1000).toISOString());
  });
});

// ─── 2) Enqueue Upsert — uses production buildUpsertOptions + upsertClipJobs ───

describe("Enqueue upsert (production buildUpsertOptions + upsertClipJobs)", () => {
  it("buildUpsertOptions returns onConflict: 'idempotency_key' with ignoreDuplicates=true when not forced", () => {
    expect(buildUpsertOptions(false)).toEqual({
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });
  });

  it("buildUpsertOptions sets ignoreDuplicates=false when force=true", () => {
    expect(buildUpsertOptions(true)).toEqual({
      onConflict: "idempotency_key",
      ignoreDuplicates: false,
    });
  });

  it("upsertClipJobs calls db.from().upsert with correct options", async () => {
    const upsertFn = vi.fn().mockReturnValue({ error: null });
    const fromFn = vi.fn().mockReturnValue({ upsert: upsertFn });
    const db = { from: fromFn };
    const jobs = [{ idempotency_key: "k1", beat_index: 0, status: "queued" }];
    await upsertClipJobs(db, jobs, false);
    expect(fromFn).toHaveBeenCalledWith("trailer_clip_jobs");
    expect(upsertFn).toHaveBeenCalledWith(jobs, {
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });
  });

  it("passes all jobs in single batch call", async () => {
    const upsertFn = vi.fn().mockReturnValue({ error: null });
    const db = { from: vi.fn().mockReturnValue({ upsert: upsertFn }) };
    const jobs = [
      { idempotency_key: "k1", beat_index: 0 },
      { idempotency_key: "k2", beat_index: 1 },
      { idempotency_key: "k3", beat_index: 2 },
    ];
    await upsertClipJobs(db, jobs, false);
    expect(upsertFn).toHaveBeenCalledTimes(1);
    expect(upsertFn.mock.calls[0][0]).toHaveLength(3);
  });
});

// ─── 3) Clip Sorting — uses production clipCandidateComparator + sortClips ───

describe("Clip sorting (production clipCandidateComparator)", () => {
  it("selected clips always sort first", () => {
    const sorted = sortClips([
      { id: "c2", selected: false, technical_score: 9, candidate_index: 0 },
      { id: "c1", selected: true, technical_score: 5, candidate_index: 1 },
    ]);
    expect(sorted[0].id).toBe("c1");
  });

  it("higher technical_score sorts before lower when both unselected", () => {
    const sorted = sortClips([
      { id: "c1", selected: false, technical_score: 6, candidate_index: 0 },
      { id: "c2", selected: false, technical_score: 9, candidate_index: 1 },
    ]);
    expect(sorted[0].id).toBe("c2");
  });

  it("candidate_index breaks ties deterministically", () => {
    const sorted = sortClips([
      { id: "c2", selected: false, technical_score: 7, candidate_index: 2 },
      { id: "c1", selected: false, technical_score: 7, candidate_index: 1 },
    ]);
    expect(sorted[0].id).toBe("c1");
  });

  it("id breaks final ties deterministically", () => {
    const sorted = sortClips([
      { id: "z-clip", selected: false, technical_score: 7, candidate_index: 1 },
      { id: "a-clip", selected: false, technical_score: 7, candidate_index: 1 },
    ]);
    expect(sorted[0].id).toBe("a-clip");
  });

  it("sort is stable across repeated calls", () => {
    const clips = [
      { id: "c3", selected: false, technical_score: 7, candidate_index: 0 },
      { id: "c1", selected: true, technical_score: 5, candidate_index: 0 },
      { id: "c2", selected: false, technical_score: 9, candidate_index: 1 },
    ];
    const sorted1 = sortClips(clips);
    const sorted2 = sortClips(clips);
    expect(sorted1.map(c => c.id)).toEqual(sorted2.map(c => c.id));
    expect(sorted1[0].id).toBe("c1");
    expect(sorted1[1].id).toBe("c2");
    expect(sorted1[2].id).toBe("c3");
  });
});

// ─── 4) Download — uses production buildClipFilename + getDownloadUrl ───

describe("Download (production buildClipFilename + getDownloadUrl)", () => {
  it("buildClipFilename uses beat_index and candidate_index", () => {
    expect(buildClipFilename({ beat_index: 3, candidate_index: 2 })).toBe("clip-beat3-2.mp4");
  });

  it("buildClipFilename defaults candidate_index to 1 when falsy", () => {
    expect(buildClipFilename({ beat_index: 0, candidate_index: null })).toBe("clip-beat0-1.mp4");
    expect(buildClipFilename({ beat_index: 1 })).toBe("clip-beat1-1.mp4");
  });

  it("getDownloadUrl returns public_url when present", () => {
    expect(getDownloadUrl({ public_url: "https://storage.example.com/clip.mp4" }))
      .toBe("https://storage.example.com/clip.mp4");
  });

  it("getDownloadUrl returns null when public_url is absent", () => {
    expect(getDownloadUrl({ public_url: null })).toBeNull();
    expect(getDownloadUrl({})).toBeNull();
  });

  it("download URL is always a persisted https URL, not ephemeral blob", () => {
    const url = getDownloadUrl({ public_url: "https://storage.example.com/proj/clips/beat0/clip1.mp4" });
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("clips");
  });
});
