/**
 * CI Blocker Gate v1 — Prevents promotion when CI < threshold OR unresolved blockers/high-impact notes exist.
 * Feature flag: CI_BLOCKER_GATE_V1 (default: false)
 * 
 * Usage: call evaluateCIBlockerGate() BEFORE any promotion path, AFTER ensuring fresh review exists.
 */

// ── Feature Flag ──
export function isCIBlockerGateEnabled(): boolean {
  return Deno.env.get("CI_BLOCKER_GATE_V1") === "true";
}

// ── Plateau V2 Feature Flag ──
export function isPlateauV2Enabled(): boolean {
  return Deno.env.get("CI_PLATEAU_V2") === "true";
}

// ── Rewrite Targeting Feature Flag ──
export function isRewriteTargetingEnabled(): boolean {
  return Deno.env.get("REWRITE_TARGETING_V1") === "true";
}

// ── Character Bible Depth Feature Flag ──
export function isCharBibleDepthEnabled(): boolean {
  return Deno.env.get("CHARACTER_BIBLE_DEPTH_V1") === "true";
}

// ── Types ──
export interface CIBlockerGateResult {
  pass: boolean;
  ci: number;
  gp: number;
  gap: number;
  blockerCount: number;
  highImpactCount: number;
  blockReasons: string[];
  provenance: string; // where data came from
}

export interface ReviewPayload {
  ci: number;
  gp: number;
  gap: number;
  blockers: any[];
  highImpactNotes: any[];
  trajectory: string | null;
}

/**
 * Parse the latest review step for the active version from auto_run_steps.
 * Returns structured review payload or null if not found / malformed.
 */
export async function parseLatestReviewForActiveVersion(
  supabase: any,
  jobId: string,
  docType: string,
  activeVersionId: string | null,
): Promise<ReviewPayload | null> {
  // Get latest review step for this doc_type in this job
  const { data: reviewSteps } = await supabase
    .from("auto_run_steps")
    .select("ci, gp, gap, output_ref, output_text, summary")
    .eq("job_id", jobId)
    .eq("document", docType)
    .eq("action", "review")
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(5);

  if (!reviewSteps || reviewSteps.length === 0) return null;

  // Find the review for the active version if possible
  let bestReview = reviewSteps[0]; // fallback to latest
  if (activeVersionId) {
    for (const r of reviewSteps) {
      const ref = r.output_ref || {};
      const reviewVersionId = ref.output_version_id || ref.version_id || ref.input_version_id;
      if (reviewVersionId === activeVersionId) {
        bestReview = r;
        break;
      }
    }
  }

  const ref = bestReview.output_ref || {};
  const blockers = ref.blocking_issues || ref.blockers || [];
  const highImpactNotes = ref.high_impact_notes || ref.high_impact || [];
  const trajectory = ref.trajectory || null;

  return {
    ci: bestReview.ci ?? 0,
    gp: bestReview.gp ?? 0,
    gap: bestReview.gap ?? 0,
    blockers: Array.isArray(blockers) ? blockers : [],
    highImpactNotes: Array.isArray(highImpactNotes) ? highImpactNotes : [],
    trajectory,
  };
}

/**
 * Evaluate CI Blocker Gate.
 * Returns pass=false if:
 *   (a) CI < minCI, OR
 *   (b) any blocking_issues with apply_timing="now" exist, OR
 *   (c) high_impact_notes count > highImpactThreshold
 * 
 * Fail-closed: if review payload is missing required fields, returns pass=false.
 */
