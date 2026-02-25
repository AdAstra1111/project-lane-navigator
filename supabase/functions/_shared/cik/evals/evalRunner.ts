/**
 * CIK — Evaluation Harness
 * Loads fixture JSON, runs scoreCinematic, compares against expected outcomes.
 * Used for regression-proofing CIK quality.
 */
import type { CinematicUnit, CinematicFailureCode } from "../../cinematic-model.ts";
import { scoreCinematic, type ScoringContext } from "../../cinematic-score.ts";

export interface ScoreBounds {
  min: number;
  max: number;
}

export interface EvalFixture {
  name: string;
  lane?: string;
  units: CinematicUnit[];
  expectedPass: boolean;
  expectedFailures?: CinematicFailureCode[];
  /** If set, these failures must NOT appear. */
  forbiddenFailures?: CinematicFailureCode[];
  /** Exact score match (if stable) or bounds { min, max }. */
  expectedScore?: number | ScoreBounds;
  description?: string;
}

export interface EvalResult {
  fixture: string;
  lane?: string;
  passed: boolean;
  actualPass: boolean;
  actualScore: number;
  actualFailures: CinematicFailureCode[];
  expectedPass: boolean;
  mismatches: string[];
}

/**
 * Run a single eval fixture against scoreCinematic.
 */
export function runEvalFixture(fixture: EvalFixture): EvalResult {
  const ctx: ScoringContext = { lane: fixture.lane };
  const score = scoreCinematic(fixture.units, ctx);

  const mismatches: string[] = [];

  if (score.pass !== fixture.expectedPass) {
    mismatches.push(`pass: expected=${fixture.expectedPass} actual=${score.pass}`);
  }

  if (fixture.expectedFailures) {
    for (const ef of fixture.expectedFailures) {
      if (!score.failures.includes(ef)) {
        mismatches.push(`missing expected failure: ${ef}`);
      }
    }
  }

  if (fixture.forbiddenFailures) {
    for (const ff of fixture.forbiddenFailures) {
      if (score.failures.includes(ff)) {
        mismatches.push(`unexpected forbidden failure: ${ff}`);
      }
    }
  }

  // Score bounds checking
  if (fixture.expectedScore !== undefined) {
    if (typeof fixture.expectedScore === "number") {
      if (Math.abs(score.score - fixture.expectedScore) > 0.001) {
        mismatches.push(`score: expected=${fixture.expectedScore} actual=${score.score.toFixed(4)}`);
      }
    } else {
      const bounds = fixture.expectedScore as ScoreBounds;
      if (score.score < bounds.min || score.score > bounds.max) {
        mismatches.push(`score out of bounds: expected [${bounds.min}, ${bounds.max}] actual=${score.score.toFixed(4)}`);
      }
    }
  }

  return {
    fixture: fixture.name,
    lane: fixture.lane,
    passed: mismatches.length === 0,
    actualPass: score.pass,
    actualScore: score.score,
    actualFailures: score.failures,
    expectedPass: fixture.expectedPass,
    mismatches,
  };
}

/**
 * Run all fixtures, return summary.
 */
export function runEvalSuite(fixtures: EvalFixture[]): {
  results: EvalResult[];
  totalPassed: number;
  totalFailed: number;
  summary: string;
} {
  const results = fixtures.map(runEvalFixture);
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.length - totalPassed;

  const summary = results
    .filter(r => !r.passed)
    .map(r => `  FAIL: ${r.fixture} (${r.lane || "default"}) — ${r.mismatches.join("; ")}`)
    .join("\n");

  return {
    results,
    totalPassed,
    totalFailed,
    summary: totalFailed === 0
      ? `All ${totalPassed} fixtures passed.`
      : `${totalFailed}/${results.length} fixtures failed:\n${summary}`,
  };
}
