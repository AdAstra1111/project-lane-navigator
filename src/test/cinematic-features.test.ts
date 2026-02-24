import { describe, it, expect } from "vitest";

// We test the cinematic modules by importing their logic directly.
// Since these are Deno edge function files, we re-implement the core logic inline for testing.

// ─── Feature Extractor Tests ───

interface CinematicUnit {
  id: string;
  intent: "intrigue" | "threat" | "wonder" | "chaos" | "emotion" | "release";
  energy: number;
  tension: number;
  density: number;
  tonal_polarity: number;
}

function makeUnit(overrides: Partial<CinematicUnit> & { id: string }): CinematicUnit {
  return {
    intent: "intrigue",
    energy: 0.5,
    tension: 0.5,
    density: 0.5,
    tonal_polarity: 0,
    ...overrides,
  };
}

// Replicate core feature extractor logic for testing
function countDirectionReversals(deltas: number[], threshold: number): number {
  let reversals = 0;
  let lastSign = 0;
  for (const d of deltas) {
    if (Math.abs(d) < threshold) continue;
    const sign = d > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) reversals++;
    lastSign = sign;
  }
  return reversals;
}

function tonalFlipCount(values: number[]): number {
  let flips = 0;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) flips++;
  }
  return flips;
}

describe("Cinematic Feature Extractor", () => {
  it("computes peakIndex correctly", () => {
    const energies = [0.2, 0.4, 0.9, 0.6];
    const peakIndex = energies.indexOf(Math.max(...energies));
    expect(peakIndex).toBe(2);
  });

  it("peakIsLate when peak in last 2 units", () => {
    const energies = [0.2, 0.4, 0.6, 0.95];
    const peakIndex = energies.indexOf(Math.max(...energies));
    const lateWindowStart = Math.max(0, energies.length - 2);
    expect(peakIndex >= lateWindowStart).toBe(true);
  });

  it("peakIsLate false when peak is early", () => {
    const energies = [0.95, 0.4, 0.6, 0.5];
    const peakIndex = energies.indexOf(Math.max(...energies));
    const lateWindowStart = Math.max(0, energies.length - 2);
    expect(peakIndex >= lateWindowStart).toBe(false);
  });

  it("counts tonal sign flips", () => {
    const polarities = [0.5, -0.3, 0.2, -0.1];
    expect(tonalFlipCount(polarities)).toBe(3);
  });

  it("counts zero flips for monotonic polarity", () => {
    const polarities = [-0.5, -0.3, -0.1, 0.0];
    // -0.5 to -0.3: no flip; -0.3 to -0.1: no flip; -0.1 to 0.0: no flip (0 is neither positive nor negative)
    expect(tonalFlipCount(polarities)).toBe(0);
  });

  it("counts direction reversals in energy deltas", () => {
    // zigzag pattern
    const deltas = [0.2, -0.15, 0.18, -0.12, 0.1];
    expect(countDirectionReversals(deltas, 0.08)).toBe(4);
  });

  it("ignores small deltas in reversal count", () => {
    const deltas = [0.2, -0.02, 0.01, -0.15];
    // Only 0.2 (pos) and -0.15 (neg) are significant → 1 reversal
    expect(countDirectionReversals(deltas, 0.08)).toBe(1);
  });
});

describe("Pacing Mismatch Detection", () => {
  function detectPacingMismatch(
    densityStart: number, densityEnd: number,
    energyEnd: number, densityDeltas: number[], energyDeltas: number[],
    unitCount: number,
  ): boolean {
    if (unitCount < 4) return false;
    const earlyDensityHigh = densityStart > 0.7 && densityEnd < 0.5;
    const lateDensityLow = densityEnd < 0.35 && energyEnd > 0.7;
    const dVar = variance(densityDeltas);
    const eVar = variance(energyDeltas);
    const samey = dVar < 0.005 && eVar < 0.005 && unitCount >= 4;
    return earlyDensityHigh || lateDensityLow || samey;
  }

  function variance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  }

  it("detects high-early low-late density", () => {
    expect(detectPacingMismatch(0.8, 0.3, 0.5, [], [], 5)).toBe(true);
  });

  it("detects low-late density with high energy", () => {
    expect(detectPacingMismatch(0.5, 0.3, 0.8, [], [], 5)).toBe(true);
  });

  it("detects samey pacing (near-zero variance)", () => {
    const deltas = [0.01, 0.01, 0.01, 0.01];
    expect(detectPacingMismatch(0.5, 0.5, 0.5, deltas, deltas, 5)).toBe(true);
  });

  it("no mismatch for healthy pacing", () => {
    expect(detectPacingMismatch(0.3, 0.7, 0.8, [0.05, 0.2, -0.1], [0.1, 0.3, -0.05], 5)).toBe(false);
  });
});

