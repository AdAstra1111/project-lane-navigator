/**
 * Timeline Builder — Tests
 * Determinism, cumulative timestamps, edge cases.
 */
import { describe, it, expect } from "vitest";
import { buildTimeline, type TimelineShotInput } from "@/videoRender/assembly/timelineBuilder";

function makeShot(index: number, duration: number, status = "complete"): TimelineShotInput {
  return {
    shot_index: index,
    status,
    artifact_json: {
      storagePath: `projects/p1/renders/j1/shots/${index}.mp4`,
      publicUrl: `https://storage.example.com/shots/${index}.mp4`,
      durationSec: duration,
    },
    prompt_json: {
      durationSec: duration + 1, // should be ignored when artifact has it
    },
  };
}

describe("buildTimeline — determinism", () => {
  it("same inputs produce identical output", () => {
    const shots = [makeShot(0, 3), makeShot(1, 4), makeShot(2, 2)];
    const t1 = buildTimeline(shots);
    const t2 = buildTimeline(shots);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
  });

  it("produces correct version and defaults", () => {
    const t = buildTimeline([makeShot(0, 5)]);
    expect(t.version).toBe("v1");
    expect(t.fps).toBe(24);
    expect(t.resolution).toBe("1280x720");
  });
});

describe("buildTimeline — cumulative timestamps", () => {
  it("computes correct start/end for sequential shots", () => {
    const shots = [makeShot(0, 3), makeShot(1, 4), makeShot(2, 2.5)];
    const t = buildTimeline(shots);
    const clips = t.tracks[0].clips;

    expect(clips[0].startSec).toBe(0);
    expect(clips[0].endSec).toBe(3);
    expect(clips[1].startSec).toBe(3);
    expect(clips[1].endSec).toBe(7);
    expect(clips[2].startSec).toBe(7);
    expect(clips[2].endSec).toBe(9.5);
    expect(t.totalDurationSec).toBe(9.5);
  });

  it("single shot timeline", () => {
    const t = buildTimeline([makeShot(0, 5)]);
    expect(t.tracks[0].clips.length).toBe(1);
    expect(t.totalDurationSec).toBe(5);
  });
});

describe("buildTimeline — filtering and sorting", () => {
  it("excludes non-complete shots", () => {
    const shots = [
      makeShot(0, 3),
      makeShot(1, 4, "error"),
      makeShot(2, 2, "running"),
      makeShot(3, 5),
    ];
    const t = buildTimeline(shots);
    expect(t.tracks[0].clips.length).toBe(2);
    expect(t.tracks[0].clips[0].shotIndex).toBe(0);
    expect(t.tracks[0].clips[1].shotIndex).toBe(3);
    expect(t.totalDurationSec).toBe(8);
  });

  it("sorts by shot_index even if input is unordered", () => {
    const shots = [makeShot(2, 2), makeShot(0, 3), makeShot(1, 4)];
    const t = buildTimeline(shots);
    expect(t.tracks[0].clips.map(c => c.shotIndex)).toEqual([0, 1, 2]);
  });
});

describe("buildTimeline — duration fallback", () => {
  it("uses prompt_json duration when artifact has none", () => {
    const shot: TimelineShotInput = {
      shot_index: 0,
      status: "complete",
      artifact_json: { storagePath: "test.mp4" },
      prompt_json: { durationSec: 6 },
    };
    const t = buildTimeline([shot]);
    expect(t.tracks[0].clips[0].durationSec).toBe(6);
  });

  it("falls back to 4s default when no duration anywhere", () => {
    const shot: TimelineShotInput = {
      shot_index: 0,
      status: "complete",
      artifact_json: {},
      prompt_json: {},
    };
    const t = buildTimeline([shot]);
    expect(t.tracks[0].clips[0].durationSec).toBe(4);
  });
});

describe("buildTimeline — empty input", () => {
  it("handles empty array", () => {
    const t = buildTimeline([]);
    expect(t.tracks[0].clips.length).toBe(0);
    expect(t.totalDurationSec).toBe(0);
  });

  it("handles all-error shots as empty", () => {
    const shots = [makeShot(0, 3, "error"), makeShot(1, 4, "queued")];
    const t = buildTimeline(shots);
    expect(t.tracks[0].clips.length).toBe(0);
    expect(t.totalDurationSec).toBe(0);
  });
});

describe("buildTimeline — options override", () => {
  it("respects custom fps and resolution", () => {
    const t = buildTimeline([makeShot(0, 3)], { fps: 30, resolution: "1920x1080" });
    expect(t.fps).toBe(30);
    expect(t.resolution).toBe("1920x1080");
  });
});

describe("buildTimeline — srcPath and publicUrl", () => {
  it("includes storage paths in clips", () => {
    const t = buildTimeline([makeShot(0, 3)]);
    const clip = t.tracks[0].clips[0];
    expect(clip.srcPath).toContain("shots/0.mp4");
    expect(clip.publicUrl).toContain("shots/0.mp4");
  });
});
