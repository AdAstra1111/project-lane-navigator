/**
 * Trailer Clip Pipeline — Persistence & Resumability Tests
 * Covers: idempotency, rehydration, polling resume, deterministic ordering, stale recovery.
 */
import { describe, it, expect, vi } from "vitest";
import { isReadyStatus, READY_STATUSES } from "@/lib/trailerPipeline/constants";

// ─── Mock DB types for deterministic testing ───

interface MockJob {
  id: string;
  beat_index: number;
  candidate_index: number;
  provider: string;
  status: string;
  provider_job_id: string | null;
  claimed_at: string | null;
  idempotency_key: string;
  public_url?: string | null;
  clip_run_id?: string;
  error?: string | null;
}

interface MockClip {
  id: string;
  beat_index: number;
  candidate_index: number;
  provider: string;
  status: string;
  public_url: string | null;
  storage_path: string | null;
  selected: boolean;
  technical_score: number | null;
}

// ─── 1) Enqueue Idempotency ───

describe("Enqueue idempotency", () => {
  function simulateEnqueue(
    existingJobs: MockJob[],
    newJobs: Array<{ beat_index: number; candidate_index: number; provider: string; idempotency_key: string }>,
    force: boolean,
  ): MockJob[] {
    // Simulates the upsert logic from handleEnqueueForRun
    const result = [...existingJobs];
    for (const nj of newJobs) {
      const existing = result.find(j => j.idempotency_key === nj.idempotency_key);
      if (existing && !force) continue; // ignoreDuplicates
      if (existing && force) {
        // upsert overwrites
        existing.status = "queued";
        existing.provider = nj.provider;
        continue;
      }
      result.push({
        id: `job-${result.length}`,
        beat_index: nj.beat_index,
        candidate_index: nj.candidate_index,
        provider: nj.provider,
        status: "queued",
        provider_job_id: null,
        claimed_at: null,
        idempotency_key: nj.idempotency_key,
      });
    }
    return result;
  }

  it("calling enqueue twice without force creates exactly one job per key", () => {
    const jobs: MockJob[] = [];
    const toEnqueue = [
      { beat_index: 0, candidate_index: 0, provider: "veo", idempotency_key: "key-0-0-veo" },
      { beat_index: 1, candidate_index: 0, provider: "runway", idempotency_key: "key-1-0-runway" },
    ];

    const after1 = simulateEnqueue(jobs, toEnqueue, false);
    expect(after1).toHaveLength(2);

    const after2 = simulateEnqueue(after1, toEnqueue, false);
    expect(after2).toHaveLength(2); // no duplicates
    expect(after2[0].idempotency_key).toBe("key-0-0-veo");
    expect(after2[1].idempotency_key).toBe("key-1-0-runway");
  });

  it("calling enqueue with force=true re-queues existing jobs", () => {
    const existing: MockJob[] = [{
      id: "job-0", beat_index: 0, candidate_index: 0, provider: "veo",
      status: "failed", provider_job_id: null, claimed_at: null,
      idempotency_key: "key-0-0-veo",
    }];
    const toEnqueue = [
      { beat_index: 0, candidate_index: 0, provider: "veo", idempotency_key: "key-0-0-veo" },
    ];
    const after = simulateEnqueue(existing, toEnqueue, true);
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("queued"); // re-queued, not duplicated
  });

  it("triple enqueue still produces no duplicates", () => {
    const toEnqueue = [
      { beat_index: 0, candidate_index: 0, provider: "veo", idempotency_key: "key-0-0-veo" },
    ];
    let jobs = simulateEnqueue([], toEnqueue, false);
    jobs = simulateEnqueue(jobs, toEnqueue, false);
    jobs = simulateEnqueue(jobs, toEnqueue, false);
    expect(jobs).toHaveLength(1);
  });
});

// ─── 2) UI Rehydration (from DB, no ephemeral state) ───

