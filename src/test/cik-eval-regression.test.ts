/**
 * CIK Eval Harness — Full Regression Suite
 * Runs ALL lane fixtures through the real scoring pipeline.
 * No LLM calls. No DB writes. Purely deterministic.
 */
import { describe, it, expect } from "vitest";

import {
  runEvalFixture,
  runEvalSuite,
  type EvalFixture,
} from "../../supabase/functions/_shared/cik/evals/evalRunner";

import { FEATURE_FILM_FIXTURES } from "../../supabase/functions/_shared/cik/evals/fixtures-feature-film";
import { SERIES_FIXTURES } from "../../supabase/functions/_shared/cik/evals/fixtures-series";
import { VERTICAL_DRAMA_FIXTURES } from "../../supabase/functions/_shared/cik/evals/fixtures-vertical-drama";
import { DOCUMENTARY_FIXTURES } from "../../supabase/functions/_shared/cik/evals/fixtures-documentary";

const ALL_FIXTURES: EvalFixture[] = [
  ...FEATURE_FILM_FIXTURES,
  ...SERIES_FIXTURES,
  ...VERTICAL_DRAMA_FIXTURES,
  ...DOCUMENTARY_FIXTURES,
];

/* ── Per-lane regression suites ── */

describe("CIK eval: feature_film lane", () => {
  for (const fixture of FEATURE_FILM_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = runEvalFixture(fixture);
      expect(result.mismatches).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});

describe("CIK eval: series lane", () => {
  for (const fixture of SERIES_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = runEvalFixture(fixture);
      expect(result.mismatches).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});

describe("CIK eval: vertical_drama lane", () => {
  for (const fixture of VERTICAL_DRAMA_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = runEvalFixture(fixture);
      expect(result.mismatches).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});

describe("CIK eval: documentary lane", () => {
  for (const fixture of DOCUMENTARY_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = runEvalFixture(fixture);
      expect(result.mismatches).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});

/* ── Suite-level invariants ── */

describe("CIK eval: suite invariants", () => {
  it("all fixtures run with zero regressions", () => {
    const suite = runEvalSuite(ALL_FIXTURES);
    expect(suite.totalFailed).toBe(0);
    expect(suite.totalPassed).toBe(ALL_FIXTURES.length);
    expect(ALL_FIXTURES.length).toBeGreaterThanOrEqual(24);
  });

  it("every lane has at least 6 fixtures", () => {
    const lanes = ["feature_film", "series", "vertical_drama", "documentary"];
    for (const lane of lanes) {
      const count = ALL_FIXTURES.filter(f => f.lane === lane).length;
      expect(count).toBeGreaterThanOrEqual(6);
    }
  });

  it("every lane has at least 2 passing fixtures", () => {
    const lanes = ["feature_film", "series", "vertical_drama", "documentary"];
    for (const lane of lanes) {
      const passing = ALL_FIXTURES.filter(f => f.lane === lane && f.expectedPass === true);
      expect(passing.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("every lane has at least 2 failing fixtures", () => {
    const lanes = ["feature_film", "series", "vertical_drama", "documentary"];
    for (const lane of lanes) {
      const failing = ALL_FIXTURES.filter(f => f.lane === lane && f.expectedPass === false);
      expect(failing.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("scores are deterministic across repeated runs", () => {
    const results1 = ALL_FIXTURES.map(runEvalFixture);
    const results2 = ALL_FIXTURES.map(runEvalFixture);
    for (let i = 0; i < results1.length; i++) {
      expect(results1[i].actualScore).toBe(results2[i].actualScore);
      expect(results1[i].actualPass).toBe(results2[i].actualPass);
      expect(results1[i].actualFailures).toEqual(results2[i].actualFailures);
    }
  });

  it("score bounds checking works for exact match", () => {
    const actualScore = runEvalFixture(FEATURE_FILM_FIXTURES[0]).actualScore;
    const fixture: EvalFixture = {
      name: "bounds_exact",
      units: FEATURE_FILM_FIXTURES[0].units,
      expectedPass: true,
      expectedScore: actualScore,
    };
    const result = runEvalFixture(fixture);
    expect(result.passed).toBe(true);
  });

  it("score bounds checking works for range", () => {
    const fixture: EvalFixture = {
      name: "bounds_range",
      units: FEATURE_FILM_FIXTURES[0].units,
      expectedPass: true,
      expectedScore: { min: 0.0, max: 1.0 },
    };
    const result = runEvalFixture(fixture);
    expect(result.passed).toBe(true);
  });

  it("score bounds checking rejects out-of-range", () => {
    // Use a failing fixture whose score is well below 0.95
    const fixture: EvalFixture = {
      name: "bounds_reject",
      units: FEATURE_FILM_FIXTURES[1].units, // ff_flat_energy — fails, low score
      expectedPass: false,
      expectedScore: { min: 0.95, max: 1.0 },
    };
    const result = runEvalFixture(fixture);
    expect(result.mismatches.some(m => m.includes("score out of bounds"))).toBe(true);
  });
});