export function evaluateCIBlockerGateFromPayload(
  review: ReviewPayload | null,
  minCI: number = 90,
  highImpactThreshold: number = 3,
): CIBlockerGateResult {
  if (!review) {
    return {
      pass: false,
      ci: 0, gp: 0, gap: 0,
      blockerCount: 0,
      highImpactCount: 0,
      blockReasons: ["fail_closed:no_review_payload"],
      provenance: "missing",
    };
  }

  const blockReasons: string[] = [];

  // (a) CI threshold
  if (review.ci < minCI) {
    blockReasons.push(`ci_below_threshold:${review.ci}<${minCI}`);
  }

  // (b) Blockers with apply_timing="now" (or no timing specified = default now)
  const nowBlockers = review.blockers.filter((b: any) => {
    const timing = b?.apply_timing || "now";
    return timing === "now";
  });
  if (nowBlockers.length > 0) {
    blockReasons.push(`active_blockers:${nowBlockers.length}`);
  }

  // (c) High impact notes above threshold
  const nowHighImpact = review.highImpactNotes.filter((n: any) => {
    const timing = n?.apply_timing || "now";
    return timing === "now";
  });
  if (nowHighImpact.length > highImpactThreshold) {
    blockReasons.push(`high_impact_above_threshold:${nowHighImpact.length}>${highImpactThreshold}`);
  }

  return {
    pass: blockReasons.length === 0,
    ci: review.ci,
    gp: review.gp,
    gap: review.gap,
    blockerCount: nowBlockers.length,
    highImpactCount: nowHighImpact.length,
    blockReasons,
    provenance: "auto_run_steps_review",
  };
}

// ── Plateau V2: Composite plateau check ──
export interface PlateauV2Result {
  isPlateaued: boolean;
  ciDelta: number;
  blockerCountDelta: number;
  highImpactCountDelta: number;
  currentCI: number;
  currentBlockerCount: number;
  currentHighImpactCount: number;
  reason: string;
}

/**
 * Composite plateau check: plateau only when CI not improving AND notes not shrinking.
 * Requires at least 2 review steps to evaluate.
 */
export async function checkPlateauV2(
  supabase: any,
  jobId: string,
  docType: string,
  minCI: number,
  windowSize: number = 2,
): Promise<PlateauV2Result> {
  // ── IEL: Include both 'review' AND 'rewrite_accepted' steps as CI data points ──
  // This ensures promoted candidates' scores are visible to the plateau gate,
  // matching what the UI displays via job.last_ci/last_gp.
  const CI_SCORED_ACTIONS = ["review", "rewrite_accepted"];
  const { data: recentReviews } = await supabase
    .from("auto_run_steps")
    .select("ci, output_ref, step_index, action")
    .eq("job_id", jobId)
    .eq("document", docType)
    .in("action", CI_SCORED_ACTIONS)
    .not("ci", "is", null)
    .order("step_index", { ascending: false })
    .limit(windowSize + 2);

  console.log(`[auto-run][IEL] plateau_v2_ci_source { job_id: "${jobId}", doc_type: "${docType}", steps_found: ${recentReviews?.length ?? 0}, actions_queried: ${JSON.stringify(CI_SCORED_ACTIONS)}, latest_ci: ${recentReviews?.[0]?.ci ?? 'null'}, latest_action: "${recentReviews?.[0]?.action ?? 'none'}", latest_step_index: ${recentReviews?.[0]?.step_index ?? 'null'} }`);

  if (!recentReviews || recentReviews.length < 2) {
    return {
      isPlateaued: false,
      ciDelta: 0, blockerCountDelta: 0, highImpactCountDelta: 0,
      currentCI: recentReviews?.[0]?.ci ?? 0,
      currentBlockerCount: 0, currentHighImpactCount: 0,
      reason: "insufficient_data",
    };
  }

  const current = recentReviews[0];
  const previous = recentReviews[1];

  const currentCI = current.ci ?? 0;
  const previousCI = previous.ci ?? 0;
  const ciDelta = currentCI - previousCI;

  // Extract blocker/high-impact counts from output_ref
  const extractCounts = (step: any) => {
    const ref = step?.output_ref || {};
    const blockers = ref.blocking_issues || ref.blockers || [];
    const highImpact = ref.high_impact_notes || ref.high_impact || [];
    return {
      blockerCount: Array.isArray(blockers) ? blockers.filter((b: any) => (b?.apply_timing || "now") === "now").length : 0,
      highImpactCount: Array.isArray(highImpact) ? highImpact.filter((n: any) => (n?.apply_timing || "now") === "now").length : 0,
    };
  };

  const currentCounts = extractCounts(current);
  const previousCounts = extractCounts(previous);

  const blockerCountDelta = currentCounts.blockerCount - previousCounts.blockerCount;
  const highImpactCountDelta = currentCounts.highImpactCount - previousCounts.highImpactCount;

  // Plateau = CI not improving AND (blockers not decreasing AND high-impact not decreasing)
  const ciNotImproving = ciDelta < 1; // less than CI_MIN_DELTA
  const notesNotShrinking = blockerCountDelta >= 0 && highImpactCountDelta >= 0;

  // Check consecutive non-improving window
  let consecutiveNonImproving = 0;
  for (let i = 0; i < recentReviews.length - 1; i++) {
    if ((recentReviews[i].ci ?? 0) < (recentReviews[i + 1].ci ?? 0) + 1) {
      consecutiveNonImproving++;
    } else {
      break;
    }
  }

  const isPlateaued = currentCI < minCI && ciNotImproving && notesNotShrinking && consecutiveNonImproving >= windowSize;

  return {
    isPlateaued,
    ciDelta,
    blockerCountDelta,
    highImpactCountDelta,
    currentCI,
    currentBlockerCount: currentCounts.blockerCount,
    currentHighImpactCount: currentCounts.highImpactCount,
    reason: isPlateaued
      ? `plateau_v2:ci_delta=${ciDelta},blocker_delta=${blockerCountDelta},hi_delta=${highImpactCountDelta},window=${consecutiveNonImproving}`
      : "not_plateaued",
  };
}