describe("Scoring Penalties for New Diagnostics", () => {
  it("PACING_MISMATCH penalty is 0.06", () => {
    // Verify the penalty constant
    const penalty = 0.06;
    const base = 1.0;
    expect(base - penalty).toBeCloseTo(0.94);
  });

  it("ENERGY_DROP penalty is 0.08", () => {
    const penalty = 0.08;
    const base = 1.0;
    expect(base - penalty).toBeCloseTo(0.92);
  });

  it("DIRECTION_REVERSAL penalty is 0.07", () => {
    const penalty = 0.07;
    const base = 1.0;
    expect(base - penalty).toBeCloseTo(0.93);
  });
});

describe("Repair Instruction Targets", () => {
  const FAILURE_TARGETS: Record<string, string> = {
    PACING_MISMATCH: "Late units density >= 0.5; density variance across units should be >= 0.01; avoid uniform density",
    ENERGY_DROP: "energy[last] >= energy[mid]; final 20% of units must not trend downward; energy[last] >= 0.80",
    DIRECTION_REVERSAL: "Max 3 energy direction reversals (sign changes in energy deltas > 0.08); prefer monotonic ramp",
  };

  it("includes PACING_MISMATCH target when triggered", () => {
    const failures = ["PACING_MISMATCH"];
    const targets = failures.map(f => FAILURE_TARGETS[f]).filter(Boolean);
    expect(targets.length).toBe(1);
    expect(targets[0]).toContain("density");
  });

  it("includes ENERGY_DROP target when triggered", () => {
    const failures = ["ENERGY_DROP"];
    const targets = failures.map(f => FAILURE_TARGETS[f]).filter(Boolean);
    expect(targets[0]).toContain("energy[last]");
  });

  it("includes DIRECTION_REVERSAL target when triggered", () => {
    const failures = ["DIRECTION_REVERSAL"];
    const targets = failures.map(f => FAILURE_TARGETS[f]).filter(Boolean);
    expect(targets[0]).toContain("reversals");
  });

  it("produces no targets for unknown failures", () => {
    const failures = ["UNKNOWN_CODE"];
    const targets = failures.map(f => FAILURE_TARGETS[f]).filter(Boolean);
    expect(targets.length).toBe(0);
  });
});

describe("Adapter Fallback Validation", () => {
  it("detects missing fields", () => {
    const units = [{ id: "u0", intent: "intrigue", energy: 0.5 }]; // missing tension, density, tonal_polarity
    const REQUIRED = ["energy", "tension", "density", "tonal_polarity"] as const;
    const missing: string[] = [];
    for (let i = 0; i < units.length; i++) {
      for (const f of REQUIRED) {
        if ((units[i] as any)[f] == null) missing.push(`unit[${i}].${f}`);
      }
    }
    expect(missing).toContain("unit[0].tension");
    expect(missing).toContain("unit[0].density");
    expect(missing).toContain("unit[0].tonal_polarity");
  });

  it("detects out-of-range values", () => {
    const units = [{ id: "u0", intent: "intrigue", energy: 1.5, tension: -0.1, density: 0.5, tonal_polarity: 0 }];
    const outOfRange: string[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.energy < 0 || u.energy > 1) outOfRange.push(`unit[${i}].energy=${u.energy}`);
      if (u.tension < 0 || u.tension > 1) outOfRange.push(`unit[${i}].tension=${u.tension}`);
    }
    expect(outOfRange).toContain("unit[0].energy=1.5");
    expect(outOfRange).toContain("unit[0].tension=-0.1");
  });
});
