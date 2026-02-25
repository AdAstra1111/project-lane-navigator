/**
 * CIK Model Router — Drift Guard Tests
 *
 * These tests import model-router constants from BOTH the frontend canonical
 * config and the backend (edge function) mirror, then assert deep equality.
 * If any value diverges between FE and BE, these tests fail — preventing
 * silent model-selection drift across surfaces.
 */
import { describe, it, expect } from "vitest";

// Frontend canonical config
import { CIK_MODEL_ROUTER_CONFIG } from "@/config/cikModelConfig";
import {
  CIK_MODEL_ATTEMPT0_DEFAULT as FE_ATTEMPT0,
  CIK_MODEL_ATTEMPT1_STRONG as FE_ATTEMPT1,
  selectCikModel as feSelectCikModel,
} from "@/config/cikModels";

// Backend config (edge function mirror)
import {
  CIK_MODEL_ATTEMPT0_DEFAULT as BE_ATTEMPT0,
  CIK_MODEL_ATTEMPT1_STRONG as BE_ATTEMPT1,
  selectCikModel as beSelectCikModel,
} from "../../supabase/functions/_shared/cik/modelRouter";

/* ── A) Constant equality ── */

describe("CIK model router drift guard", () => {
  it("FE attempt0 default matches canonical config", () => {
    expect(FE_ATTEMPT0).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
  });

  it("FE attempt1 strong matches canonical config", () => {
    expect(FE_ATTEMPT1).toBe(CIK_MODEL_ROUTER_CONFIG.attempt1Strong);
  });

  it("BE attempt0 default matches canonical config", () => {
    expect(BE_ATTEMPT0).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
  });

  it("BE attempt1 strong matches canonical config", () => {
    expect(BE_ATTEMPT1).toBe(CIK_MODEL_ROUTER_CONFIG.attempt1Strong);
  });

  it("FE and BE attempt0 default are identical", () => {
    expect(FE_ATTEMPT0).toBe(BE_ATTEMPT0);
  });

  it("FE and BE attempt1 strong are identical", () => {
    expect(FE_ATTEMPT1).toBe(BE_ATTEMPT1);
  });
});

/* ── B) Lane override equality ── */

describe("CIK lane override drift guard", () => {
  const canonicalLanes = Object.keys(CIK_MODEL_ROUTER_CONFIG.laneOverrides).sort();

  it("canonical config has expected lanes", () => {
    expect(canonicalLanes).toEqual(["feature_film", "series"]);
  });

  for (const lane of canonicalLanes) {
    it(`FE and BE select same models for lane '${lane}' attempt 0`, () => {
      const fe = feSelectCikModel({ attemptIndex: 0, lane });
      const be = beSelectCikModel({ attemptIndex: 0, lane });
      expect(fe.model).toBe(be.model);
      expect(fe.reason).toBe(be.reason);
    });

    it(`FE and BE select same models for lane '${lane}' attempt 1 with hard failures`, () => {
      const fe = feSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ["WEAK_ARC"] });
      const be = beSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ["WEAK_ARC"] });
      expect(fe.model).toBe(be.model);
      expect(fe.reason).toBe(be.reason);
    });

    it(`FE and BE select same models for lane '${lane}' attempt 1 without hard failures`, () => {
      const fe = feSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: [] });
      const be = beSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: [] });
      expect(fe.model).toBe(be.model);
      expect(fe.reason).toBe(be.reason);
    });
  }
});

/* ── C) Smoke: deterministic selection across surfaces ── */

describe("CIK router deterministic smoke", () => {
  const testLanes = ["feature_film", "series", "documentary", "vertical_drama", "unknown_lane"];

  for (const lane of testLanes) {
    it(`attempt 0 always cheap for lane '${lane}'`, () => {
      const fe = feSelectCikModel({ attemptIndex: 0, lane });
      const be = beSelectCikModel({ attemptIndex: 0, lane });
      expect(fe.model).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
      expect(be.model).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
    });
  }

  it("attempt 1 with failures escalates to strong model", () => {
    const fe = feSelectCikModel({ attemptIndex: 1, lane: "documentary", attempt0HardFailures: ["X"] });
    expect(fe.model).toBe(CIK_MODEL_ROUTER_CONFIG.attempt1Strong);
  });

  it("attempt 1 without failures stays cheap", () => {
    const fe = feSelectCikModel({ attemptIndex: 1, lane: "documentary", attempt0HardFailures: [] });
    expect(fe.model).toBe(CIK_MODEL_ROUTER_CONFIG.attempt0Default);
  });

  it("lane override overrides strong model for premium lanes", () => {
    for (const lane of ["feature_film", "series"]) {
      const fe = feSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ["WEAK_ARC"] });
      const be = beSelectCikModel({ attemptIndex: 1, lane, attempt0HardFailures: ["WEAK_ARC"] });
      const expected = CIK_MODEL_ROUTER_CONFIG.laneOverrides[lane]?.attempt1Strong;
      expect(fe.model).toBe(expected);
      expect(be.model).toBe(expected);
    }
  });
});