// ── Rewrite Targeting Compiler ──
export interface RewriteDirective {
  index: number;
  noteId: string;
  category: string;
  severity: string;
  directive: string;
  episodeIndex?: number; // for episode_grid row targeting
}

/**
 * Compile evaluator blockers + highImpactNotes into deterministic rewrite directives.
 * Fail-closed: returns empty array + failClosed=true if notes are absent.
 */
export function compileRewriteDirectives(
  blockers: any[],
  highImpactNotes: any[],
  docType: string,
): { directives: RewriteDirective[]; failClosed: boolean; reason: string } {
  if (!Array.isArray(blockers) && !Array.isArray(highImpactNotes)) {
    return { directives: [], failClosed: true, reason: "no_notes_arrays_provided" };
  }

  const allNotes = [
    ...(blockers || []).map((b: any) => ({ ...b, severity: "blocker" })),
    ...(highImpactNotes || []).map((n: any) => ({ ...n, severity: "high" })),
  ].filter((n: any) => (n?.apply_timing || "now") === "now");

  if (allNotes.length === 0) {
    return { directives: [], failClosed: false, reason: "no_actionable_notes" };
  }

  const directives: RewriteDirective[] = allNotes.map((note: any, i: number) => {
    const directive: RewriteDirective = {
      index: i,
      noteId: note.id || note.note_key || `note_${i}`,
      category: note.category || "general",
      severity: note.severity,
      directive: note.description || note.note || "Fix this issue",
    };

    // Episode-specific targeting for episode_grid
    if (docType === "episode_grid" && note.description) {
      const epMatch = note.description.match(/[Ee]pisode\s*(\d+)/);
      if (epMatch) {
        directive.episodeIndex = parseInt(epMatch[1], 10);
      }
    }

    return directive;
  });

  return { directives, failClosed: false, reason: "compiled" };
}

/**
 * Format compiled directives into rewrite direction strings.
 */
export function formatDirectivesAsDirections(directives: RewriteDirective[], docType: string): string[] {
  if (directives.length === 0) return [];

  const lines: string[] = [
    "TARGETED REWRITE DIRECTIVES (from evaluator — address each specifically):",
  ];

  for (const d of directives) {
    const prefix = d.severity === "blocker" ? "🔴 BLOCKER" : "🟡 HIGH-IMPACT";
    const epTag = d.episodeIndex != null ? ` [Episode ${d.episodeIndex}]` : "";
    lines.push(`${prefix} [${d.category}]${epTag}: ${d.directive}`);
  }

  lines.push("Do NOT rewrite sections not mentioned above unless structurally necessary.");

  return lines;
}

