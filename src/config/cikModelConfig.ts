/**
 * CIK Model Router — Canonical Configuration (Single Source of Truth)
 *
 * This file defines the canonical model names and lane overrides for the CIK
 * quality-gate model router. Both frontend and backend MUST stay in sync with
 * these values. A Vitest drift test enforces equality at CI time.
 *
 * DO NOT duplicate these values elsewhere. If you need to change a model,
 * change it here AND in the backend mirror at
 * supabase/functions/_shared/cik/modelRouter.ts, then run tests.
 */

/* ── Canonical Config Shape ── */

export interface CikLaneOverride {
  attempt0?: string;
  attempt1Strong?: string;
}

export interface CikModelRouterConfig {
  attempt0Default: string;
  attempt1Strong: string;
  laneOverrides: Record<string, CikLaneOverride>;
}

/* ── Canonical Values ── */

export const CIK_MODEL_ROUTER_CONFIG: CikModelRouterConfig = {
  attempt0Default: "google/gemini-2.5-flash",
  attempt1Strong: "google/gemini-2.5-pro",
  laneOverrides: {
    feature_film: { attempt1Strong: "openai/gpt-5" },
    series: { attempt1Strong: "openai/gpt-5" },
  },
};
