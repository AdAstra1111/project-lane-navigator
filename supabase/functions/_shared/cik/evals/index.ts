/**
 * CIK Eval Harness — Public API
 * Re-exports runner + all lane fixtures for use in tests and standalone scripts.
 */

export { runEvalFixture, runEvalSuite } from "./evalRunner.ts";
export type { EvalFixture, EvalResult, ScoreBounds } from "./evalRunner.ts";

export { FEATURE_FILM_FIXTURES } from "./fixtures-feature-film.ts";
export { SERIES_FIXTURES } from "./fixtures-series.ts";
export { VERTICAL_DRAMA_FIXTURES } from "./fixtures-vertical-drama.ts";
export { DOCUMENTARY_FIXTURES } from "./fixtures-documentary.ts";

import { FEATURE_FILM_FIXTURES } from "./fixtures-feature-film.ts";
import { SERIES_FIXTURES } from "./fixtures-series.ts";
import { VERTICAL_DRAMA_FIXTURES } from "./fixtures-vertical-drama.ts";
import { DOCUMENTARY_FIXTURES } from "./fixtures-documentary.ts";
import type { EvalFixture } from "./evalRunner.ts";

/** All fixtures across all lanes. */
export const ALL_FIXTURES: EvalFixture[] = [
  ...FEATURE_FILM_FIXTURES,
  ...SERIES_FIXTURES,
  ...VERTICAL_DRAMA_FIXTURES,
  ...DOCUMENTARY_FIXTURES,
];