// ── Character Bible Depth Checklist (Schema v2) ──
export const CHARACTER_BIBLE_DEPTH_PROMPT_BLOCK = `
## CHARACTER SCHEMA v2 — MANDATORY STRUCTURE

### DESCRIPTOR POLICY (STRICTLY ENFORCED)
DO NOT use:
- Vague personality descriptors ("enigmatic", "magnetic presence", "complex soul")
- Poetic or metaphorical language ("storm beneath calm", "fire and ice")
- Ambiguous emotional phrasing ("deeply conflicted", "haunted by the past")

INSTEAD use:
- Structural descriptors: social position, institutional role, operational function
- Relational clarity: power dynamics, leverage, dependency, obligation
- System-based positioning: where they sit in hierarchy, who they answer to, who answers to them

### CORE CHARACTER REQUIREMENTS (each principal character MUST have ALL):
1. **Social Position** — Where they sit in the hierarchy/class/institution. Be specific (e.g., "junior partner at a mid-tier consulting firm", NOT "ambitious professional").
2. **Functional Role** — What they DO operationally in the world. Concrete daily activity.
3. **World Embedding** — Physical location, daily environment, institutional context they move through.
4. **Want vs Need** — External goal (specific, measurable) vs internal truth (must conflict with Want).
5. **Wound** — The specific formative event (name the event, not a vague feeling).
6. **Flaw** — Internal limitation that generates story friction. Behavioral, not poetic.
7. **Key Relationships** — Map dynamics with at least 2 other characters. Show power dynamics, obligations, tensions.
8. **Arc** — Start state → breaking point → end state. Concrete, not aspirational.
9. **Voice** — Speech register, vocabulary level, verbal tics, avoidances.

### WORLD CHARACTER REQUIREMENTS (NON-CANONICAL — supporting/background):
World characters populate the social ecosystem. They require ONLY:
- Name or Role Title
- Social Position (hierarchy layer)
- Functional Role (what they do)
- World Embedding (where they operate)

Do NOT give world characters full arcs or detailed wounds. They are environmental texture.

### WORLD DENSITY REQUIREMENT:
The bible MUST include a "WORLD CHARACTERS" section with:
- At least 2–3 visible hierarchy layers (e.g., management/staff/street, court/church/merchants)
- At least 5–10 supporting/world roles for prestige or large-scale projects
- Institutional roles, intermediaries, enforcers, rivals, environmental figures
- These characters create a lived-in, socially stratified world

### CANON SEPARATION:
- Characters in "PRINCIPAL CHARACTERS" and "ANTAGONIST" sections = CANONICAL (persist in canon)
- Characters in "WORLD CHARACTERS" section = NON-CANONICAL (generation-only, disposable)
- CLEARLY label the "WORLD CHARACTERS" section header with "(NON-CANONICAL)"
`;

// ── Character Bible Depth Eval Extension (Schema v2) ──
export const CHARACTER_BIBLE_DEPTH_EVAL_BLOCK = `
## CHARACTER DEPTH SCORING — SCHEMA v2 (MANDATORY for character_bible evaluation)

For each PRINCIPAL character, check these Schema v2 requirements:
- social_position, functional_role, world_embedding, want_vs_need, wound, flaw, relationships, arc, voice
- If ANY principal character is missing 3+ items: BLOCKER (severity: blocker, category: character)
- If ANY principal character is missing 1-2 items: HIGH-IMPACT (severity: high, category: character)

DESCRIPTOR QUALITY CHECK:
- If any character uses vague descriptors ("enigmatic", "magnetic", "complex soul", "storm beneath calm"): HIGH-IMPACT penalty
- Characters must be positioned structurally (hierarchy, institution, function) not poetically

WORLD DENSITY CHECK:
- If no "WORLD CHARACTERS" section exists: HIGH-IMPACT (severity: high, category: world_density)
- If fewer than 5 world roles for a prestige project: note as improvement area
- If no visible hierarchy layers: HIGH-IMPACT

GP IMPACT: A character bible with isolated characters (no social system, no hierarchy, no institutional context) cannot score above 70 GP regardless of individual character depth.
CI IMPACT: Missing Schema v2 structural fields = direct CI penalty. Shallow characters cannot score above 75 CI.
`;