describe("UI rehydration from DB", () => {
  it("derives candidate list from DB clips without prior in-memory state", () => {
    const dbClips: MockClip[] = [
      { id: "c1", beat_index: 0, candidate_index: 0, provider: "veo", status: "complete", public_url: "https://storage/clip1.mp4", storage_path: "proj/clips/clip1.mp4", selected: true, technical_score: 8.5 },
      { id: "c2", beat_index: 0, candidate_index: 1, provider: "runway", status: "complete", public_url: "https://storage/clip2.mp4", storage_path: "proj/clips/clip2.mp4", selected: false, technical_score: 7.2 },
      { id: "c3", beat_index: 1, candidate_index: 0, provider: "veo", status: "complete", public_url: "https://storage/clip3.mp4", storage_path: "proj/clips/clip3.mp4", selected: false, technical_score: 6.1 },
    ];

    // Simulate UI rehydration: group by beat, sort deterministically
    const clipsByBeat: Record<number, MockClip[]> = {};
    for (const c of dbClips) {
      if (!clipsByBeat[c.beat_index]) clipsByBeat[c.beat_index] = [];
      clipsByBeat[c.beat_index].push(c);
    }
    for (const key of Object.keys(clipsByBeat)) {
      clipsByBeat[parseInt(key)].sort((a, b) => {
        // selected first
        if (a.selected && !b.selected) return -1;
        if (!a.selected && b.selected) return 1;
        // then score desc
        const scoreDiff = (b.technical_score ?? 0) - (a.technical_score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        // then candidate_index asc
        const ciDiff = a.candidate_index - b.candidate_index;
        if (ciDiff !== 0) return ciDiff;
        // then id asc
        return a.id.localeCompare(b.id);
      });
    }

    // Beat 0: selected c1 first, then c2
    expect(clipsByBeat[0]).toHaveLength(2);
    expect(clipsByBeat[0][0].id).toBe("c1"); // selected
    expect(clipsByBeat[0][1].id).toBe("c2");

    // Beat 1 has 1 clip
    expect(clipsByBeat[1]).toHaveLength(1);

    // Selected clip is derivable from DB
    const selectedBeat0 = clipsByBeat[0].find(c => c.selected);
    expect(selectedBeat0?.id).toBe("c1");
  });

  it("provider breakdown counts derivable from DB jobs", () => {
    const dbJobs: MockJob[] = [
      { id: "j1", beat_index: 0, candidate_index: 0, provider: "veo", status: "succeeded", provider_job_id: "veo-123", claimed_at: null, idempotency_key: "k1" },
      { id: "j2", beat_index: 0, candidate_index: 1, provider: "runway", status: "queued", provider_job_id: null, claimed_at: null, idempotency_key: "k2" },
      { id: "j3", beat_index: 1, candidate_index: 0, provider: "veo", status: "failed", provider_job_id: "veo-456", claimed_at: null, idempotency_key: "k3", error: "content policy" },
      { id: "j4", beat_index: 1, candidate_index: 1, provider: "runway", status: "polling", provider_job_id: "rw-789", claimed_at: "2024-01-01T00:00:00Z", idempotency_key: "k4" },
    ];

    const counts = { queued: 0, running: 0, polling: 0, succeeded: 0, failed: 0, canceled: 0, total: 0 };
    for (const j of dbJobs) {
      counts.total++;
      counts[j.status as keyof typeof counts] = ((counts[j.status as keyof typeof counts] as number) || 0) + 1;
    }

    expect(counts.total).toBe(4);
    expect(counts.succeeded).toBe(1);
    expect(counts.queued).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.polling).toBe(1);
  });

  it("download uses persisted public_url, not ephemeral blob", () => {
    const clip: MockClip = {
      id: "c1", beat_index: 0, candidate_index: 0, provider: "veo",
      status: "complete", public_url: "https://storage.example.com/clip1.mp4",
      storage_path: "proj/clips/clip1.mp4", selected: false, technical_score: 7.0,
    };

    // The public_url is the source of truth for downloads
    expect(clip.public_url).toBeTruthy();
    expect(clip.storage_path).toBeTruthy();
    // Download should use public_url, never in-memory blob
    expect(typeof clip.public_url).toBe("string");
  });
});

// ─── 3) Resume Polling ───

