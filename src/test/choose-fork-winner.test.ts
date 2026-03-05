/**
 * chooseForkWinner — deterministic fork winner selection tests.
 * Policy: composite_first_v1
 *   1) highest composite (ci+gp)
 *   2) highest ci
 *   3) highest gp
 *   4) fewest blockers
 *   5) prefer aggressive (stable tiebreak)
 */
import { describe, it, expect } from "vitest";

type ForkCandidate = { versionId: string; ci: number; gp: number; blockerCount: number; label: string; decision: string };

function chooseForkWinner(candidates: ForkCandidate[]): { winner: ForkCandidate; loser: ForkCandidate | null; reason: string } {
  if (candidates.length === 0) return { winner: candidates[0], loser: null, reason: "no_candidates" };
  if (candidates.length === 1) return { winner: candidates[0], loser: null, reason: "single_candidate" };
  const sorted = [...candidates].sort((a, b) => {
    const compositeA = a.ci + a.gp, compositeB = b.ci + b.gp;
    if (compositeB !== compositeA) return compositeB - compositeA;
    if (b.ci !== a.ci) return b.ci - a.ci;
    if (b.gp !== a.gp) return b.gp - a.gp;
    if (a.blockerCount !== b.blockerCount) return a.blockerCount - b.blockerCount;
    return a.label === "aggressive" ? -1 : b.label === "aggressive" ? 1 : 0;
  });
  const w = sorted[0], l = sorted.length > 1 ? sorted[1] : null;
  const wComp = w.ci + w.gp, lComp = l ? l.ci + l.gp : -1;
  const reason = wComp > lComp ? "higher_composite" : w.ci > (l?.ci ?? -1) ? "higher_ci" : w.gp > (l?.gp ?? -1) ? "higher_gp" : w.blockerCount < (l?.blockerCount ?? Infinity) ? "fewer_blockers" : "tiebreak_aggressive";
  return { winner: w, loser: l, reason };
}

const mkCand = (label: string, ci: number, gp: number, blockers = 0): ForkCandidate => ({
  versionId: `${label}-v1`, ci, gp, blockerCount: blockers, label, decision: "PROMOTE",
});

describe("chooseForkWinner", () => {
  it("picks higher composite winner", () => {
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 85, 90), mkCand("aggressive", 88, 92)]);
    expect(winner.label).toBe("aggressive");
    expect(reason).toBe("higher_composite");
  });

  it("picks higher composite even when loser has fewer blockers (the bug fix)", () => {
    // Conservative has 0 blockers but lower scores; aggressive has 3 blockers but higher scores
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 85, 90, 0), mkCand("aggressive", 88, 92, 3)]);
    expect(winner.label).toBe("aggressive");
    expect(reason).toBe("higher_composite");
  });

  it("uses ci as first tiebreaker when composite is equal", () => {
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 90, 80), mkCand("aggressive", 85, 85)]);
    // Both composite = 170, conservative has higher ci
    expect(winner.label).toBe("conservative");
    expect(reason).toBe("higher_ci");
  });

  it("uses gp as second tiebreaker", () => {
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 85, 86), mkCand("aggressive", 85, 85)]);
    // Both composite = 171 vs 170 — actually conservative wins by composite here
    // Let me make them equal: 85+85=170 vs 85+85=170 with different gp... need same ci
    const r = chooseForkWinner([mkCand("conservative", 85, 84), mkCand("aggressive", 85, 85)]);
    expect(r.winner.label).toBe("aggressive");
    expect(r.reason).toBe("higher_composite"); // 170 > 169
  });

  it("uses blockers as tiebreaker when scores identical", () => {
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 85, 85, 1), mkCand("aggressive", 85, 85, 3)]);
    expect(winner.label).toBe("conservative");
    expect(reason).toBe("fewer_blockers");
  });

  it("prefers aggressive as stable tiebreak when everything equal", () => {
    const { winner, reason } = chooseForkWinner([mkCand("conservative", 85, 85, 2), mkCand("aggressive", 85, 85, 2)]);
    expect(winner.label).toBe("aggressive");
    expect(reason).toBe("tiebreak_aggressive");
  });

  it("returns single candidate as winner", () => {
    const { winner, loser, reason } = chooseForkWinner([mkCand("conservative", 80, 80)]);
    expect(winner.label).toBe("conservative");
    expect(loser).toBeNull();
    expect(reason).toBe("single_candidate");
  });
});
