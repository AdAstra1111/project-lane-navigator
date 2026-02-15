import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Document ladder ──
const LADDER = ["idea", "concept_brief", "blueprint", "architecture", "draft", "coverage"] as const;
type DocStage = (typeof LADDER)[number];

function nextDoc(current: DocStage): DocStage | null {
  const idx = LADDER.indexOf(current);
  return idx >= 0 && idx < LADDER.length - 1 ? LADDER[idx + 1] : null;
}

// ── Stage-specific weight profiles ──
const WEIGHTS: Record<DocStage, { ci: number; gp: number; gap: number; traj: number; hi: number; pen: number }> = {
  idea:            { ci: 0.20, gp: 0.30, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  concept_brief:   { ci: 0.25, gp: 0.25, gap: 0.10, traj: 0.15, hi: 0.20, pen: 0.05 },
  blueprint:       { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  architecture:    { ci: 0.30, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.15, pen: 0.05 },
  draft:           { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
  coverage:        { ci: 0.35, gp: 0.20, gap: 0.10, traj: 0.20, hi: 0.10, pen: 0.05 },
};

// ── Trajectory score mapping ──
function trajectoryScore(t: string | null): number {
  switch ((t || "").toLowerCase().replace(/[_-]/g, "")) {
    case "converging": return 90;
    case "strengthened": return 85;
    case "stalled": return 55;
    case "overoptimised": case "overoptimized": return 60;
    case "eroding": return 25;
    default: return 55;
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ── Derive blocker / high-impact counts from raw_ai_response JSONB ──
function deriveCounts(raw: any): { blockers: number; highImpact: number; blockerTexts: string[] } {
  if (!raw) return { blockers: 0, highImpact: 0, blockerTexts: [] };
  const blocking = raw.blocking_issues || raw.blockers || [];
  const high = raw.high_impact_notes || raw.high_impact || [];
  const blockerTexts = blocking.map((b: any) =>
    typeof b === "string" ? b : b?.description || b?.note || JSON.stringify(b)
  );
  return { blockers: blocking.length, highImpact: high.length, blockerTexts };
}

// ── Simple string hash for thrash detection ──
function hashStr(s: string): string {
  return s.toLowerCase().trim().slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const body = await req.json();
    const sessionId: string = body.sessionId;
    const currentDocumentRaw: string = body.current_document || "concept_brief";

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId required" }), { status: 400, headers: corsHeaders });
    }

    const currentDocument = (LADDER.includes(currentDocumentRaw as DocStage)
      ? currentDocumentRaw
      : "concept_brief") as DocStage;

    // ── Fetch session ──
    const { data: session, error: sessErr } = await supabase
      .from("dev_engine_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();

    if (sessErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found or access denied" }), { status: 404, headers: corsHeaders });
    }

    const latestCI = Number(session.latest_ci) || 0;
    const latestGP = Number(session.latest_gp) || 0;
    const latestGap = Number(session.latest_gap) || 0;
    const sessionTrajectory = session.trajectory || null;
    const currentIteration = session.current_iteration || 1;

    // ── Fetch last 3 iterations ──
    const { data: iterations } = await supabase
      .from("dev_engine_iterations")
      .select("iteration_number, trajectory, raw_ai_response, ci_score, gp_score, gap")
      .eq("session_id", sessionId)
      .order("iteration_number", { ascending: false })
      .limit(3);

    const iters = (iterations || []).reverse(); // chronological order

    // Derive blocker/high-impact counts from latest iteration
    const latestIter = iters.length > 0 ? iters[iters.length - 1] : null;
    const latestCounts = deriveCounts(latestIter?.raw_ai_response);
    const blockersCount = latestCounts.blockers;
    const highImpactCount = latestCounts.highImpact;

    const reasons: string[] = [];
    const riskFlags: string[] = [];
    const mustFixNext: string[] = [];

    // Risk flag if blocker count unavailable
    if (!latestIter?.raw_ai_response) {
      riskFlags.push("blocker_count_unavailable");
    }

    if (currentDocumentRaw !== currentDocument) {
      riskFlags.push("document_type_assumed");
    }

    // ══════════════════════════════════
    // HARD GATES
    // ══════════════════════════════════

    // Gate A — Blockers
    if (blockersCount > 0) {
      reasons.push("Blocking issues remain (" + blockersCount + " active)");
      mustFixNext.push(...latestCounts.blockerTexts.slice(0, 3));
      if (mustFixNext.length === 0) mustFixNext.push("Resolve blocking issues");

      return respond({
        recommendation: "stabilise",
        next_document: null,
        readiness_score: 0,
        confidence: computeConfidence(currentIteration, highImpactCount, latestGap, sessionTrajectory),
        reasons,
        must_fix_next: mustFixNext,
        risk_flags: riskFlags,
      });
    }

    // Gate B — Trajectory crash (eroding 2 consecutive)
    if (iters.length >= 2) {
      const lastTwo = iters.slice(-2);
      const bothEroding = lastTwo.every(
        (it) => (it.trajectory || "").toLowerCase() === "eroding"
      );
      if (bothEroding) {
        reasons.push("Trajectory eroding across iterations");
        mustFixNext.push("Run Executive Strategy Loop");
        return respond({
          recommendation: "escalate",
          next_document: null,
          readiness_score: 0,
          confidence: computeConfidence(currentIteration, highImpactCount, latestGap, sessionTrajectory),
          reasons,
          must_fix_next: mustFixNext,
          risk_flags: riskFlags,
        });
      }
    }

    // Gate C — Thrash detection
    if (iters.length >= 3) {
      const counts = iters.map((it) => deriveCounts(it.raw_ai_response).blockers);
      // oscillation: 0→N→0 or N→0→N
      const oscillation =
        (counts[0] === 0 && counts[1] > 0 && counts[2] === 0) ||
        (counts[0] > 0 && counts[1] === 0 && counts[2] > 0);

      // same top issue repeats 3 times
      let repeatedIssue = false;
      const allBlockerHashes = iters.map((it) =>
        deriveCounts(it.raw_ai_response).blockerTexts.map(hashStr)
      );
      if (allBlockerHashes.length === 3) {
        const flat0 = new Set(allBlockerHashes[0]);
        const flat1 = new Set(allBlockerHashes[1]);
        const flat2 = new Set(allBlockerHashes[2]);
        for (const h of flat0) {
          if (flat1.has(h) && flat2.has(h)) { repeatedIssue = true; break; }
        }
      }

      if (oscillation || repeatedIssue) {
        reasons.push("Note thrash detected");
        mustFixNext.push("Run Executive Strategy Loop");
        return respond({
          recommendation: "escalate",
          next_document: null,
          readiness_score: 0,
          confidence: computeConfidence(currentIteration, highImpactCount, latestGap, sessionTrajectory),
          reasons,
          must_fix_next: mustFixNext,
          risk_flags: riskFlags,
        });
      }
    }

    // ══════════════════════════════════
    // WEIGHTED READINESS SCORE
    // ══════════════════════════════════

    const w = WEIGHTS[currentDocument];
    const gapScore = 100 - clamp(latestGap * 2, 0, 100);
    const trajScore = trajectoryScore(sessionTrajectory);
    const hiScore = 100 - clamp(highImpactCount * 10, 0, 60);
    const iterPenalty = clamp((currentIteration - 2) * 4, 0, 20);

    let readinessScore = Math.round(
      latestCI * w.ci +
      latestGP * w.gp +
      gapScore * w.gap +
      trajScore * w.traj +
      hiScore * w.hi -
      iterPenalty * w.pen
    );
    readinessScore = clamp(readinessScore, 0, 100);

    // ── Decision ──
    let recommendation: "promote" | "stabilise" | "escalate";
    const next = nextDoc(currentDocument);

    if (readinessScore >= 78) {
      recommendation = "promote";
    } else if (readinessScore >= 65) {
      recommendation = "stabilise";
    } else {
      recommendation = "escalate";
    }

    // Over-Optimised nudge
    if (
      (sessionTrajectory || "").toLowerCase().replace(/[_-]/g, "") === "overoptimised" &&
      blockersCount === 0 &&
      latestGP >= 60 &&
      readinessScore >= 72
    ) {
      recommendation = "promote";
      reasons.push("Over-optimised: promote to avoid endless polishing");
    }

    // ── Reasons ──
    reasons.push(`Readiness score: ${readinessScore}/100`);
    reasons.push(`CI: ${latestCI}, GP: ${latestGP}, Gap: ${latestGap}`);
    reasons.push(`Trajectory: ${sessionTrajectory || "unknown"}`);
    if (highImpactCount > 0) {
      reasons.push(`${highImpactCount} high-impact note(s) remaining`);
    }
    if (currentIteration > 3) {
      reasons.push(`${currentIteration} iterations completed — diminishing returns possible`);
    }

    // ── Must-fix-next ──
    if (recommendation === "promote" && next) {
      mustFixNext.push(`Promote to ${next}`);
    } else if (recommendation === "stabilise") {
      // Include top 2 high-impact note summaries
      const hiNotes = (latestIter?.raw_ai_response?.high_impact_notes || []).slice(0, 2);
      for (const n of hiNotes) {
        mustFixNext.push(typeof n === "string" ? n : n?.description || n?.note || "Resolve high-impact notes");
      }
      if (mustFixNext.length === 0) mustFixNext.push("Resolve high-impact notes");
      mustFixNext.push("Run another editorial pass");
    } else if (recommendation === "escalate") {
      mustFixNext.push("Run Executive Strategy Loop");
      mustFixNext.push("Consider repositioning format or lane");
    }

    const confidence = computeConfidence(currentIteration, highImpactCount, latestGap, sessionTrajectory);

    return respond({
      recommendation,
      next_document: recommendation === "promote" ? next : null,
      readiness_score: readinessScore,
      confidence,
      reasons,
      must_fix_next: mustFixNext,
      risk_flags: riskFlags,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ──

function computeConfidence(
  currentIteration: number,
  highImpactCount: number,
  gap: number,
  trajectory: string | null
): number {
  let c = 70;
  if (currentIteration <= 1) c -= 10;
  if (highImpactCount >= 5) c -= 10;
  if (gap >= 20) c -= 15;
  const t = (trajectory || "").toLowerCase().replace(/[_-]/g, "");
  if (t === "converging" || t === "strengthened") c += 10;
  return clamp(c, 0, 100);
}

function respond(data: any): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
