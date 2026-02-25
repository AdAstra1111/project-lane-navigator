/**
 * Demo Run State Machine — Tests
 * Deterministic transitions, progress, hash, validation.
 */
import { describe, it, expect } from "vitest";
import {
  nextStep, stepIndex, stepProgress, isValidTransition,
  settingsHash, buildLogEntry, DEMO_STEPS,
  type DemoStep,
} from "@/videoRender/demoStateMachine";

describe("nextStep", () => {
  it("cik -> video_plan", () => expect(nextStep("cik")).toBe("video_plan"));
  it("video_plan -> render_job", () => expect(nextStep("video_plan")).toBe("render_job"));
  it("render_job -> rough_cut", () => expect(nextStep("render_job")).toBe("rough_cut"));
  it("rough_cut -> feedback", () => expect(nextStep("rough_cut")).toBe("feedback"));
  it("feedback -> complete", () => expect(nextStep("feedback")).toBe("complete"));
  it("complete -> null", () => expect(nextStep("complete")).toBeNull());
});

describe("stepIndex", () => {
  it("returns correct indices", () => {
    DEMO_STEPS.forEach((s, i) => expect(stepIndex(s)).toBe(i));
  });
  it("invalid returns -1", () => expect(stepIndex("invalid" as DemoStep)).toBe(-1));
});

describe("stepProgress", () => {
  it("complete step = 100", () => expect(stepProgress("complete", "complete")).toBe(100));
  it("queued cik is partial", () => {
    const p = stepProgress("cik", "running");
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(50);
  });
  it("error preserves progress to failed step", () => {
    const p = stepProgress("render_job", "error");
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(100);
  });
  it("running feedback is near 100", () => {
    expect(stepProgress("feedback", "running")).toBeGreaterThan(70);
  });
});

describe("isValidTransition", () => {
  it("allows sequential steps", () => {
    expect(isValidTransition("cik", "video_plan")).toBe(true);
    expect(isValidTransition("feedback", "complete")).toBe(true);
  });
  it("rejects skipping steps", () => {
    expect(isValidTransition("cik", "render_job")).toBe(false);
  });
  it("rejects going backwards", () => {
    expect(isValidTransition("render_job", "cik")).toBe(false);
  });
  it("rejects same step", () => {
    expect(isValidTransition("cik", "cik")).toBe(false);
  });
});

describe("settingsHash — determinism", () => {
  it("same inputs produce same hash", () => {
    const h1 = settingsHash("p1", "d1", { model: "veo-2" });
    const h2 = settingsHash("p1", "d1", { model: "veo-2" });
    expect(h1).toBe(h2);
  });
  it("different inputs produce different hash", () => {
    const h1 = settingsHash("p1", "d1", { model: "veo-2" });
    const h2 = settingsHash("p1", "d2", { model: "veo-2" });
    expect(h1).not.toBe(h2);
  });
  it("hash is a hex string", () => {
    const h = settingsHash("p1", null, {});
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
});

describe("buildLogEntry", () => {
  it("produces valid entry", () => {
    const e = buildLogEntry("cik", "started", "running quality gate");
    expect(e.step).toBe("cik");
    expect(e.action).toBe("started");
    expect(e.detail).toBe("running quality gate");
    expect(e.ts).toBeTruthy();
  });
  it("omits detail when not provided", () => {
    const e = buildLogEntry("cik", "done");
    expect(e.detail).toBeUndefined();
  });
});

describe("integration — success path state transitions", () => {
  it("walks all steps in order", () => {
    let current: DemoStep = "cik";
    const visited: DemoStep[] = [current];
    while (true) {
      const next = nextStep(current);
      if (!next) break;
      expect(isValidTransition(current, next)).toBe(true);
      visited.push(next);
      current = next;
    }
    expect(visited).toEqual([...DEMO_STEPS]);
    expect(current).toBe("complete");
  });
});

describe("integration — error path halts deterministically", () => {
  it("error at render_job stops pipeline", () => {
    const log: Array<{ step: DemoStep; status: string }> = [];
    let current: DemoStep = "cik";

    // Simulate steps
    for (const step of DEMO_STEPS) {
      if (step === "complete") break;
      current = step;
      if (step === "render_job") {
        log.push({ step, status: "error" });
        break;
      }
      log.push({ step, status: "complete" });
      const next = nextStep(current);
      if (next) current = next;
    }

    expect(current).toBe("render_job");
    expect(log[log.length - 1].status).toBe("error");
    expect(log.length).toBe(3); // cik, video_plan, render_job
  });
});