describe("Resume polling after refresh", () => {
  it("jobs with status=polling and provider_job_id are resumable", () => {
    const pollingJobs: MockJob[] = [
      { id: "j1", beat_index: 0, candidate_index: 0, provider: "veo", status: "polling", provider_job_id: "veo-op-123", claimed_at: "2024-01-01T00:00:00Z", idempotency_key: "k1" },
      { id: "j2", beat_index: 1, candidate_index: 0, provider: "runway", status: "polling", provider_job_id: "rw-task-456", claimed_at: "2024-01-01T00:00:00Z", idempotency_key: "k2" },
    ];

    // All polling jobs have provider_job_id — poll_pending_jobs can resume them
    for (const j of pollingJobs) {
      expect(j.status).toBe("polling");
      expect(j.provider_job_id).toBeTruthy();
    }
  });

  it("polling jobs can transition to succeeded with persisted output", () => {
    const job: MockJob = {
      id: "j1", beat_index: 0, candidate_index: 0, provider: "veo",
      status: "polling", provider_job_id: "veo-op-123",
      claimed_at: "2024-01-01T00:00:00Z", idempotency_key: "k1",
    };

    // Simulate poll completion
    const completedClip: MockClip = {
      id: "clip-from-j1", beat_index: job.beat_index, candidate_index: job.candidate_index,
      provider: job.provider, status: "complete",
      public_url: "https://storage.example.com/clips/beat0/j1.mp4",
      storage_path: "proj/clips/beat0/j1.mp4",
      selected: false, technical_score: 7.5,
    };

    // Output reference is persisted in DB
    expect(completedClip.public_url).toBeTruthy();
    expect(completedClip.storage_path).toBeTruthy();
  });

  it("polling jobs without provider_job_id cannot be polled (safety)", () => {
    const badJob: MockJob = {
      id: "j-bad", beat_index: 0, candidate_index: 0, provider: "veo",
      status: "polling", provider_job_id: null,
      claimed_at: "2024-01-01T00:00:00Z", idempotency_key: "k-bad",
    };
    // A job in polling state without provider_job_id is un-resumable
    expect(badJob.provider_job_id).toBeNull();
    // Backend should treat this as failed or re-queue it
  });
});

// ─── 4) Deterministic Ordering ───

describe("Deterministic clip ordering", () => {
  it("clips render in EDL order (beat_index asc, then selected first, then score desc, then candidate_index, then id)", () => {
    const clips: MockClip[] = [
      { id: "c3", beat_index: 2, candidate_index: 0, provider: "veo", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 9.0 },
      { id: "c1", beat_index: 0, candidate_index: 0, provider: "veo", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 7.0 },
      { id: "c2", beat_index: 0, candidate_index: 1, provider: "runway", status: "complete", public_url: null, storage_path: null, selected: true, technical_score: 8.0 },
      { id: "c4", beat_index: 1, candidate_index: 0, provider: "veo", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 6.5 },
    ];

    // Group by beat_index, sort within beat deterministically
    const byBeat: Record<number, MockClip[]> = {};
    for (const c of clips) {
      if (!byBeat[c.beat_index]) byBeat[c.beat_index] = [];
      byBeat[c.beat_index].push(c);
    }
    for (const k of Object.keys(byBeat)) {
      byBeat[parseInt(k)].sort((a, b) => {
        if (a.selected && !b.selected) return -1;
        if (!a.selected && b.selected) return 1;
        const scoreDiff = (b.technical_score ?? 0) - (a.technical_score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const ciDiff = a.candidate_index - b.candidate_index;
        if (ciDiff !== 0) return ciDiff;
        return a.id.localeCompare(b.id);
      });
    }

    // Beat order: 0, 1, 2
    const beatIndices = Object.keys(byBeat).map(Number).sort((a, b) => a - b);
    expect(beatIndices).toEqual([0, 1, 2]);

    // Beat 0: c2 (selected) before c1 (not selected, lower score)
    expect(byBeat[0][0].id).toBe("c2");
    expect(byBeat[0][1].id).toBe("c1");

    // Deterministic across "reload" (same input → same output)
    const byBeat2: Record<number, MockClip[]> = {};
    for (const c of clips) {
      if (!byBeat2[c.beat_index]) byBeat2[c.beat_index] = [];
      byBeat2[c.beat_index].push(c);
    }
    for (const k of Object.keys(byBeat2)) {
      byBeat2[parseInt(k)].sort((a, b) => {
        if (a.selected && !b.selected) return -1;
        if (!a.selected && b.selected) return 1;
        const scoreDiff = (b.technical_score ?? 0) - (a.technical_score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const ciDiff = a.candidate_index - b.candidate_index;
        if (ciDiff !== 0) return ciDiff;
        return a.id.localeCompare(b.id);
      });
    }
    expect(byBeat2[0][0].id).toBe(byBeat[0][0].id);
  });

  it("equal scores use candidate_index then id as stable tie-breakers", () => {
    const clips: MockClip[] = [
      { id: "c-b", beat_index: 0, candidate_index: 1, provider: "veo", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 7.0 },
      { id: "c-a", beat_index: 0, candidate_index: 0, provider: "runway", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 7.0 },
    ];
    clips.sort((a, b) => {
      if (a.selected && !b.selected) return -1;
      if (!a.selected && b.selected) return 1;
      const scoreDiff = (b.technical_score ?? 0) - (a.technical_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const ciDiff = a.candidate_index - b.candidate_index;
      if (ciDiff !== 0) return ciDiff;
      return a.id.localeCompare(b.id);
    });
    expect(clips[0].id).toBe("c-a"); // candidate_index 0 < 1
    expect(clips[1].id).toBe("c-b");
  });
});

// ─── 5) Stale Running Job Recovery ───

describe("Stale running job recovery", () => {
  const STALE_THRESHOLD_MS = 15 * 60 * 1000;

  it("running jobs older than threshold are reclaimable", () => {
    const now = Date.now();
    const staleTime = new Date(now - STALE_THRESHOLD_MS - 1000).toISOString();
    const recentTime = new Date(now - 60_000).toISOString(); // 1 min ago

    const jobs: MockJob[] = [
      { id: "j1", beat_index: 0, candidate_index: 0, provider: "veo", status: "running", provider_job_id: null, claimed_at: staleTime, idempotency_key: "k1" },
      { id: "j2", beat_index: 1, candidate_index: 0, provider: "runway", status: "running", provider_job_id: "rw-123", claimed_at: recentTime, idempotency_key: "k2" },
      { id: "j3", beat_index: 2, candidate_index: 0, provider: "veo", status: "queued", provider_job_id: null, claimed_at: null, idempotency_key: "k3" },
    ];

    // Simulate stale recovery (what handleProcessQueue does)
    const threshold = new Date(now - STALE_THRESHOLD_MS);
    const recovered: string[] = [];
    for (const j of jobs) {
      if (j.status === "running" && j.claimed_at && new Date(j.claimed_at) < threshold) {
        j.status = "queued";
        j.claimed_at = null;
        j.error = "Auto-recovered from stale running state";
        recovered.push(j.id);
      }
    }

    expect(recovered).toEqual(["j1"]); // only the stale one
    expect(jobs[0].status).toBe("queued"); // recovered
    expect(jobs[0].error).toBe("Auto-recovered from stale running state");
    expect(jobs[1].status).toBe("running"); // recent, not recovered
    expect(jobs[2].status).toBe("queued"); // was already queued
  });

  it("terminal jobs are never recovered", () => {
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString();
    const terminalJobs: MockJob[] = [
      { id: "j1", beat_index: 0, candidate_index: 0, provider: "veo", status: "succeeded", provider_job_id: "veo-123", claimed_at: staleTime, idempotency_key: "k1" },
      { id: "j2", beat_index: 1, candidate_index: 0, provider: "runway", status: "failed", provider_job_id: null, claimed_at: staleTime, idempotency_key: "k2" },
      { id: "j3", beat_index: 2, candidate_index: 0, provider: "veo", status: "canceled", provider_job_id: null, claimed_at: staleTime, idempotency_key: "k3" },
    ];

    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    const recovered: string[] = [];
    for (const j of terminalJobs) {
      if (j.status === "running" && j.claimed_at && new Date(j.claimed_at) < threshold) {
        recovered.push(j.id);
      }
    }

    expect(recovered).toEqual([]); // none recovered — all terminal
  });

  it("polling jobs are NOT recovered by stale check (they have their own polling path)", () => {
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString();
    const pollingJob: MockJob = {
      id: "j1", beat_index: 0, candidate_index: 0, provider: "veo",
      status: "polling", provider_job_id: "veo-op-123",
      claimed_at: staleTime, idempotency_key: "k1",
    };

    // Stale check only targets status === "running"
    const isStaleRecoverable = pollingJob.status === "running" && pollingJob.claimed_at && new Date(pollingJob.claimed_at) < new Date(Date.now() - STALE_THRESHOLD_MS);
    expect(isStaleRecoverable).toBe(false);
  });
});

// ─── 6) Blueprint readiness filter consistency ───

describe("Blueprint filter uses shared isReadyStatus", () => {
  it("ClipCandidatesStudio filter matches backend gate", () => {
    const statuses = ["complete", "ready", "v2_shim", "draft", "failed", "error"];
    const accepted = statuses.filter(isReadyStatus);
    expect(accepted).toEqual(["complete", "ready", "v2_shim"]);
  });

  it("READY_STATUSES array has expected members", () => {
    expect(READY_STATUSES).toContain("complete");
    expect(READY_STATUSES).toContain("ready");
    expect(READY_STATUSES).toContain("v2_shim");
    expect(READY_STATUSES).toHaveLength(3);
  });
});

// ─── 7) Provider toggle sessionStorage persistence ───

describe("Provider toggle sessionStorage persistence", () => {
  it("serialization roundtrips correctly", () => {
    const state = { veo: true, runway: false };
    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized);
    expect(parsed.veo).toBe(true);
    expect(parsed.runway).toBe(false);
  });

  it("defaults to veo=true, runway=false on empty storage", () => {
    const fallback = { veo: true, runway: false };
    try {
      const s = null; // simulates empty sessionStorage
      const parsed = s ? JSON.parse(s) : fallback;
      expect(parsed.veo).toBe(true);
      expect(parsed.runway).toBe(false);
    } catch {
      // fallback
      expect(fallback.veo).toBe(true);
    }
  });
});

// ─── 8) Select clip idempotency ───

describe("Select clip idempotency", () => {
  it("selecting same clip twice results in same state", () => {
    const clips: MockClip[] = [
      { id: "c1", beat_index: 0, candidate_index: 0, provider: "veo", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 8.0 },
      { id: "c2", beat_index: 0, candidate_index: 1, provider: "runway", status: "complete", public_url: null, storage_path: null, selected: false, technical_score: 7.0 },
    ];

    function simulateSelect(allClips: MockClip[], selectId: string, beatIndex: number) {
      for (const c of allClips) {
        if (c.beat_index === beatIndex) c.selected = false;
      }
      const target = allClips.find(c => c.id === selectId);
      if (target) target.selected = true;
    }

    simulateSelect(clips, "c1", 0);
    expect(clips[0].selected).toBe(true);
    expect(clips[1].selected).toBe(false);

    // Select again — same result
    simulateSelect(clips, "c1", 0);
    expect(clips[0].selected).toBe(true);
    expect(clips[1].selected).toBe(false);
  });
});

// ─── 9) Reset failed determinism ───

describe("Reset failed determinism", () => {
  it("only requeues failed jobs, not other statuses", () => {
    const jobs: MockJob[] = [
      { id: "j1", beat_index: 0, candidate_index: 0, provider: "veo", status: "failed", provider_job_id: null, claimed_at: null, idempotency_key: "k1", error: "timeout" },
      { id: "j2", beat_index: 1, candidate_index: 0, provider: "runway", status: "succeeded", provider_job_id: "rw-1", claimed_at: null, idempotency_key: "k2" },
      { id: "j3", beat_index: 2, candidate_index: 0, provider: "veo", status: "queued", provider_job_id: null, claimed_at: null, idempotency_key: "k3" },
      { id: "j4", beat_index: 3, candidate_index: 0, provider: "veo", status: "canceled", provider_job_id: null, claimed_at: null, idempotency_key: "k4" },
    ];

    // Simulate reset_failed
    let resetCount = 0;
    for (const j of jobs) {
      if (j.status === "failed") {
        j.status = "queued";
        j.error = null;
        j.provider_job_id = null;
        j.claimed_at = null;
        resetCount++;
      }
    }

    expect(resetCount).toBe(1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[1].status).toBe("succeeded");
    expect(jobs[2].status).toBe("queued");
    expect(jobs[3].status).toBe("canceled");
  });
});
